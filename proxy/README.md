# 바리스 API 프록시 (Cloudflare Worker)

배포된 대시보드(`github.io`)에서 바리스 임포트가 동작하게 하는 프록시입니다.

## 왜 필요한가
바리스 API 서버는 요청 **출처(Origin)** 로 접근을 가릅니다. 자기 도메인(`*.xyzcorp.io`)과
`localhost`만 허용하고 `github.io` 같은 외부 정적 호스팅은 차단합니다(로그인 시 "관리자 정보 없음").
브라우저는 Origin 헤더를 JS로 바꿀 수 없으므로, 정적 사이트에서는 우회가 불가능합니다.

이 Worker는 **서버 측에서** 요청을 중계하며 `Origin`/`Referer`를 `barison.xyzcorp.io`로 설정해
전달합니다. 바리스 서버는 허용된 출처로 인식하고 정상 처리하며, 브라우저↔프록시 구간은 이 Worker가
CORS를 직접 허용합니다. (검증: `clevel` 더미 비번 → `727 비밀번호 불일치` = 계정 조회 성공)

## 보안
- 로그인/조회 요청이 이 프록시를 경유합니다(자격증명이 프록시를 지나감). **반드시 본인 Cloudflare
  계정에 배포**하세요. 공개 프록시 금지.
- `worker.js`의 `ALLOW_ORIGINS`로 호출 가능한 프런트 출처를 제한합니다.

## 배포 방법
```bash
cd proxy
npx wrangler login        # 한 번만: 브라우저로 Cloudflare 로그인(없으면 가입)
npx wrangler deploy       # 배포 → https://loungex-baris-proxy.<계정>.workers.dev 출력
```

배포 후 출력된 Worker URL을 루트의 `script.js`에서 `%%BARIS_PROXY_URL%%` 자리에 넣고 푸시하면,
배포된 대시보드에서 `업데이트` 임포트가 동작합니다.

## 로컬 테스트
```bash
cd proxy
npx wrangler dev --port 8787 --local
# 다른 터미널:
curl -s -X POST http://localhost:8787/xmanager/login/web \
  -H 'Content-Type: application/json' -H 'Origin: https://sigmaideas.github.io' \
  --data '{"account":"clevel","password":"<비번>"}'
# → 201 + accessToken 이면 정상
```
