import { Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';

// 업무보드 — 예전 서버(사내 Git 서버의 이슈·라벨 기반 board-core)는 걷어냈다.
// GitHub Issues·Projects 기반으로 다시 만들 때까지 /board/api/* 는 503 을 돌려준다. 화면(web/src/board)은 남아 있다.
@Injectable()
export class BoardService {
  get enabled() { return false; }

  handle(_req: Request, res: Response) {
    res.status(503).json({ ok: false, error: '업무보드는 GitHub 연동으로 다시 만드는 중입니다' });
  }
}
