/**
 * Cloudflare Worker + KV 단일 JSON 저장소
 *
 * 배포 후 KV 바인딩 이름을 코드의 CALENDAR_KV 와 동일하게 설정하세요.
 * 접근 경로: GET / PUT / POST /api/calendar-events
 *
 * 보안: 현재는 공개 읽기·쓰기입니다. 필요하면 배포 후 헤더 토큰 검증을 추가하세요.
 */

export default {
  async fetch(request, env) {
    const baseHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: baseHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path !== "/api/calendar-events") {
      return new Response("Not Found", { status: 404, headers: baseHeaders });
    }

    const kv = env.CALENDAR_KV;
    if (!kv) {
      return json({ error: "KV binding CALENDAR_KV missing" }, 500, baseHeaders);
    }

    try {
      if (request.method === "GET") {
        const raw = await kv.get("shared_events");
        const payload = raw && raw.trim() !== "" ? raw : "{}";
        JSON.parse(payload);
        return new Response(payload, {
          headers: { ...baseHeaders, "Content-Type": "application/json" },
        });
      }

      if (request.method === "PUT" || request.method === "POST") {
        const text = await request.text();
        JSON.parse(text);
        await kv.put("shared_events", text);
        return json({ ok: true }, 200, baseHeaders);
      }

      return new Response("Method Not Allowed", { status: 405, headers: baseHeaders });
    } catch (e) {
      return json({ error: String(e && e.message ? e.message : e) }, 400, baseHeaders);
    }
  },
};

function json(obj, status, baseHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...baseHeaders, "Content-Type": "application/json" },
  });
}
