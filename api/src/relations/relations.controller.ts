import { Body, Controller, ForbiddenException, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AdminOnly, AuthGuard } from '../auth/auth.guard.js';
import { sessionOf } from '../auth/session.js';
import { cfg, originOk } from '../config.js';
import { RelationsService } from './relations.service.js';

const sameOrigin = (req: Request) => {
  const origin = req.get('origin');
  if (!originOk(origin)) throw new ForbiddenException('다른 출처에서 온 요청입니다');
};

@UseGuards(AuthGuard)
@Controller('dashapi/relations')
export class RelationsController {
  constructor(private readonly rel: RelationsService) {}

  @Get()
  graph() { return this.rel.graph(); }

  @AdminOnly()
  @Post('decide')
  decide(@Req() req: Request, @Body() b: any) {
    sameOrigin(req);
    return this.rel.decide(sessionOf(req)!.login, Number(b?.rev), b || {});
  }

  // 다시 읽기 — 끝날 때까지 기다리지 않는다(구성요소 20여 개 × 파일 수십 개)
  @AdminOnly()
  @Post('rescan')
  rescan(@Req() req: Request, @Body() b: { keys?: string[] }) {
    sameOrigin(req);
    void this.rel.rescan(Array.isArray(b?.keys) ? b.keys.map(String) : undefined);
    return { ok: true, scanning: true };
  }
}
