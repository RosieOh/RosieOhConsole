import { cfg } from '../config.js';

// GitHub OAuth — 신원 확인만 한다. 사용자 토큰은 저장하지 않는다(scope 없음 = 공개 프로필만).
export const redirectUri = () => `${cfg.publicUrl}/dashapi/oauth/callback`;

export function authorizeUrl(state: string) {
  const u = new URL(cfg.githubWeb + '/login/oauth/authorize');
  u.searchParams.set('client_id', cfg.oauthClientId);
  u.searchParams.set('redirect_uri', redirectUri());
  u.searchParams.set('state', state);
  u.searchParams.set('allow_signup', 'false');
  return u.toString();
}

export async function exchangeCode(code: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(cfg.githubWeb + '/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: cfg.oauthClientId, client_secret: cfg.oauthClientSecret, code, redirect_uri: redirectUri() }),
  });
  if (!res.ok) throw new Error(`GitHub 로그인 확인 실패 (HTTP ${res.status})`);
  const j: any = await res.json();
  if (!j.access_token) throw new Error(`GitHub 가 로그인 토큰을 주지 않았습니다${j.error ? ` (${j.error})` : ''}`);
  return j.access_token;
}

export async function whoAmI(token: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(cfg.githubApi + '/user', { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub 사용자 확인 실패 (HTTP ${res.status})`);
  const j: any = await res.json();
  if (!j.login) throw new Error('GitHub 사용자 정보를 읽지 못했습니다');
  return j.login;
}
