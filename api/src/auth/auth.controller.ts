import { Body, Controller, ForbiddenException, Get, HttpException, Post, Query, Req, Res } from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { cfg, secureCookie, originOk } from '../config.js';
import { audit } from '../audit.js';
import { AccountError, githubLogin, linkGithub, passwordLogin, signup } from '../accounts/accounts.js';
import { authorizeUrl, exchangeCode, whoAmI } from './github-oauth.js';
import { SESSION_COOKIE, STATE_COOKIE, TTL_MS, sessionOf, signSession } from './session.js';

const cookieOpts = () => ({ httpOnly: true, secure: secureCookie(), sameSite: 'lax' as const, path: '/' });
const sameOrigin = (req: Request) => {
  const origin = req.get('origin');
  if (!originOk(origin)) throw new ForbiddenException('다른 출처에서 온 요청입니다');
};
/** 계정 오류 → HTTP 오류(화면이 code 로 갈래를 탄다) */
export const httpOf = (e: unknown) => (e instanceof AccountError ? new HttpException({ message: e.message, code: e.code }, e.status) : e);

export function giveSession(res: Response, login: string, sv: number) {
  res.cookie(SESSION_COOKIE, signSession(login, sv), { ...cookieOpts(), maxAge: TTL_MS });
}

@Controller('dashapi')
export class AuthController {
  // GitHub 로그인 화면으로. mode=link 면 로그인한 사람의 계정에 GitHub 을 연결한다(마이페이지)
  @Get('login')
  login(@Query('mode') mode: string, @Req() req: Request, @Res() res: Response) {
    const link = mode === 'link';
    if (link && !sessionOf(req)) return res.redirect('/?login=expired');
    const state = randomBytes(16).toString('hex') + (link ? '.link' : '');
    res.cookie(STATE_COOKIE, state, { ...cookieOpts(), maxAge: 10 * 60 * 1000 });
    res.redirect(authorizeUrl(state));
  }

  // GitHub 이 돌려보낸 곳 — 신원 확인 → (연결 | 로그인·가입 요청) → 세션 쿠키
  @Get('oauth/callback')
  async callback(@Query('code') codeQ: unknown, @Query('state') stateQ: unknown, @Req() req: Request, @Res() res: Response) {
    // 같은 이름을 여러 번 보내면 배열이 된다 — 문자열 하나가 아니면 받지 않는다
    const code = typeof codeQ === 'string' ? codeQ : '';
    const state = typeof stateQ === 'string' ? stateQ : '';
    const want = String(req.cookies?.[STATE_COOKIE] || '');
    res.clearCookie(STATE_COOKIE, cookieOpts());
    const ok = want && state && want.length === state.length && timingSafeEqual(Buffer.from(want), Buffer.from(state));
    if (!ok || !code) return res.redirect('/?login=expired');
    let gh: string;
    try { gh = await whoAmI(await exchangeCode(code)); }
    catch (e: any) { console.warn('[로그인] GitHub 확인 실패:', e?.message); return res.redirect('/?login=failed'); }

    if (state.endsWith('.link')) {
      const s = sessionOf(req);
      if (!s) return res.redirect('/?login=expired');
      try {
        linkGithub(s.login, gh);
        await audit({ login: s.login, action: 'account.github.link', target: gh, ok: true });
        return res.redirect('/#account?github=linked');
      } catch (e: any) {
        return res.redirect('/#account?github=' + encodeURIComponent(e instanceof AccountError ? e.code : 'failed'));
      }
    }

    try {
      const a = githubLogin(gh, req.ip || '?');
      giveSession(res, a.login, a.sv);
      return res.redirect('/');
    } catch (e: any) {
      if (e instanceof AccountError) {
        if (e.code === 'pending') await audit({ login: gh, action: 'account.signup.github', target: gh, detail: '승인 대기', ok: true });
        return res.redirect('/?login=' + encodeURIComponent(e.code));
      }
      console.warn('[로그인] 실패:', e?.message);
      return res.redirect('/?login=failed');
    }
  }

  // 아이디·비밀번호 로그인
  @Post('auth/login')
  passwordLogin(@Body() b: { login?: string; password?: string }, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    sameOrigin(req);
    try {
      const a = passwordLogin(String(b?.login ?? ''), String(b?.password ?? ''), req.ip || '?');
      giveSession(res, a.login, a.sv);
      return { ok: true, login: a.login };
    } catch (e) { throw httpOf(e); }
  }

  // 회원가입 — 승인 대기로 남는다(세션은 주지 않는다)
  @Post('auth/signup')
  async signup(@Body() b: { login?: string; name?: string; email?: string; password?: string }, @Req() req: Request) {
    sameOrigin(req);
    try {
      const a = signup(b || {}, req.ip || '?');
      await audit({ login: a.login, action: 'account.signup', target: a.login, detail: `승인 대기, ${req.ip}`, ok: true });
      return { ok: true, login: a.login, status: a.status };
    } catch (e) { throw httpOf(e); }
  }

  @Post('logout')
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    sameOrigin(req);   // 다른 사이트가 몰래 로그아웃시키지 못하게
    res.clearCookie(SESSION_COOKIE, cookieOpts());
    return { ok: true };
  }

  // SPA 가 로그인 여부·누구인지 확인
  @Get('me')
  me(@Req() req: Request) {
    const s = sessionOf(req);
    return s ? { authenticated: true, login: s.login, name: s.name, role: s.role, admin: s.admin, deployer: s.deployer } : { authenticated: false };
  }
}
