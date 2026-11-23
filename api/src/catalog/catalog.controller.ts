import { BadRequestException, Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AdminOnly, AuthGuard } from '../auth/auth.guard.js';
import { sessionOf } from '../auth/session.js';
import { cfg } from '../core/config.js';
import { assertSameOrigin } from '../core/http.js';
import { CatalogOp, CatalogService } from './catalog.service.js';

@UseGuards(AuthGuard)
@Controller('dashapi/catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  get() { return this.catalog.view(); }

  @AdminOnly()
  @Post('ops')
  ops(@Req() req: Request, @Body() b: { rev: number; ops: CatalogOp[] }) {
    assertSameOrigin(req);
    return this.catalog.apply(sessionOf(req)!.login, Number(b?.rev), b?.ops);
  }

  // 구성요소 추가에서 고를 조직 저장소 목록
  @AdminOnly()
  @Get('repos')
  async repos(@Query('refresh') refresh?: string) {
    return { repos: await this.catalog.repos(refresh === '1') };
  }

  @AdminOnly()
  @Get('logo-candidates')
  async candidates(@Query('repo') repo: string, @Query('refresh') refresh?: string) {
    return { candidates: await this.catalog.candidates(String(repo || ''), refresh === '1') };
  }

  // 로고 올리기 — data: base64(또는 data URL)
  @AdminOnly()
  @Post('logo')
  upload(@Req() req: Request, @Body() b: { data?: string }) {
    assertSameOrigin(req);
    const raw = String(b?.data || '').replace(/^data:[^,]*,/, '');
    if (!raw) throw new BadRequestException('파일이 없습니다');
    try { return { file: this.catalog.saveLogo(Buffer.from(raw, 'base64')) }; }
    catch (e: any) { throw new BadRequestException(e?.message); }
  }
}
