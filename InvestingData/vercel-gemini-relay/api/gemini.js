// Vercel Serverless Function — Gemini "미국 고정 리전" 릴레이
//
// 목적: Cloudflare 워커는 엣지가 유동적이라, 회사망 등 특정 경로에서
//       Google 이 "User location is not supported" 오류를 낸다.
//       이 함수는 Vercel 의 고정 리전(vercel.json 의 regions=iad1, 미국 동부)에서
//       실행되므로 항상 Gemini 지원 지역에서 Google 을 호출한다.
//
// 보안:
//   - GEMINI_API_KEY 는 Vercel 환경변수에만 저장한다(클라이언트/워커로 노출 안 됨).
//   - x-relay-secret 헤더가 RELAY_SECRET 과 일치하는 요청만 허용한다.
//
// 요청 형식 (워커 → 이 함수):
//   POST /api/gemini
//   headers: { "x-relay-secret": "<RELAY_SECRET>", "content-type": "application/json" }
//   body: { "endpoint": "models?pageSize=1000" | "models/<model>:generateContent",
//           "method": "GET" | "POST",
//           "payload": <object|null> }
//
// 응답: Google 응답의 status 와 JSON 을 그대로 전달한다.

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/";

// Vercel 함수 최대 실행 시간(초). 무료(Hobby) 등급 상한은 60초.
// (vercel.json 의 functions.maxDuration 과 함께 명시해 확실히 적용한다)
export const config = { maxDuration: 60 };

// endpoint 화이트리스트: models 조회 / generateContent 만 허용(오남용 방지)
function isAllowedEndpoint(endpoint) {
  if (typeof endpoint !== "string" || !endpoint) return false;
  if (endpoint.includes("..") || endpoint.startsWith("/")) return false;
  if (/^models(\?|$)/.test(endpoint)) return true; // ListModels
  if (/^models\/[A-Za-z0-9._:-]+:generateContent$/.test(endpoint)) return true;
  return false;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Only POST is allowed" });
    return;
  }

  const secret = process.env.RELAY_SECRET || "";
  if (!secret || req.headers["x-relay-secret"] !== secret) {
    res.status(401).json({ error: "unauthorized relay caller" });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!apiKey) {
    res.status(500).json({ error: "GEMINI_API_KEY 가 Vercel 에 설정되지 않았습니다." });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      res.status(400).json({ error: "invalid json body" });
      return;
    }
  }
  body = body || {};

  const endpoint = body.endpoint;
  const method = (body.method || "GET").toUpperCase();
  const payload = body.payload || null;

  if (!isAllowedEndpoint(endpoint)) {
    res.status(400).json({ error: "허용되지 않은 endpoint 입니다." });
    return;
  }
  if (method !== "GET" && method !== "POST") {
    res.status(400).json({ error: "허용되지 않은 method 입니다." });
    return;
  }

  const sep = endpoint.includes("?") ? "&" : "?";
  const url = GEMINI_BASE + endpoint + sep + "key=" + encodeURIComponent(apiKey);

  const init = { method };
  if (method === "POST") {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(payload || {});
  }

  let upstream;
  try {
    upstream = await fetch(url, init);
  } catch (err) {
    res.status(502).json({ error: "Google 호출 실패: " + String(err) });
    return;
  }

  const textBody = await upstream.text();
  res.status(upstream.status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.send(textBody);
}
