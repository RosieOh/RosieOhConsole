import { BadRequestException, Body, ConflictException, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { audit } from '../core/audit.js';
import { AdminOnly, AuthGuard } from '../auth/auth.guard.js';
import { sessionOf } from '../auth/session.js';
import { cfg } from '../core/config.js';
import { assertSameOrigin } from '../core/http.js';
import { RevConflict } from '../core/json-store.js';
import { BuildNotifyChange, buildRecipients, changeBuildNotify, getBuildNotify } from './build-notify.js';

// 가드는 핸들러마다 단다. 빌드가 읽는 recipients 는 APK 목록처럼 로그인 없이 연다(#187)
@Controller('dashapi/build-notify')
export class BuildNotifyController {
  @Get('recipients')
  recipients() {
    return buildRecipients();
  }

  @Get()
  @UseGuards(AuthGuard)
  @AdminOnly()
  get() {
    return getBuildNotify();
  }

  @Put()
  @UseGuards(AuthGuard)
  @AdminOnly()
  async change(@Req() req: Request, @Body() b: BuildNotifyChange & { rev?: number }) {
    assertSameOrigin(req);
    const me = sessionOf(req)!.login;
    const body = b ?? {};
    try { changeBuildNotify(me, body, body.rev); }
    catch (e: any) {
      if (e instanceof RevConflict) throw new ConflictException(e.message);
      throw new BadRequestException(e?.message);
    }
    const detail = body.add ? `추가 ${body.add}` : body.remove ? `빼기 ${body.remove}` : `보내기 ${body.on ? '켬' : '끔'}`;
    await audit({ login: me, action: 'build-notify', target: 'build-notify', detail, ok: true });
    return getBuildNotify();
  }
}
