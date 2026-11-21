import { Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { secureCookie } from '../config.js';
import { isAllowed } from '../access/access.js';
import { authorizeUrl, exchangeCode, whoAmI } from './github-oauth.js';
import { SESSION_COOKIE, STATE_COOKIE, TTL_MS, sessionOf, signSession } from './session.js';

const cookieOpts = () => ({ httpOnly: true, secure: secureCookie(), sameSite: 'lax' as const, path: '/' });

@Controller('dashapi')
export class AuthController {
  // 로그인 버튼 → GitHub 로그인 화면
  @Get('login')
  login(@Res() res: Response) {
    const state = randomBytes(16).toString('hex');
    res.cookie(STATE_COOKIE, state, { ...cookieOpts(), maxAge: 10 * 60 * 1000 });
    res.redirect(authorizeUrl(state));
  }

  // GitHub 이 돌려보낸 곳 — 신원 확인 → 허용 명단 확인 → 세션 쿠키
  @Get('oauth/callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Req() req: Request, @Res() res: Response) {
    const want = String(req.cookies?.[STATE_COOKIE] || '');
    res.clearCookie(STATE_COOKIE, cookieOpts());
    const ok = want && state && want.length === state.length && timingSafeEqual(Buffer.from(want), Buffer.from(state));
    if (!ok || !code) return res.redirect('/?login=expired');
    try {
      const login = await whoAmI(await exchangeCode(code));
      if (!isAllowed(login)) return res.redirect('/?login=forbidden');
      res.cookie(SESSION_COOKIE, signSession(login), { ...cookieOpts(), maxAge: TTL_MS });
      return res.redirect('/');
    } catch (e: any) {
      console.warn('[로그인] 실패:', e?.message);
      return res.redirect('/?login=failed');
    }
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(SESSION_COOKIE, cookieOpts());
    return { ok: true };
  }

  // SPA 가 로그인 여부·누구인지 확인
  @Get('me')
  me(@Req() req: Request) {
    const s = sessionOf(req);
    return s ? { authenticated: true, login: s.login, role: s.role, admin: s.admin, deployer: s.deployer } : { authenticated: false };
  }
}
