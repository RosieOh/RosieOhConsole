import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { audit } from '../audit.js';
import { AdminOnly, AuthGuard } from '../auth/auth.guard.js';
import { sessionOf } from '../auth/session.js';
import { cfg, originOk } from '../config.js';
import { RevConflict } from '../json-store.js';
import { LOGIN_RE, Role, listAccess, roleOf, setRole } from './access.js';

const sameOrigin = (req: Request) => {
  const origin = req.get('origin');
  if (!originOk(origin)) throw new ForbiddenException('다른 출처에서 온 요청입니다');
};

// 프로필 사진은 GitHub 의 공개 주소로 — API 호출 없이
const avatarOf = (login: string) => `${cfg.githubWeb}/${encodeURIComponent(login)}.png?size=80`;
const known = () => {
  const a = listAccess();
  return { a, logins: [...new Set([...a.roots, ...Object.keys(a.users)])].sort() };
};

// 사람 표시용(프로필 사진·이름) — 로그인한 누구나
@UseGuards(AuthGuard)
@Controller('dashapi/users')
export class UsersController {
  @Get()
  list() {
    return { users: known().logins.map((login) => ({ login, fullName: '', avatar: avatarOf(login) })) };
  }
}

@UseGuards(AuthGuard)
@AdminOnly()
@Controller('dashapi/access')
export class AccessController {
  @Get()
  list() {
    const { a, logins } = known();
    const people = logins.map((login) => {
      const u = a.users[login];
      return {
        login, fullName: '', avatar: avatarOf(login), email: '', member: true,
        role: roleOf(login), root: a.roots.includes(login), board: null,
        by: u?.by ?? null, at: u?.at ?? null,
      };
    });
    return { rev: a.rev, people, boardEnabled: false, warning: a.warning };
  }

  /** 사람 추가·역할 바꾸기. role 'none' 이면 명단에서 뺀다(로그인 못 함) */
  @Put(':login')
  async set(@Req() req: Request, @Param('login') login: string, @Body() b: { role?: Role | 'none'; rev?: number }) {
    sameOrigin(req);
    const me = sessionOf(req)!.login;
    if (!LOGIN_RE.test(login)) throw new BadRequestException('GitHub 아이디 형식이 아닙니다');
    let rev: number | undefined;
    if (b.role !== undefined) {
      try { rev = setRole(me, login, b.role, b.rev).rev; }
      catch (e: any) {
        if (e instanceof RevConflict) throw new ConflictException(e.message);
        throw new BadRequestException(e?.message);
      }
      await audit({ login: me, action: 'access.role', target: login, detail: b.role, ok: true });
    }
    return { ok: true, rev: rev ?? listAccess().rev, role: roleOf(login), board: null };
  }
}
