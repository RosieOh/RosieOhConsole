import { Body, Controller, ForbiddenException, Get, Headers, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard, DeployerOnly } from '../auth/auth.guard.js';
import { sessionOf } from '../auth/session.js';
import { cfg } from '../config.js';
import { RelationsService } from '../relations/relations.service.js';
import { ServersService } from './servers.service.js';

const sameOrigin = (req: Request) => {
  const origin = req.get('origin');
  if (origin && origin !== cfg.publicUrl) throw new ForbiddenException('다른 출처에서 온 요청입니다');
};

// 받는 쪽 — 로그인 없이, PROBE_TOKEN 으로(본문은 main.ts 에서 text 로 읽는다)
@Controller('dashapi/probe')
export class ProbeIngestController {
  constructor(private readonly servers: ServersService) {}
  @Post('ingest')
  @HttpCode(200)   // 점검 템플릿은 200 만 성공으로 본다
  ingest(@Headers('authorization') auth: string, @Query() q: any, @Req() req: Request) {
    return this.servers.ingest(auth, q, typeof (req as any).body === 'string' ? (req as any).body : '');
  }
}

@UseGuards(AuthGuard)
@Controller('dashapi/servers')
export class ServersController {
  constructor(private readonly servers: ServersService, private readonly rel: RelationsService) {}

  @Get()
  list() {
    const r = this.servers.list();
    const named = this.rel.infraNames();
    return { ...r, servers: r.servers.map((s) => ({ ...s, ...named.get(s.id) })) };
  }

  @Post(':id/probe')
  probe(@Req() req: Request, @Param('id') id: string) {
    sameOrigin(req);
    return this.servers.request(sessionOf(req)!.login, id, 'probe');
  }

  // 로그 — 운영 로그엔 개인정보가 있을 수 있어 관리자·배포 담당만(가린 뒤에도)
  @DeployerOnly()
  @Post(':id/logs')
  requestLogs(@Req() req: Request, @Param('id') id: string, @Body() b: { target?: string; lines?: number }) {
    sameOrigin(req);
    return this.servers.request(sessionOf(req)!.login, id, 'logs', String(b?.target || ''), '', Number(b?.lines) || 300);
  }

  @DeployerOnly()
  @Get(':id/logs')
  logs(@Param('id') id: string, @Query('target') target: string) { return this.servers.logsOf(id, String(target || '')); }

  @DeployerOnly()
  @Post(':id/restart')
  restart(@Req() req: Request, @Param('id') id: string, @Body() b: { target?: string; confirm?: string }) {
    sameOrigin(req);
    return this.servers.request(sessionOf(req)!.login, id, 'restart', String(b?.target || ''), String(b?.confirm || ''));
  }
}
