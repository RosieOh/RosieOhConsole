import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { RunnersService } from './runners.service.js';

@UseGuards(AuthGuard)
@Controller('dashapi/runners')
export class RunnersController {
  constructor(private readonly runners: RunnersService) {}

  @Get()
  async view(@Query('refresh') refresh?: string) {
    return this.runners.view(refresh === '1');
  }

  // 개요 배너용 — 가벼운 경고만
  @Get('alerts')
  async alerts() {
    const v = await this.runners.view();
    return { alerts: v.alerts, updatedAt: v.updatedAt };
  }
}
