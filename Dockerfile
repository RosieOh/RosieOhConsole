# ── web (React 19 · Vite 8) 빌드 ──
# 빌드·시험 단계는 빌드하는 기계의 아키텍처($BUILDPLATFORM)에서 한 번만 돈다 — 산출물(웹 정적 파일·api JS)은 아키텍처와 상관없다.
# amd64·arm64 이미지를 함께 만들 때 대상 아키텍처마다 다시 도는 건 아래 런타임 단계뿐이다
FROM --platform=$BUILDPLATFORM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
ARG VITE_GITHUB_OWNER=RosieOh
ENV VITE_GITHUB_OWNER=$VITE_GITHUB_OWNER
COPY web/ ./
# 업무보드 화면의 단계 정의가 서버와 같은지 보는 시험(stages.test.ts)이 이 파일을 읽는다
COPY api/src/board/derive.ts /api/src/board/derive.ts
RUN npm run build && npm test

# ── api (NestJS 12, ESM) 빌드 ──────────────────────────
FROM --platform=$BUILDPLATFORM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS api
WORKDIR /api
COPY api/package.json api/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY api/ ./
# 서버 점검 수집기 시험(probe-collector.test.mjs)이 워크플로 안의 수집기를 읽는다
COPY .github/workflows/server-probe.yml /.github/workflows/server-probe.yml
RUN npm run build && npm test

# ── 런타임 (NestJS 가 API + React 빌드 동시 서빙) ───────
FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a
WORKDIR /app
ENV NODE_ENV=production TZ=Asia/Seoul
COPY api/package.json api/package-lock.json ./
# 실행에는 node 만 쓴다 — 설치가 끝나면 npm·npx·corepack·yarn 을 지운다(기반 이미지에 묶인 npm 의존성 취약점·공격 표면을 없앤다)
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg /root/.npm
COPY --from=api /api/dist ./dist
COPY api/docs ./docs
COPY --from=web /web/dist ./public
# 콘솔 데이터(감사 로그·배포 기록 캐시·카탈로그·권한) — 볼륨을 /data 에 붙인다. 처음 붙을 때 이 소유자를 물려받는다
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8087
CMD ["node", "dist/main.js"]
