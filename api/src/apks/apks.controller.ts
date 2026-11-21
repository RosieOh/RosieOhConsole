import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpException, NotFoundException, Param, ParseIntPipe, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { sessionOf } from '../auth/session.js';
import { cfg, originOk } from '../config.js';
import { ApksService } from './apks.service.js';
import { contentDisposition, rateLimiter } from './release.js';
import { WHO_RE } from './knox.js';

// 로그인 없이 쓴다(사용자 요청 2026-10-12) — 목록·다운로드 모두. 받은 기록은 아이디(있으면)와 IP 로 남긴다
const allow = rateLimiter(30);

@Controller('dashapi/apks')
export class ApksController {
  constructor(private readonly apks: ApksService) {}

  @Get()
  async list(@Query('refresh') refresh?: string) {
    return { apps: await this.apks.list(refresh === '1') };
  }

  // 버전별 바뀐 점(로그인 없이)
  @Get(':repo/changes')
  async changes(@Param('repo') repo: string, @Query('tag') tag: string) {
    try { return await this.apks.changes(repo, String(tag || '')); } catch (e: any) { throw new NotFoundException(e?.message); }
  }

  // 업데이트 내역에서 고를 버전들(보관함에 파일이 없는 옛 버전 포함, 로그인 없이)
  @Get(':repo/versions')
  async versions(@Param('repo') repo: string) {
    try { return await this.apks.versions(repo); } catch (e: any) { throw new NotFoundException(e?.message); }
  }

  // 녹스 적용 표시 — 비개발자 담당자도 쓰므로 로그인 없이 가능(이름 입력), 로그인했으면 아이디로
  @Post(':repo/knox')
  async knox(@Param('repo') repo: string, @Body() b: { tag?: string; by?: string; undo?: boolean }, @Req() req: Request) {
    const origin = req.get('origin');
    if (!originOk(origin)) throw new ForbiddenException('다른 출처에서 온 요청입니다');
    const by = sessionOf(req)?.login ?? String(b?.by || '').trim();
    if (!WHO_RE.test(by)) throw new BadRequestException('이름을 입력하세요');
    try { await this.apks.markKnox(repo, String(b?.tag || ''), sessionOf(req) ? by : `${by}(${req.ip})`, !!b?.undo); }
    catch (e: any) { throw new BadRequestException(e?.message); }
    return { ok: true };
  }

  // 출고 기록 — 보기는 로그인 없이, 고치기는 로그인한 사람만
  @Get(':repo/shipped')
  async shipped(@Param('repo') repo: string) {
    try { return await this.apks.shippedList(repo); } catch (e: any) { throw new NotFoundException(e?.message); }
  }

  @Post(':repo/shipped')
  async saveShipped(@Param('repo') repo: string, @Body() b: { from?: string; rec?: any; remove?: boolean; rev?: number }, @Req() req: Request) {
    const s = sessionOf(req);
    if (!s) throw new ForbiddenException('로그인한 사람만 출고 기록을 고칠 수 있습니다');
    const origin = req.get('origin');
    if (!originOk(origin)) throw new ForbiddenException('다른 출처에서 온 요청입니다');
    try { return await this.apks.saveShipped(repo, b?.from ? String(b.from) : null, b?.remove ? null : b?.rec ?? {}, s.login, typeof b?.rev === 'number' ? b.rev : undefined); }
    catch (e: any) { throw new BadRequestException(e?.message); }
  }

  // 버전 메모 — 로그인한 사람만
  @Post(':repo/note')
  async note(@Param('repo') repo: string, @Body() b: { tag?: string; text?: string }, @Req() req: Request) {
    const s = sessionOf(req);
    if (!s) throw new ForbiddenException('로그인한 사람만 메모를 쓸 수 있습니다');
    const origin = req.get('origin');
    if (!originOk(origin)) throw new ForbiddenException('다른 출처에서 온 요청입니다');
    try { await this.apks.setNote(repo, String(b?.tag || ''), String(b?.text ?? ''), s.login); } catch (e: any) { throw new BadRequestException(e?.message); }
    return { ok: true };
  }

  // 비공개 저장소의 릴리스 파일은 브라우저가 바로 못 받는다 — 콘솔이 읽기 토큰으로 받아 그대로 흘려보낸다(공개 저장소도 같은 길)
  @Get(':repo/:assetId/download')
  async download(@Param('repo') repo: string, @Param('assetId', ParseIntPipe) assetId: number, @Req() req: Request, @Res() res: Response) {
    if (!allow(req.ip || '?')) throw new HttpException('잠시 뒤 다시 받으세요, 1분에 30번까지입니다', 429);
    const hit = await this.apks.find(repo, assetId);
    if (!hit) throw new NotFoundException('APK 를 찾지 못했다');

    const ac = new AbortController();
    const headerTimer = setTimeout(() => ac.abort(), 15000);
    res.on('close', () => ac.abort());
    let up: globalThis.Response;
    try {
      up = await fetch(hit.url, { headers: { Accept: 'application/octet-stream', ...(cfg.githubToken ? { Authorization: `Bearer ${cfg.githubToken}` } : {}) }, signal: ac.signal });
    } catch {
      clearTimeout(headerTimer);
      if (!res.headersSent) res.status(502).json({ message: 'GitHub 에서 APK 를 받지 못했다' });
      return;
    }
    clearTimeout(headerTimer);
    if (!up.ok || !up.body) {
      res.status(502).json({ message: `GitHub 이 HTTP ${up.status} 로 답했다` });
      return;
    }

    console.log(`[APK] ${sessionOf(req)?.login ?? '-'}@${req.ip} ← ${repo} ${hit.release.tag} ${hit.asset.name}`);
    // 내부 테스트 빌드는 QA 상태(녹스) 와 상관없어 받은 기록을 남기지 않는다
    if (!hit.test) try { this.apks.recordDownload(repo, hit.release.tag, sessionOf(req)?.login ?? `IP ${req.ip}`); } catch { /* 기록 실패해도 받기는 된다 */ }
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', contentDisposition(hit.asset.name));
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const len = up.headers.get('content-length');
    if (len) res.setHeader('Content-Length', len);
    if (hit.release.sha256) res.setHeader('X-Apk-Sha256', hit.release.sha256);
    try {
      await pipeline(Readable.fromWeb(up.body as any), res);
    } catch {
      /* 받는 쪽이 끊었다 — 더 할 일 없음 */
    }
  }
}
