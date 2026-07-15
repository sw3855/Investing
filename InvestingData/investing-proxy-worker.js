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
 *    POST   https://<worker>/favorites?account=<id>&folder_op=create → 본문 {folder} 빈 폴더 생성
 *    POST   https://<worker>/favorites?account=<id>&folder_op=rename → 본문 {folder,newFolder} 폴더 이름 변경
 *    POST   https://<worker>/favorites?account=<id>            → 본문 {symbol,name,folder} 추가/이동
 *    DELETE https://<worker>/favorites?account=<id>&symbol=..  → 해당 심볼 삭제
 *    DELETE https://<worker>/favorites?account=<id>&folder=..  → 폴더와 그 안의 종목 삭제
 *    DELETE https://<worker>/favorites?account=<id>            → (symbol 없이) 계정 전체 삭제
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Fav-Key",
  "Access-Control-Max-Age": "86400",
};

// 즐겨찾기 저장 한도(계정별) 및 문자열 길이 제한 (악용 방지)
const FAV_MAX_ITEMS = 300;
const FAV_MAX_LEN = 200;
// 계정별 폴더 개수 상한
const FAV_MAX_FOLDERS = 100;
// 공유 키 해시에 사용하는 고정 솔트 (레인보우 테이블 완화용)
const FAV_SALT = "investing-fav-v1";

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

  const authKey = request.headers.get("X-Fav-Key") || "";
  if (authKey.length < 4 || authKey.length > FAV_MAX_LEN) {
    return jsonResponse({ error: "공유 키는 4자 이상이어야 합니다." }, 400);
  }

  const kvKey = "fav:" + account;

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
