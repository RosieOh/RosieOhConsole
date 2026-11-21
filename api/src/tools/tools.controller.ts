import { Controller, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { ToolsService } from './tools.service.js';

@UseGuards(AuthGuard)
@Controller('dashapi/tools')
export class ToolsController {
  constructor(private readonly tools: ToolsService) {}

  @Get()
  async list(@Query('refresh') refresh?: string) {
    return { repos: await this.tools.list(refresh === '1') };
  }

  @Get(':name/readme')
  async readme(@Param('name') name: string) {
    try { return { name, markdown: await this.tools.readme(name) }; }
    catch { throw new NotFoundException('README 를 찾지 못했다'); }
  }
}
