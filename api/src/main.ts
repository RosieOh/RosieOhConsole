import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import express from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AppModule } from './app.module.js';
import { BoardService } from './board/board.service.js';
import { assertConfig, cfg, secureCookie } from './config.js';
import { securityHeaders } from './security-headers.js';
import { testbedProxy } from './testbed-proxy.js';
import { closePersist, initPersist, persistInfo } from './persist.js';
import { banner } from './banner.js';

async function bootstrap() {
  assertConfig();
  await initPersist();   // MariaDB 면 표를 만들고 문서를 읽는다 — 서비스들이 생성자에서 읽으므로 Nest 보다 먼저
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.set('trust proxy', 1);   // 리버스 프록시 뒤
  app.disable('x-powered-by');
  const pub = fileURLToPath(new URL('../public', import.meta.url));
  const indexHtml = existsSync(pub + '/index.html') ? readFileSync(pub + '/index.html', 'utf8') : undefined;
  app.use(securityHeaders({ https: secureCookie(), indexHtml }));
  app.use(cookieParser());
  app.use('/mxtest', testbedProxy);                     // 본문을 그대로 넘기므로 JSON 파서보다 먼저
  app.use('/dashapi/probe/ingest', express.text({ type: '*/*', limit: '4mb' }));   // 서버 점검 결과(text)
  app.use('/dashapi', express.json({ limit: '2mb' }));   // 로고 올리기(1MB → base64)

  // 업무보드(6d) — API 는 보드 코드가 그대로 처리(본문을 직접 읽는다: 웹훅 서명 확인 때문에 JSON 파서를 거치지 않는다)
  const board = app.get(BoardService);
  app.use('/board/api', (req: express.Request, res: express.Response) => {
    req.url = req.url.startsWith('/healthz') ? req.url : '/api' + req.url;   // 보드 코드의 경로는 /api/… 와 /healthz
    board.handle(req, res);
  });

  // React 빌드(public) + SPA fallback — /dashapi·/mxtest 밖의 GET 은 화면
  if (existsSync(pub)) {
    app.use(express.static(pub, { index: false, maxAge: '1h' }));
    // 보드 화면은 콘솔 안으로 들어왔다(#148) — 따로 빌드하지 않는다.
    // 옛 주소(/board, /board/, 북마크·메일에 남은 링크)는 콘솔의 업무 탭으로 보낸다.
    app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (req.method !== 'GET' || !/^\/board(\/|$)/.test(req.path)) return next();
      return res.redirect(301, '/#board');
    });
    app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (req.method !== 'GET' || req.path.startsWith('/dashapi')) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile('index.html', { root: pub });
    });
  }

  // 끌 때 밀린 저장을 보내고 닫는다
  let closing = false;
  for (const sig of ['SIGTERM', 'SIGINT'] as const) process.once(sig, async () => {
    if (closing) return;
    closing = true;
    await app.close().catch(() => undefined);
    await closePersist().catch((e) => console.error('[저장] 닫기 실패:', e?.message));
    process.exit(0);
  });

  await app.listen(cfg.port, '0.0.0.0');
  console.log(banner([
    'Rosie 콘솔',
    `${cfg.publicUrl}  (포트 ${cfg.port})`,
    `GitHub ${cfg.githubWeb}/${cfg.owner}${cfg.orgs.length ? ` + ${cfg.orgs.join(', ')}` : ''}`,
    `처음 관리자 ${cfg.admins.join(', ')} · 저장 ${persistInfo().driver}`,
  ]));
}
bootstrap().catch((e) => { console.error('[시작 실패]', e?.message || e); process.exit(1); });
