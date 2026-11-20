# Investing 워크스페이스 메모
- 이 메모 폴더는 레포 `InvestingData/.copilot-memory/`로 정션 연결됨(git 관리). 원본 백업=memory-tool\memories\repo.bak.

## InvestingData/CheckInvestingData.html
- 단일 HTML + PyScript(Pyodide) 앱. Python 코드는 `<script type="py">` 안에 있음.
- 네트워크는 pyfetch + Cloudflare Worker 프록시(`#proxy` hidden input, `?url=` 형식).
  - 프록시 워커: InvestingData/investing-proxy-worker.js. ALLOWED_HOSTS 에 host 추가 필요.
  - 이미 허용된 host: tradingview, api.stlouisfed.org, data.sec.gov, www.sec.gov, cnn, multpl, naver.
  - `pyfetch`는 래퍼(`_pyfetch_raw`+AbortSignal.timeout, 기본 25s, `timeout_ms=` 인자). Gemini 평가는 90s.
  - 시세 일괄조회: 워커 `GET /quotes?symbols=` (TradingView `global/scan` POST, 대문자 필수, 300개, 20s 캐시). 클라 `_fetch_quotes(syms)`(빠진 심볼은 `_fetch_index_limited` 폴백, `_QUOTE_LIMIT`=6). 헤더 지수·즐겨찾기 공용.
  - 헤더 지수바: `#indices` 아래 인라인 JS가 `window.IDX_LIST`(원본 목록) 정의 + localStorage `idx_cache_v1` 즉시 표시 + /quotes 선조회. Python `INDEX_LIST`는 window.IDX_LIST에서 읽고, 렌더 후 `window.__idxPyReady=True`·캐시 저장.
  - 비번 리셋: `pw_op=reset`은 요청만 KV `pw_reset_requests`에 기록(관리자 계정은 403, 클라는 무반응). 관리자 승인 `POST /ai-access?op=reset_pw {target}`(→0000), 거절 `DELETE /ai-access?reset_req=`. UI `#pw-reset-list`/`render_pw_reset_requests`. 일반 계정 원문키 10회 오입력 → record.failCount, 423 잠금(토큰도 거부), 관리자 리셋 승인 시 해제. 관리자 계정은 잠금 제외.
  - 즐겨찾기 가격: `_FAV_PRICE_CACHE`(45s TTL)+`_FAV_PRICE_INFLIGHT`(배치 Task 공유), `_paint_fav_prices/_paint_fav_names`.

- 재무 데이터 주 소스: TradingView 스캐너(FIN_HISTORY_FIELDS). 매출/매출총이익/순이익/EBITDA/FCF/자산/부채만 제공(라인아이템·부문별 매출 없음).
- 실적 컨센서스: `CONSENSUS_FIELDS`(earnings_per_share_forecast_fq/next_fq/fy/next_fy, revenue_forecast_*, earnings_per_share_fq=직전실제, revenue_fq, eps_surprise_fq/percent_fq, earnings_release_date/next_date). `fetch_consensus()`(격리 요청), `_convert_consensus()`(보고통화→거래통화 fx환산). lookup→payload["consensus"]. render_report의 통합 섹션 "실적 추정치 · 컨센서스"(TTM 실제+직전분기 어닝서프라이즈 + 향후 EPS/매출 컨센서스 표 이번/다음분기·올해/내년FY). `_con()`=컨센서스 우선 data 폴백. 검증됨(AAPL 실측).
- 재무 섹션 렌더: `refresh_financials()` → `#fin-section`. 연간/분기 토글 = `_FIN_STATE["period"]`.
- 애널리스트 추천: `recommendation_mark`(1~5) → `rating_label()`.
- 테크니컬 레이팅: 스캐너 `Recommend.All/MA/Other` + 타임프레임 접미사(`|60`=1시간, `|1W`=주봉, 접미사없음=일봉). 개별종목=FIELDS 포함, ETF=`fetch_tech_rating()`→payload["tech"].
  - 상태 `_TECH_STATE{data,tf}`, `_TECH_TFS`. `_tech_scores(data,tf)`/`_tech_field`/`_tech_has_any`.
  - `_tech_rating_section(data)`=탭+본문. `_render_tech_body()`/`_tech_gauges_html()`=요약·오실레이터·무빙애버리지 3게이지. 탭 클릭=`_on_tech_tf`가 `#tech-body`만 재렌더. 렌더 후 `_bind_tech_controls()` 호출 필수(render_report/render_holdings 끝).
  - 게이지 스타일은 공포·탐욕 CSS(`.fg-gauge` 등) + `.tech-tabs/.tech-tab/.tech-gauges` 재사용. 구간 `_TECH_ZONES`, 색 `_tech_color`, 위치 `_tech_pos`.
- 섹터 RRG 그룹: `_rrg_all_sectors()` → (ticker,name,color,group) 4-튜플, group="etf"|"custom"|"folder:<이름>". item["group"]. 필터 `_RRG_VIEW{group}` + `_rrg_view_bar()`(그룹 2개 이상일 때 "표시:" 세그먼트 버튼, `on_rrg_view_click`), 기본값 "all"(폴더 추가 시 자동 전환 안 함). 내 종목(etf 외) 버블=흰 테두리(티커 글자는 custom만, 폴더 종목은 없음), 표에 `.rrg-grp` 배지.
- 종목 탭 즐겨찾기: 조회 박스 `#favOpenBtn` → 모달 `#fav-pop`(modal-pop, 내부 id 기존 유지: favFolder/favAddBtn/favorites-list). 종목 클릭 시 팝업 닫고 조회. 접기 버튼(favCollapseBtn) 제거됨.
- 로그인 전용 탭(실적 달력·AI 평가) 표시: `_update_login_tabs()`. 공용 모달 CSS 클래스 `.modal-pop/-box/-head/-close`(실적 달력 다가오는 발표, AI 접근 관리).
- AI 평가 접근 관리 UI: AI 탭에서 제거 → 헤더 계정 팝업의 `#aiAdminOpenBtn`(관리자만 노출, `_refresh_ai_admin`)이 모달 `#ai-admin-pop` 열고 `_load_ai_access()`. 닫기 `_close_ai_admin_pop()`.
- 시총 주간 스냅샷(구현됨): 워커 scheduled(cron '0 22 * * 5')+/mcap-top 지연기록 → FAVORITES KV 'mcaphist:<연도>' = {금요일날짜:{t,f(확정),r:[[sym,mcap]...TOP50]}}. 미확정(f=false) 스냅샷은 하루 1회 갱신, /mcap-history 응답 d=기록일(t의 UTC날짜, 금요일보다 이를 때). GET /mcap-history?weeks=520 → {weeks:[{d,f,r}]}(빈 결과는 캐시 안 함). 클라 `_MCAP_HIST{weeks,at,busy,sel,err}`, `_render_mcap_chart()`=SVG 순위추이(#mcap-chart, 표 아래), 표 행/선 클릭=`_mcap_select` 토글 강조, 종목탭 이동은 행의 '조회' 버튼(data-go).
  - 스캐너 is_primary 대표 클래스가 주마다 바뀜(GOOG↔GOOGL) → 클라 `_MCAP_ALIAS`/`_mcap_canon`으로 순위추이·선택 심볼 통합.
- 과거 분기 시총(SEC×Yahoo) 검증결과: dei/EntityCommonStockSharesOutstanding 은 다중클래스(GOOGL/META/BRK) 404 → us-gaap CommonStockSharesOutstanding(instant) 또는 WeightedAverageNumberOfSharesOutstandingBasic(분기 duration, Q4는 10-K 연간만) 사용. BRK는 2015 이후 us-gaap 태그 없음(A환산주 별도). SEC 주식수=공시 당시 원본(분할 미반영), Yahoo v8 close=분할조정 → filed 이후 분할비율(events=split) 곱해 보정 필수. Yahoo interval=3mo 봉은 분기 1일 시작, close=분기말 종가.


## 평가비율 섹션 ROIC (종목탭) — 최근 분기 ROIC + 직전 분기 대비 증분
- VALUATION_FIELDS 는 원래대로(ROIC/beta/WACC용 필드 모두 제거됨). WACC 기능 전면 삭제.
- **SEC EDGAR 분기(10-Q/10-K) 기반**. `fetch_quarterly_roic(full_symbol)`→lookup→payload["sec_roic"]={roic,prev,incr,date,prev_date}(미국만, 실패 None).
  - ROIC(연율화) = NOPAT ÷ 투하자본 ×4. NOPAT=영업이익(OperatingIncomeLoss)×(1-실효세율(tax/pretax,0~0.5클램프,없으면 _SEC_TAX_FALLBACK=0.21)). 투하자본=부채(LongTermDebtNoncurrent+Current, 없으면 LongTermDebt)+자기자본(StockholdersEquity)-현금(CashAndCashEquivalents)-단기투자(ShortTermInvestments).
  - `_sec_concept_quarterly_flow`(손익: 3개월 80~100일 + 4분기=연간350~380 − 9개월260~285 차이보완), `_sec_concept_quarter_end`(잔액: 10-Q/10-K 모든 기말). `_days_between`. `_SEC_ROIC_TAGS`. CIK=company_tickers.json(`_SEC_CIK_MAP`,`_sec_cik_for_symbol`). asyncio.gather 9개.
  - 최근 2개 분기(ends 정렬) → roic, prev, incr=roic-prev(%p). 검증: GOOGL Q2'26=19.3%, Q1=24.7%→증분-5.4%p / AMZN Q2'26=14.1%.
- WACC 무위험수익률: **실시간 미10년물(TVC:US10Y)** 사용. `_RF_RATE{rate}`(소수): update_indices가 close/100 저장 + lookup `_ensure_rf_rate()`. `_current_rf()`.
- WACC 위험프리미엄(ERP): **S&P500 이익수익률 기반 시장 내재값**. `_ERP_RATE{rate}`, `_ensure_erp()`(multpl s-p-500-earnings-yield 최신÷100, 3~8% 클램프, lookup에서 호출), `_current_erp()`. 근거: 1단계DDM에서 g≈rf면 ERP≈E/P. (단순 E/P−국채 프록시는 현재 음수라 부적합)
- WACC 법인세: **종목별 SEC 실효세율**(tax/pretax) 사용. sec_roic["tax_rate"]에 저장(_eff_tax(e0)), `_estimate_wacc(val, tax_rate=None)`로 전달. 없으면 _WACC_TAX=0.21 폴백.
- render/compare WACC 호출은 sec_roic["tax_rate"] 전달. 힌트에 실제 rf%/erp%/실효세율% 표시.
- (과거 'ROIC 증분' 표시는 사용자 요청으로 WACC로 대체. sec_roic엔 incr/prev/prev_date도 계산되나 미표시.)
- FactSet 값(GOOGL13.7/AMZN14.7/META11.1)은 독자조정(R&D자본화 등)이라 SEC 공개데이터로 재현 불가 확인함.
- TradingView `wacc` 필드는 비어있음(미제공)→ CAPM 추정. `_estimate_wacc(val)`/`_roic_wacc(val)`. 상수 _WACC_RF=4.2%, _WACC_ERP=5%, _WACC_TAX=21%, _WACC_DEBT_SPREAD=2%.
- render_report 평가비율 grid + render_holdings 비교표(f_roic/f_wacc/f_spread)에 ROIC/WACC/ROIC−WACC 행. spread 색상 up/down.

## 지수 일봉 캔들 차트 탭 ("지수 차트", data-tab=idxchart)
- 상단 지수바(INDEX_LIST)의 일봉 OHLC를 Yahoo Finance v8 chart API로 조회.
  - TV심볼→야후심볼 매핑 `INDEX_YF`. 호스트 폴백 `YF_CHART_HOSTS`(query1→query2).
  - 프록시 ALLOWED_HOSTS에 query1/query2.finance.yahoo.com 추가됨.
- `_fetch_index_history(yf,rng)`→rows=[(ts,o,h,l,c)]. `_candle_svg()`=캔들스틱 SVG(.chart-svg 재사용).
  `_render_idxchart()`→#idxchart-result. 상태 `_IDXCHART_STATE{sym,range}`, `_IDXCHART_LOADED`.
- 이벤트: #idxChartBtn/#idxChartSel/#idxChartRange button(1mo~5y). 탭 첫 진입시 on_tab이 자동 조회.
- 헤더 지수바 클릭→차트: update_indices가 charted 심볼에 `.idx-link data-idxsym` 부여. `@when click #indices`(정적 위임, target.closest('.idx-link'))→`_open_index_chart(sym)`가 탭전환+select값 세팅+_run_idxchart.
- 기간 버튼(1mo/3mo/6mo/1y) = `.fin-period .on` 토글.
- **환율 계산기**: idxChartSel 값이 FX_IDC:USDKRW(원/달러)일 때 `_render_idxchart`가 head 다음에 `_fx_converter_html(disp_c)` 삽입. **환율 단일 소스=`_FX_RATE["rate"]`**(update_indices가 헤더 그리드용 FX_IDC:USDKRW close를 round(,2)로 저장, TradingView·60초 갱신=가장 최신). 차트 헤더 price·계산기 모두 `_FX_RATE["rate"]` 우선(없으면 Yahoo 일봉 종가 last_c 폴백)→헤더 그리드/차트/계산기 값 일치. FX일 때 head는 dec=2. 입력 `#fxKrwInput`(원화)/`#fxUsdInput`(달러) 양방향: `@when("input","#idxchart-result")` **위임**(입력창이 innerHTML로 동적 삽입되므로 입력창에 직접 @when 불가)→event.target.id로 분기. KRW→USD=krw/rate, USD→KRW=usd*rate, 출력은 `fmt_num`(천단위 콤마). 입력창은 `type="text" inputmode="decimal"`(number타입은 콤마 표시 불가), `_fx_num(el)`=콤마제거+빈값/오류시 None. CSS `.fx-converter`/`.fx-conv-*`.
- `_candle_svg(rows,dec,prefix,hover)` 재사용 가능(가이드 id=prefix, hover dict 주입).
  공통 호버 `_candle_hover()/_candle_hide()`(svg.candle-svg 선택). idxchart/stock 핸들러 모두 이 공통함수 사용.
- 이동평균선 MA5/20/60/120/200: `_MA_DEFS`(기간,색)+`_sma()`. `_candle_svg` 안에서 데이터 있는 기간만 폴리라인+상단 범례 표시, 호버 툴팁에 MA값 행(`ma_html`) 추가. (짧은 기간엔 긴 MA 미표시=정상)

## 지수차트 회복 점수·조정 압력 모델 (트위터 "반도체 가격과 회복점수" 역산)
- `_render_idxchart(name,rows,bench_closes=None)`가 캔들 뒤에 `_recovery_pressure_html(rows,bench_closes)` 패널 삽입(Williams/Stoch 앞). `_run_idxchart`가 eligible 심볼이면 벤치마크도 조회해 ts로 정렬한 bench_closes 전달.
- 회복 점수 = 상대강도(지수/벤치마크)의 60일 스토캐스틱 위치, 5일 평활(`_sma_nullable`). 조정 압력 = 절대가격 60일 역스토캐스틱(100-pos), 5일 평활. 높을수록 조정 진행. 두 입력이 달라 대략 대칭이나 완벽 대칭 아님(합≈일정).
- **확인(confirmation) 팩터 기본 적용**: 변동성(20일 σ)이 자기 60일평균 초과 + 대표ETF 거래량이 20일평균 대비 스파이크일 때만 중립(50)대비 편차를 증폭(F=clamp(∏(1+k·max(0,ratio-1)),1,cap)). 평활 전 raw에 적용. `_recov_conf_factors(closes,vol_aligned)`/`_recov_apply_conf(base,f)`. 상수 `_RECOV_CONF_KV=0.6,_RECOV_CONF_KN=0.6,_RECOV_CONF_CAP=1.8,_RECOV_VOL_WIN=20`. 원본대비 평균 1.5p(스파이크날 최대~11p) 차이라 토글없이 기본.
- 거래량 소스=대표 ETF(`_RECOV_PROXY_ETF` NDX→QQQ,SPX→SPY,DJI→DIA,RUT→IWM,SOX→SOXX,GOLD→GLD,BTC→BTC-USD): 지수는 거래량 0/부정확이라 ETF로 대체. 종목탭은 종목 자신 거래량. `_fetch_index_history`가 `_YF_VOLUME_CACHE[key]={date:vol}` 적재. `_recov_volume_aligned(rows,vol_yf,rng,interval)`(async)가 ffill 정렬. `_fetch_history_any`는 이제 `(rows,win_sym)` 반환→종목 거래량 소스로 사용. `_STOCKCHART_STATE["vol"]`.
- `_RECOV_WIN=60`,`_RECOV_SMOOTH=5`,`_RECOV_DEFAULT_BENCH="^NDX"`,`_RECOV_BENCH={"NASDAQ:NDX":"^GSPC"}`,`_RECOV_ELIGIBLE={NDX,SPX,DJI,RUT,SOX,TVC:GOLD,BITSTAMP:BTCUSD}`. `_stoch_position`/`_recovery_pressure_series`/`_recovery_pressure_svg`.
- 벤치마크 정렬 `_align_bench_closes(rows,bench_rows)`: raw ts가 아닌 **UTC 날짜** 기준 매칭 + 공백일(주말 등)은 직전값 ffill(2포인터). 금선물(개장시각 달라 ts 불일치)·BTC(주말 거래) 대응. 검증: 금 회복58/조정48, BTC 회복82/조정24. (구 `bmap[r[0]]` ts직접매칭은 금/BTC에서 전부 None 되어 폐기)
- 레짐 배경 밴드(`_REGIME_BG` recover/neutral/weak, 회복점수 66/33 기준)를 SVG rect로 그림. 회복=녹#2e9e5b/조정=적#e8663d 폴리라인. win(60)보다 봉 적으면(1mo/3mo) 패널 미표시. 검증: SOX/NDX 6mo 회복9/조정77.
- 호버 동기화: `_candle_hover`/`_candle_hide`의 보조지표 루프에 `prefix+"-recov-guide"`(세로 점선) 추가. 숫자값(우상단 `id=idxchart-recov-val` text)은 `_RECOV_HOVER{recov,corr,last_recov,last_corr}`(=_recovery_pressure_html에서 저장)를 참조해 호버 봉(pts.index(best))의 회복/조정 값으로 innerHTML 갱신, 호버 해제 시 last값 복원. `_recov_value_markup(rv,cv)`/`_last_num`.

## 차트 호버 값 = 각 패널 우측 상단 SVG text (하단 툴팁 폐기)
- 하단 candle-tip 툴팁 제거함(`#idxchart-tip`/`#stockchart-tip` div 삭제, `.candle-tooltip-host` padding-bottom 제거). `_candle_hover`는 더이상 tip 없음(tip None체크 삭제).
- 캔들 차트: `_candle_svg`가 우상단에 `#<prefix>-price-val`(시/고/저/종, y=14)·`#<prefix>-ma-val`(MA5~200 값, y=27) SVG text 추가(좌상단 MA범례 제거). 봉별 마크업 `_price_markup`/`_ma_markup`을 pts에 `psvg`/`masvg`로 저장. 마지막봉 마크업은 `_CANDLE_VAL_LAST[prefix]=(psvg,masvg)`에 저장→호버해제 복원.
- 오실레이터 패널(Williams/Stoch): `_oscillator_svg`가 guide_id 있으면 우상단 `#<base>-val` text + `_OSC_HOVER[val_id]=series` 저장. `_osc_value_markup(series,idx)`. `_candle_hover`가 `-wr-val`/`-stoch-val`도 갱신, hide시 마지막봉 복원.
- pts의 `ma_html`/`osc_html`/`date`/`o/h/l/c`는 이제 미사용(무해, 남겨둠).
- 회복/조정 패널 도움말: `_recovery_pressure_svg` 제목 옆 SVG `<g class="recov-help-btn">`(?원). `_recovery_pressure_html`이 `.recov-wrap`로 감싸고 `_recov_help_popup()`(`.recov-help-pop` display:none, 닫기 `.recov-help-close`) 추가. 공용 `_handle_recov_help_click(event)`: help-btn 토글(같은 .recov-wrap 내 pop)/close 숨김/팝업밖 클릭 전체 숨김. `@when("click","#idxchart-result")` + `@when("click","#result")`(종목탭) 둘 다 호출. CSS는 style에 `.recov-wrap`/`.recov-help-*`.
- **prefix별 분리**: `_recovery_pressure_svg(...,prefix)`·`_recovery_pressure_html(...,prefix)`가 `#<prefix>-recov-val`/`#<prefix>-recov-guide` 사용. `_RECOV_HOVER`는 `{prefix:{recov,corr,last_recov,last_corr}}` dict. `_candle_hover`/`_candle_hide`가 `_RECOV_HOVER.get(prefix)` 참조.
- 종목 탭 캔들에도 회복/조정 패널 추가: `_render_stock_chart`가 `_recovery_pressure_html(rows,_STOCKCHART_STATE["bench"],"stockchart")` 삽입. `load_stock_chart`가 rows≥60일 때 `_fetch_index_history(_RECOV_DEFAULT_BENCH=^NDX,...)`+`_align_bench_closes`로 bench 계산→`_STOCKCHART_STATE["bench"]` 저장(재렌더/overlay 토글시 재사용).

## DCA Optimizer (종목탭 #dca-section, stock-chart 다음, render_report에서 load_dca(sym))
- 야후 1mo max 월봉(`_dca_monthly` 월 병합) ÷ 공개된 FCF TTM(`_dca_fcf_points`: fq_h 4분기합+45일 지연, 이전은 fy_h+75일) = P/FCF 지수. 최근 120개월 분포 백분위(`_dca_series`, 12개월 미만/적자=회색) → `_DCA_ZONES` ≤10 4X/≤25 3X/≤40 2X/≤75 1X/≤90 LIGHT/STRONG TRIM. `_dca_svg`=구간색 캔들+FCF×중앙배수 계단선. 캐시 `_DCA_STATE{symbol,rows}`.
- (2026-11 개편) 종합점수 엔진: `_DCA_AXES` 밸류40(100-백분위)/기술30/건전성20/추세10, 가용 축만 가중평균(밸류 필수). `_DCA_ZONES`=점수 하한 80/67/55/35/22. `_dca_health_points`(FCF·매출 YoY, 부채/FCF), `_dca_tech_eval`(RSI·%R·Slow K·52주 낙폭 / MA200d·40w 괴리+변동성 백분위), 실적 감소 시 cap(2X/1X). SVG 하단 종합점수 패널, 축 카드 `.dca-axes/.dca-ax`.
- (2026-11-12) 주봉 고정: 야후 1wk max → `_dca_weekly`(ISO주 병합), 차트·기술 모두 주봉(토글 삭제), `_DCA_LB/MA/VOL`=52/40/10, 백분위 창 520주·최소 52주, 표시 `_DCA_SHOW`=52(최근 1년), 중앙배수는 최근 520주 기준. `_DCA_STATE{symbol,rows}`. 테스트 $env:TEMP\dca_test3.py.
- (2026-11) 섹터별 기준: FIELDS에 sector/industry 추가. `_DCA_METRICS`(fcf/fcf3y/ni), `_DCA_PROFILES`(metric,기대매출성장 g0,rev_k,earn_k,부채밴드(ok,bad)|None,이름): growth/default/defensive/cyclical(FCF 3년평균)/levered(부채 ≤3~15)/finance(순이익 P/E, 부채 제외). `_DCA_SECTOR_GROUP`/`_DCA_INDUSTRY_GROUP`(REIT→levered), `_dca_profile()`→(grp,prof,sector). 테스트 $env:TEMP\dca_test5.py.
- (2026-11-12) 프로필 7번째=성장보정 연수(cyclical 0, 나머지 3). default·levered·growth=ni(P/E) (growth는 AI capex로 FCF 급감→P/FCF 고점 오판(GOOGL) 때문에 fcf→ni, 월봉 전환은 효과 미미). `_dca_growth_points`(매출 TTM 2년 CAGR, metric "rev") + `_dca_growth_adjust`(이익×(1+g)^3, g -10~40%)로 리레이팅 종목(LLY) 오판 방지. 실데이터 테스트 $env:TEMP\dca_multi.py <TV심볼>(TradingView+Yahoo, d1\.ca_bundle.pem).
- (2026-11-12) 업종별 기준: `_dca_profile` 우선순위 `_DCA_SYMBOL_GROUP`(티커, MU/WDC/LRCX/AMAT/KLAC 등→semicycle; LRCX는 TV에서 Industrial Machinery라 업종 구분 불가) > `_DCA_INDUSTRY_GROUP` > 섹터. 프로필 추가: semicycle(ni3y), infra(ebitda, 부채/EBITDA 3~8; 리츠·Communications·Cable/Satellite TV), biotech(rev P/S, 최근 순이익>0이면 default). 메트릭 ni3y/ebitda, `_DCA_EARN_LBL`. 하네스 dca_lly.py는 ebitda 필드·_LAST_STOCK symbol/financials 포함, dca_multi2.py <심볼> <metric> 비교.
- (2026-11-13) 종목 DB 분류 우선: load_dca가 `_dca_d1_symbol`(US BRK.B→BRK-B, KRX 코드, 그 외 None)로 `_D1_STATE.rows` 또는 `/stocks?symbol=` 조회 → `_DCA_STATE["d1"]=(sym,row)`. `_dca_profile` 순서: 심볼 예외 > `_DCA_D1_INDUSTRY_GROUP`(Yahoo) > `_DCA_KR_INDUSTRY_GROUP`(네이버, 공백제거) > `_DCA_D1_SECTOR_GROUP` > (DB 없을 때만) TV 업종/섹터. DB 성장률(eps/rev_growth_0y/1y)은 스냅샷 컨센서스라 **최신 주만** `_dca_apply_forward`(건전성 50:50, 함정 상한=컨센서스 기준). 단위테스트 $env:TEMP\dca_d1test.py.
- (2026-11-12) growth 프로필 ni→**ebitda**(부채/EBITDA 1~4): GOOGL 순이익에 지분 평가익(Q2'26 NI 112B) 포함돼 P/E 10년 최저로 오판(3X~4X). EBITDA로 6~10월 1X, 10월 하락 후 2X(사용자 기대와 일치). TV `oper_income_fq_h`는 없음(ttm만). 진단 $env:TEMP\dca_diag.py <심볼..> (env DCA_W=-w 주별 출력, DCA_M=metric 강제).
- (2026-11-12) `_DCA_ZONES` 1X 하한 35→27, LT 하한 22→15(사용자 기대: GOOGL 4월 초 1X, 4월 말~5월 LT, 6~10월 1X, 10월 말 2X). 트림 빈도 크게 감소(MSFT lt 43→1주/5년).
- (2026-11-12) DCA 기술축→**조정 압력**(`_recovery_pressure_series` 주봉 60주 역스토캐스틱), 가중 밸류.3/조정.4/건전성.2/추세.1, 구간 2X≥52·1X≥24. 회복 점수(^NDX, KRX는 ^KS11 대비) <34면 최대 3X(`_DCA_RECOV_BRAKE`). load_dca가 `_DCA_STATE["bench"]` 저장. NVDA 10월 2X·11월 3X, GOOGL 4월 1X·5월 LT·6~10월 1X·10월말 2X. 변형 비교 $env:TEMP\dca_rp.py(env V,Z,WK).
- (2026-11-12) `_DCA_GROWTH_CLAMP` 40→**10%**: LLY(매출성장 45%) ×2.7 보정으로 밸류 92~100 → 1년 내내 2X~3X 오판. 10%면 LLY 고점 1X·조정기 2X, NVDA/GOOGL 보정 유지. 업종 기준은 지표 선택만 하고 비교는 자기 10년 역사(동종 비교 아님). dca_diag env DCA_GC/DCA_GY 오버라이드.
- (2026-11-13) 역발상 **연속 가중** 보정 `_dca_regime_adj(rec, corr)` = −(rec−40)/20 + (corr−40)/20 (사용자 요청: 구간 임계값 대신 회복 60→−1, 80→−2, 100→−3). `_DCA_REGIME_PIVOT=40`, `_DCA_REGIME_STEP`=20→**10**(사용자 선택, 합산 ±10; GOOGL 5월 ST·6월 LT, NVDA 2X 다수 1X로 바뀜을 알고 채택). 추세추종(빨강 감산)은 GOOGL 실적 후 2X를 깨서 기각. 이후 LLY 회복 99인데 1X 지적 → 제곱 가속 HOT_MAX/HOT_AT 시도했으나 사용자가 **선형·STEP=15로 확정**(HOT 상수 제거, 보정 약 ±6.7). LLY 11/9 1X(33)로 남음을 알고 채택. 목표주가 보정(`_dca_target_adj`)은 사용자가 **되돌림**(미적용). 참고: `_dca_apply_forward` 재계산은 radj를 빠뜨림(미수정). dca_diag env DCA_RA=step, DCA_RT=pivot, DCA_RH=hot_max.
- (2026-11-13) 원조 dcaoptimizer.com 역산: 판정은 **월봉 종가** 기준(현재 달은 형성 중), 사이트에 "technical tool, fundamentals 검증 안 함", 배지(FCF/Quality)는 판정 불변. 홈 티커(2026-11-03 스냅샷=10월 월봉) 10종목이 **10월 종가÷12개월 SMA 괴리**와 완전 단조: NFLX −26% 4X, ORCL −19% 3X, GOOGL −16% 3X, AVGO −11% 2X, META −2/AMZN −1/TSLA +1/NVDA +4 1X, MSFT +16/AAPL +18 1X. 52주 낙폭·P/E·자기역사 밸류로는 설명 안 됨.
- (2026-11-13) 사용자 선택: 기존 축 대체 대신 **축 추가**. `_DCA_AXES` ma12 .4/val .2/tech .25/health .1/trend .05. `_dca_ma12_dev(rows)`(주봉→월 버킷, 금요일 기준 달, 이번 달=현재 종가, 12개월 평균 괴리%), `_dca_ma12_score`=MID 42 − dev×1.75(아래)/×0.6(위). ma12 단독이면 원조 10종목 10/10 일치, 혼합 점수는 10월 말 3/10(밸류·건전성이 NVDA/AMZN/META를 2X로 올림, 회복 브레이크가 NFLX 4X 막음).
- (2026-11-13) 사용자 확정: **점수 = ma12 + radj(역발상)만**. 다른 축 가중 0(UI "참고"), 회복 브레이크(`_DCA_RECOV_BRAKE`)·값싼 함정 상한 제거(cap 항상 None), `_dca_apply_forward`는 건전성·fwd만 갱신(재채점 없음 → radj 누락 버그 해소). 점수 유무는 ma12(월봉 12개) 기준. 10월 말 원조 9/10 일치(ORCL 82 4X vs 원조 3X).
- (2026-11-13) 역발상 보정의 회복·조정 압력을 **일봉 60일**로 변경: load_dca가 2y 1d 종목+벤치 받아 `_DCA_STATE["daily"]`, `_dca_daily_regime`이 각 주 마지막 거래일 값 매핑(거래량 확인 팩터 없음). 10월 말 원조 **10/10**(ORCL 79.6→3X). LLY 3~4월 radj +4~+6, 점수 40~50으로 여전히 1X(보정 최대 ±6.7 한계). STEP 8로 키우면 LLY 2X 되지만 GOOGL·ORCL 10월 4X로 깨짐. dca_diag는 daily 자동 사용(env DCA_WEEKLY_REG=1이면 주봉).
- (2026-11-13) DCA UI 이전: 별도 카드(`#dca-section` 결과 div, `_dca_svg` 주봉 캔들+적정가선) 제거. `_render_dca`는 `_DCA_STATE["view"]`(summary/details/help/wts/wsc)만 만들고 종목 차트 재렌더. 종목 차트 헤드 아래 `_dca_head_html()`(배지+"세부 항목" 버튼, `_handle_dca_more_click`, `_DCA_STATE["open"]`), `_candle_body_html`(stockchart만)에 `_dca_score_panel_html`을 회복/조정 패널 위에 — 보이는 각 일봉에 그 주 점수, ? 버튼은 recov-help 팝업 재사용. 이후 사용자 요청으로 `_dca_svg`(최근 `_DCA_SHOW`=52주 캔들+적정가선+점수)를 세부 항목 안에 복원.



- **Yahoo range=max+1wk는 오래된 종목에서 3mo 봉으로 강등** → load_dca는 "20y" 사용.
- Williams/Stochastic 설정 공용 상수 `_WR_PERIOD,_WR_SIGNAL`=10,9 / `_STOCH_PARAMS`=(15,5,5) (_daily_indicators_html 위). 차트 패널·호버·DCA 기술점수 모두 사용.

## 종목 탭 일봉 캔들 차트 (report 카드 다음)
- render_report/render_holdings 가 `#stock-chart` div 삽입 후 `load_stock_chart(full_symbol,desc)` 호출.
- TV심볼→Yahoo 후보 `_yf_symbol_candidates()`(미국=티커그대로/클래스주 . →-, KRX=.KS/.KQ, HKEX zfill(4).HK 등). `_fetch_history_any(cands,rng)` 순차 시도.
- `_render_stock_chart()`=카드+상단(`.stock-chart-top`: h3+분기지표 체크박스/선택)+기간버튼(data-srange, `_STOCKCHART_RANGES` 1mo~5y)+`_candle_svg(prefix="stockchart", overlay=)`. 상태 `_STOCKCHART_STATE{...,rows,overlay,overlay_metric}`, 호버 `_STOCKCHART_HOVER`.
  - 분기지표 오버레이: `#stockQtrToggle` 체크박스+`#stockQtrMetric` 선택(`_STOCK_OVL_METRICS`). `_stockchart_financials()`(=_LAST_STOCK.financials, 종목 일치+분기/연간데이터 있을때만→ETF/지수차트엔 없음). 10년 기간이면 연간 지표, 그 외 분기 지표 사용(`_build_stock_overlay(rows,fin,key,annual)`; annual=range=="10y"). `_period_end_ts(label,annual)`=분기말/연말(12/31) 매핑→최근접 캔들 idx. 하위 패널(막대, 색 #8e44ad, 캔들과 x축 공유). 토글/선택시 `_rerender_stock_chart()`(캐시 rows). 기간=1mo~10y.
- 호버는 정적 컨테이너 `#result` 에 `@when mousemove/mouseleave` 추가(on_stockchart_hover/leave)로 위임(#stock-chart는 innerHTML로 재생성되므로 직접 @when 불가).

## 캔들 차트 추세선 (idxchart/stockchart)
- `_candle_svg(..., trend_key=)` → `_TREND_GEOM[prefix]` 좌표계 저장 + clipPath `<g id=prefix-trend-layer>` + 임시선 `#prefix-trend-temp`. 키 "idx|<TV심볼>"/"stk|<심볼>".
- 선은 [ts1,p1,ts2,p2](ts 기반→기간/주기 바꿔도 유지), localStorage `candle_trendlines`. 오른쪽 끝까지 점선 연장.
- 툴바 `_trend_toolbar_html(prefix,key)`(.trend-tools data-prefix, 버튼 data-trend=draw/undo/clear). 클릭은 기존 click 위임 핸들러에서 `_handle_trend_click`, 드래그는 pointerdown/move/up @when(#idxchart-result/#result). 갱신 `_trend_refresh(prefix)`(재렌더 없음).
- 그리기 방식: 클릭-클릭(첫 클릭 `_TREND_DRAG`에 시작점, move로 임시선, 두 번째 클릭에 확정). `_trend_cancel(prefix, clear_draw=False)` — pointerup/mouseleave는 시작점 유지, 그리기 토글 시 clear_draw=True.
- 끝점 드래그 수정: `_trend_hit`(화면10px 내 끝점) → `_TREND_EDIT[prefix]=(li,end)`, 그리기 모드 무관. move에서 레이어만 재그림, up/cancel(`_trend_cancel`)에서 저장. 끝점 근처 cursor grab. 브라우저 검증됨.
- 가격 커서: `_candle_svg`가 `<g id=prefix-ycur>`(가로 guide-line + 좌측 축 파란 라벨 `#prefix-ycur-val`) 추가, `_TREND_GEOM`에 dec 저장. `_candle_hover`→`_price_cursor(prefix, sy)`(캔들 영역 밖이면 숨김), `_candle_hide`에서 숨김.
- 서버 동기화: 워커 레코드 `trends{key:[[ts1,p1,ts2,p2]]}`(save 기본값 포함, GET 응답), `POST ?trend_op=set` 본문 {trends:{key:lines}}(빈배열=삭제, stk는 즐겨찾기 심볼만, 키100/선50 제한), 종목/폴더 삭제 시 해당 stk 키 삭제. 클라 `_trend_save(key)`→`_trend_server_ok`(로그인+idx 또는 즐겨찾기 stk)면 `_TREND_PUSH` 큐→`_trend_flush`(순차 배치 전송). `_apply_fav_prefs`→`_apply_fav_trends`(서버 우선 병합, 서버에 없는 로컬 대상 키 업로드, 열린 차트 refresh).
- 좌우 이동(팬): `_PAN_FETCH_RANGE`로 선택 기간보다 긴 이력 조회(6mo→2y, 10y→max), `_pan_init(prefix, rows, rng)`로 보이는 봉 수 count 계산, `_PAN_VIEW{n,count,end}`. `_candle_body_html`이 `_pan_window`로 rows[s0:e] 슬라이스(+ `_PAN_WARMUP`=260 선행봉을 lead로 넘겨 MA/회복/오실레이터 예열). `_candle_svg`/`_daily_indicators_html`/`_recovery_pressure_html`에 `lead` 인자. `_PAN_BODY[prefix]` 람다로 `.candle-tooltip-host` 내부만 재렌더. 드래그는 추세선 pointer 핸들러 공유(그리기 모드 off + 끝점 아님일 때), 30ms 스로틀.
- 최신 봉 오른쪽 빈 영역: `_PAN_VIEW["blank"]`=max(5,count//2)까지 end>n 허용. `_pan_window`→(s0,lead,e,extra), `_candle_svg`/`_oscillator_svg`/`_recovery_pressure_svg`에 `extra`(slots=n+extra로 X 계산), `_TREND_GEOM["n"]`=slots, `hover["slots"]`로 보조패널 가이드 x 계산.
- Playwright 테스트 팁: mouse.down이 pointerdown을 안 보내는 경우가 있음 → 먼저 page.click(아무 요소) 후 드래그.
- 디버깅 팁: 페이지 로드 직후 Python이 바쁘면 첫 pointer 이벤트가 늦게 처리됨. js.console.log 대신 document.body.setAttribute로 값 확인하면 확실.

## 전체 화면 체크박스 (기본 해제)
- CSS `.chart-fs`(position:fixed inset:0 z9000, 다크 bg) + body:has로 스크롤 잠금. 종목=`#stockChartFs`(동적, `_STOCKCHART_STATE["fs"]`, #stock-chart에 클래스), 지수차트=`#idxChartFs`→#tab-idxchart, RRG=`#rrgFs`→#tab-rrg(@when change). 모바일(≤600px) 미표시: 라벨 `.chart-fs-ctrl` 숨김 + `.chart-fs` 규칙은 `@media (min-width:601px)` 안에만.
- 한 화면 맞춤: `_fit_fullscreen(root_sel)`가 .fin-chart 안 svg 높이 합으로 비율 계산해 `fin.style.maxWidth` 축소(min 560, 가운데 정렬). render_idxchart/render_stock_chart 끝·토글·window resize에서 호출. RRG는 CSS `.chart-fs .rrg-chart-wrap{max-width:(100vh-40px)*900/540}`. 넘치면 .chart-fs overflow-y:auto 스크롤.

## 차트 호버 툴팁 전역 on/off
- 헤더 index-box에 `#hoverToggle` 체크박스(`.hover-toggle`). `@when change`→`_HOVER_ENABLED{on}` 갱신, 끄면 `_hide_all_hover_tips()`.
- 모든 호버 핸들러(_candle_hover/on_cmp_hover/on_multpl_hover/on_liq_hover/on_macro_hover/on_fin_hover) 시작부에 `if not _HOVER_ENABLED["on"]: return` 가드.
- 숨김 대상 id 목록 `_ALL_HOVER_IDS`.

## Sankey(실적 흐름도) 기능 (직접 구현)
- `_sankey_ribbon()` = 베지어 리본 path 헬퍼.
- `_sankey_svg()` = TradingView 근사도(매출→총이익/원가→순이익/비용). 폴백용.
- SEC EDGAR 상세도: `_sec_load_sankey(full_symbol)` 가 lookup() 안에서 미국 종목만 호출,
  결과를 전역 `_SEC_SANKEY = {"annual":snap, "quarterly":snap}` 에 저장.
  - CIK 매핑: https://www.sec.gov/files/company_tickers.json (전역 `_SEC_CIK_MAP` 캐시).
  - 값: https://data.sec.gov/api/xbrl/companyconcept/CIK{10자리}/us-gaap/{Tag}.json
  - us-gaap 태그 후보는 `SEC_TAGS` dict. 기간 정렬은 (start,end) 매칭 + duration 필터(연간330~400/분기70~100일).
  - `_sec_sankey_svg()` = 4단계 상세도(매출→총이익/원가→영업이익/영업비용→순이익/세금 + R&D·판관비 분해).
- refresh_financials 에서 SEC 스냅샷 있으면 상세도, 없으면 `_sankey_svg` 근사도.
- SEC 값은 USD. 부문별 매출(Search/YouTube 등)은 회사별 확장태그라 미구현.

## 거시경제 탭 (data-tab=macrodoc "거시경제") — HTML 리포트 자료실
- 관리자(ai_admin 계정)만 HTML 파일 등록/삭제, 로그인 안해도 열람 가능.
- 워커 `/macro-doc`(FAVORITES KV): GET(목록/`?id=`개별, 무인증), POST{title,html}(관리자), DELETE?id=(관리자). 키 macrodoc_index + macrodoc:<id>. 같은 제목=갱신. 최대 3MB/100건.
- 목록은 `#macrodoc-list` 표(`_render_macrodoc_table`): 갱신일 내림차순 정렬(`_sorted_macrodocs`), 10개씩 페이지네이션(`_MACRODOC_PAGE`/`_MACRODOC_PER_PAGE`, `#macrodoc-pager` 이전/다음). 각 행 "보기"(`_make_macrodoc_view_handler`)+관리자에게만 "삭제"(`_make_macrodoc_del_handler`, `.macrodoc-del`) 버튼 표시(`_is_ai_admin()` 체크는 렌더 시점에 수행). 등록 박스 내 원형 칩 목록(구 `_render_macrodoc_admin_list`/`#macrodoc-admin-list`)은 삭제하고 표로 통합. "보기"→`_view_macrodoc`이 sandbox iframe(allow-scripts, srcdoc)로 격리 렌더.
- 관리자 패널 `#macrodoc-admin`은 `_is_ai_admin()` 기준 `_update_macrodoc_admin_ui()`로 표시(로그인/탭전환/`_refresh_ai_admin`에서 호출). 파일 등록: `#macroDocFile`.text()→_macrodoc_save.
- (기존 "경제지표" 탭은 data-tab=macro, FRED 지표. 거시경제와 다름.)

## 헤더 지수 상시 표시 (#indices)
- 카드 그리드(`div#indices.idx-grid` → `.idx-cell` 반복, auto-fill minmax(108px,1fr), width:100%)로 표시. 각 카드: 이름(`.nm`)/지수(`.pv`)/변동률(`.chg`) 세로 배치. `update_indices()`가 `el.innerHTML` 갱신. (표 형태는 폐기)
- INDEX_LIST 끝에 VIX(TVC:VIX→^VIX), MOVE(TVC:MOVE→^MOVE) 추가(스캐너·Yahoo 둘 다 검증됨).
- **로딩 스켈레톤**: 초기 HTML에 `.idx-cell.skeleton`(자식 `.sk.nm/.sk.pv/.sk.chg`) 14개(INDEX_LIST 수) 정적 배치→Pyodide 부팅+지수 fetch 동안 shimmer(`@keyframes idx-shimmer`, prefers-reduced-motion 시 정지) 표시. update_indices의 innerHTML 갱신으로 교체됨. (구 "로딩중…" 텍스트 대체)
- 클릭 이동(지수 차트 탭) 유지: 차트 있는 지수는 `.idx-cell.idx-link` + `data-idxsym`. `on_index_header_click`은 `closest(".idx-link")`로 그대로 동작.
- `.index-box`는 `position:relative; padding-bottom:36px`로 하단 여백 확보. `#fxrate`(원/달러 환율)는 `position:absolute; left/bottom`으로 좌측하단 고정, `.hover-toggle`(차트 툴팁 on/off)은 `right/bottom`으로 우측하단 고정. 그리드(`.idx-grid`)는 그 위 전체 폭 사용.

## 즐겨찾기 그리드 (#favorites-list)
- `.fav-folder-items`를 flex-wrap에서 grid(auto-fill minmax(108px,1fr))로 변경. 각 항목은 `.fav-cell.fav-load`(헤더 idx-cell과 동일 톤): 티커(`.nm`)/가격(`.pv`, 초기 "-")/변동률(`.chg`) 세로 표시, 우상단에 작은 원형 삭제 버튼(`.fav-del`, stopPropagation으로 로드 클릭과 분리). 회사명은 `title` 툴팁으로 이동(구 fav-chip 방식은 ai-access-list 등 다른 곳에 계속 쓰이므로 CSS 유지).
- KRX 종목은 카드 `.nm`에 한글 회사명 표시: `_naver_kr_name(code)`(네이버 ac q=코드, `_KR_NAME_CACHE`)를 `_refresh_fav_prices`에서 가격과 병렬 조회해 갱신. 가격은 소수점 없이(fmt_num(...,0)).
- 카드 티커 표시(`.nm`)는 거래소 접두어 제거(`sym.split(":",1)[-1]`), `data-symbol`/조회/삭제는 원래 전체 심볼("EXCHANGE:TICKER") 그대로 사용.
- `render_favorites()` 끝에서 `_refresh_fav_prices()`(비동기)가 렌더된 `.fav-cell[data-symbol]` 전체를 모아 `_fetch_index()`(헤더 지수와 동일 함수, 임의 심볼 close/change 조회)로 가격·변동률 채움.

## 즐겨찾기 드래그 앤 드롭 (정렬/폴더 이동)
- `.fav-cell`에 `draggable="true"` + `data-folder`, `.fav-folder-items`에 `data-folder` 부여. 네이티브 HTML5 D&D 사용(터치 롱프레스 아님, 마우스로 누른 채 드래그).
- 상태 `_FAV_LAST{list}`(마지막 렌더 favorites 원본, render_favorites 시작에서 갱신) / `_FAV_DRAG{symbol,folder}`(드래그 중 항목).
- 핸들러(모두 동기, `_bind_favorites()`에서 매 렌더 후 바인딩): `_on_fav_dragstart`/`_on_fav_dragend`(evt.target=드래그 소스, dataTransfer.setData 병행), `_on_fav_cell_dragover`/`_on_fav_cell_dragleave`/`_on_fav_cell_drop`(대상=`evt.target.closest(".fav-cell")`), `_on_fav_container_dragover`/`_on_fav_container_drop`(빈 폴더/카드 사이 여백에 드롭, `.fav-cell` 위일 땐 컨테이너 핸들러 스킵). **주의**: `_bind()`는 async 함수를 직접 지원하지 않아(create_proxy가 코루틴을 await 안 함) drop 핸들러는 동기로 두고 내부에서 `asyncio.ensure_future(_apply_fav_drop(...))` 호출.
- `_apply_fav_drop(drag_sym, target_folder, before_sym)`: 폴더 다르면 먼저 `fav_add()`로 폴더 이동 → 대상 폴더의 현재 순서 목록(order) 계산 후 before_sym 앞에 삽입(없으면 끝) → 워커 `POST /favorites?reorder=1` 본문 `{folder, order}` 호출 → `render_favorites(favs)` 재렌더.
- 워커 `/favorites` 새 연산 `?reorder=1`(POST, 본문 `{folder, order:[symbol,...]}`): 해당 folder 항목만 order 순서로 재배치(원래 배열 내 그 인덱스 위치들에 재배치, 다른 폴더 항목 위치는 불변). order에 없는 folder 항목은 뒤에 보존.

- 매매 내역 표에 `변화액(추정)` 열(`delta_value_usd`, 정렬키 `dvalue`): `_compute_changes()`에서 `평가액 × (증감수량 ÷ 현재수량)`, 청산은 `-직전분기 평가액`. **평가액 × 변화율(수량기준)은 틀림** — 변화율 분모가 이전수량이라 현재수량/이전수량 배 왜곡됨.

## 경제지표 탭 (data-tab=macro "경제지표", FRED)
- API 키는 **Cloudflare Worker 환경변수 `FRED_API_KEY`로 서버 주입**. 클라 상수 `FRED_API_KEY=""`(빈값)로 보내면 워커가 api.stlouisfed.org 요청에 `searchParams.set("api_key", env.FRED_API_KEY)`로 채움(investing-proxy-worker.js 프록시 핸들러, allow-check 직후). #fredKey 입력창·#macroBtn 조회버튼은 삭제됨. fetch_all_macro/_show_macro_chart/on_liquidity 모두 FRED_API_KEY 사용.
- 탭 첫 진입 자동조회: on_tab에서 `_MACRO_LOADED["done"]` 체크→`run_macro()`(구 on_macro 로직을 함수화). 
- 상단 fieldset엔 분류 버튼(.macro-mode NORMAL/CUSTOM)+#macro-status+경기순환 방향표(#cycle-note, CUSTOM일 때만 표시)만 남김. 
- render_macro는 #macro-chart를 빈값으로 초기화(구 "아래 지표 행을 클릭..." placeholder 박스 삭제). 지표 행 클릭 시 _show_macro_chart로 차트 표시(`is_db=ind.get("source")=="db"` 정의 필수).
- **모바일 동시요청 제한**: fetch_all_macro가 17개 FRED 지표를 gather로 동시 요청하면 모바일 네트워크(낮은 동시연결)에서 PMI(DBnomics) 외 나머지가 자주 드롭됨. `_MACRO_REQUEST_LIMIT=asyncio.Semaphore(4)`+`_fetch_one_macro_limited(ind,key,sem_size)`로 동시 요청 4개로 제한. **실패(None) 지표만 자동 재조회**: fetch_all_macro가 최대 2회, 0.6s 대기 후 실패분만 동시성 2(`_MACRO_RETRY_LIMIT`)로 재조회해 results 교체.

## 반응형 (모바일)
- **2단계 탭**: 상위 그룹 바 `.tab-groups`>`.group-btn[data-group]`(종목분석/시장지표/거시경제/계산기) + 하위 탭 `.tabs`>`.tab-group[data-group]`>`.tab-btn[data-tab]`. `.tab-group{display:none}`, `.active`만 표시(`display:flex;flex-wrap:nowrap;overflow-x:auto`=한 줄). 그룹 클릭 `@when click .group-btn`=`on_group`→그 그룹의 마지막 선택 탭(`_GROUP_LAST`) 또는 첫 탭을 `.click()`. `on_tab`/`_open_index_chart`가 탭 전환 후 `_sync_tab_group(name)` 호출→해당 탭의 부모 `.tab-group` data-group으로 group-btn·tab-group active 동기화 + `_GROUP_LAST` 기록. 그룹핑: analysis=stock/ai/guru, market=idxchart/feargreed/rrg/multpl, macro=macro/liquidity/macrodoc, tools=compound. 모바일(≤600px)은 `.tab-groups{grid 4열}`.
- `@media (max-width:600px)`에서 `.idx-grid`/`.fav-folder-items`를 1열로 바꾸고 `.idx-cell`/`.fav-cell`을 `grid-template-columns:1fr auto 84px` 한 줄 행(이름|값|변동률)으로 전환 = 표처럼 보이게. 카드 테두리는 아래쪽만 남김. `.fav-del`/`.guru-fav-del`은 세로 중앙 우측으로 이동(+ cell padding-right 확보). HTML/JS 변경 없이 CSS만.

## 13F 탭 (검색 + 대가 즐겨찾기)
- 전체 목록 표시 폐기. 검색 기반: `#guru-search` 입력 중엔 내장 `GURUS` 즉시 필터(`_filter_gurus`, 빈 쿼리=빈 결과), `#guruSearchBtn`/Enter → `run_guru_search()`가 내장 결과 + `_edgar_search_filers()`(SEC EDGAR `www.sec.gov/cgi-bin/browse-edgar?...&type=13F-HR&output=atom` atom 파싱, 이미 허용된 host) 병합.
- `_GURU_INDEX{cik:dict}`(GURUS로 시드 + 검색/즐겨찾기 결과 `_remember_guru()`), `_guru_by_cik()`는 이 인덱스 조회 → 내장 목록 밖 기관도 조회 가능.
- 대가 즐겨찾기: 워커 `/favorites` 레코드에 `gurus` 배열 추가. `POST ?guru_op=add`(본문 {cik,ko,name,firm}), `DELETE ?guru=<cik>`, GET 응답에 `gurus` 포함. **주의: handleFavorites의 모든 KV put에 `gurus`를 함께 저장해야 유실 없음.**
- 클라: `_GURU_FAVS{list}`, `_guru_fav_api()`, `refresh_guru_favorites()`(`_update_fav_login_ui()`에서 호출), `render_guru_favorites()`가 `#guru-favorites`(`.fav-folder-items` 그리드 재사용)에 `.fav-cell.guru-fav-load` 카드(이름 `.nm` / 운용사 `.pv.sub` / 빈 `.chg`) 렌더 → 모바일 표 전환 CSS 자동 적용. 등록 버튼 `#guruFavAddBtn`(`_update_guru_fav_btn()`으로 로그인+조회+미등록일 때만 활성).

## 적립식 복리 계산기 탭 (data-tab=compound "복리계산기", fical.net 참조)
- 순수 클라 계산(네트워크 없음). 입력: `#cmpInitial`(시작금액)/`#cmpMonthly`(매월적립,2번째달부터)/`#cmpYears`(년)/`#cmpRate`(연%)/`#cmpMode`(복리주기 ppy=연간복리횟수: 월12/연1/반기2/분기4/일360). `#cmpBtn` 계산.
- `_cmp_num(sel)`=콤마제거 float. `_compound_simulate(initial,monthly,years,rate,ppy)`=월단위 루프, ppy=360은 (1+r/360)^30/월, 12는 매월, 그외 mpp=12/ppy 경계월에만 복리. 반환(투자금,최종,연차yearly). `_render_compound()`→#cmp-result(요약 3카드 .cmp-summary/.cmp-stat + 연차표 .cmp-table). 탭 첫진입 자동계산 `_CMP_LOADED`. 금액입력 change시 콤마서식(on_cmp_*_change). CSS .cmp-summary/.cmp-stat/.cmp-table.

## 세션 토큰 (2026-10)
- 워커 GET/register/pw change 응답에 `token`("~tok.<exp>.<HMAC>", 24h, 서명에 keyHash 포함→키변경 시 무효, 비밀 env.SESSION_SECRET 없으면 FAV_SALT). X-Fav-Key 헤더에 키 원문 또는 토큰 모두 허용(`credentialMatches`). save()는 record.keyHash 유지.
- 클라는 로그인 후 `_FAV_CREDS["key"]`=토큰, sessionStorage엔 `_FAV_TOKEN_PREFIX` 시작값만 저장(원문 비번 저장 안 함).
- `_esc`는 따옴표도 이스케이프. `_warn(where, exc)`=console.warn. `_candle_hover(event, root, hover, prefix)`/`_candle_hide(prefix)`.

## 로그인 유지 (새로고침)
- `_fav_set_creds(acct,key)`가 `_FAV_CREDS`+sessionStorage(`fav_session`) 동시 갱신(None=삭제). 로그인/등록/로그아웃/계정삭제/비번변경 모두 이 함수 사용.
- 시작 시 `_restore_fav_session()`가 저장값으로 GET 검증 후 복원(401/403/404·미존재면 세션 폐기). sessionStorage라 탭 닫으면 로그아웃.

## 실적 달력 탭 (data-tab=earncal, 종목분석 그룹, 로그인 시에만 표시)
- `#earnCalTabBtn`(display none) ← `_update_earncal_tab()`(_update_fav_login_ui에서 호출, 로그아웃 시 숨김+stock 탭 전환).
- `_load_earncal(force)`: `_FAV_LAST` 심볼별 스캐너 earnings_release_next_date/earnings_release_date(UTC 날짜) Semaphore(6) 조회, 심볼 목록 key 동일하면 캐시. `_render_earncal()`=일요일 시작 월 달력(.earncal-grid/.earn-chip, past=회색). 다가오는 발표 표는 `#earnCalUpBtn` 클릭 시 모달 팝업 `#earncal-up-pop`(.open, 배경/×클릭 닫기, `_render_earncal_upcoming()`→#earncal-up-body). 버튼은 이전/다음 달 + 팝업 버튼만(이번 달/새로고침 삭제됨). render_favorites가 탭 활성 시 재로딩.
- 폴더 강조: `#earnCalFolder` select(`_populate_earncal_folders`, 렌더마다 갱신, state 변경 안함) → `_EARNCAL_STATE["folder"]`. `_earncal_sym_folders()`(_FAV_LAST 기준)+`_earncal_mark()`=선택 폴더 종목만 hl, 나머지 기본색(dim 없음). hl 칩은 셀 내 앞쪽 정렬.
- 강조 폴더는 서버 저장: 워커 레코드에 `prefs{earncal_folder}` 추가, `POST ?pref_op=set`. GET 응답에 prefs. 폴더 rename/delete 시 워커가 prefs도 갱신. 클라 `_apply_fav_prefs(data)`(로그인/등록/세션복원), `_save_earncal_folder()`(change 시).
- **잠정실적 함정**: 스캐너 `earnings_publication_type_fq==21`(잠정, 예: TSLA 인도량 10/2)이면 earnings_release_date=잠정일이고 next_date는 다음 분기로 넘어가 정식 실적일이 누락됨. → 이벤트 kind="prelim"(점선 칩) + 해당 미국 종목만 Nasdaq `api.nasdaq.com/api/analyst/{TKR}/earnings-date` reportText의 mm/dd/yyyy로 보완(kind="est" if "estimated"). 22=확정. 워커 ALLOWED_HOSTS에 api.nasdaq.com 추가(Origin/Referer nasdaq.com).
- 워커 handleFavorites는 이제 `save(over)` 헬퍼로 저장(keyHash/favorites/folders/gurus/prefs 보존). 새 필드 추가 시 save 기본값에만 추가하면 됨.

## 성능 개선 (2026-10)
- lookup(): forecast 후 valuation/financials/consensus/rf/erp/fx/usd_rate/sec_roic 를 asyncio.gather 병렬. ETF는 holdings+tech gather.
- `_bind`: `_PROXIES`=[(el,proxy)], 300개(또는 live×2) 넘으면 `_prune_proxies()`가 isConnected=False 항목을 한 주기 늦춰 destroy(`_PROXIES_STALE`).
- 워커 /quotes QUOTE_COLUMNS에 market_cap_basic/fundamental_currency_code/earnings_release_(next_)date/earnings_publication_type_fq 포함 → 히트맵(`_heat_caps_from_quotes`)·실적달력(`_fav_quote_data`)이 종목별 스캐너 요청 대신 일괄 시세 사용, 필드 없는 종목만 개별 폴백.
- update_fxrate 삭제 → update_indices 결과로 `_render_fxrate(d)`. 헤더 60초 갱신은 document.hidden 이면 생략, visibilitychange 시 60초 경과면 즉시 갱신.

## 시총 순위 탭 (data-tab=mcap, 종목분석 그룹)
- 워커 `GET /mcap-top?n=20`(handleMcapTop): TradingView `/america/scan` POST 고정 본문(type stock/dr + is_primary=true + typespecs has_none_of preferred + exchange not OTC(MTPDL 같은 OTC 우선주가 기업 전체 시총으로 섞임) → GOOG/GOOGL·BRK 중복과 해외 ADR 제외, market_cap_basic desc), caches.default 60초. 범용 POST 프록시는 열지 않음.
- 클라 `_MCAP_STATE{rows,at,busy}`, `_fetch_mcap_top`/`_render_mcap_top`/`_load_mcap_top`. 새로고침 버튼 없음(사용자 요청 삭제), 탭 진입 시 60초 지났으면 재조회. 행 클릭(`#mcap-result` 위임)→종목 탭 조회.
- 즐겨찾기 폴더별 히트맵 `#mcap-heat`(차트 아래): `_load_mcap_heat()`(on_tab mcap + mcap탭 활성 시 render_favorites), `_heat_groups`/`_render_mcap_heat`/`_squarify`/`_heat_color`(finviz ±3%). 크기=`_fetch_heat_cap`(scanner market_cap_basic는 `currency`(거래통화)가 아니라 `fundamental_currency_code` 기준 — KRX/TSE/HKEX/XETR 모두 USD로 옴, 거래통화로 환산하면 1/1400 축소 버그, `_HEAT_CAPS` 600s, 없으면 폴더 중앙값), 등락=`_FAV_PRICE_CACHE`/`_fetch_fav_batch` 공유. 셀 클릭=종목 조회. 글자 cqw 스케일.
- 다음 단계 후보: 순위 변화 그래프(Yahoo 종가×현재 발행주식수 추정 + 워커 Cron KV 스냅샷).

## 장외(프리/애프터) 가격
- 실시간 시세: TradingView 비로그인은 KRX 20분·미국 15분 지연(`update_mode=delayed_streaming_1200/900`). `_fetch_quotes`가 `_naver_quotes`로 덮어씀: KRX→`polling.finance.naver.com/api/realtime/domestic/stock/코드,..`, 미국→`/worldstock/stock/로이터코드,..`(NASDAQ→X.O, NYSE·AMEX→X, BRK.B→BRKb; SPY.K는 안 됨). Raw 필드 부호 포함, 미국 overMarketPriceInfo(PRE_MARKET/AFTER_MARKET overPrice·fluctuationsRatio)→pre/postmarket_close/change. 워커 ALLOWED_HOSTS 추가. `_refresh_head_price`(조회 직후 + 60초), 60초 타이머가 즐겨찾기 가격도 갱신.
- 차트: `_chart_head_html(prefix,...)`가 `_CHART_EXT[prefix]={last,up,ext}` 설정 → `_candle_svg`가 최신종가/장외가 점선 + 왼쪽축 가격태그 그림. `_IDXCHART_STATE["render_args"]`로 토글 시 재렌더.
- 장외 캔들: `_chart_ext_bar`(스캐너 pre/postmarket_open/high/low, 지수는 ETF값×지수종가/ETF종가) → `_CHART_EXT["bar"]`(일봉만), `_candle_body_html`이 extra=1 칸 확보, `_candle_svg`가 반투명 점선 캔들로 그림.
- 스캐너 필드 premarket_close/premarket_change/postmarket_close/postmarket_change(%, 직전 종가 대비) 제공(심볼·global/scan 모두 확인). market-status 필드는 null.
- 종목탭 헤더 `_head_price_html(sym,data,close,cur)`: 미국 거래소(`_US_EXCHANGES`)만, `_us_session()`(ET 계산 `_now_us_eastern`, DST 수동) pre=04:00~09:30, regular=~16:00, 그 외·주말=post. 장외면 "현재가"에 장외가만 표시(라벨·정규장 종가 줄 없음, 사용자 요청 삭제). 목표가 등 계산은 정규장 close 유지. 헤더는 `.px-head`로 감싸고 `_LAST_HEAD` 저장(토글 시 outerHTML 교체).
- 공통 `_ext_quote(sym,d,proxy=None)`→(가격,변동률,sess)|None. post 세션 변동률은 정규장 등락(d.change)과 복리 합산=전일 종가 대비(인라인 JS paint도 동일). pre는 원래 전일 종가 대비라 그대로. 프리/애프터 라벨·배지 전부 없음(사용자 요청 삭제). 워커 /quotes QUOTE_COLUMNS에 장외 4필드 추가(배포 필요), `_fetch_index` 폴백도 포함.
- 지수는 장외가 없음(스캐너 null) → 대표 ETF(`window.IDX_EXT_PROXY` 인라인 JS 원본, Python `IDX_EXT_PROXY`) 장외 변동률을 지수 종가에 적용한 추정. update_indices가 프록시 ETF도 조회, `_paint_indices(qm)`/`_IDX_LAST_QM`. 인라인 JS paint도 같은 로직(Intl America/New_York).
- 헤더 `#regularOnly` "정규장 기준" 체크박스(기본 해제, localStorage `px_regular_only`) → `_PX_REGULAR{on}`, `on_regular_only_change`가 지수바·즐겨찾기(`_FAV_PRICE_CACHE`)·종목 헤더 재도색.

## 종목 데이터 D1 (미국 종목, StockDataList.md 항목)
- 스키마+GOOGL 샘플: InvestingData/d1/stocks_sample.sql (stocks 1행/종목, op_income_history(symbol,fiscal_year)). 단위 $M, %.
- 워커 `GET /stocks`(목록) / `?symbol=`(stock+op_income) / `?all=1`({rows, op_income} 전체), D1 바인딩 `STOCKS_DB`. 뷰어: InvestingData/StockDataView.html(독립 페이지, 샘플 버튼 포함).
- 수집: InvestingData/d1/build_sp500.py (Wikipedia S&P목록 + yfinance → sp500_data.sql, 스키마는 stocks_sample.sql의 INSERT 이전부분 재사용). 회사망 SSL: certifi+Windows 저장소 합친 `.ca_bundle.pem` → requests verify + 스레드별 curl_cffi Session(verify). Python 3.9라 truststore 불가. inst_trans(Finviz)는 NULL.
  - 러셀1000 합집합(2026-10): Wikipedia List_of_Russell_1000_companies(Company/Symbol). 1심볼=1행, `stocks.indices`="S&P500 R1000" 등. 다중클래스는 회사명 "(Class|Series|Common ..)" 제거 후 1개만(S&P 소속>점없는 티커>표순서). upload()가 ALTER TABLE ADD COLUMN indices 선실행(오류 무시). 앱 그리드 "지수" 열. 시장 선택 `#d1Mkt`(.fin-period, data-mkt=all/sp/r1/r1only) → `_D1_STATE["mkt"]`+`_D1_MKTS`, `_d1_set_mkt`, 필터 초기화 시 all. 저장 필터엔 미포함.
  - S&P400/600(2026-11): build_sp1000.py + update_sp1000.bat(→sp1000_data.sql), build_sp500 공용 `index_members()`→(members, counts) 4개 지수(S&P500/S&P400/S&P600/R1000) 태깅, `prune_sql`(MIN_COUNTS 모두 충족 시 4지수 합집합 밖 USD 삭제), `us_build(members)`. sp500 스크립트=S&P500∪R1000 대상, 400/600 스크립트=S&P400∪S&P600 전체(R1000 중복 319개도 재수집). 앱 `#d1Mkt` sp400/sp600 버튼.
  - 코스피(2026-10): InvestingData/d1/build_kospi.py + update_kospi.bat (→kospi_data.sql). 네이버만 사용(`m.stock.naver.com/api/stocks/marketValue/KOSPI` 목록, `/stock/{code}/integration|finance/annual|trend?pageSize=60`(최대60, 100 이상 400), 일봉 `api.stock.naver.com/chart/domestic/item/{code}/day?startDateTime=YYYYMMDD0000&endDateTime=...`, 업종명 `/stocks/industry?page=1&pageSize=100`(200은 400)). 보통주=stockEndType stock & 코드 끝자리 0(831개). indices='KOSPI', currency='KRW', exchange='KRX'; $M 열은 KRW=X 환율로 달러 환산, 주가/EPS 원화; frgn/inst_net_1m/3m(억원=Σ수량×종가/1e8, 20/60거래일). build_sp500.py 공용 헬퍼: parse_args/schema_sql/run_all/finish/upload(ADDED_COLS 각각 ALTER). 미국 prune은 COALESCE(currency,'USD')='USD'만, 코스피 prune은 currency='KRW'만.
  - upload(): `npx --yes` + stdin DEVNULL + CI=1 필수(없으면 npx "Ok to proceed?" 프롬프트가 capture_output에 숨어 무한 대기). 타임아웃 시 taskkill /T(npx.cmd만 kill하면 node가 파이프 유지). wrangler는 NODE_OPTIONS=--use-system-ca 없으면 회사망 fetch failed.
  - 네이버 finance/annual 컨센서스는 FY0 1개뿐 → FY+1·EPS 리비전은 wisereport JSON: `navercomp.wisereport.co.kr/company/ajax/c1050001_data.aspx?flag=2&cmp_cd=&finGubun=MAIN&frq=0&sDT=YYYYMMDD`(연간 (A)/(E) 행, SALES 억원/EPS/ROE), `cF5002.aspx?...&yymm=FY0키&frq=Y&acc_cd=122700`(chart1 JSON 문자열의 avg=EPS 컨센서스 월말 추이). 30일 상향/하향은 소스 없음(코스피 숨김). 결산월 변경 기업은 영업이익 연도 중복→연도별 dedupe. finish()가 업로드 전 로컬 sqlite 검증(D1은 SQL 오류를 D1_RESET_DO로만 표시).
  - 앱: `_D1_MKTS["kospi"]`, "전체" 버튼 삭제됨(기본=sp, 필터 초기화는 시장 유지), `_D1_HIDE`(kospi→inst_pct·insider_net_6m 숨김, 미국 시장→`_D1_NETS` 숨김), `_d1_cols()`=보이는 열, 시장 변경 시 `_d1_build_grid()`. `_d1_fmt(v,kind,cur)` px는 KRW면 ₩, kind "eok"=억원 색상. 상세는 currency 기준 숨김. `_D1_TV_EXCH` KRX 추가.

- 앱 탭: 도구·데이터 그룹 "종목 DB"(data-tab=d1). 엑셀형 그리드 `#d1-grid`(정적 div, 내부 innerHTML): `_D1_COLS`(_D1_SECTIONS에서 생성+op_last/op_yoy), `_D1_STATE{rows,ops,flt,sort,sel,loaded}`, 머리글 `.d1-sort` 클릭 정렬, 열별 `.d1-flt` 입력(숫자 >10, <=5, 10~20, 연산자 생략=≥ / 문자 포함, 쉼표 OR, `!단어`=제외(AND), 잘못된 식 .bad), 행 클릭→`_render_d1` 상세 `#d1-result`.
- 체크박스 필터 열 `_D1_CHECK_KEYS={"sector"}`: 헤더에 `.d1-chk-btn` → body에 동적 `#d1-chk-pop`(fixed, 현재 시장 값별 개수, 전체 해제). flt 값=쉼표 연결, `_d1_check_pred`=정확 일치 OR. `_D1_CHK{key,pop,proxies}`, 문서 클릭 시 닫힘.
- d1 탭 main 패딩 12px/max-width:none은 `@media (min-width:601px)`에서만(모바일은 다른 탭과 동일). 모바일 `#d1Mkt` flex-wrap + fieldset min-width:0(페이지 폭 확장 방지).
- CSV 저장 `#d1CsvBtn`→`on_d1_csv`: `_d1_filtered()`(=(cols,rows,bad), 렌더와 공용) 결과를 원시값+통화열로 BOM UTF-8 CSV(Blob, `to_js`), `_csv_cell`은 수식주입 방지.
- 저장 필터(로그인 시): 워커 레코드 `d1_filters`=[{name,flt,sort}] (최대30, `POST ?d1f_op=set|del`, GET 응답 포함). 클라 `_D1_SAVED{list}`, `_d1_update_saved_ui`(_update_fav_login_ui에서 호출), `#d1-saved`(select `#d1SavedSel`/`#d1SaveName`/`#d1SaveBtn`/`#d1DelBtn`), `_apply_fav_prefs`가 목록 적재. `#d1-count`/`#d1-status`는 사용자가 HTML에서 제거함(코드는 None 가드).

## 공포·탐욕 타임라인 차트
- CNN graphdata의 `fear_and_greed_historical.data`[{x(ms),y,rating}] → `_fg_history_points`(UTC 날짜별 dedupe) → `_FG_HIST{pts,range}`. CNN 카드 내 `#fg-chart`(`_fg_history_body`=기간버튼 data-fgrange 30/90/180/365 + `_fg_history_svg` 구간 배경밴드). 클릭/호버는 `#fg-result` 위임(`on_fg_range_click`/`on_fg_hover`, `_FG_CHART`, `#fg-tip/#fg-guide`).
- 하단 지수 패널: `_FG_OVERLAYS`[(sp,S&P 500),(ndx,나스닥 100)], `_FG_HIST["series"][k]{day:close}`/`["ov"][k]` 토글(버튼 `data-fgsp=<k>`, 기본 off). sp=CNN 응답 `market_momentum_sp500.data`(`_fg_sp_points`), ndx=첫 토글 시 `_fetch_index_history("^NDX","10y")`. 같은 svg 안 x축 공유 패널 스택(각 130px), 호버 점 `.fg-guide-sub#fg-guide-dot-<k>`, cache `sy{k:y}`. 기간은 최대 5년('전체' 제거).
- 1년 초과(3년/5년): 클릭 시 `FEAR_GREED_LONG_URL`(graphdata/2020-09-19, 이보다 이르면 HTTP 500) 1회 lazy 조회, `_FG_HIST["long"]`. `fetch_fear_greed(src)`.
- 마킹 메모(로그인): 워커 레코드 `fg_marks{"YYYY-MM-DD":{m,s}}`(구버전 값=문자열 memo 호환, `_fg_mark_memo`/`_fg_mark_score`=시계열값 우선→저장 s)(save 기본값/GET 포함, `POST ?fgm_op=set` {date,memo,score}, 빈 memo=삭제, 최대300). 목록 `#fg-marks`(`_fg_mark_list_html`, 지수 오름차순, 추가 폼 날짜/지수/메모 → 시계열에 없으면 지수 수동입력, data-fgmark=add/goto/ledit/ldel → `_fg_mark_list_action`). 시계열 밖 날짜도 차트 범위 안이면 저장 지수 위치에 원 표시(`_FG_CHART["marks"]`). `_fg_ensure_long()`, `_fg_data_score`는 pts 기준 day→v dict 캐시(`_FG_HIST["daymap"]`). 클라 `_FG_MARKS{map,mode,sel,edit}`, `_fg_mark_pop_html`(차트 내 절대위치 팝업), `_fg_mark_click`(on_fg_range_click 선처리, data-fgmark=mode/save/del/edit/close, circle.fg-mark), `_fg_apply_marks`(←_apply_fav_prefs), 로그아웃 시 `_update_fav_login_ui`가 초기화+`_fg_refresh_chart`.

## 주의

## 섹터 RRG 탭 (data-tab=rrg)
- 기준지수 SPY 대비 13개 테마 ETF RRG. 기간 버튼은 1개월/3개월/6개월, 기본값 1개월.
- 기간 변경 시 즉시 재조회(분석 버튼 제거). RS Ratio=선택기간 첫날 대비 누적 상대성과, RS Momentum=최근 5일 상대변화 vs 기간 추세.
- 중심 확대: 현재 버블의 중앙 90% 분포 기준 축 설정, 범위 밖 값은 가장자리 클램프.
- 버블 호버 시 해당 섹터 이동경로(최근 12일)와 레이블만 표시. 호버 레이블은 SVG 최상단으로 올려 가림 방지.
- 표 컬럼: 눈아이콘(표시토글) / 테마 ETF / RS Ratio / RS Momentum / 사분면 + 액션 가이드 + 주의 신호.
- **표 눈 아이콘 표시/숨김**: `_RRG_HIDDEN`(set, 기본 빈=전부 표시), `_RRG_LAST_ITEMS`. `_render_rrg`는 items 저장 후 `_rrg_render_body()` 호출(차트=visible만 `_rrg_svg`, 표=전체행+눈버튼, 숨김행 dim). 눈 클릭=`_make_rrg_eye_handler`(토글 후 재렌더, 재조회 없음). 전부 숨기면 차트 자리에 힌트. `_RRG_EYE_ON/OFF` SVG, CSS `.rrg-eye`/`.rrg-eye.off`/`.rrg-row-hidden`.
- **커스텀 종목 추가**: `_RRG_CUSTOM{list:[{ticker,name,color}]}`. `_rrg_all_sectors`/`render_rrg_chips`/`_rrg_add_custom`/`_make_rrg_custom_del_handler`. UI=#rrgCustomInput+#rrgAddBtn(@when click/keydown Enter). 미국 티커 기준. **새로고침 시 초기화(기본 테마 ETF만)**: 시작 시 `_rrg_load_custom()`/`_rrg_load_folders()` 호출 제거함(세션 중에만 유지). save/load 함수는 남아있으나 미사용.
- **즐겨찾기 폴더 함께 표시**: `_RRG_FOLDERS{list:[폴더명]}` + localStorage(`rrg_folders`). `_rrg_all_sectors()`=기본 테마ETF + 커스텀 + 추가된 폴더들의 종목(중복 dedup, `_yf_symbol_candidates[0]` fetch). **항상 합쳐서 표시**(폴더가 기본을 대체하지 않음). UI="종목 추가" 옆 "폴더 추가"(#rrgFolderSel 사용가능 폴더 드롭다운+#rrgFolderAddBtn, select change도 즉시 추가). 추가된 종목·폴더는 `#rrg-chips`에 칩(render_rrg_chips: 커스텀=색점, 폴더=📁, 각 × 삭제). `_rrg_add_folder`/`_make_rrg_folder_del_handler`/`_rrg_load_folders`/`_rrg_save_folders`. `_populate_rrg_folders`=아직 추가안된 폴더만(미로그인 시 placeholder). on_tab rrg·render_favorites·login시 populate. 폴더 종목은 로그인 필요.
- RRG SVG는 viewBox 900x540 + `.rrg-chart{min-width:660px}`(가로 스크롤 원인). 모바일(≤600px)에선 media에서 `.rrg-chart{min-width:0}`+`.rrg-chart-wrap{overflow:hidden}`로 화면폭에 맞춰 축소(가로 스크롤/잘림 제거).

## 계정 UI = 헤더 우측 사람 아이콘 팝업 (구 '계정' fieldset 제거)
- 헤더에 `.hdr-acct`(position:relative) > `#acctBtn.acct-btn`(원형, 사람 SVG) + `#acct-popup.acct-popup`(드롭다운, `.open`으로 표시). 로그인 시 `#acctBtn.logged-in`(녹색 점 ::after).
- 팝업 안에 기존 계정 컨트롤 ID 그대로 이동: `#favAccount`/`#favKey`/`#favAccountLabel`/`#favKeyLabel`/`#favAccountInfo`/`#favLoginBtn`/`#favRegisterBtn`/`#favResetBtn`/`#favChangePwBtn`/`#favLogoutBtn`/`#favDeleteBtn`/`#fav-login-status`. 세로 스택(`.acct-fields` label=flex column, `.acct-actions` button width:100%).
- `_update_fav_login_ui()`가 display 토글: 로그아웃 시 label=flex/버튼=block, 로그인 시 정보=block. #acctBtn에 logged-in 클래스 토글 추가.
- 토글: `@when click #acctBtn`=`on_acct_btn`(stopPropagation+classList.toggle open). 바깥 클릭 닫기=`document.addEventListener("click", create_proxy(_on_doc_click_acct))`(target.closest('.hdr-acct') 아니면 닫음). 다크모드 팝업 오버라이드(#161c24).

## 로딩 인디케이터 (스피너)
- CSS `.mini-spin`(회전 원, `@keyframes mini-spin`, prefers-reduced-motion 시 느리게). `<span class="mini-spin"></span>`.
- 공통 헬퍼(_set_status 위): `_status_html(msg)`=**로딩성 메시지면 스피너만(텍스트 없음), 그 외(완료/오류 등)는 빈 문자열**. 로딩 판정=텍스트에 "..."/"…" 포함 or "중"으로 끝남 AND `_STATUS_DONE_HINTS`(완료/오류/실패/없습니다/필요/입력/취소됨/삭제됨/변경됨/등록됨/저장/결과) 미포함. `_apply_status(sel,msg)`=el.innerHTML=_status_html.
- 모든 `_set_*_status`(status/macro/liq/idxchart/rrg/guru/guru_fav/fav/fav_login/fg/multpl/ai_admin/ai/macrodoc)는 `_apply_status("#sel", msg)` 한 줄로 통일. (사용자 요청으로 "조회중/완료" 등 상태 텍스트 전부 제거, 스피너만 노출)
- 인라인 hint 로더(macro/stockchart/guru result box, AI 평가 카드 본문)도 텍스트 제거하고 `<span class="mini-spin"></span>`만 남김.

## UI 팔레트 (어두운 파란 톤)
- 짙은 크롬(헤더/card-head/ai-card-head): `#0e1e46`(구 #131722). **단, index-box는 사용자 요청으로 원복 #131722 유지.**
- 카드/탭 표면 `#16274f`, 테두리 `#243b6e`, 호버 `#1d3268`, 액센트 파랑 `#2962ff`.
- **지수 그리드(.idx-cell)는 원복: bg #1b2130 / border #232838 / hover #1e2740.** (사용자 요청)

## 다크 모드 (OS 기본 테마 자동)
- 토글 없음. `prefers-color-scheme`로 OS/기기 테마 자동 적용. `:root`에 `color-scheme: light dark`(네이티브 input/select/스크롤바 자동).
- `</style>` 직전 `@media (prefers-color-scheme: dark)` 블록(추가형, 라이트모드 무변경): :root 변수 재정의(--bd/--bg/--pri/--mut) + body 다크 + 하드코딩 표면/텍스트/경계선/호버 셀렉터 오버라이드.
- 헤더/index-box/card-head/ai-card-head(#131722)는 두 모드 공통으로 다크 유지(오버라이드 안함).
- 차트 인라인 SVG 제목 텍스트는 `fill:currentColor`로 바꿔 body color 상속(라이트=#1f2328/다크=#e6e8eb 자동). 클래스기반 SVG(.chart-svg .pt-val/.guide-line/.guide-dot)는 media에서 오버라이드.

- 실적 달력: `_load_earncal`이 KRX 종목 `_naver_kr_name` 병렬 조회 → 이벤트 `tkr`/`name`을 한글명으로.
- `_get_json(url, {})` 는 url + "?" 를 붙임(무해). 404 는 InvestingApiError 로 발생→호출부에서 try/except 처리.
- 문서화용 md 파일 만들지 말 것(사용자 요청 시에만).
