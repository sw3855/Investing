/**
 * investing-proxy-worker.js
 *
 * TradingView 내부 API 호출을 브라우저(CheckTradingViewForecast.html)에서
 * 사용할 수 있도록 CORS 헤더를 붙여 중계하는 Cloudflare Worker.
 *
 * 브라우저는 보안(CORS) 정책상 symbol-search.tradingview.com /
 * scanner.tradingview.com / api.stlouisfed.org(FRED) /
 * api.db.nomics.world(DBnomics) / ac.stock.naver.com(네이버 증권) 를 직접 호출하지
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
 *
 * ── 즐겨찾기(Favorites) 저장을 위한 KV 설정 ────────────────
 *  즐겨찾기는 Cloudflare KV 에 사용자별 JSON 으로 저장한다.
 *  1) 대시보드: Workers & Pages → KV → Create namespace
 *       (이름 예: investing_favorites)
 *  2) 이 Worker → Settings → Variables → KV Namespace Bindings
 *       Variable name(바인딩 이름): FAVORITES
 *       KV namespace: 위에서 만든 investing_favorites 선택
 *  (wrangler 사용 시 wrangler.toml 예)
 *       [[kv_namespaces]]
 *       binding = "FAVORITES"
 *       id = "<네임스페이스 ID>"
 *
 *  즐겨찾기 API (계정 ID + 공유 키 인증):
 *    계정 ID 는 쿼리(?account=), 공유 키는 요청 헤더 X-Fav-Key 로 전달한다.
 *    같은 계정 ID + 키를 입력하면 어느 기기에서든 같은 목록을 공유한다.
 *    GET    https://<worker>/favorites?account=<id>            → {favorites:[...], folders:[...], exists}
 *    POST   https://<worker>/favorites?account=<id>&register=1  → 계정 등록(중복 시 409)
 *    POST   https://<worker>/favorites?account=<id>&pw_op=reset  → 키 검증 없이 공유 키를 "0000"으로 초기화(미등록 시 404)
 *    POST   https://<worker>/favorites?account=<id>&pw_op=change → 본문 {newKey} 로그인 상태에서 공유 키 변경
 *    POST   https://<worker>/favorites?account=<id>&folder_op=create → 본문 {folder} 빈 폴더 생성
 *    POST   https://<worker>/favorites?account=<id>&folder_op=rename → 본문 {folder,newFolder} 폴더 이름 변경
 *    POST   https://<worker>/favorites?account=<id>            → 본문 {symbol,name,folder} 추가/이동
 *    DELETE https://<worker>/favorites?account=<id>&symbol=..  → 해당 심볼 삭제
 *    DELETE https://<worker>/favorites?account=<id>&folder=..  → 폴더와 그 안의 종목 삭제
 *    DELETE https://<worker>/favorites?account=<id>            → (symbol 없이) 계정 전체 삭제
 *
 * ── Gemini AI 기업 평가 (POST /gemini) ─────────────────────
 *  평가 프롬프트(Evaluation_Prompt.md 내용)를 시스템 지시로 사용해 제미나이가
 *  Google 검색 그라운딩으로 최신 실적·공시를 수집하여 기업을 채점한다.
 *  API 키는 요청 헤더 X-Gemini-Key 로 전달하거나 Worker 환경변수 GEMINI_API_KEY 로 설정한다.
 *    POST https://<worker>/gemini   본문 {company:"삼성전자"}
 *      → { text:"<마크다운 분석>", sources:[{title,uri}, ...] }
 *
 *  ● 평가 프롬프트는 워커 코드에 넣지 않고 KV 에 파일로 바인딩한다.
 *    1) 대시보드: Workers & Pages → KV → Create namespace
 *         (이름 예: investing_prompts)
 *    2) 이 Worker → Settings → Variables → KV Namespace Bindings
 *         Variable name(바인딩 이름): PROMPTS
 *         KV namespace: 위에서 만든 investing_prompts 선택
 *    3) Evaluation_Prompt.md 내용을 'evaluation' 키 값으로 업로드한다.
 *         (wrangler:  wrangler kv:key put --binding=PROMPTS "evaluation" \
 *                       --path=Evaluation_Prompt.md )
 *         (또는 대시보드 KV 화면에서 Key=evaluation, Value=파일내용 붙여넣기)
 *    (wrangler.toml 예)
 *         [[kv_namespaces]]
 *         binding = "PROMPTS"
 *         id = "<네임스페이스 ID>"
 *
 *  ● AI 평가 접근 제어 (로그인 + 관리자 허가)
 *    - /gemini 는 즐겨찾기 계정으로 로그인해야 하며(계정 ID ?account=, 공유 키 X-Fav-Key),
 *      관리자 계정 또는 관리자가 허가한 계정만 사용할 수 있다.
 *    - 관리자 계정 ID 는 FAVORITES KV 의 'ai_admin' 키에 저장된다(최초 1회 '이성원'으로 시드).
 *      관리자를 바꾸려면 KV 의 'ai_admin' 값을 수정한다.
 *    - 허용 계정 목록은 FAVORITES KV 의 'ai_access' 키(JSON 배열)에 저장된다.
 *    - 관리자 전용 관리 API:
 *        GET    /ai-access?account=<admin>            → { admin, allowed:[...] }
 *        POST   /ai-access?account=<admin>  본문 {target} → 계정 접근 허가
 *        DELETE /ai-access?account=<admin>&target=..   → 계정 접근 취소
 */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Fav-Key, X-Gemini-Key",
  "Access-Control-Max-Age": "86400",
};

// 항상 "최신" Gemini 모델을 자동으로 선택한다.
//  1순위: ListModels API 로 generateContent 를 지원하는 gemini-flash 계열 중
//         버전이 가장 높은 안정 모델을 실시간으로 탐색한다.
//  2순위(폴백): 구글이 유지·관리하는 최신 별칭(항상 최신 Flash 를 가리킴).
const GEMINI_MODEL_FALLBACK = "gemini-flash-latest";
// 탐색 결과는 일정 시간 캐시해 매 요청마다 ListModels 를 부르지 않는다.
const MODEL_CACHE_MS = 6 * 60 * 60 * 1000; // 6시간
let _modelCache = { name: null, at: 0 };

// Google Gemini 호출은 회사망/엣지 경로에 따라 "User location is not supported"
// 오류가 날 수 있다. GEMINI_RELAY_URL(예: Vercel 미국 고정 함수)이 설정돼 있으면
// 그 릴레이를 통해 호출해 항상 지원 지역에서 나가도록 한다. 없으면 직접 호출.
const GEMINI_DIRECT_BASE = "https://generativelanguage.googleapis.com/v1beta/";

async function geminiFetch(env, endpoint, method, payload, apiKey) {
  const relayUrl = env && env.GEMINI_RELAY_URL;
  if (relayUrl) {
    // 릴레이 경유: API 키는 릴레이(Vercel) 쪽에 있으므로 워커는 보내지 않는다.
    return fetch(relayUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-relay-secret": (env && env.GEMINI_RELAY_SECRET) || "",
      },
      body: JSON.stringify({ endpoint, method, payload: payload || null }),
    });
  }
  // 직접 호출(하위 호환)
  const sep = endpoint.includes("?") ? "&" : "?";
  const url =
    GEMINI_DIRECT_BASE + endpoint + sep + "key=" + encodeURIComponent(apiKey || "");
  const init = { method };
  if (method === "POST") {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(payload || {});
  }
  return fetch(url, init);
}

// "models/gemini-2.5-flash" → 205 처럼 버전 비교용 점수를 만든다.
function _modelVersionScore(name) {
  const m = String(name || "").match(/gemini-(\d+)\.(\d+)/);
  if (!m) return -1;
  return parseInt(m[1], 10) * 100 + parseInt(m[2], 10);
}

// ListModels 로 최신 gemini-flash(안정판) 모델명을 찾는다. 실패 시 별칭 폴백.
async function resolveLatestModel(env, apiKey) {
  const now = Date.now();
  if (_modelCache.name && now - _modelCache.at < MODEL_CACHE_MS) {
    return _modelCache.name;
  }
  try {
    const resp = await geminiFetch(env, "models?pageSize=1000", "GET", null, apiKey);
    if (resp.ok) {
      const data = await resp.json();
      const models = Array.isArray(data.models) ? data.models : [];
      const candidates = models.filter((m) => {
        const n = m && m.name ? m.name : "";
        const methods = (m && m.supportedGenerationMethods) || [];
        // gemini-flash 계열 + 텍스트 생성 지원 + 실험/프리뷰/특수 변형 제외(안정판 우선)
        return (
          n.includes("gemini") &&
          n.includes("flash") &&
          methods.includes("generateContent") &&
          !/exp|preview|lite|thinking|image|tts|audio|native|vision/i.test(n)
        );
      });
      candidates.sort(
        (a, b) => _modelVersionScore(b.name) - _modelVersionScore(a.name)
      );
      if (candidates.length && _modelVersionScore(candidates[0].name) >= 0) {
        const best = candidates[0].name.replace(/^models\//, "");
        _modelCache = { name: best, at: now };
        return best;
      }
    }
  } catch {
    // 무시하고 폴백 별칭 사용
  }
  _modelCache = { name: GEMINI_MODEL_FALLBACK, at: now };
  return GEMINI_MODEL_FALLBACK;
}

// 평가 프롬프트(Evaluation_Prompt.md)는 워커 코드에 넣지 않고 PROMPTS(KV)에
// 파일로 바인딩한다. 아래 키 값으로 저장된 텍스트를 런타임에 읽어 사용한다.
const EVALUATION_PROMPT_KEY = "evaluation";
// 프롬프트가 아직 KV 에 없을 때 안내할 오류 문구
const PROMPT_MISSING_MSG =
  "평가 프롬프트가 설정되지 않았습니다. Worker 의 PROMPTS(KV) 바인딩에 " +
  "'evaluation' 키로 Evaluation_Prompt.md 내용을 업로드하세요.";
// 같은 아이솔레이트 내 반복 KV 읽기를 줄이기 위한 메모리 캐시
let _promptCache = null;

// PROMPTS(KV)에서 평가 프롬프트 텍스트를 읽어온다. 없으면 null.
async function getEvaluationPrompt(env) {
  if (_promptCache) return _promptCache;
  if (!env || !env.PROMPTS) return null;
  let text = null;
  try {
    text = await env.PROMPTS.get(EVALUATION_PROMPT_KEY);
  } catch {
    text = null;
  }
  if (text && text.trim()) {
    _promptCache = text;
    return text;
  }
  return null;
}

// 즐겨찾기 저장 한도(계정별) 및 문자열 길이 제한 (악용 방지)
const FAV_MAX_ITEMS = 300;
const FAV_MAX_LEN = 200;
// 계정별 폴더 개수 상한
const FAV_MAX_FOLDERS = 100;
// 공유 키 해시에 사용하는 고정 솔트 (레인보우 테이블 완화용)
const FAV_SALT = "investing-fav-v1";

// AI 평가 접근 제어: 관리자 계정·허용 계정 목록을 FAVORITES KV 에 저장한다.
//  - ai_admin : 관리자 계정 ID (없으면 아래 기본값으로 최초 1회 시드)
//  - ai_access: 허용 계정 ID 목록(JSON 배열)
const AI_ADMIN_KEY = "ai_admin";
const AI_ADMIN_DEFAULT = "이성원";
const AI_ACCESS_KEY = "ai_access";
// 같은 아이솔레이트 내 반복 KV 읽기를 줄이기 위한 관리자 계정 캐시
let _adminCache = null;

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
  // CNN Business: 공포·탐욕 지수(Fear & Greed Index) 데이터
  "production.dataviz.cnn.io",
  // multpl.com: S&P 500 PER·Shiller PE·배당수익률·국채금리·인플레이션 등 시장/거시 지표
  "www.multpl.com",
  // 네이버 증권 자동완성: 한글 회사명 -> KRX 종목코드(예: 삼성전자 -> 005930)
  "ac.stock.naver.com",
];

function isAllowed(hostname) {
  return ALLOWED_HOSTS.includes(hostname) || hostname.endsWith(".tradingview.com");
}

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const reqUrl = new URL(request.url);

    // ── 즐겨찾기 API (Cloudflare KV 저장) ──
    if (reqUrl.pathname === "/favorites") {
      return handleFavorites(request, env, reqUrl);
    }

    // ── AI 평가 접근 권한 관리 (관리자 전용) ──
    if (reqUrl.pathname === "/ai-access") {
      return handleAiAccess(request, env, reqUrl);
    }

    // ── Gemini AI 기업 평가 ──
    if (reqUrl.pathname === "/gemini") {
      return handleGemini(request, env, reqUrl);
    }

    if (request.method !== "GET") {
      return new Response("Only GET is allowed", {
        status: 405,
        headers: CORS_HEADERS,
      });
    }

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
    // CNN 공포·탐욕 지수 API 는 정상 브라우저처럼 보이는 요청만 허용한다.
    // (User-Agent 만 브라우저면 되고, Origin 을 붙이면 오히려 차단될 수 있다)
    if (targetUrl.hostname === "production.dataviz.cnn.io") {
      upstreamHeaders["Accept"] = "application/json, text/plain, */*";
      upstreamHeaders["Accept-Language"] = "en-US,en;q=0.9";
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

// ===================== 즐겨찾기(Favorites) =====================

function jsonResponse(obj, status = 200) {
  const headers = new Headers(CORS_HEADERS);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(obj), { status, headers });
}

// ===================== AI 평가 접근 제어 =====================

// 관리자 계정 ID 를 FAVORITES KV(ai_admin)에서 읽어온다.
// 키가 없으면 기본값(AI_ADMIN_DEFAULT)으로 최초 1회 시드해 KV 에 등록한다.
async function getAdminAccount(env) {
  if (_adminCache) return _adminCache;
  if (!env || !env.FAVORITES) return AI_ADMIN_DEFAULT;
  let value = null;
  try {
    value = await env.FAVORITES.get(AI_ADMIN_KEY);
  } catch {
    value = null;
  }
  if (value && value.trim()) {
    _adminCache = value.trim();
    return _adminCache;
  }
  // 미등록 상태면 기본 관리자 계정을 KV 에 등록(시드)한다.
  try {
    await env.FAVORITES.put(AI_ADMIN_KEY, AI_ADMIN_DEFAULT);
  } catch {
    // 쓰기 실패해도 기본값으로 동작
  }
  _adminCache = AI_ADMIN_DEFAULT;
  return _adminCache;
}

// FAVORITES KV 에 저장된 허용 계정 목록을 읽어온다.
async function loadAiAccess(env) {
  if (!env || !env.FAVORITES) return [];
  try {
    const raw = await env.FAVORITES.get(AI_ACCESS_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
    }
  } catch {
    // 무시하고 빈 목록 반환
  }
  return [];
}

async function saveAiAccess(env, list) {
  await env.FAVORITES.put(AI_ACCESS_KEY, JSON.stringify(list));
}

// 계정 자격 증명(계정 ID + 공유 키)을 즐겨찾기 레코드로 검증.
// 성공 시 record, 실패 시 null. (즐겨찾기 로그인과 동일한 자격 사용)
async function verifyCredentials(env, account, authKey) {
  if (!env || !env.FAVORITES) return null;
  if (!isValidAccount(account)) return null;
  if (typeof authKey !== "string" || authKey.length < 4) return null;
  let record = null;
  try {
    const raw = await env.FAVORITES.get("fav:" + account);
    if (raw) record = JSON.parse(raw);
  } catch {
    record = null;
  }
  if (!record || !record.keyHash) return null;
  const authHash = await sha256Hex(FAV_SALT + ":" + authKey);
  if (!timingSafeEqual(record.keyHash, authHash)) return null;
  return record;
}

// AI 평가 사용 권한: 관리자이거나 허용 목록에 포함되면 true.
async function isAiAuthorized(env, account) {
  const admin = await getAdminAccount(env);
  if (account === admin) return true;
  const list = await loadAiAccess(env);
  return list.includes(account);
}

/**
 * GET/POST/DELETE /ai-access  (관리자 전용)
 *   인증: 계정 ID(?account=) + 공유 키(X-Fav-Key). 계정이 관리자(ai_admin) 여야 한다.
 *   GET                 → { admin, allowed:[...] }
 *   POST   본문 {target} → 해당 계정에 AI 평가 접근 허가
 *   DELETE ?target=..   → 해당 계정의 접근 허가 취소
 */
async function handleAiAccess(request, env, reqUrl) {
  if (!env || !env.FAVORITES) {
    return jsonResponse({ error: "KV 바인딩(FAVORITES)이 설정되지 않았습니다." }, 500);
  }
  const account = reqUrl.searchParams.get("account") || "";
  const authKey = request.headers.get("X-Fav-Key") || "";
  const record = await verifyCredentials(env, account, authKey);
  const admin = await getAdminAccount(env);
  if (!record || account !== admin) {
    return jsonResponse({ error: "관리자만 접근할 수 있습니다." }, 403);
  }

  if (request.method === "GET") {
    return jsonResponse({ admin, allowed: await loadAiAccess(env) });
  }

  if (request.method === "POST") {
    let payload;
    try {
      payload = await request.json();
    } catch {
      return jsonResponse({ error: "invalid json body" }, 400);
    }
    const target = cleanStr(payload && payload.target);
    if (!isValidAccount(target)) {
      return jsonResponse(
        { error: "허가할 계정 ID가 올바르지 않습니다.", allowed: await loadAiAccess(env) },
        400
      );
    }
    if (target === admin) {
      return jsonResponse(
        { error: "관리자 계정은 이미 접근 가능합니다.", allowed: await loadAiAccess(env) },
        400
      );
    }
    const list = await loadAiAccess(env);
    if (!list.includes(target)) {
      if (list.length >= 500) {
        return jsonResponse({ error: "허용 계정이 너무 많습니다.", allowed: list }, 400);
      }
      list.push(target);
      await saveAiAccess(env, list);
    }
    return jsonResponse({ allowed: list });
  }

  if (request.method === "DELETE") {
    const target = cleanStr(reqUrl.searchParams.get("target"));
    let list = await loadAiAccess(env);
    list = list.filter((a) => a !== target);
    await saveAiAccess(env, list);
    return jsonResponse({ allowed: list });
  }

  return jsonResponse({ error: "method not allowed" }, 405);
}

// ===================== Gemini AI 기업 평가 =====================

/**
 * POST /gemini
 *   본문: { "company": "삼성전자" }  (분석할 기업/티커)
 *   인증: Gemini API 키를 요청 헤더 X-Gemini-Key 로 전달하거나
 *         Worker 환경변수(secret) GEMINI_API_KEY 를 설정한다.
 *
 * PROMPTS(KV)에서 읽은 평가 프롬프트를 시스템 지시로, 사용자가 입력한 기업명을
 * 사용자 발화로 넣어 Google 검색 그라운딩을 켠 상태로 Gemini generateContent 를 호출한다.
 *   응답: { text: "<마크다운 분석 결과>", sources: [{title, uri}, ...] }
 */
async function handleGemini(request, env, reqUrl) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Only POST is allowed" }, 405);
  }

  // ── 로그인 및 AI 평가 접근 권한 확인 ──
  const account = (reqUrl && reqUrl.searchParams.get("account")) || "";
  const authKey = request.headers.get("X-Fav-Key") || "";
  const authRecord = await verifyCredentials(env, account, authKey);
  if (!authRecord) {
    return jsonResponse(
      { error: "로그인이 필요합니다. 상단 계정 영역에서 로그인하세요." },
      401
    );
  }
  if (!(await isAiAuthorized(env, account))) {
    return jsonResponse(
      { error: "AI 평가 사용 권한이 없습니다. 관리자에게 접근 허가를 요청하세요." },
      403
    );
  }

  const apiKey =
    request.headers.get("X-Gemini-Key") ||
    (env && env.GEMINI_API_KEY) ||
    "";
  // 릴레이(Vercel)를 쓰는 경우 API 키는 릴레이 쪽에 있으므로 워커에는 없어도 된다.
  const usingRelay = !!(env && env.GEMINI_RELAY_URL);
  if (!apiKey && !usingRelay) {
    return jsonResponse(
      { error: "Gemini API 키가 없습니다. 웹페이지에 키를 입력하거나 Worker 에 GEMINI_API_KEY 를 설정하세요." },
      400
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "invalid json body" }, 400);
  }

  const company = (payload && payload.company ? String(payload.company) : "").trim();
  if (!company) {
    return jsonResponse({ error: "분석할 기업명(종목)을 입력하세요." }, 400);
  }
  if (company.length > 100) {
    return jsonResponse({ error: "기업명이 너무 깁니다." }, 400);
  }

  const evaluationPrompt = await getEvaluationPrompt(env);
  if (!evaluationPrompt) {
    return jsonResponse({ error: PROMPT_MISSING_MSG }, 500);
  }

  const model = await resolveLatestModel(env, apiKey);

  const geminiBody = {
    systemInstruction: {
      parts: [{ text: evaluationPrompt }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: "다음 종목을 평가 기준에 따라 분석해줘: " + company }],
      },
    ],
    tools: [{ google_search: {} }],
    generationConfig: {
      temperature: 0.4,
      // gemini-2.5 계열은 기본적으로 내부 "thinking"(추론)을 수행해 응답이 느리다.
      // 검색 그라운딩까지 겹치면 릴레이(Vercel) 60초 한계를 넘겨 504가 나기 쉬우므로
      // thinking 예산을 0으로 두어 속도를 크게 높인다. (thinking 미지원 모델은 무시됨)
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  let upstream;
  try {
    upstream = await geminiFetch(
      env,
      "models/" + model + ":generateContent",
      "POST",
      geminiBody,
      apiKey
    );
  } catch (err) {
    return jsonResponse({ error: "Gemini 호출 실패: " + err }, 502);
  }

  // 응답 본문을 먼저 텍스트로 받고 JSON 파싱을 시도한다. (릴레이 타임아웃 시
  // Vercel 이 HTML 오류 페이지를 반환할 수 있어, 그 경우 실제 원인을 그대로 노출)
  const rawBody = await upstream.text();
  let data;
  try {
    data = JSON.parse(rawBody);
  } catch {
    const snippet = (rawBody || "").slice(0, 300).replace(/\s+/g, " ").trim();
    return jsonResponse(
      {
        error:
          "Gemini 응답을 해석할 수 없습니다 (HTTP " +
          upstream.status +
          "). 릴레이/타임아웃 오류일 수 있습니다: " +
          (snippet || "(빈 응답)"),
      },
      502
    );
  }

  if (upstream.status >= 400) {
    // Google 오류는 data.error.message, 릴레이 오류는 data.error(문자열) 형태다.
    let msg = "HTTP " + upstream.status;
    if (data && data.error) {
      if (typeof data.error === "string") msg = data.error;
      else if (data.error.message) msg = data.error.message;
    }
    return jsonResponse({ error: "Gemini 오류: " + msg }, upstream.status);
  }

  const candidate = data && data.candidates && data.candidates[0];
  let text = "";
  if (candidate && candidate.content && Array.isArray(candidate.content.parts)) {
    text = candidate.content.parts
      .map((p) => (p && p.text ? p.text : ""))
      .join("");
  }
  if (!text) {
    return jsonResponse(
      { error: "Gemini 가 빈 응답을 반환했습니다. 잠시 후 다시 시도하세요." },
      502
    );
  }

  // 검색 그라운딩 출처 추출
  const sources = [];
  const gm = candidate && candidate.groundingMetadata;
  const chunks = gm && Array.isArray(gm.groundingChunks) ? gm.groundingChunks : [];
  for (const c of chunks) {
    if (c && c.web && c.web.uri) {
      sources.push({ title: c.web.title || c.web.uri, uri: c.web.uri });
    }
  }

  return jsonResponse({ text, sources, model });
}

// 계정 ID(로그인 이름). 유니코드 문자/숫자 및 _.- 공백 1~64자만 허용(한글 등 지원).
function isValidAccount(u) {
  return typeof u === "string" && /^[\p{L}\p{N}_.\- ]{1,64}$/u.test(u);
}

function cleanStr(v) {
  return (v == null ? "" : String(v)).trim().slice(0, FAV_MAX_LEN);
}

// 공유 키를 솔트와 함께 SHA-256 해시(16진수)로 변환한다.
async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// 타이밍 공격을 줄이기 위한 상수시간 문자열 비교.
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

/**
 * 즐겨찾기 CRUD. env.FAVORITES(KV)에 계정별로 저장한다.
 *   키:  fav:<account>
 *   값:  { "keyHash": "<sha256>", "favorites": [{ "symbol", "name" }, ...] }
 *
 * 인증: 계정 ID 는 쿼리(?account=), 공유 키는 헤더(X-Fav-Key)로 전달한다.
 *   - 계정은 register=1 요청으로 먼저 생성해야 하며, 이미 있으면 409를 반환한다.
 *   - 이미 존재하는 계정은 저장된 keyHash 와 일치해야 읽기/쓰기가 가능하다.
 *   - 같은 계정 ID + 키를 입력하면 어느 기기에서든 같은 목록을 공유한다.
 */
async function handleFavorites(request, env, reqUrl) {
  if (!env || !env.FAVORITES) {
    return jsonResponse(
      { error: "KV 바인딩(FAVORITES)이 설정되지 않았습니다. Worker 설정을 확인하세요." },
      500
    );
  }

  const account = reqUrl.searchParams.get("account") || "";
  if (!isValidAccount(account)) {
    return jsonResponse({ error: "invalid account id" }, 400);
  }

  const kvKey = "fav:" + account;

  // 비밀번호 리셋: 키 검증 없이 계정 ID만으로 공유 키를 "0000"으로 초기화한다.
  // (POST ?pw_op=reset) — 등록된 계정에서만 동작하고, 없으면 404.
  // 키를 모를 때 복구용이므로 X-Fav-Key 검증 이전에 처리한다.
  if (request.method === "POST" && reqUrl.searchParams.get("pw_op") === "reset") {
    let resetRecord = null;
    try {
      const raw = await env.FAVORITES.get(kvKey);
      if (raw) resetRecord = JSON.parse(raw);
    } catch {
      resetRecord = null;
    }
    if (!resetRecord) {
      return jsonResponse({ error: "등록되지 않은 계정입니다." }, 404);
    }
    resetRecord.keyHash = await sha256Hex(FAV_SALT + ":" + "0000");
    await env.FAVORITES.put(kvKey, JSON.stringify(resetRecord));
    return jsonResponse({ reset: true });
  }

  const authKey = request.headers.get("X-Fav-Key") || "";
  if (authKey.length < 4 || authKey.length > FAV_MAX_LEN) {
    return jsonResponse({ error: "공유 키는 4자 이상이어야 합니다." }, 400);
  }

  // 기존 레코드 로드
  let record = null;
  try {
    const raw = await env.FAVORITES.get(kvKey);
    if (raw) record = JSON.parse(raw);
  } catch {
    record = null;
  }

  const authHash = await sha256Hex(FAV_SALT + ":" + authKey);

  // 이미 존재하는 계정이면 키 검증
  if (record && record.keyHash && !timingSafeEqual(record.keyHash, authHash)) {
    return jsonResponse({ error: "계정 키가 일치하지 않습니다." }, 403);
  }

  const favorites =
    record && Array.isArray(record.favorites) ? record.favorites : [];
  const folders =
    record && Array.isArray(record.folders) ? record.folders : [];

  if (request.method === "GET") {
    return jsonResponse({ favorites, folders, exists: !!record });
  }

  if (request.method === "POST") {
    // 계정 등록 요청: ?register=1 → ID 중복 확인 후 빈 계정을 생성한다.
    if (reqUrl.searchParams.get("register") === "1") {
      if (record) {
        return jsonResponse({ error: "이미 존재하는 계정 ID입니다." }, 409);
      }
      await env.FAVORITES.put(
        kvKey,
        JSON.stringify({ keyHash: authHash, favorites: [], folders: [] })
      );
      return jsonResponse({ favorites: [], folders: [], registered: true });
    }

    // 이하 작업은 등록된 계정에서만 가능하다.
    if (!record) {
      return jsonResponse({ error: "등록되지 않은 계정입니다. 먼저 계정을 등록하세요." }, 404);
    }
    let payload;
    try {
      payload = await request.json();
    } catch {
      return jsonResponse({ error: "invalid json body" }, 400);
    }

    // 비밀번호 변경 요청: ?pw_op=change, 본문 {newKey}
    // 현재 키(X-Fav-Key) 검증을 통과한 로그인 상태에서만 가능하다.
    if (reqUrl.searchParams.get("pw_op") === "change") {
      const newKey = payload && typeof payload.newKey === "string" ? payload.newKey : "";
      if (newKey.length < 4 || newKey.length > FAV_MAX_LEN) {
        return jsonResponse({ error: "새 공유 키는 4자 이상이어야 합니다." }, 400);
      }
      const newHash = await sha256Hex(FAV_SALT + ":" + newKey);
      await env.FAVORITES.put(
        kvKey,
        JSON.stringify({ keyHash: newHash, favorites, folders })
      );
      return jsonResponse({ favorites, folders, changed: true });
    }

    // 빈 폴더 생성 요청: ?folder_op=create, 본문 {folder}
    if (reqUrl.searchParams.get("folder_op") === "create") {
      const newFolder = cleanStr(payload && payload.folder);
      if (!newFolder) {
        return jsonResponse({ error: "폴더 이름을 입력하세요.", favorites, folders }, 400);
      }
      if (folders.includes(newFolder)) {
        return jsonResponse({ error: "이미 존재하는 폴더입니다.", favorites, folders }, 409);
      }
      if (folders.length >= FAV_MAX_FOLDERS) {
        return jsonResponse(
          { error: `폴더는 최대 ${FAV_MAX_FOLDERS}개까지 만들 수 있습니다.`, favorites, folders },
          400
        );
      }
      folders.push(newFolder);
      await env.FAVORITES.put(
        kvKey,
        JSON.stringify({ keyHash: authHash, favorites, folders })
      );
      return jsonResponse({ favorites, folders });
    }

    // 폴더 이름 변경 요청: ?folder_op=rename, 본문 {folder, newFolder}
    if (reqUrl.searchParams.get("folder_op") === "rename") {
      const oldName = cleanStr(payload && payload.folder);
      const newName = cleanStr(payload && payload.newFolder);
      if (!oldName || !newName) {
        return jsonResponse({ error: "변경할 폴더와 새 이름을 입력하세요.", favorites, folders }, 400);
      }
      if (oldName === "Default" || newName === "Default") {
        return jsonResponse({ error: "'Default' 폴더는 이름을 변경할 수 없습니다.", favorites, folders }, 400);
      }
      if (oldName === newName) {
        return jsonResponse({ favorites, folders });
      }
      const usedOld =
        folders.includes(oldName) ||
        favorites.some((f) => (f.folder || "Default") === oldName);
      if (!usedOld) {
        return jsonResponse({ error: "변경할 폴더를 찾을 수 없습니다.", favorites, folders }, 404);
      }
      const usedNew =
        folders.includes(newName) ||
        favorites.some((f) => (f.folder || "Default") === newName);
      if (usedNew) {
        return jsonResponse({ error: "이미 존재하는 폴더 이름입니다.", favorites, folders }, 409);
      }
      favorites.forEach((f) => {
        if ((f.folder || "Default") === oldName) f.folder = newName;
      });
      const idx = folders.indexOf(oldName);
      if (idx >= 0) folders[idx] = newName;
      else folders.push(newName);
      await env.FAVORITES.put(
        kvKey,
        JSON.stringify({ keyHash: authHash, favorites, folders })
      );
      return jsonResponse({ favorites, folders });
    }

    const symbol = cleanStr(payload && payload.symbol);
    const name = cleanStr(payload && payload.name);
    const folder = cleanStr(payload && payload.folder) || "Default";
    if (!symbol) {
      return jsonResponse({ error: "symbol is required" }, 400);
    }
    const existing = favorites.find((f) => f && f.symbol === symbol);
    if (existing) {
      // 이미 있는 종목은 폴더/이름만 갱신(폴더 이동 용도).
      existing.name = name || existing.name || "";
      existing.folder = folder;
    } else {
      if (favorites.length >= FAV_MAX_ITEMS) {
        return jsonResponse(
          { error: `즐겨찾기는 최대 ${FAV_MAX_ITEMS}개까지 저장할 수 있습니다.`, favorites, folders },
          400
        );
      }
      favorites.push({ symbol, name, folder });
    }
    // 사용된 폴더를 폴더 목록에도 반영해 둔다.
    if (folder && folder !== "Default" && !folders.includes(folder)) {
      folders.push(folder);
    }
    await env.FAVORITES.put(
      kvKey,
      JSON.stringify({ keyHash: authHash, favorites, folders })
    );
    return jsonResponse({ favorites, folders });
  }

  if (request.method === "DELETE") {
    const symbol = cleanStr(reqUrl.searchParams.get("symbol"));
    const folderToDelete = cleanStr(reqUrl.searchParams.get("folder"));

    // symbol 도 folder 도 없으면 계정 전체 삭제 (키 검증 통과 시)
    if (!symbol && !folderToDelete) {
      if (record) {
        await env.FAVORITES.delete(kvKey);
      }
      return jsonResponse({ favorites: [], folders: [], deleted: true });
    }

    if (!record) {
      return jsonResponse({ favorites: [], folders: [] });
    }

    // 폴더 삭제: 해당 폴더와 그 안의 종목을 모두 제거한다.
    if (folderToDelete) {
      const keptFavs = favorites.filter(
        (f) => (f.folder || "Default") !== folderToDelete
      );
      const keptFolders = folders.filter((n) => n !== folderToDelete);
      await env.FAVORITES.put(
        kvKey,
        JSON.stringify({ keyHash: authHash, favorites: keptFavs, folders: keptFolders })
      );
      return jsonResponse({ favorites: keptFavs, folders: keptFolders });
    }

    const next = favorites.filter((f) => f && f.symbol !== symbol);
    await env.FAVORITES.put(
      kvKey,
      JSON.stringify({ keyHash: authHash, favorites: next, folders })
    );
    return jsonResponse({ favorites: next, folders });
  }

  return jsonResponse({ error: "method not allowed" }, 405);
}
