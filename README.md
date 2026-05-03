# Eoulrim Calendar

**저장소:** [github.com/shinhp3/eoulrimstudio-calendar](https://github.com/shinhp3/eoulrimstudio-calendar)

브라우저에서 동작하는 월별 **할 일 캘린더**입니다. HTML / CSS / JS가 분리되어 있습니다.

- **동기화 주소가 설정된 경우:** 같은 Worker URL을 바라보는 모든 사용자가 **동일한 일정·할 일 목록**을 봅니다. (주기적으로 서버에서 다시 불러오며, 수정 후에는 서버로 저장합니다.)
- **동기화를 비운 경우:** 이 브라우저의 `localStorage`에만 저장됩니다.

동기화 주소는 `index.html`의 `<meta name="calendar-sync-url" content="...">` 로 바꿀 수 있습니다.

## 로컬에서 보기

저장소 폴더에서 `index.html`을 브라우저로 열면 됩니다.

## 저장소 구조

```
.
├── .github/
│   └── workflows/
│       └── deploy-pages.yml   # GitHub Pages 자동 배포
├── models/
│   └── calendar-events.json   # Worker(GitHub API)가 커밋하는 공유 데이터 위치
├── workers/
│   ├── eoulrimstudio-upload.worker.js   # STL·records·tools + 캘린더(/api/calendar-events) 통합 Worker — 대시보드 붙여넣기 배포용
│   ├── github-calendar-sync.js          # 캘린더만 단독 배포할 때 (GitHub Contents API)
│   ├── calendar-sync.js                 # KV 전용 (대안)
│   ├── wrangler.toml.example
│   └── wrangler.github-calendar.toml.example
├── css/
│   └── styles.css
├── js/
│   └── calendar.js
├── index.html
├── .gitignore
└── .nojekyll                  # GitHub Pages에서 Jekyll 비활성화
```

## 다른 사람과 같은 데이터 보기 (Worker 배포)

브라우저는 **`calendar-sync-url`** 로 JSON 전체를 GET/PUT 합니다. 저장 방식은 두 가지 중 하나를 쓰면 됩니다.

### A. GitHub에 커밋 (STL 업로드 Worker와 같은 방식) — 권장

1. GitHub에서 이 저장소용 **PAT** 을 만들고, 대상 저장소에 **Contents: Read and write** 권한을 줍니다.
2. Cloudflare Worker에 다음을 설정합니다 (**저장소에 커밋하지 마세요**).
   - Secret: `GITHUB_TOKEN`
   - 변수: `GITHUB_USERNAME` (owner), `GITHUB_REPO` (저장소 이름만)
   - 선택: `GITHUB_BRANCH` (기본 `main`), `CALENDAR_REPO_PATH` (기본 `models/calendar-events.json`)
3. `workers/wrangler.github-calendar.toml.example` 을 참고해 `workers/wrangler.toml` 을 만들고 엔트리를 **`github-calendar-sync.js`** 로 둔 뒤 배포합니다.
4. 배포된 Worker의 **`https://<worker-host>/api/calendar-events`** 전체 URL을 `index.html` 의 `calendar-sync-url` 메타에 넣습니다.

메모를 수정하면 Worker가 GitHub **Contents API**로 `models/calendar-events.json` 을 갱신하고, **`main`** 에 커밋이 쌓입니다 (예: `Update calendar: models/calendar-events.json @ <ISO 시각>`).

**이미 `eoulrimstudio-upload.eoulrimstudio.workers.dev` 에 STL Worker를 쓰는 경우:** 저장소의 **`workers/eoulrimstudio-upload.worker.js`** 전체를 Cloudflare 대시보드 Worker 코드에 붙여넣어 배포하면 됩니다. (데스크톱의 `worker.json`과 동일 선상에 **`GET`/`PUT` `/api/calendar-events`** 가 추가된 버전입니다.) 캘린더 데이터는 **`GITHUB_REPO` 저장소의 `models/calendar-events.json`** 에 커밋됩니다.

별도 Worker만 쓰려면 **`github-calendar-sync.js`** 를 배포하면 됩니다.

### B. KV만 사용 (대안)

1. Cloudflare **KV** 를 만들고 바인딩 이름 **`CALENDAR_KV`** 로 연결합니다.
2. `workers/wrangler.toml.example` + `workers/calendar-sync.js` 로 배포합니다.
3. **`/api/calendar-events`** 전체 URL을 메타에 넣습니다.

### 「서버와 연결되지 않았습니다」또는 「동기화 주소가 JSON API가 아닙니다」가 뜰 때

메타 URL로 **GET** 했을 때 본문이 **`{` 로 시작하는 JSON** 이어야 합니다.

- **HTML이 오거나 PUT 이 405:** 해당 Worker에 `github-calendar-sync.js` 또는 `calendar-sync.js` 라우트가 없거나, 다른 앱이 같은 경로를 쓰고 있는 상태입니다.
- **GitHub 방식에서 401/403:** `GITHUB_TOKEN` 권한 또는 owner/repo 이름을 확인하세요.

공개 Worker는 **누구나 GET/PUT** 가능합니다. 운영에서는 헤더 토큰 검증 등을 추가하는 것을 권장합니다.

클라이언트는 대략 **45초마다** 서버를 다시 읽고, 항목을 바꾼 뒤에는 **디바운스된 PUT** 으로 전체 JSON을 올립니다.

## GitHub에 올리고 Pages로 공유하기

1. 원격은 `https://github.com/shinhp3/eoulrimstudio-calendar.git` 로 연결할 수 있습니다. 로컬에서 `git push origin main` 으로 반영합니다.
2. 저장소 **Settings → Pages**에서 **Build and deployment**의 Source를 **GitHub Actions**로 선택합니다.
3. `main`(또는 `master`) 브랜치에 push하면 워크플로 **Deploy to GitHub Pages**가 실행되어 정적 사이트가 배포됩니다.
4. 배포가 끝나면 Pages 안내에 나온 URL(예: `https://<사용자>.github.io/<저장소>/`)로 접속해 공유할 수 있습니다.

프로젝트 페이지(`/<repo>/`) 경로에서도 CSS·JS는 상대 경로로 불러오므로 별도 설정 없이 동작합니다.

## Cloudflare Worker와 GitHub 토큰 (`eoulrimstudio-upload.eoulrimstudio.workers.dev`)

`GITHUB_TOKEN`, `GITHUB_USERNAME`처럼 민감한 값은 **GitHub 저장소에 커밋하지 말고**, **Cloudflare Worker의 환경 변수·Secrets**에만 두는 방식이 안전합니다.

이 저장소의 워크플로는 기본적으로 **GitHub Actions만으로 Pages에 게시**합니다. Worker로 추가 작업(미러링, 알림 등)을 할 경우 Worker에 검증 가능한 HTTP 엔드포인트를 두고, 필요할 때만 저장소 Actions Secrets를 설정하면 됩니다.

| 저장소 Secrets (선택) | 설명 |
|----------------------|------|
| `CF_WORKER_DEPLOY_URL` | Worker 배포·알림용 POST URL 전체 |
| `CF_WORKER_WEBHOOK_SECRET` | Worker와 동일한 값으로 요청 헤더 `X-Webhook-Secret` 검증용 |

워크플로 마지막 단계에서 위 Secret이 있을 때만 Worker로 JSON 알림을 보냅니다.
