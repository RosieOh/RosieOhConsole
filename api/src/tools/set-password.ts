// 터미널에서 계정 비밀번호 정하기 — scripts/set-password.bash 가 부른다(직접: node dist/tools/set-password.js <아이디>)
// 비밀번호는 표준 입력 한 줄(SET_PASSWORD 환경변수도 된다). DATABASE_URL 이 있으면 MariaDB, 없으면 DATA_DIR 파일에 쓴다.
import { closePersist, initPersist, persistInfo } from '../persist.js';
import { AccountError, setPasswordDirect } from '../accounts/accounts.js';
import { roleOf } from '../access/access.js';

async function readLine(): Promise<string> {
  if (process.env.SET_PASSWORD) return process.env.SET_PASSWORD;
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

async function main() {
  const login = process.argv[2];
  if (!login) { console.error('사용법: node dist/tools/set-password.js <아이디>  (비밀번호는 표준 입력)'); process.exit(2); }
  await initPersist();
  try {
    const r = setPasswordDirect(login, await readLine());
    console.log(`✓ ${r.account.login} 비밀번호를 ${r.created ? '정하고 계정을 만들었습니다' : '바꿨습니다(기존 로그인은 끊김)'} — 역할 ${roleOf(r.account.login)}, 저장 ${persistInfo().driver}`);
  } catch (e) {
    console.error(`✗ ${e instanceof AccountError ? e.message : (e as Error)?.message}`);
    process.exitCode = 1;
  } finally {
    await closePersist();
  }
}
void main();
