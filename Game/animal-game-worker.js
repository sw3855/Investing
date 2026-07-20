/**
 * animal-game-worker.js
 *
 * "포켓몬고" 스타일 동물 이름 맞히기 게임용 Cloudflare Worker.
 *
 * 개념
 *  - 동물 이미지 파일은 Cloudflare R2(오브젝트 스토리지)에 저장한다.
 *  - 각 이미지 파일(key)과 정답 동물 이름을 이 Worker 안에서 매핑한다.
 *  - 웹페이지(AnimalGame.html)는 아래 API 를 호출해
 *      1) 랜덤 동물 1마리를 받고(/game/next)
 *      2) 그 이미지를 표시하고(/game/image?key=...)
 *      3) 사용자가 입력한 이름을 채점한다(/game/check).
 *
 * ── 왜 R2 인가? ────────────────────────────────────────────
 *  Worker 코드 자체에는 용량 제한(무료 플랜 약 1MB)이 있어 이미지를 많이
 *  넣을 수 없다. R2 는 이미지 같은 "파일(바이너리)" 저장에 최적화된
 *  S3 호환 스토리지이며 무료 등급(월 10GB 저장)이 넉넉하다.
 *
 * ── 배포 방법 ──────────────────────────────────────────────
 *  1) https://dash.cloudflare.com → R2 → Create bucket
 *        버킷 이름 예: animal-images
 *  2) 만든 버킷에 동물 이미지 업로드 (Game/images 폴더의 SVG 파일들)
 *        예) fox.svg, rabbit.svg, tiger.svg ...
 *        (파일 이름 = 아래 ANIMALS 의 image 값과 일치시켜야 함)
 *  3) Workers & Pages → Create Worker → 이 파일 내용을 붙여넣고 Deploy
 *  4) 이 Worker → Settings → Variables → R2 Bucket Bindings
 *        Variable name(바인딩 이름): ANIMAL_IMAGES
 *        R2 bucket: 위에서 만든 animal-images 선택
 *  5) 발급된 주소(예: https://animal-game.<계정>.workers.dev)를
 *     AnimalGame.html 의 WORKER_BASE 에 입력
 *
 *  (wrangler 사용 시 wrangler.toml 예)
 *     name = "animal-game"
 *     main = "animal-game-worker.js"
 *     compatibility_date = "2024-01-01"
 *     [[r2_buckets]]
 *     binding = "ANIMAL_IMAGES"
 *     bucket_name = "animal-images"
 *
 * ── API ────────────────────────────────────────────────────
 *   GET /game/next
 *        → { id, image, hint }   (정답 이름은 내려주지 않는다!)
 *   GET /game/image?key=<image>
 *        → R2 에 저장된 실제 이미지 바이너리
 *   POST /game/check   body: { id, answer }
 *        → { correct: true|false, name?, next? }
 *   GET /game/list
 *        → 등록된 동물 개수 등 상태(디버그용)
 */

// ── 동물 이미지 ↔ 이름 매핑 ────────────────────────────────
//  image : R2 버킷에 올린 파일 이름(key)
//  names : 정답으로 인정할 이름들(첫 번째가 대표 이름). 오타/영문/별칭 허용용.
//  hint  : 웹페이지에 보여줄 힌트(선택)
const ANIMALS = [
  { id: "fox",      image: "fox.svg",      names: ["여우", "fox"],              hint: "꾀 많은 갈색 동물" },
  { id: "rabbit",   image: "rabbit.svg",   names: ["토끼", "rabbit", "bunny"],  hint: "귀가 긴 동물" },
  { id: "tiger",    image: "tiger.svg",    names: ["호랑이", "tiger"],          hint: "줄무늬 맹수" },
  { id: "elephant", image: "elephant.svg", names: ["코끼리", "elephant"],       hint: "코가 긴 큰 동물" },
  { id: "penguin",  image: "penguin.svg",  names: ["펭귄", "penguin"],          hint: "남극에 사는 새" },
  { id: "giraffe",  image: "giraffe.svg",  names: ["기린", "giraffe"],          hint: "목이 아주 긴 동물" },
  { id: "panda",    image: "panda.svg",    names: ["판다", "panda"],            hint: "대나무를 먹는 곰" },
  { id: "lion",     image: "lion.svg",     names: ["사자", "lion"],             hint: "갈기가 있는 백수의 왕" },
];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS },
  });

// 입력값 정규화: 공백 제거 + 소문자 (한글은 그대로, 영문/대소문자/공백만 관대하게 처리)
const normalize = (s) => (s || "").toString().trim().toLowerCase().replace(/\s+/g, "");

function pickRandom(excludeId) {
  const pool = excludeId ? ANIMALS.filter((a) => a.id !== excludeId) : ANIMALS;
  const list = pool.length ? pool : ANIMALS;
  return list[Math.floor(Math.random() * list.length)];
}

// 배열을 무작위로 섞는다 (Fisher–Yates)
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 객관식 보기 3개(정답 1 + 오답 2)를 대표 이름으로 만들어 섞어서 반환
function buildChoices(animal, count = 3) {
  const correct = animal.names[0];
  const distractors = shuffle(
    ANIMALS.filter((a) => a.id !== animal.id).map((a) => a.names[0])
  ).slice(0, Math.max(0, count - 1));
  return shuffle([correct, ...distractors]);
}

function publicAnimal(a) {
  // 정답(names)은 그대로 노출하지 않고, 객관식 보기(choices)만 내려준다.
  return { id: a.id, image: a.image, hint: a.hint, choices: buildChoices(a) };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // 랜덤 동물 1마리
      if (path === "/game/next" && request.method === "GET") {
        const exclude = url.searchParams.get("exclude") || "";
        return json(publicAnimal(pickRandom(exclude)));
      }

      // R2 에 저장된 이미지 반환
      if (path === "/game/image" && request.method === "GET") {
        const key = url.searchParams.get("key") || "";
        const animal = ANIMALS.find((a) => a.image === key);
        if (!animal) return json({ error: "unknown image" }, 404);

        if (!env.ANIMAL_IMAGES) {
          return json({ error: "R2 bucket(ANIMAL_IMAGES) 바인딩이 설정되지 않았습니다." }, 500);
        }
        const object = await env.ANIMAL_IMAGES.get(key);
        if (!object) return json({ error: "image not found in R2: " + key }, 404);

        const headers = new Headers(CORS_HEADERS);
        object.writeHttpMetadata(headers);
        headers.set("Cache-Control", "public, max-age=86400");
        return new Response(object.body, { headers });
      }

      // 정답 채점
      if (path === "/game/check" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const { id, answer } = body;
        const animal = ANIMALS.find((a) => a.id === id);
        if (!animal) return json({ error: "unknown animal id" }, 400);

        const guess = normalize(answer);
        const correct = animal.names.some((n) => normalize(n) === guess);

        if (correct) {
          return json({
            correct: true,
            name: animal.names[0],
            next: publicAnimal(pickRandom(animal.id)), // 맞히면 바로 다음 동물
          });
        }
        return json({ correct: false });
      }

      // 상태(디버그)
      if (path === "/game/list" && request.method === "GET") {
        return json({ count: ANIMALS.length, ids: ANIMALS.map((a) => a.id) });
      }

      return json({ error: "not found", path }, 404);
    } catch (err) {
      return json({ error: String(err) }, 500);
    }
  },
};
