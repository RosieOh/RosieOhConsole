# 운영 배포 — Oracle Cloud 무료 ARM VM

콘솔은 **Oracle Cloud 상시 무료(Always Free) ARM VM** 한 대에 `compose.prod.yml`(콘솔 + MariaDB + Caddy)로 띄운다. main 에 머지하면 GitHub Actions 가 이미지를 만들고(`image`), 그 이미지로 서버를 바꾼다(`deploy`). 드는 돈은 도메인뿐이고, 도메인이 없을 때는 `<IP>.sslip.io` 로 먼저 띄운다.

```
main 머지 → image 워크플로(GHCR :<커밋 12자>) → deploy 워크플로 ──SSH "deploy <커밋>"──▶ 서버 rosie-deploy
                                                                                    └ git checkout → scripts/server-deploy.bash
                                                                                       (이미지 교체 → 헬스 확인 → 실패면 이전 이미지로)
```

## 1. Oracle VM 만들기 (처음 한 번, 웹 콘솔에서)
1. [Oracle Cloud](https://www.oracle.com/cloud/free/) 가입 — 카드 인증이 있지만 무료 자원만 쓰면 청구되지 않는다. 홈 리전은 나중에 못 바꾼다(서울·춘천은 자리가 모자랄 때가 있다)
2. Compute › Instances › Create
   - Image: **Canonical Ubuntu 24.04**
   - Shape: **VM.Standard.A1.Flex (Ampere ARM)** — OCPU 2 · 메모리 12GB 면 넉넉하다(무료 한도 4 · 24GB)
   - Networking: 공인 IPv4 할당
   - SSH keys: 내 공개키(`~/.ssh/id_ed25519.pub`) 붙여넣기
   - "Out of capacity" 가 나오면 다른 가용 도메인(AD)이나 시간을 바꿔 다시
3. Networking › Virtual cloud networks › (VCN) › Security Lists › Default — **Ingress 규칙 추가**: 소스 `0.0.0.0/0`, TCP, 대상 포트 `80` / `443` 각각
4. 확인: `ssh ubuntu@<공인 IP>` 로 들어가진다

> 무료 계정의 VM 은 7일 동안 CPU·네트워크·메모리를 거의 안 쓰면 회수될 수 있다. 콘솔은 늘 GitHub 를 읽으니 보통 문제없지만, 걱정되면 계정을 Pay As You Go 로 올려 둔다(무료 한도 안이면 여전히 0원).

## 2. 운영용 GitHub OAuth 앱
GitHub › Settings › Developer settings › OAuth Apps › New — OAuth 앱은 콜백 주소를 하나만 받으니 로컬 개발용과 **따로** 만든다.
- Homepage URL: `https://<주소>`
- Authorization callback URL: `https://<주소>/dashapi/oauth/callback`
- `<주소>` 는 도메인이 없으면 `<IP 의 점을 -로>.sslip.io` (예: `203-0-113-7.sslip.io`)

## 3. 서버 준비 + 첫 실행 (이 컴퓨터에서)
```
scripts/oracle-setup.bash ubuntu@<공인 IP>                       # 주소 = <IP>.sslip.io
scripts/oracle-setup.bash ubuntu@<공인 IP> --domain console.example.com
```
- 서버: Docker·git 설치, iptables 80·443 열기, `deploy` 사용자, `/opt/rosie-console` 에 저장소 clone, 매일 04:30 DB 백업(`/home/deploy/backups`, 14개)
- 반영 키: 새 ed25519 키를 `deploy` 사용자에 `command="/usr/local/bin/rosie-deploy"` 로 묶어 등록 — 이 키로는 셸·포트 포워딩이 안 되고 **main 에 있는 커밋 반영**만 된다
- `deploy/.env`: SESSION_SECRET·DB 비밀번호·PROBE_TOKEN 은 만들어 넣고, OAuth ID·시크릿과 GitHub 토큰은 물어서 **서버에만** 둔다
- GitHub(묻고 나서): 환경 `production`(main 브랜치만), 시크릿 `DEPLOY_HOST`·`DEPLOY_SSH_KEY`·`DEPLOY_KNOWN_HOSTS`, 변수 `DEPLOY_URL`·`DEPLOY_ENABLED=true`
- 마지막으로 지금 main 커밋 이미지로 띄우고 `https://<주소>/dashapi/health` 를 확인한다. 처음 관리자는 `CONSOLE_ADMINS`(RosieOh) — GitHub 로 로그인하면 된다

다시 실행해도 된다(있는 것은 그대로 두고 반영 키만 새로 바꾼다). `--no-github` 는 서버만, `--no-start` 는 띄우지 않는다.

## 4. 그다음
- **반영**: main 머지 → 자동. 수동·되돌리기는 Actions › deploy › Run workflow 에 커밋을 넣는다(main 에 있는 커밋만)
- **도메인을 사면**: DNS A 레코드를 서버 IP 로 → OAuth 앱 콜백을 새 주소로 → `scripts/oracle-setup.bash ubuntu@<IP> --domain <새 주소>` (`.env` 의 주소와 `DEPLOY_URL` 만 바뀐다) → Actions 에서 deploy 를 한 번 돌리면 Caddy 가 새 인증서를 받는다
- **서버에서 직접**: `sudo -iu deploy` → `cd /opt/rosie-console/deploy && docker compose -f compose.prod.yml ps|logs -f console`
- **백업**: `/home/deploy/backups/console-*.sql.gz`. 서버 밖에도 두려면 가끔 `scp ubuntu@<IP>:/home/deploy/backups/<파일> .` (되살리기는 `scripts/db-backup.bash` 머리말)
- **반영 키 바꾸기**: `scripts/oracle-setup.bash` 를 다시 실행(옛 반영 키는 지워진다)

## 알아 둘 것
- image 워크플로가 실패하면(이미지 취약점 검사 포함) deploy 는 돌지 않는다
- 헬스가 3분 안에 오르지 않으면 `server-deploy.bash` 가 이전 이미지로 되돌리고 워크플로는 실패로 끝난다. 이때 서버의 저장소는 새 커밋에 있지만(compose·Caddyfile) 이미지는 이전 것이다 — 고친 커밋을 다시 반영하면 맞춰진다
- 콘솔은 한 대만 띄운다고 본다(가입 제한 횟수·캐시가 메모리에 있다)
