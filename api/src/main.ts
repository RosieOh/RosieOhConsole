import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import express from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AppModule } from './app.module.js';
import { BoardService } from './board/board.service.js';
import { assertConfig, cfg } from './config.js';
import { testbedProxy } from './testbed-proxy.js';

async function bootstrap() {
  assertConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.set('trust proxy', 1);   // 리버스 프록시 뒤
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
  const pub = fileURLToPath(new URL('../public', import.meta.url));
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

  await app.listen(cfg.port, '0.0.0.0');
  console.log(`rosie-console, 포트 ${cfg.port}, 주소 ${cfg.publicUrl}, GitHub ${cfg.githubWeb}/${cfg.owner}, 처음 관리자 ${cfg.admins.join(',')}`);
}
bootstrap();
