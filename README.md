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
├── workers/
│   ├── calendar-sync.js       # Cloudflare Worker 예제 (KV에 JSON 저장)
│   └── wrangler.toml.example
├── css/
│   └── styles.css
├── js/
│   └── calendar.js
├── index.html
├── .gitignore
└── .nojekyll                  # GitHub Pages에서 Jekyll 비활성화
```

## 다른 사람과 같은 데이터 보기 (Worker 배포)

1. Cloudflare에서 **KV 네임스페이스**를 만들고, Worker에 바인딩 이름 **`CALENDAR_KV`** 로 연결합니다.
2. `workers/wrangler.toml.example` 을 참고해 `wrangler.toml` 을 만든 뒤, `workers/calendar-sync.js` 를 배포합니다.
3. 배포된 Worker의 **`/api/calendar-events`** 경로 전체 URL을 `index.html` 메타 `calendar-sync-url` 에 넣습니다.  
   기본값은 `https://eoulrimstudio-upload.eoulrimstudio.workers.dev/api/calendar-events` 형태를 가정합니다.
4. 이 Worker 예제는 **누구나 GET/PUT 가능한 공개 API**입니다. 운영 환경에서는 헤더 토큰 검증 등을 Worker에 추가하는 것을 권장합니다.

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
