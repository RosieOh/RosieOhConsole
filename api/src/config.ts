// 콘솔 환경변수 — 한곳에서 읽는다. 비밀값은 여기서만 꺼내 쓰고 응답·로그에 싣지 않는다.
const list = (v: string | undefined, d = '') => (v ?? d).split(',').map((s) => s.trim()).filter(Boolean);

export const cfg = {
  port: Number(process.env.PORT) || 8087,
  // 브라우저가 들어오는 콘솔 주소. OAuth 되돌아올 주소와 쿠키 Secure 여부를 정한다
  publicUrl: (process.env.PUBLIC_URL || 'http://localhost:8087').replace(/\/$/, ''),
  // GitHub — 로그인(OAuth)·저장소·Actions·릴리스의 원본
  githubApi: (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, ''),
  githubWeb: (process.env.GITHUB_WEB_URL || 'https://github.com').replace(/\/$/, ''),
  // 콘솔이 다루는 저장소의 주인(사용자 계정)
  owner: process.env.GITHUB_OWNER || 'RosieOh',
  // 읽기 토큰(fine-grained: Metadata·Contents·Actions read). 없으면 공개 API 한도(시간당 60회)로 돈다
  githubToken: process.env.GITHUB_TOKEN || '',
  // 쓰기 토큰(Actions write·Contents write·Pull requests write) — 되돌리기·운영 반영 등. 없으면 그 버튼이 꺼진다
  githubWriteToken: process.env.GITHUB_WRITE_TOKEN || '',
  oauthClientId: process.env.OAUTH_CLIENT_ID || '',
  oauthClientSecret: process.env.OAUTH_CLIENT_SECRET || '',
  sessionSecret: process.env.SESSION_SECRET || '',
  // 처음 관리자이자 로그인할 수 있는 GitHub 계정(쉼표로 여럿). 권한 화면에서 더 추가할 수 있다
  admins: list(process.env.CONSOLE_ADMINS, process.env.GITHUB_OWNER || 'RosieOh'),
  // 테스트배드 — API 문서·테스터가 이 주소로 대신 호출한다(/mxtest/*). 비우면 꺼진다
  testbedUrl: (process.env.TESTBED_URL || '').replace(/\/$/, ''),
  // 콘솔이 직접 갖는 데이터(감사 로그·배포 기록 캐시)
  dataDir: process.env.DATA_DIR || '/data',
};

export const secureCookie = () => cfg.publicUrl.startsWith('https://');
export const repoUrl = (repo: string) => `${cfg.githubWeb}/${cfg.owner}/${repo}`;

export function assertConfig() {
  const missing = (['oauthClientId', 'oauthClientSecret'] as const).filter((k) => !cfg[k]);
  if (cfg.sessionSecret.length < 32) missing.push('sessionSecret(32자 이상)' as any);
  if (missing.length) throw new Error('환경변수가 비었다: ' + missing.join(', '));
}
