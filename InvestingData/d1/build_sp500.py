"""S&P 500 전 종목을 yfinance로 수집해 D1(stocks, op_income_history)용 SQL 파일을 만든다.

설치:  pip install yfinance pandas lxml requests
실행:  python build_sp500.py                 (전체 → sp500_data.sql)
       python build_sp500.py --limit 10      (앞 10종목만 테스트)
       python build_sp500.py --symbols AAPL MSFT GOOGL
적재:  npx wrangler d1 execute investing_stocks --remote --file=sp500_data.sql
       또는 python build_sp500.py --upload   (수집 후 바로 D1 적재)
"""
import argparse
import io
import logging
import math
import os
import shutil
import ssl
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timezone
from pathlib import Path

import certifi
import pandas as pd
import requests
import yfinance as yf

HERE = Path(__file__).resolve().parent
SP500_URL = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
EXCHANGES = {"NMS": "NASDAQ", "NGM": "NASDAQ", "NCM": "NASDAQ", "NYQ": "NYSE",
             "ASE": "NYSE American", "PCX": "NYSE Arca", "BTS": "Cboe"}
# 한 회사가 두 클래스로 편입된 경우 제외할 쪽 (GOOGL·FOXA·NWSA만 유지)
SECONDARY_CLASSES = {"GOOG", "FOX", "NWS"}

# 값이 없는 항목의 404 등은 None 으로 처리하므로 yfinance 자체 오류 로그는 숨김
logging.getLogger("yfinance").setLevel(logging.CRITICAL)


def _ca_bundle():
    """certifi + Windows 인증서 저장소(회사망 SSL 검사 루트 포함)를 합친 PEM 경로."""
    if sys.platform != "win32":
        return certifi.where()
    ctx = ssl.create_default_context()
    pems = [ssl.DER_cert_to_PEM_cert(c) for c in ctx.get_ca_certs(binary_form=True)]
    path = HERE / ".ca_bundle.pem"
    path.write_text(Path(certifi.where()).read_text(encoding="utf-8") + "\n" + "".join(pems),
                    encoding="utf-8")
    return str(path)


CA = _ca_bundle()
os.environ.setdefault("REQUESTS_CA_BUNDLE", CA)
os.environ.setdefault("CURL_CA_BUNDLE", CA)
try:
    from curl_cffi import requests as curl_requests
    # yfinance는 세션·crumb를 전역 싱글턴에 두므로 모든 스레드가 같은 세션을 써야 함
    YF_SESSION = curl_requests.Session(impersonate="chrome", verify=CA)
except ImportError:
    YF_SESSION = None


def _ticker(symbol):
    return yf.Ticker(symbol, session=YF_SESSION) if YF_SESSION else yf.Ticker(symbol)

STOCK_COLS = [
    "symbol", "name", "exchange", "sector", "industry", "market_cap", "fy0",
    "rev_est_0y", "rev_est_1y", "rev_growth_0y", "rev_growth_1y",
    "eps_growth_0y", "eps_growth_1y", "roe_ttm", "roe_est_0y", "roe_est_1y",
    "eps_est_0y", "eps_est_1y", "eps_rev_1m", "eps_rev_3m", "eps_up_30d", "eps_down_30d",
    "forward_pe", "pbr", "price", "high_52w", "low_52w",
    "chg_from_high", "chg_from_low", "chg_1m",
    "volume", "avg_vol_1y", "avg_vol_1w", "vol_chg",
    "inst_pct", "insider_net_6m", "short_pct", "div_yield", "op_last", "op_yoy", "updated_at",
]
COL_TYPES = {c: "TEXT" for c in ("name", "exchange", "sector", "industry", "updated_at")}
COL_TYPES.update({c: "INTEGER" for c in ("fy0", "eps_up_30d", "eps_down_30d", "volume",
                                          "avg_vol_1y", "avg_vol_1w", "insider_net_6m")})


def sp500_symbols():
    html = requests.get(SP500_URL, headers={"User-Agent": "Mozilla/5.0"}, timeout=30,
                        verify=CA).text
    df = pd.read_html(io.StringIO(html), attrs={"id": "constituents"})[0]
    symbols = {s.replace(".", "-") for s in df["Symbol"].astype(str)}
    return sorted(symbols - SECONDARY_CLASSES)


def num(v, scale=1.0):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return f * scale


def pct_change(a, b):
    a, b = num(a), num(b)
    return (a / b - 1) * 100 if a is not None and b else None


def cell(df, row, col, scale=1.0):
    try:
        return num(df.loc[row, col], scale)
    except Exception:
        return None


def collect(symbol):
    t = _ticker(symbol)
    info = t.info or {}
    if not info.get("longName") and not info.get("shortName"):
        raise ValueError("info 없음")

    rev = _safe(lambda: t.revenue_estimate)
    ern = _safe(lambda: t.earnings_estimate)
    trend = _safe(lambda: t.eps_trend)
    revs = _safe(lambda: t.eps_revisions)
    hist = _safe(lambda: t.history(period="1y", auto_adjust=False))
    ins = _safe(lambda: t.insider_purchases)
    inc = _safe(lambda: t.income_stmt)

    price = num(info.get("currentPrice") or info.get("regularMarketPrice"))
    close = hist["Close"].dropna() if hist is not None and not hist.empty else None
    vol = hist["Volume"].dropna() if hist is not None and not hist.empty else None
    if price is None and close is not None and len(close):
        price = num(close.iloc[-1])
    high, low = num(info.get("fiftyTwoWeekHigh")), num(info.get("fiftyTwoWeekLow"))
    bvps = num(info.get("bookValue"))
    eps0, eps1 = cell(ern, "0y", "avg"), cell(ern, "+1y", "avg")

    fy0 = None
    if info.get("lastFiscalYearEnd"):
        fy0 = datetime.fromtimestamp(info["lastFiscalYearEnd"], tz=timezone.utc).year + 1

    insider = None
    if ins is not None and not ins.empty:
        m = ins[ins.iloc[:, 0].astype(str).str.startswith("Net Shares")]
        if not m.empty:
            insider = num(m["Shares"].iloc[0])

    avg1y = num(vol.mean()) if vol is not None and len(vol) else None
    avg1w = num(vol.tail(5).mean()) if vol is not None and len(vol) else None

    row = {
        "symbol": symbol,
        "name": info.get("longName") or info.get("shortName"),
        "exchange": EXCHANGES.get(info.get("exchange"), info.get("exchange")),
        "sector": info.get("sector"),
        "industry": info.get("industry"),
        "market_cap": num(info.get("marketCap"), 1e-6),
        "fy0": fy0,
        "rev_est_0y": cell(rev, "0y", "avg", 1e-6),
        "rev_est_1y": cell(rev, "+1y", "avg", 1e-6),
        "rev_growth_0y": cell(rev, "0y", "growth", 100),
        "rev_growth_1y": cell(rev, "+1y", "growth", 100),
        "eps_growth_0y": cell(ern, "0y", "growth", 100),
        "eps_growth_1y": cell(ern, "+1y", "growth", 100),
        "roe_ttm": num(info.get("returnOnEquity"), 100),
        "roe_est_0y": eps0 / bvps * 100 if eps0 is not None and bvps and bvps > 0 else None,
        "roe_est_1y": eps1 / bvps * 100 if eps1 is not None and bvps and bvps > 0 else None,
        "eps_est_0y": eps0,
        "eps_est_1y": eps1,
        "eps_rev_1m": pct_change(cell(trend, "0y", "current"), cell(trend, "0y", "30daysAgo")),
        "eps_rev_3m": pct_change(cell(trend, "0y", "current"), cell(trend, "0y", "90daysAgo")),
        "eps_up_30d": cell(revs, "0y", "upLast30days"),
        "eps_down_30d": cell(revs, "0y", "downLast30days"),
        "forward_pe": num(info.get("forwardPE")),
        "pbr": num(info.get("priceToBook")),
        "price": price,
        "high_52w": high,
        "low_52w": low,
        "chg_from_high": pct_change(price, high),
        "chg_from_low": pct_change(price, low),
        "chg_1m": pct_change(close.iloc[-1], close.iloc[-21]) if close is not None and len(close) > 21 else None,
        "volume": num(vol.iloc[-1]) if vol is not None and len(vol) else None,
        "avg_vol_1y": avg1y,
        "avg_vol_1w": avg1w,
        "vol_chg": pct_change(avg1w, avg1y),
        "inst_pct": num(info.get("heldPercentInstitutions"), 100),
        "insider_net_6m": insider,
        "short_pct": num(info.get("shortPercentOfFloat"), 100),
        "div_yield": num(info.get("trailingAnnualDividendYield"), 100),
        "updated_at": date.today().isoformat(),
    }

    ops = []
    if inc is not None and not inc.empty and "Operating Income" in inc.index:
        for col, v in inc.loc["Operating Income"].items():
            v = num(v, 1e-6)
            if v is not None:
                ops.append((pd.Timestamp(col).year, v))
    ops = sorted(ops)[-5:]
    last = ops[-1][1] if ops else None
    prev = ops[-2][1] if len(ops) > 1 else None
    row["op_last"] = last
    row["op_yoy"] = (last / prev - 1) * 100 if last is not None and prev and prev > 0 else None
    return row, ops


def _safe(fn):
    try:
        return fn()
    except Exception:
        return None


def sql_val(v):
    if v is None:
        return "NULL"
    if isinstance(v, str):
        return "'" + v.replace("'", "''") + "'"
    if isinstance(v, float) and v.is_integer() and abs(v) > 1e6:
        return str(int(v))
    return repr(round(v, 4)) if isinstance(v, float) else str(v)


def to_sql(row, ops):
    out = ["INSERT OR REPLACE INTO stocks (%s) VALUES (%s);" % (
        ", ".join(STOCK_COLS), ", ".join(sql_val(row.get(c)) for c in STOCK_COLS))]
    sym = sql_val(row["symbol"])
    out.append("DELETE FROM op_income_history WHERE symbol = %s;" % sym)
    if ops:
        out.append("INSERT INTO op_income_history (symbol, fiscal_year, operating_income) VALUES %s;"
                   % ", ".join("(%s, %d, %s)" % (sym, y, sql_val(v)) for y, v in ops))
    return "\n".join(out)


def fetch_with_retry(symbol, tries=5):
    for i in range(tries):
        try:
            return collect(symbol)
        except Exception as exc:
            err = exc
            limited = "Rate limited" in str(exc) or "Too Many Requests" in str(exc)
            time.sleep((30 if limited else 2) * (i + 1))
    raise err


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", nargs="*")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--out", default=str(HERE / "sp500_data.sql"))
    ap.add_argument("--upload", action="store_true", help="저장 후 wrangler로 원격 D1에 적재")
    ap.add_argument("--log", help="콘솔 출력을 이 파일에도 덧붙임")
    args = ap.parse_args()
    if args.log:
        logf = open(args.log, "a", encoding="utf-8")
        sys.stdout = _Tee(sys.__stdout__, logf)
        sys.stderr = _Tee(sys.__stderr__, logf)

    symbols = [s.upper() for s in args.symbols] if args.symbols else sp500_symbols()
    if args.limit:
        symbols = symbols[: args.limit]
    print("대상 %d종목" % len(symbols))

    schema = "\n".join(
        ["CREATE TABLE IF NOT EXISTS stocks (",
         "  symbol TEXT PRIMARY KEY,",
         ",\n".join("  %s %s" % (c, COL_TYPES.get(c, "REAL")) for c in STOCK_COLS[1:]),
         ");",
         "CREATE TABLE IF NOT EXISTS op_income_history (",
         "  symbol TEXT NOT NULL, fiscal_year INTEGER NOT NULL, operating_income REAL,",
         "  PRIMARY KEY (symbol, fiscal_year)",
         ");"])
    dup = ", ".join(sql_val(s) for s in sorted(SECONDARY_CLASSES))
    schema += "\nDELETE FROM stocks WHERE symbol IN (%s);" % dup
    schema += "\nDELETE FROM op_income_history WHERE symbol IN (%s);" % dup
    if not args.symbols and not args.limit and len(symbols) >= 450:
        # 전체 수집일 때만 지수에서 빠진 종목 정리 (목록 파싱 이상 시 대량 삭제 방지)
        keep = ", ".join(sql_val(s) for s in symbols)
        schema += "\nDELETE FROM stocks WHERE symbol NOT IN (%s);" % keep
        schema += "\nDELETE FROM op_income_history WHERE symbol NOT IN (%s);" % keep
    results, failed = {}, []
    n, t0 = len(symbols), time.time()
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(fetch_with_retry, s): s for s in symbols}
        for i, f in enumerate(as_completed(futs), 1):
            s = futs[f]
            el = time.time() - t0
            prog = "[%d/%d %3d%% 경과 %s 남은 %s]" % (
                i, n, i * 100 // n, _mmss(el), _mmss(el / i * (n - i)))
            try:
                results[s] = to_sql(*f.result())
                print("%s %s OK" % (prog, s))
            except Exception as exc:
                failed.append(s)
                print("%s %s 실패: %s" % (prog, s, exc), file=sys.stderr)

    if failed:
        print("실패 %d종목 재시도 (단일 작업)" % len(failed))
        time.sleep(30)
        retry, failed = failed, []
        for i, s in enumerate(retry, 1):
            try:
                results[s] = to_sql(*fetch_with_retry(s, tries=3))
                print("[재시도 %d/%d] %s OK" % (i, len(retry), s))
            except Exception as exc:
                failed.append(s)
                print("[재시도 %d/%d] %s 실패: %s" % (i, len(retry), s, exc), file=sys.stderr)

    body = "\n\n".join(results[s] for s in sorted(results))
    Path(args.out).write_text(schema.rstrip() + "\n\n" + body + "\n", encoding="utf-8")
    print("저장: %s (성공 %d, 실패 %d)" % (args.out, len(results), len(failed)))
    if failed:
        print("실패 종목:", " ".join(failed))
    if args.upload:
        sys.exit(upload(args.out))


def upload(sql_path):
    npx = shutil.which("npx")
    if not npx:
        print("npx를 찾을 수 없습니다 (Node.js 설치 필요)", file=sys.stderr)
        return 1
    env = dict(os.environ)
    # 회사망 SSL 검사 루트를 Node가 신뢰하도록
    env["NODE_OPTIONS"] = (env.get("NODE_OPTIONS", "") + " --use-system-ca").strip()
    cmd = [npx, "wrangler", "d1", "execute", "investing_stocks", "--remote",
           "--file=%s" % sql_path, "--yes"]
    print("적재:", " ".join(cmd[1:]))
    # wrangler 출력도 로그에 남도록 직접 중계
    p = subprocess.Popen(cmd, cwd=str(HERE.parent), env=env, stdout=subprocess.PIPE,
                         stderr=subprocess.STDOUT, encoding="utf-8", errors="replace")
    for line in p.stdout:
        print(line, end="")
    return p.wait()


class _Tee:
    def __init__(self, *streams):
        self.streams = streams

    def write(self, s):
        for st in self.streams:
            st.write(s)
            st.flush()

    def flush(self):
        for st in self.streams:
            st.flush()


def _mmss(sec):
    sec = int(sec)
    return "%02d:%02d" % (sec // 60, sec % 60)


if __name__ == "__main__":
    main()
