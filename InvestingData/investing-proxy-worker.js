/**
 * investing-proxy-worker.js
 *
 * TradingView 내부 API 호출을 브라우저(CheckTradingViewForecast.html)에서
 * 사용할 수 있도록 CORS 헤더를 붙여 중계하는 Cloudflare Worker.
 *
 * 브라우저는 보안(CORS) 정책상 symbol-search.tradingview.com /
 * scanner.tradingview.com / api.stlouisfed.org(FRED) /
 * api.db.nomics.world(DBnomics) 를 직접 호출하지
 * 못하므로 이 Worker 가 프록시 역할을 한다. (KOSIS HTML 의 CORS 프록시와 동일 개념)
 *
 * ── 배포 방법 ──────────────────────────────────────────────
 *  1) https://dash.cloudflare.com  →  Workers & Pages  →  Create Worker
 *  2) 생성된 편집기에 이 파일 내용을 붙여넣고 Deploy
 *  3) 발급된 주소(예: https://tv-proxy.<계정>.workers.dev)를 확인
 *  4) HTML 툴의 "CORS 프록시" 칸에 아래 형식으로 입력
 *        https://tv-proxy.<계정>.workers.dev/?url=
 *
 *  (또는 wrangler 사용:  wrangler deploy investing-proxy-worker.js)
 *
 * 사용 형식:
 *   GET  https://<worker>/?url=<encodeURIComponent(대상 TradingView URL)>
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

// 프록시를 허용할 대상 호스트 (오픈 프록시 악용 방지)
const ALLOWED_HOSTS = [
  "symbol-search.tradingview.com",
  "scanner.tradingview.com",
  "api.stlouisfed.org",
  // DBnomics: ISM PMI 등 거시경제 지표 시계열 (API 키 불필요, 무료)
  "api.db.nomics.world",
  // SEC EDGAR: 13F 대가 포트폴리오(제출 목록/보유내역 XML)
  "data.sec.gov",
  "www.sec.gov",
];

function isAllowed(hostname) {
  return ALLOWED_HOSTS.includes(hostname) || hostname.endsWith(".tradingview.com");
}

export default {
  async fetch(request) {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== "GET") {
      return new Response("Only GET is allowed", {
        status: 405,
        headers: CORS_HEADERS,
      });
    }

    const reqUrl = new URL(request.url);
    const target = reqUrl.searchParams.get("url");
    if (!target) {
      return new Response("Missing 'url' query parameter", {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch {
      return new Response("Invalid target URL", {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    if (targetUrl.protocol !== "https:" || !isAllowed(targetUrl.hostname)) {
      return new Response("Target host is not allowed", {
        status: 403,
        headers: CORS_HEADERS,
      });
    }

    const upstreamHeaders = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      Accept: "application/json",
    };
    // TradingView 는 Origin/Referer 를 확인하므로 해당 호스트에만 붙인다.
    // (FRED 등 다른 API 에는 불필요하고 오히려 방해가 될 수 있음)
    if (targetUrl.hostname.endsWith(".tradingview.com")) {
      upstreamHeaders["Origin"] = "https://www.tradingview.com";
      upstreamHeaders["Referer"] = "https://www.tradingview.com/";
    }
    // SEC EDGAR 는 연락처가 포함된 명시적 User-Agent 를 요구한다(미준수 시 403).
    // SEC 권장 형식: "Company/App Name email@domain".
    if (targetUrl.hostname.endsWith(".sec.gov")) {
      upstreamHeaders["User-Agent"] =
        "InvestingDataTool admin@investing-data-tool.example";
      upstreamHeaders["Accept-Encoding"] = "gzip, deflate";
    }

    let upstream;
    try {
      upstream = await fetch(targetUrl.toString(), {
        method: "GET",
        headers: upstreamHeaders,
      });
    } catch (err) {
      return new Response("Upstream fetch failed: " + err, {
        status: 502,
        headers: CORS_HEADERS,
      });
    }

    const body = await upstream.arrayBuffer();
    const headers = new Headers(CORS_HEADERS);
    headers.set(
      "Content-Type",
      upstream.headers.get("Content-Type") || "application/json; charset=utf-8"
    );
    return new Response(body, { status: upstream.status, headers });
  },
};
