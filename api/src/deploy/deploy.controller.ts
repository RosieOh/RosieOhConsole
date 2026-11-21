import { Body, Controller, ForbiddenException, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AdminOnly, AuthGuard, DeployerOnly } from '../auth/auth.guard.js';
import { sessionOf } from '../auth/session.js';
import { recentAudit } from '../audit.js';
import { cfg } from '../config.js';
import { DeployService } from './deploy.service.js';
import { resolvedAt } from './failures.js';
import { StoreAppsService } from './store-apps.service.js';
import { ApksService } from '../apks/apks.service.js';
import { recentAudit as auditTail } from '../audit.js';

@UseGuards(AuthGuard)
@Controller('dashapi/deploy')
export class DeployController {
  constructor(private readonly deploy: DeployService, private readonly storeApps: StoreAppsService, private readonly apks: ApksService) {}

  @Get()
  async overview(@Query('refresh') refresh?: string) {
    return this.deploy.overview(refresh === '1');
  }

  @Get('store-apps')
  async store(@Query('refresh') refresh?: string) {
    return { apps: await this.storeApps.list(refresh === '1') };
  }

  // 배포 이력 — 모든 서비스·환경의 배포·되돌리기·부모앱 릴리스·APK 릴리스를 한 표로
  @Get('history')
  async history() {
    const ov = await this.deploy.overview();
    const rows: any[] = [];
    const dur = (a?: string | null, b?: string | null) => (a && b ? Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 1000)) : null);
    for (const sv of ov.services) for (const env of ['testbed', 'prod'] as const) {
      const runs = this.deploy.allRuns.get(`${sv.key}:${env}`) ?? [];
      const fixed = resolvedAt(runs);
      for (const r of runs) {
        rows.push({ id: `${sv.repo}#${r.id}:${sv.key}`, comp: sv.key, repo: sv.repo, env, kind: r.action === 'rollback' ? '되돌리기' : '배포', version: r.version ?? null,
          state: r.state, actor: r.actor, at: r.at, ended: r.ended ?? null, sec: dur(r.at, r.ended), url: r.url, number: r.number, runId: r.id, workflow: r.workflow, event: r.event, warn: r.warn ?? null, resolved: fixed.get(r.id) ?? null });
      }
    }
    for (const a of await this.storeApps.list()) for (const r of a.history) {
      if (r.lane === 'dry-run') continue;
      rows.push({ id: `${a.repo}#${r.id}:${a.key}`, comp: a.key, repo: a.repo, env: 'release', kind: r.lane === 'ota' ? 'OTA' : r.lane === 'store' ? '스토어 업로드' : r.lane === 'none' ? '변경 없음' : '릴리스',
        version: null, state: r.state, actor: r.actor, at: r.at, ended: null, sec: null, url: r.url, number: r.number, runId: r.id, workflow: a.workflow, event: r.event, warn: null });
    }
    for (const a of await this.apks.list()) for (const rel of a.releases) {
      rows.push({ id: `${a.repo}@${rel.tag}:${a.key}`, comp: a.key, repo: a.repo, env: 'apk', kind: 'APK 릴리스', version: rel.tag, state: 'success', actor: '', at: rel.date, ended: null, sec: null,
        url: rel.buildUrl || rel.url, number: null, runId: Number(rel.buildUrl?.match(/runs\/(\d+)/)?.[1]) || null, workflow: 'release-apk.yml', event: '', warn: null });
    }
    rows.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const audit = (await auditTail(200)).filter((e) => /^(rollback|promote)/.test(e.action));
    return { rows, audit, updatedAt: ov.updatedAt };
  }

  // 되돌리기 목록의 버전 설명 — 들어온 변경·되돌리면 빠지는 변경
  @Get('versions')
  async versions(@Query('service') service = '', @Query('env') env = '') {
    return this.deploy.versionNotes(service, env);
  }

  @Get('audit')
  async audit() {
    return { entries: await recentAudit(50) };
  }

  @DeployerOnly()
  @Post('rollback')
  async rollback(@Req() req: Request, @Body() body: any) {
    // 다른 사이트에서 몰래 보내는 요청 막기 — 콘솔 화면에서 온 것만
    const origin = req.get('origin');
    if (origin && origin !== cfg.publicUrl) throw new ForbiddenException('다른 출처에서 온 요청입니다');
    return this.deploy.rollback(sessionOf(req)!.login, body || {});
  }

  // 되돌리기 하한 지정·해제 — 관리자만
  @AdminOnly()
  @Post('floor')
  async floor(@Req() req: Request, @Body() body: any) {
    const origin = req.get('origin');
    if (origin && origin !== cfg.publicUrl) throw new ForbiddenException('다른 출처에서 온 요청입니다');
    return this.deploy.setFloor(sessionOf(req)!.login, body || {});
  }
}
