"""S&P 400(중형) + S&P 600(소형) 종목을 yfinance로 수집해 D1(stocks, op_income_history)용 SQL 파일을 만든다.
수집·SQL 생성·적재는 build_sp500.py 공용 함수를 사용하고, indices 는 4개 미국 지수 기준으로 태깅한다.

실행:  python build_sp1000.py                 (전체 → sp1000_data.sql)
       python build_sp1000.py --limit 10      (앞 10종목만 테스트)
       python build_sp1000.py --symbols AA AAL
적재:  python build_sp1000.py --upload        (수집 후 바로 D1 적재)
"""
import build_sp500 as us


def main():
    args = us.parse_args("sp1000_data.sql")
    members, counts = us.index_members()
    mine = sorted(s for s, t in members.items() if "S&P400" in t or "S&P600" in t)
    symbols = [s.upper() for s in args.symbols] if args.symbols else mine
    if args.limit:
        symbols = symbols[: args.limit]
    print("대상 %d종목 (S&P400 %d, S&P600 %d, 합집합 %d)"
          % (len(symbols), counts["S&P400"], counts["S&P600"], len(mine)))

    schema = us.schema_sql()
    if not args.symbols and not args.limit:
        schema += us.prune_sql(members, counts)
    results, failed = us.run_all(symbols, us.us_build(members), args.workers)
    us.finish(args, schema, results, failed)


if __name__ == "__main__":
    main()
