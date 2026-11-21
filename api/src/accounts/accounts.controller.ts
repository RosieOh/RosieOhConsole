import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { audit } from '../audit.js';
import { AdminOnly, AuthGuard } from '../auth/auth.guard.js';
import { giveSession, httpOf } from '../auth/auth.controller.js';
import { sessionOf } from '../auth/session.js';
import { cfg, originOk } from '../config.js';
import {
  ADMIN_ACTIONS, AdminAction, adminAction, bumpSession, changePassword, listAccounts, myPage, publicAccount, unlinkGithub, updateProfile, withdraw,
} from './accounts.js';

const sameOrigin = (req: Request) => {
  const origin = req.get('origin');
  if (!originOk(origin)) throw new ForbiddenException('다른 출처에서 온 요청입니다');
};
const me = (req: Request) => sessionOf(req)!.login;

// 마이페이지 — 로그인한 본인 것만
@UseGuards(AuthGuard)
@Controller('dashapi/account')
export class AccountController {
  @Get()
  view(@Req() req: Request) {
    try { return myPage(me(req)); } catch (e) { throw httpOf(e); }
  }

  @Put()
  async update(@Req() req: Request, @Body() b: { name?: string; email?: string }) {
    sameOrigin(req);
    try {
      const a = updateProfile(me(req), b || {});
      await audit({ login: a.login, action: 'account.profile', target: a.login, ok: true });
      return a;
    } catch (e) { throw httpOf(e); }
  }

  // 비밀번호 바꾸기·정하기 — 다른 기기는 끊기고 이 기기는 새 쿠키로 이어진다
  @Post('password')
  async password(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() b: { current?: string; next?: string }) {
    sameOrigin(req);
    try {
      const login = me(req);
      giveSession(res, login, changePassword(login, b || {}));
      await audit({ login, action: 'account.password', target: login, ok: true });
      return { ok: true };
    } catch (e) { throw httpOf(e); }
  }

  @Post('logout-others')
  async logoutOthers(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    sameOrigin(req);
    try {
      const login = me(req);
      giveSession(res, login, bumpSession(login));
      await audit({ login, action: 'account.logout-others', target: login, ok: true });
      return { ok: true };
    } catch (e) { throw httpOf(e); }
  }

  @Delete('github')
  async unlink(@Req() req: Request) {
    sameOrigin(req);
    try {
      const login = me(req);
      unlinkGithub(login);
      await audit({ login, action: 'account.github.unlink', target: login, ok: true });
      return { ok: true };
    } catch (e) { throw httpOf(e); }
  }

  // 탈퇴 — 쿠키도 지운다
  @Post('withdraw')
  async withdraw(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() b: { password?: string; confirm?: string }) {
    sameOrigin(req);
    try {
      const login = me(req);
      withdraw(login, b || {});
      res.clearCookie('mxc', { path: '/' });
      await audit({ login, action: 'account.withdraw', target: login, ok: true });
      return { ok: true };
    } catch (e) { throw httpOf(e); }
  }
}

// 회원 관리 — 관리자
@UseGuards(AuthGuard)
@AdminOnly()
@Controller('dashapi/accounts')
export class AccountsAdminController {
  @Get()
  list() {
    return { accounts: listAccounts().map((a) => ({ ...publicAccount(a), lastFail: (a.history || []).find((h) => !h.ok) ?? null })) };
  }

  @Post(':login/:action')
  async act(@Req() req: Request, @Param('login') login: string, @Param('action') action: string) {
    sameOrigin(req);
    if (!ADMIN_ACTIONS.includes(action as AdminAction)) throw new BadRequestException(`조치는 ${ADMIN_ACTIONS.join(', ')} 입니다`);
    const by = me(req);
    try {
      const r = adminAction(by, login, action as AdminAction);
      await audit({ login: by, action: `account.${action}`, target: login, ok: true });   // 임시 비밀번호는 남기지 않는다
      return { ok: true, ...r };
    } catch (e) {
      await audit({ login: by, action: `account.${action}`, target: login, detail: (e as Error)?.message, ok: false });
      throw httpOf(e);
    }
  }
}
