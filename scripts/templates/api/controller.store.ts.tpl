import { Body, Controller, Delete, ForbiddenException, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { __GUARD_IMPORTS__ } from '../auth/auth.guard.js';
import { sessionOf } from '../auth/session.js';
import { cfg } from '../config.js';
import { __PASCAL__Service } from './__NAME__.service.js';

// 쓰기는 콘솔 화면에서 온 요청만(다른 출처 차단)
const sameOrigin = (req: Request) => {
  const origin = req.get('origin');
  if (origin && origin !== cfg.publicUrl) throw new ForbiddenException('다른 출처에서 온 요청입니다');
};

// __TITLE__ — GET /dashapi/__NAME__ · POST(저장, 관리자·배포 담당) · DELETE /:id
@UseGuards(AuthGuard)
__GUARD_DECORATOR__@Controller('dashapi/__NAME__')
export class __PASCAL__Controller {
  constructor(private readonly svc: __PASCAL__Service) {}

  @Get()
  list() { return this.svc.list(); }

  @DeployerOnly()
  @Post()
  save(@Req() req: Request, @Body() body: any) {
    sameOrigin(req);
    return this.svc.save(sessionOf(req)!.login, body || {});
  }

  @DeployerOnly()
  @Delete(':id')
  remove(@Req() req: Request, @Param('id') id: string, @Query('rev') rev?: string) {
    sameOrigin(req);
    return this.svc.remove(sessionOf(req)!.login, id, rev === undefined ? undefined : Number(rev));
  }
}
