import { Body, Controller, Delete, ForbiddenException, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard, DeployerOnly } from '../auth/auth.guard.js';
import { sessionOf } from '../auth/session.js';
import { cfg, originOk } from '../config.js';
import { PromoteService } from './promote.service.js';

const sameOrigin = (req: Request) => {
  const origin = req.get('origin');
  if (!originOk(origin)) throw new ForbiddenException('다른 출처에서 온 요청입니다');
};

@UseGuards(AuthGuard)
@Controller('dashapi/promote')
export class PromoteController {
  constructor(private readonly promote: PromoteService) {}

  @Get()
  candidates() { return this.promote.candidates(); }

  @DeployerOnly()
  @Post('schedule')
  schedule(@Req() req: Request, @Body() b: any) {
    sameOrigin(req);
    return this.promote.schedule(sessionOf(req)!.login, b || {});
  }

  @DeployerOnly()
  @Delete('schedule/:id')
  cancel(@Req() req: Request, @Param('id') id: string) {
    sameOrigin(req);
    return this.promote.cancel(sessionOf(req)!.login, id);
  }
}
