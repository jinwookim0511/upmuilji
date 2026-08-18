# 업무일지 Vercel 앱

이 폴더는 GitHub와 Vercel에서 독립적으로 배포하는 Next.js 애플리케이션입니다.

## 로컬 실행

1. `.env.example`을 `.env.local`로 복사하고 값을 입력합니다.
2. `pnpm install`을 실행합니다.
3. `pnpm dev`로 개발 서버를 시작합니다.

## Vercel 환경 변수

Production, Preview, Development 환경에 다음 값을 설정합니다.

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASSWORD`
- `SMTP_SENDER_EMAIL`

실제 값은 GitHub에 커밋하지 않습니다. Vercel 프로젝트 설정의 Environment Variables에서만 관리합니다.

## 배포

GitHub 저장소의 기본 브랜치가 Vercel 프로젝트에 연결되면 커밋할 때마다 프로덕션 배포가 생성됩니다. Pull Request 브랜치는 Vercel Preview에서 먼저 확인합니다.
