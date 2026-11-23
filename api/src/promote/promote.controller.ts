import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard, DeployerOnly } from '../auth/auth.guard.js';
import { sessionOf } from '../auth/session.js';
import { cfg } from '../core/config.js';
import { assertSameOrigin } from '../core/http.js';
import { PromoteService } from './promote.service.js';

@UseGuards(AuthGuard)
@Controller('dashapi/promote')
export class PromoteController {
  constructor(private readonly promote: PromoteService) {}

  @Get()
  candidates() { return this.promote.candidates(); }

  @DeployerOnly()
  @Post('schedule')
  schedule(@Req() req: Request, @Body() b: any) {
    assertSameOrigin(req);
    return this.promote.schedule(sessionOf(req)!.login, b || {});
  }

  @DeployerOnly()
  @Delete('schedule/:id')
  cancel(@Req() req: Request, @Param('id') id: string) {
    assertSameOrigin(req);
    return this.promote.cancel(sessionOf(req)!.login, id);
  }
}
