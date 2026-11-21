import { Body, Controller, ForbiddenException, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AdminOnly, AuthGuard } from '../auth/auth.guard.js';
import { sessionOf } from '../auth/session.js';
import { cfg } from '../config.js';
import { SecretsService } from './secrets.service.js';

const sameOrigin = (req: Request) => {
  const origin = req.get('origin');
  if (origin && origin !== cfg.publicUrl) throw new ForbiddenException('다른 출처에서 온 요청입니다');
};

// 시크릿·변수 — 보기는 로그인한 누구나(이름·사용처·권한만, 값 없음), 바꾸기는 관리자
@UseGuards(AuthGuard)
@Controller('dashapi/secrets')
export class SecretsController {
  constructor(private readonly secrets: SecretsService) {}

  @Get()
  async overview(@Query('refresh') refresh?: string) {
    return this.secrets.overview(refresh === '1');
  }

  @AdminOnly()
  @Post('set')
  async set(@Req() req: Request, @Body() b: any) {
    sameOrigin(req);
    return this.secrets.set(sessionOf(req)!.login, b || {});
  }

  @AdminOnly()
  @Post('delete')
  async remove(@Req() req: Request, @Body() b: any) {
    sameOrigin(req);
    return this.secrets.remove(sessionOf(req)!.login, b || {});
  }
}
