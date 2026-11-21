import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { Role, canDeploy, isAllowed, roleOf } from '../access/access.js';
import { cfg } from '../config.js';
import { getAccount } from '../accounts/accounts.js';

// 세션 쿠키 — 로그인 아이디와 세션 판 번호(v)만 싣는다(GitHub 토큰·비밀번호는 싣지 않는다).
// 계정의 sv 가 쿠키의 v 와 다르면(비밀번호 변경·다른 기기 로그아웃·정지) 그 쿠키는 끊긴다.
export const SESSION_COOKIE = 'mxc';
export const STATE_COOKIE = 'mxc_state';
export const TTL_MS = 12 * 3600 * 1000;

export interface Session { login: string; name: string; role: Role; admin: boolean; deployer: boolean }

const mac = (body: string) => createHmac('sha256', cfg.sessionSecret).update(body).digest('base64url');

export function signSession(login: string, v = 0, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ login, v, exp: now + TTL_MS })).toString('base64url');
  return `${body}.${mac(body)}`;
}

export function readSession(value: string | undefined, now = Date.now()): Session | null {
  if (!value || !cfg.sessionSecret) return null;
  const [body, sig] = value.split('.');
  if (!body || !sig) return null;
  const want = Buffer.from(mac(body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const { login, exp, v } = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!login || typeof exp !== 'number' || exp < now) return null;
    if (!isAllowed(login)) return null;   // 권한 명단에서 빠지면 그 자리에서 끊긴다
    const acc = getAccount(login);
    if (acc && (acc.status !== 'active' || (acc.sv || 0) !== (v || 0))) return null;
    const role = roleOf(login);
    return { login, name: acc?.name || login, role, admin: role === 'admin', deployer: canDeploy(role) };
  } catch {
    return null;
  }
}

export const sessionOf = (req: Request) => readSession(req.cookies?.[SESSION_COOKIE]);
