import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { __GUARD_IMPORTS__ } from '../auth/auth.guard.js';
import { __PASCAL__Service } from './__NAME__.service.js';

// __TITLE__ — GET /dashapi/__NAME__ (?refresh=1 이면 캐시를 건너뛴다)
@UseGuards(AuthGuard)
__GUARD_DECORATOR__@Controller('dashapi/__NAME__')
export class __PASCAL__Controller {
  constructor(private readonly svc: __PASCAL__Service) {}

  @Get()
  list(@Query('refresh') refresh?: string) { return this.svc.list(refresh === '1'); }
}
