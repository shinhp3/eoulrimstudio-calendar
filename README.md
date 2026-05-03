# Eoulrim Calendar

**저장소:** [github.com/shinhp3/eoulrimstudio-calendar](https://github.com/shinhp3/eoulrimstudio-calendar)

브라우저에서 동작하는 월별 캘린더입니다. HTML / CSS / JS 파일이 분리되어 있으며, 일정은 `localStorage`에 저장됩니다.

## 로컬에서 보기

저장소 폴더에서 `index.html`을 브라우저로 열면 됩니다.

## 저장소 구조

```
.
├── .github/
│   └── workflows/
│       └── deploy-pages.yml   # GitHub Pages 자동 배포
├── css/
│   └── styles.css
├── js/
│   └── calendar.js
├── index.html
├── .gitignore
└── .nojekyll                  # GitHub Pages에서 Jekyll 비활성화
```

## GitHub에 올리고 Pages로 공유하기

1. 원격은 `https://github.com/shinhp3/eoulrimstudio-calendar.git` 로 연결해 두었습니다. 로컬에서 `git push origin main` 으로 반영합니다.
2. 저장소 **Settings → Pages**에서 **Build and deployment**의 Source를 **GitHub Actions**로 선택합니다.
3. `main`(또는 `master`) 브랜치에 push하면 워크플로 **Deploy to GitHub Pages**가 실행되어 정적 사이트가 배포됩니다.
4. 배포가 끝나면 Pages 안내에 나온 URL(예: `https://<사용자>.github.io/<저장소>/`)로 접속해 공유할 수 있습니다.

프로젝트 페이지(`/<repo>/`) 경로에서도 CSS·JS는 상대 경로로 불러오므로 별도 설정 없이 동작합니다.

## Cloudflare Worker와 토큰 (`eoulrimstudio-upload.eoulrimstudio.workers.dev`)

`GITHUB_TOKEN`, `GITHUB_USERNAME`처럼 민감한 값은 **GitHub 저장소에 커밋하지 말고**, 말씀하신 것처럼 **Cloudflare Worker의 환경 변수·Secrets**에만 두는 방식이 안전합니다.

이 저장소의 워크플로는 기본적으로 **GitHub Actions만으로 Pages에 게시**합니다. Worker로 추가 작업(미러링, 알림, 다른 스토리지 동기화 등)을 하려면 Worker 쪽에 검증 가능한 HTTP 엔드포인트를 만든 뒤, 필요할 때만 아래를 설정합니다.

| 저장소 Secrets (선택) | 설명 |
|----------------------|------|
| `CF_WORKER_DEPLOY_URL` | Worker 배포·알림용 POST URL 전체 (예: Worker에 구현한 경로 포함) |
| `CF_WORKER_WEBHOOK_SECRET` | Worker와 동일한 값으로 요청 헤더 `X-Webhook-Secret` 검증용 |

워크플로 마지막 단계에서 위 Secret이 있을 때만 Worker로 JSON 알림을 보냅니다. Worker 코드에서 헤더와 본문을 검증한 뒤, Worker에 보관한 `GITHUB_TOKEN` 등으로 GitHub API를 호출하면 됩니다.

> Worker 베이스 URL 예: `https://eoulrimstudio-upload.eoulrimstudio.workers.dev` — 실제 호출 경로(`/deploy` 등)는 Worker 구현에 맞게 `CF_WORKER_DEPLOY_URL`에 넣으면 됩니다.
