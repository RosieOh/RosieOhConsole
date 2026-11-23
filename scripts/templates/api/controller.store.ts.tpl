import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { __GUARD_IMPORTS__ } from '../auth/auth.guard.js';
import { sessionOf } from '../auth/session.js';
import { assertSameOrigin } from '../core/http.js';
import { __PASCAL__Service } from './__NAME__.service.js';

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
    assertSameOrigin(req);   // 쓰기는 콘솔 화면에서 온 요청만(다른 출처 차단)
    return this.svc.save(sessionOf(req)!.login, body || {});
  }

  @DeployerOnly()
  @Delete(':id')
  remove(@Req() req: Request, @Param('id') id: string, @Query('rev') rev?: string) {
    assertSameOrigin(req);   // 쓰기는 콘솔 화면에서 온 요청만(다른 출처 차단)
    return this.svc.remove(sessionOf(req)!.login, id, rev === undefined ? undefined : Number(rev));
  }
}
