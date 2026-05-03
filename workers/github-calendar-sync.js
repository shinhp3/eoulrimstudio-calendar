/**
 * 캘린더 공유 JSON을 GitHub 저장소에 커밋합니다 (STL 업로드 Worker와 동일한 패턴).
 *
 * 경로: models/calendar-events.json (브랜치 main, 환경변수로 변경 가능)
 * 라우트: GET | PUT | OPTIONS /api/calendar-events
 *
 * Secrets / Vars (Cloudflare Worker 설정):
 *   GITHUB_TOKEN      — repo Contents 쓰기 권한이 있는 PAT
 *   GITHUB_USERNAME   — 저장소 owner (사용자 또는 조직)
 *   GITHUB_REPO       — 저장소 이름만 (예: eoulrimstudio-calendar)
 * 선택:
 *   GITHUB_BRANCH     — 기본 main
 *   CALENDAR_REPO_PATH — 기본 models/calendar-events.json
 *
 * 기존 Worker에 POST /upload(STL) 등이 있다면, 같은 fetch 핸들러 안에서
 * pathname 분기만 합치면 한 Worker에서 STL + 캘린더를 함께 제공할 수 있습니다.
 */

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";

    if (pathname !== "/api/calendar-events") {
      return new Response("Not Found", { status: 404, headers: cors });
    }

    const cfg = resolveGithubConfig(env);
    if (!cfg.ok) {
      return json(
        { error: cfg.error },
        500,
        cors
      );
    }

    try {
      if (request.method === "GET") {
        const { data } = await readCalendarJson(cfg);
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
        });
      }

      if (request.method === "PUT") {
        const text = await request.text();
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch {
          return json({ error: "invalid JSON body" }, 400, cors);
        }
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          Array.isArray(parsed)
        ) {
          return json({ error: "body must be a JSON object" }, 400, cors);
        }

        const normalized = JSON.stringify(parsed);
        const iso = new Date().toISOString();
        const message = `Update calendar: ${cfg.filePath} @ ${iso}`;

        const putRes = await githubPutFile(cfg, normalized, message);
        if (!putRes.ok) {
          const errText = await putRes.text();
          return json(
            { error: "GitHub PUT failed", status: putRes.status, detail: errText.slice(0, 500) },
            putRes.status >= 400 && putRes.status < 600 ? putRes.status : 502,
            cors
          );
        }

        return json({ ok: true }, 200, cors);
      }

      return new Response("Method Not Allowed", { status: 405, headers: cors });
    } catch (e) {
      const msg = e && e.message ? String(e.message) : String(e);
      return json({ error: msg }, 500, cors);
    }
  },
};

/** @param {Record<string, string | undefined>} env */
function resolveGithubConfig(env) {
  const token = env.GITHUB_TOKEN;
  const owner = env.GITHUB_USERNAME;
  const repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || "main";
  const filePath = env.CALENDAR_REPO_PATH || "models/calendar-events.json";

  if (!token || String(token).trim() === "") {
    return { ok: false, error: "GITHUB_TOKEN is not set" };
  }
  if (!owner || String(owner).trim() === "") {
    return { ok: false, error: "GITHUB_USERNAME is not set" };
  }
  if (!repo || String(repo).trim() === "") {
    return { ok: false, error: "GITHUB_REPO is not set" };
  }

  return {
    ok: true,
    token: String(token).trim(),
    owner: String(owner).trim(),
    repo: String(repo).trim(),
    branch,
    filePath: String(filePath).trim().replace(/^\/+/, ""),
  };
}

function contentsUrl(cfg) {
  const pathEncoded = cfg.filePath
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  return `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${pathEncoded}?ref=${encodeURIComponent(cfg.branch)}`;
}

function contentsUrlPut(cfg) {
  const pathEncoded = cfg.filePath
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  return `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${pathEncoded}`;
}

function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "eoulrimstudio-calendar-github-sync-worker",
  };
}

function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  bytes.forEach(function (b) {
    bin += String.fromCharCode(b);
  });
  return btoa(bin);
}

function base64ToUtf8(b64) {
  const clean = String(b64).replace(/\s/g, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return new TextDecoder().decode(out);
}

/** @param {{ ok: true } & ReturnType<typeof resolveGithubConfig> extends infer X ? X : never} cfg */
async function readCalendarJson(cfg) {
  const res = await fetch(contentsUrl(cfg), {
    headers: ghHeaders(cfg.token),
  });

  if (res.status === 404) {
    return { data: {}, sha: null };
  }

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`GitHub GET ${res.status}: ${t.slice(0, 300)}`);
  }

  const meta = /** @type {{ content?: string, encoding?: string, sha?: string }} */ (
    await res.json()
  );

  if (!meta.content || meta.encoding !== "base64") {
    throw new Error("unexpected GitHub contents response");
  }

  const raw = base64ToUtf8(meta.content);
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("models/calendar-events.json is not valid JSON");
  }

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("calendar file must be a JSON object");
  }

  return { data, sha: meta.sha || null };
}

/** @param {{ ok: true } & ReturnType<typeof resolveGithubConfig> extends infer X ? X : never} cfg */
async function githubPutFile(cfg, utf8JsonString, message) {
  const cur = await readCalendarJson(cfg);
  const sha = cur.sha;

  const bodyObj = {
    message,
    content: utf8ToBase64(utf8JsonString),
    branch: cfg.branch,
  };
  if (sha) {
    bodyObj.sha = sha;
  }

  return fetch(contentsUrlPut(cfg), {
    method: "PUT",
    headers: {
      ...ghHeaders(cfg.token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(bodyObj),
  });
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}
