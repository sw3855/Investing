"""코스피 보통주를 네이버 증권에서 수집해 D1(stocks, op_income_history)용 SQL 파일을 만든다.
미국 종목과 같은 테이블을 쓰며 indices='KOSPI', currency='KRW' 로 구분한다.
- 시가총액·매출·영업이익($M 열)은 USD/KRW 환율로 달러 환산, 주가·EPS 는 원화
- 기관 보유 비율 대신 외국인/기관 순매수(억원, 1M=최근 20거래일, 3M=60거래일)
- FY+1 추정치·EPS 리비전은 네이버 기업분석(wisereport), 30일 상향/하향·공매도는 비움

실행:  python build_kospi.py                  (전체 → kospi_data.sql)
       python build_kospi.py --limit 10       (시총 상위 10종목만 테스트)
       python build_kospi.py --symbols 005930 000660
       python build_kospi.py --upload         (수집 후 바로 D1 적재)
"""
import json
import re
import sys
import threading
import time
from datetime import date, timedelta

import requests

import build_sp500 as us

API = "https://m.stock.naver.com/api"
WR = "https://navercomp.wisereport.co.kr/company/ajax"
CHART = "https://api.stock.naver.com/chart/domestic/item/%s/day?startDateTime=%s0000&endDateTime=%s2359"
HEADERS = {"User-Agent": "Mozilla/5.0"}
_local = threading.local()


def _get(url):
    s = getattr(_local, "s", None)
    if s is None:
        s = _local.s = requests.Session()
        s.headers.update(HEADERS)
        s.verify = us.CA
    r = s.get(url, timeout=20)
    r.raise_for_status()
    return r.json()


def _n(v):
    """'1,234' '+1,234' '9.89배' '45,531원' '0.76%' → float, '-'·빈값 → None."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return us.num(v)
    s = re.sub(r"[^0-9.\-]", "", str(v).replace("+", ""))
    return us.num(s) if s not in ("", "-", ".") else None


def kospi_list():
    """시총순 코스피 보통주 [(코드, 이름, 시총 억원)]. ETF·ETN·우선주(코드 끝자리≠0) 제외."""
    out = []
    for page in range(1, 60):
        stocks = _get("%s/stocks/marketValue/KOSPI?page=%d&pageSize=100" % (API, page))["stocks"]
        if not stocks:
            break
        for x in stocks:
            if x.get("stockEndType") == "stock" and x["itemCode"].endswith("0"):
                out.append((x["itemCode"], x["stockName"], _n(x.get("marketValue"))))
    return out


def industry_names():
    try:
        groups = _get("%s/stocks/industry?page=1&pageSize=100" % API).get("groups") or []
    except Exception as exc:
        print("업종명 조회 실패: %s" % exc, file=sys.stderr)
        return {}
    return {str(g["no"]): g["name"] for g in groups}


def usdkrw():
    close = us._ticker("KRW=X").history(period="5d")["Close"].dropna()
    fx = us.num(close.iloc[-1]) if len(close) else None
    if not fx or not 500 < fx < 3000:
        raise RuntimeError("USD/KRW 환율 조회 실패: %s" % fx)
    return fx


def consensus(code, fy0_key, today):
    """wisereport 연간 컨센서스 {연도: 행}과 FY0 EPS 컨센서스 월말 추이."""
    dt = today.strftime("%Y%m%d")
    rows = _get("%s/c1050001_data.aspx?flag=2&cmp_cd=%s&finGubun=MAIN&frq=0&sDT=%s&chartType=svg"
                % (WR, code, dt)).get("JsonData") or []
    est = {int(r["YYMM"][:4]): r for r in rows if r.get("YYMM", "").endswith("(E)")}
    res = _get("%s/cF5002.aspx?cmp_cd=%s&dt=%s&yymm=%s&frq=Y&acc_cd=122700&fingubun=MAIN&chartType=svg"
               % (WR, code, dt, fy0_key)) or {}
    chart = json.loads(res.get("chart1") or "{}")
    trend = [us.num(v) for v in chart.get("avg") or []]
    return est, trend


def collect(code, name, mcap_eok, fx, industries):
    integ = _get("%s/stock/%s/integration" % (API, code))
    info = {x.get("code"): x.get("value") for x in integ.get("totalInfos") or []}
    fin = (_get("%s/stock/%s/finance/annual" % (API, code)) or {}).get("financeInfo") or {}
    trend = _get("%s/stock/%s/trend?pageSize=60" % (API, code)) or []
    today = date.today()
    chart = _get(CHART % (code, (today - timedelta(days=366)).strftime("%Y%m%d"),
                          today.strftime("%Y%m%d"))) or []
    if not chart:
        raise ValueError("시세 없음")

    usd = lambda eok: eok * 1e8 / fx / 1e6 if eok is not None else None  # 억원 → $M

    # 연간 재무: 실적 연도(N)와 컨센서스 연도(Y)
    keys = fin.get("trTitleList") or []
    act = [k["key"] for k in keys if k.get("isConsensus") == "N"]
    est = next((k["key"] for k in keys if k.get("isConsensus") == "Y"), None)
    rows = {r.get("title"): r.get("columns") or {} for r in fin.get("rowList") or []}

    def fv(title, key):
        return _n(((rows.get(title) or {}).get(key) or {}).get("value")) if key else None

    last = act[-1] if act else None
    rev0, rev_last = fv("매출액", est), fv("매출액", last)
    eps0, eps_last = fv("EPS", est), fv("EPS", last)
    wr, trend_eps = consensus(code, est, today) if est else ({}, [])
    nx = wr.get(int(est[:4]) + 1, {}) if est else {}
    rev1, eps1 = _n(nx.get("SALES")), _n(nx.get("EPS"))
    eps_cur = trend_eps[-1] if trend_eps else None

    def eps_rev(months):
        if len(trend_eps) <= months or not trend_eps[-1 - months]:
            return None
        return us.pct_change(eps_cur, trend_eps[-1 - months])

    close = [_n(c.get("closePrice")) for c in chart]
    vol = [_n(c.get("accumulatedTradingVolume")) or 0 for c in chart]
    price = close[-1]
    high, low = _n(info.get("highPriceOf52Weeks")), _n(info.get("lowPriceOf52Weeks"))
    avg1y = sum(vol) / len(vol)
    avg1w = sum(vol[-5:]) / len(vol[-5:])

    def net(field, days):
        tot = 0.0
        for t in trend[:days]:
            q, p = _n(t.get(field)), _n(t.get("closePrice"))
            if q is not None and p is not None:
                tot += q * p
        return tot / 1e8 if trend else None  # 억원

    row = {
        "symbol": code,
        "name": name,
        "exchange": "KRX",
        "indices": "KOSPI",
        "currency": "KRW",
        "sector": None,
        "industry": industries.get(str(integ.get("industryCode") or "")),
        "market_cap": usd(mcap_eok),
        "fy0": int(est[:4]) if est else None,
        "rev_est_0y": usd(rev0),
        "rev_growth_0y": us.pct_change(rev0, rev_last) if rev_last and rev_last > 0 else None,
        "eps_growth_0y": us.pct_change(eps0, eps_last) if eps_last and eps_last > 0 else None,
        "roe_ttm": fv("ROE", last),
        "roe_est_0y": fv("ROE", est),
        "rev_est_1y": usd(rev1),
        "rev_growth_1y": us.pct_change(rev1, rev0) if rev1 is not None and rev0 and rev0 > 0 else None,
        "eps_growth_1y": us.pct_change(eps1, eps0) if eps1 is not None and eps0 and eps0 > 0 else None,
        "roe_est_1y": _n(nx.get("ROE")),
        "eps_est_0y": eps0 if eps0 is not None else _n(info.get("cnsEps")),
        "eps_est_1y": eps1,
        "eps_rev_1m": eps_rev(1),
        "eps_rev_3m": eps_rev(3),
        "forward_pe": _n(info.get("cnsPer")),
        "pbr": _n(info.get("pbr")),
        "price": price,
        "high_52w": high,
        "low_52w": low,
        "chg_from_high": us.pct_change(price, high),
        "chg_from_low": us.pct_change(price, low),
        "chg_1m": us.pct_change(close[-1], close[-21]) if len(close) > 21 else None,
        "volume": vol[-1],
        "avg_vol_1y": avg1y,
        "avg_vol_1w": avg1w,
        "vol_chg": us.pct_change(avg1w, avg1y),
        "frgn_net_1m": net("foreignerPureBuyQuant", 20),
        "inst_net_1m": net("organPureBuyQuant", 20),
        "frgn_net_3m": net("foreignerPureBuyQuant", 60),
        "inst_net_3m": net("organPureBuyQuant", 60),
        "div_yield": _n(info.get("dividendYieldRatio")),
        "updated_at": us.RUN_AT,
    }

    # 결산월 변경 기업은 같은 연도가 두 번 나옴 → 나중 결산 기준
    by_year = {}
    for k in act:
        v = fv("영업이익", k)
        if v is not None:
            by_year[int(k[:4])] = usd(v)
    ops = sorted(by_year.items())[-5:]
    lo = ops[-1][1] if ops else None
    prev = ops[-2][1] if len(ops) > 1 else None
    row["op_last"] = lo
    row["op_yoy"] = (lo / prev - 1) * 100 if lo is not None and prev and prev > 0 else None
    return row, ops


def main():
    args = us.parse_args("kospi_data.sql", workers=6)
    listed = kospi_list()
    by_code = {c: (n, m) for c, n, m in listed}
    if args.symbols:
        codes = [c for c in args.symbols if c in by_code]
        miss = sorted(set(args.symbols) - set(codes))
        if miss:
            print("코스피 보통주 목록에 없음:", " ".join(miss), file=sys.stderr)
    else:
        codes = [c for c, _n2, _m in listed]
    if args.limit:
        codes = codes[: args.limit]
    fx = usdkrw()
    industries = industry_names()
    print("대상 %d종목 (코스피 보통주 %d, USD/KRW %.2f)" % (len(codes), len(listed), fx))

    def build(code, tries=4):
        name, mcap = by_code[code]
        for i in range(tries):
            try:
                return us.to_sql(*collect(code, name, mcap, fx, industries))
            except Exception as exc:
                err = exc
                time.sleep(2 * (i + 1))
        raise err

    schema = us.schema_sql()
    if not args.symbols and not args.limit and len(listed) >= 700:
        # 전체 수집일 때만 코스피에서 빠진 종목 정리 (목록 이상 시 대량 삭제 방지)
        keep = ", ".join(us.sql_val(c) for c in codes)
        schema += "\nDELETE FROM stocks WHERE currency = 'KRW' AND symbol NOT IN (%s);" % keep
        schema += "\nDELETE FROM op_income_history WHERE symbol NOT IN (SELECT symbol FROM stocks);"
    results, failed = us.run_all(codes, build, args.workers, retry_wait=10)
    us.finish(args, schema, results, failed)


if __name__ == "__main__":
    main()
