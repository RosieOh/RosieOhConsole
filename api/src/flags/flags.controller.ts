import { Body, Controller, ForbiddenException, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard, DeployerOnly } from '../auth/auth.guard.js';
import { sessionOf } from '../auth/session.js';
import { cfg, originOk } from '../config.js';
import { FlagsService } from './flags.service.js';

@UseGuards(AuthGuard)
@Controller('dashapi/flags')
export class FlagsController {
  constructor(private readonly flags: FlagsService) {}

  @Get()
  list(@Query('refresh') refresh?: string) { return this.flags.list(refresh === '1'); }

  // 흐름 도식 배지 — 서비스·환경별 켜진 스위치 수
  @Get('summary')
  summary() { return this.flags.summary(); }

  @DeployerOnly()
  @Post()
  set(@Req() req: Request, @Body() body: any) {
    const origin = req.get('origin');
    if (!originOk(origin)) throw new ForbiddenException('다른 출처에서 온 요청입니다');
    return this.flags.set(sessionOf(req)!.login, body || {});
  }
}
