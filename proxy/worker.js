/**
 * 바리스(Barison) 백오피스 API CORS 프록시 — Cloudflare Worker
 *
 * 왜 필요한가:
 *   바리스 API 서버는 요청 "출처(Origin)"로 접근을 가른다. 자기 도메인(*.xyzcorp.io)과
 *   localhost만 허용하고, github.io 같은 외부 정적 호스팅에서 온 요청은 차단한다
 *   (로그인 시 "관리자 정보 없음", 지점전환 시 거부). 브라우저는 Origin 헤더를 JS로
 *   바꿀 수 없으므로, 순수 정적 사이트(github.io)에서는 우회가 불가능하다.
 *
 *   이 프록시는 "서버 측"에서 요청을 중계하면서 Origin/Referer를 barison.xyzcorp.io로
 *   설정해 전달한다. 따라서 바리스 서버는 허용된 출처로 인식하고 정상 처리한다.
 *   브라우저 ↔ 프록시 구간은 이 Worker가 CORS를 직접 허용한다.
 *
 * 보안 메모:
 *   - 로그인/조회 요청이 이 프록시를 경유한다(자격증명이 프록시를 지나감).
 *     반드시 본인 소유의 Cloudflare 계정에 배포해 사용할 것.
 *   - ALLOW_ORIGINS 로 호출 가능한 프런트 출처를 제한한다.
 */

const TARGET = "https://api-baris-v3-backoffice.xyzcorp.io";

// 이 프록시를 호출할 수 있는 프런트엔드 출처(화이트리스트)
const ALLOW_ORIGINS = [
  "https://sigmaideas.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
];

// 공유 데이터 저장 키(KV 안에서의 키 이름)
const DATA_KEY = "dashboard";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const reqOrigin = request.headers.get("Origin") || "";
    const allowOrigin = ALLOW_ORIGINS.includes(reqOrigin) ? reqOrigin : ALLOW_ORIGINS[0];

    const cors = {
      "Access-Control-Allow-Origin": allowOrigin,
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, X-Save-Key",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    };

    // CORS 프리플라이트
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    // ───────── 공유 데이터 저장/조회 (KV, 공유 암호로 보호) ─────────
    if (url.pathname === "/__data") {
      const jsonCors = { ...cors, "Content-Type": "application/json" };
      const key = request.headers.get("X-Save-Key") || "";
      // SAVE_KEY 비밀값과 일치해야 읽기/쓰기 허용
      if (!env.SAVE_KEY || key !== env.SAVE_KEY) {
        return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: jsonCors });
      }
      if (request.method === "GET") {
        const stored = await env.DATA.get(DATA_KEY);
        return new Response(stored || JSON.stringify({ stores: [], monthly: [] }), { status: 200, headers: jsonCors });
      }
      if (request.method === "PUT" || request.method === "POST") {
        const text = await request.text();
        try { JSON.parse(text); } catch { return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400, headers: jsonCors }); }
        await env.DATA.put(DATA_KEY, text);
        return new Response(JSON.stringify({ ok: true, savedAt: new Date().toISOString() }), { status: 200, headers: jsonCors });
      }
      return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: jsonCors });
    }

    // ───────── 그 외: 바리스 API 프록시 ─────────
    // 대상 URL: 경로/쿼리 그대로 전달
    const target = TARGET + url.pathname + url.search;

    // 헤더 구성: Origin/Referer를 바리스로 위장(서버 출처 검사 통과), 인증/콘텐츠 타입은 그대로 중계
    const h = new Headers();
    const ct = request.headers.get("Content-Type");
    if (ct) h.set("Content-Type", ct);
    const auth = request.headers.get("Authorization");
    if (auth) h.set("Authorization", auth);
    h.set("Accept", "application/json, text/plain, */*");
    h.set("Origin", "https://barison.xyzcorp.io");
    h.set("Referer", "https://barison.xyzcorp.io/");
    h.set("User-Agent", request.headers.get("User-Agent") || "Mozilla/5.0");

    const init = { method: request.method, headers: h };
    if (!["GET", "HEAD"].includes(request.method)) {
      init.body = await request.arrayBuffer();
    }

    let resp;
    try {
      resp = await fetch(target, init);
    } catch (e) {
      return new Response(JSON.stringify({ error: "proxy_fetch_failed", message: String(e) }), {
        status: 502,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const body = await resp.arrayBuffer();
    const outHeaders = new Headers(cors);
    const rct = resp.headers.get("Content-Type");
    if (rct) outHeaders.set("Content-Type", rct);
    // 바리스는 623/727 등 비표준 상태코드를 쓰는데 Response는 200~599만 허용한다.
    // 실제 코드는 JSON 본문(payload)에 있으므로, 범위를 벗어나면 400으로 보정하고
    // 원래 코드는 헤더로 남긴다.
    outHeaders.set("X-Baris-Status", String(resp.status));
    const safeStatus = resp.status >= 200 && resp.status <= 599 ? resp.status : 400;
    return new Response(body, { status: safeStatus, headers: outHeaders });
  },
};
