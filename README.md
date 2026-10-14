# 에버랜드 사파리 스페셜투어 텔레그램 알림

**대상: 2026년 10월 24일 이용, 일반 사파리 스페셜 투어.**

Node.js 22 이상만 있으면 됩니다. 추가 패키지는 설치하지 않습니다.

## 동작

- 공식 예약 화면이 사용하는 `checkCapaWoS`로 대상일의 예약 가능 표시를 확인합니다.
- 가능 응답이면 달력의 대상 날짜와 판매 가능한 사파리 상품도 확인한 뒤 알립니다.
- 최초 가능 상태, 매진 후 재등장은 즉시 알립니다. 가능 상태가 유지되면 30분마다 다시 알립니다.
- HTML 로그인 화면, 차단, 응답 오류는 빈자리/매진으로 처리하지 않습니다. 3회 연속 실패 시 실패로 종료합니다.
- 알림 전송이 성공한 뒤에만 상태를 저장합니다. `--dry-run`은 알림과 상태 저장을 하지 않습니다.
- 한국시간 10월 24일 00:00에 종료합니다. 해당 상품의 예약 기한은 방문 전날까지입니다.

**알림은 예약 성공을 보장하지 않습니다.** 비로그인 시간대 상세 API는 현재 메인 화면으로 이동하는 HTML을 반환하여 사용하지 않습니다. 알림에 정확한 시간과 수량을 표시하지 않고, 공식 예약 링크를 제공합니다. 로그인, 캡차, 예약 및 결제는 직접 진행하세요.

## 새 텔레그램 봇 연결

1. 텔레그램 [@BotFather](https://t.me/BotFather)에서 `/newbot`을 보내 새 봇을 만드세요.
2. 새 봇과 개인 채팅을 열고 **시작** 또는 `/start`를 보내세요. 그룹으로 받으려면 새 그룹에 봇을 추가하고 `/start@봇사용자명`을 보내세요.
3. `.env.example`을 `.env`로 복사한 뒤 `TELEGRAM_BOT_TOKEN=`에 발급된 토큰을 입력하세요. 토큰은 채팅이나 공개 저장소에 올리지 마세요.
4. 이 폴더에서 아래 명령으로 채팅 ID를 확인한 뒤 `.env`의 `TELEGRAM_CHAT_ID=`에 넣으세요.

```powershell
node --env-file=.env telegram-chat-id.mjs
```

연결 확인과 로컬 실행:

```powershell
npm test
npm run check
npm run notify:test
npm start
```

로컬 감시는 기본 60초 간격이며 컴퓨터가 켜져 있어야 합니다. 중지는 Ctrl+C입니다. `POLL_INTERVAL_SECONDS`는 30초 이상으로 설정할 수 있습니다.

## GitHub에서 컴퓨터를 꺼도 실행

저장소: [hijinnn/everland-safari-alert](https://github.com/hijinnn/everland-safari-alert)

코드는 `dev` 브랜치에서 검토한 뒤 `main`으로 반영합니다. 사파리 알림 작업은 **`main` 브랜치에서만 실행**되도록 설정되어 있습니다. `dev`에서는 예약 감시나 텔레그램 알림 작업을 실행하지 않습니다.

빈 저장소에 `dev`를 먼저 올리면 `main`이 아직 없을 수 있습니다. 검토 후 GitHub의 브랜치 생성 메뉴에서 `dev`를 기준으로 `main`을 만들고, **Settings → General → Default branch**를 `main`으로 설정하세요. 이후 변경은 `dev`에서 검토하고 PR로 `main`에 반영하면 됩니다. GitHub의 예약 실행은 기본 브랜치에 있는 워크플로를 사용합니다.

저장소 **Settings → Secrets and variables → Actions → New repository secret**에서 새 봇 전용 값을 등록하세요.

| 이름 | 값 |
| --- | --- |
| `SAFARI_TELEGRAM_BOT_TOKEN` | 새 봇 토큰 |
| `SAFARI_TELEGRAM_CHAT_ID` | 새 봇의 알림을 받을 개인 채팅/그룹 ID |

로컬 `.env`에서는 `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`를 사용하고, GitHub Actions에서는 위의 `SAFARI_` 이름을 사용합니다. `.env` 파일은 저장소에 올리지 않습니다.

`main`에 코드를 반영하고 Secrets를 등록한 뒤 **Actions → Safari availability alert → Run workflow**에서 브랜치를 `main`으로 선택하고 `test_notification`을 체크해 테스트 알림을 확인하세요. 체크하지 않고 실행하면 실제 감시를 시작합니다. 기본 브랜치를 `main`으로 설정하면 예약 실행도 활성화됩니다.

워크플로는 5분마다 실행을 요청하고, 실행 중에는 최대 4분의 감시 시간 안에서 60초 간격으로 조회합니다. 알림 상태는 Actions Cache에 저장하며, 상태 변경 시에만 새 캐시를 저장합니다. 캐시가 만료되면 중복 알림이 한 번 발생할 수 있습니다. 동시 실행은 방지합니다.

GitHub 예약 실행은 지연되거나 누락될 수 있으므로 **24시간 60초 간격의 연속 감시를 보장하지 않습니다**. 실행 대기와 사이 간격이 생길 수 있습니다. 이 설정은 하루 최대 약 19시간에 준비 시간을 더한 러너 실행 시간을 사용하므로 비공개 저장소에서는 포함된 실행 분량과 과금 설정을 확인하세요. 공개 저장소의 표준 GitHub 호스팅 러너 사용 정책은 [공식 안내](https://docs.github.com/en/billing/concepts/product-billing/github-actions)를 참고하세요.

예약을 마치면 Actions의 해당 워크플로 메뉴에서 **Disable workflow**를 선택하세요. 대상일이 지나면 프로그램은 조회 없이 끝나지만, GitHub 스케줄 자체를 비활성화하는 것은 별도입니다.

## 확인 기록

2026-10-14 23:07 KST에 코드의 실제 읽기 전용 조회를 검증했으며, 2026-10-24 응답은 `resultCode=-1`(잔여 수량 없음)이었습니다. 성공 코드 `00`은 기존 발렛 프로젝트의 동일 API 처리에서 확인했으며, 사파리의 실제 가능 상태를 관측한 것은 아닙니다. 가능 응답 경로는 모의 API 응답 테스트로 검증했습니다.

공식 상품의 공개 자바스크립트는 `-1`을 예약 가능한 수량 없음으로 처리합니다. 달력의 `capaFg=1`만으로는 잔여석이 있다고 판단할 수 없어 단독 알림에 사용하지 않습니다.

참고: [사파리 공식 예약](https://reservation.everland.com/web/el.do?method=getProduct&top_menu_id=01&high_menu_id=0102&menu_id=01020100000000000004), [기존 발렛 프로젝트](https://github.com/hijinnn/everland-valet-alert), [Telegram 봇 안내](https://core.telegram.org/bots/tutorial), [GitHub 스케줄 안내](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
