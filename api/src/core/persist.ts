import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { cfg } from './config.js';

// 저장소 — DATABASE_URL 이 있으면 MariaDB, 없으면 DATA_DIR 의 파일(로컬 개발·시험).
//
// MariaDB 테이블
//   store(name, rev, value, updated_at)  JSON 문서 하나 = 한 줄('catalog', 'access', 'deploy-readings' …)
//   audit(id, at, login, action, target, detail, ok, url)
//   blob(name, mime, body, created_at)    로고 그림 등
//
// 문서는 시작할 때 전부 메모리로 읽고(initPersist), 읽기는 메모리에서 바로 한다(동기).
// 쓰기는 메모리를 먼저 바꾸고 DB 에는 이름마다 차례로 보낸다 — 같은 이름에 쓰기가 몰리면 마지막 값만 간다.
// 콘솔은 한 대만 뜬다고 본다(여러 대면 rev 검사가 메모리 기준이라 서로 덮을 수 있다).

type Pool = import('mariadb').Pool;
let pool: Pool | null = null;
const docs = new Map<string, { rev: number; value: any }>();
const pending = new Map<string, { rev: number; json: string }>();
const flying = new Map<string, Promise<void>>();
let lastError: string | null = null;

export const dbOn = () => !!pool;
export const persistInfo = () => ({ driver: pool ? 'mariadb' : 'file', error: lastError });

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS store (
     name VARCHAR(100) NOT NULL PRIMARY KEY,
     rev INT NOT NULL DEFAULT 0,
     value LONGTEXT NOT NULL,
     updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
   ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS audit (
     id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
     at TIMESTAMP(3) NOT NULL,
     login VARCHAR(100) NOT NULL,
     action VARCHAR(100) NOT NULL,
     target VARCHAR(500) NOT NULL,
     detail TEXT NULL,
     ok TINYINT(1) NOT NULL,
     url VARCHAR(1000) NULL,
     KEY audit_at (at)
   ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS blob_file (
     name VARCHAR(200) NOT NULL PRIMARY KEY,
     mime VARCHAR(100) NOT NULL,
     body MEDIUMBLOB NOT NULL,
     created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
   )`,
];

/** mariadb://user:pass@host:3306/db → 연결 설정 */
function parseUrl(url: string) {
  const u = new URL(url);
  if (!/^(mariadb|mysql):$/.test(u.protocol)) throw new Error('DATABASE_URL 은 mariadb://user:pass@host:3306/db 모양입니다');
  return {
    host: u.hostname, port: Number(u.port || 3306),
    user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
  };
}

/** 시작할 때 한 번 — DB 면 표를 만들고 문서를 전부 읽는다. Nest 를 만들기 전에 부른다 */
export async function initPersist(url = process.env.DATABASE_URL) {
  if (!url || pool) return;
  const mariadb = await import('mariadb');
  pool = mariadb.createPool({ ...parseUrl(url), connectionLimit: 5, bigIntAsNumber: true, insertIdAsNumber: true, connectTimeout: 10_000 });
  let conn;
  for (let i = 1; ; i++) {
    try { conn = await pool.getConnection(); break; }
    catch (e: any) {
      if (i >= 10) throw new Error(`MariaDB 에 연결하지 못했다: ${e?.message}`);
      console.warn(`[저장] MariaDB 연결 재시도 ${i}/10: ${e?.message}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  try {
    for (const sql of SCHEMA) await conn.query(sql);
    const rows: { name: string; rev: number; value: string }[] = await conn.query('SELECT name, rev, value FROM store');
    for (const r of rows) {
      try { docs.set(r.name, { rev: r.rev, value: JSON.parse(r.value) }); }
      catch { console.warn(`[저장] store.${r.name} 를 읽지 못해 건너뛴다`); }
    }
    const blobs: { name: string }[] = await conn.query('SELECT name FROM blob_file');
    for (const b of blobs) blobNames.add(b.name);
    if (!process.env.NODE_TEST_CONTEXT) console.log(`[저장] MariaDB, 문서 ${rows.length}개, 파일 ${blobs.length}개`);
  } finally { conn.release(); }
}

const fileOf = (name: string) => `${cfg.dataDir}/${name}.json`;

/**
 * 문서 읽기(없으면 null). file 은 파일 모드의 경로(기본 DATA_DIR/<name>.json).
 * DB 모드에서 아직 DB 에 없고 그 경로에 옛 파일이 있으면 값을 DB 로 옮겨 온다
 */
export function readDoc<T = any>(name: string, file = fileOf(name)): T | null {
  if (pool) {
    const hit = docs.get(name);
    if (hit) return hit.value as T;
    const legacy = readFileDoc<T>(file);
    if (legacy !== null) { writeDoc(name, legacy, (legacy as any)?.rev ?? 0); if (!process.env.NODE_TEST_CONTEXT) console.log(`[저장] ${file} → MariaDB store.${name}`); }
    return legacy;
  }
  return readFileDoc<T>(file);
}

function readFileDoc<T>(p: string): T | null {
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8')) as T;
}

/** 문서 쓰기 — 파일은 임시 파일 → rename(동기), DB 는 메모리 → 차례로 보냄 */
export function writeDoc(name: string, value: unknown, rev = 0, file = fileOf(name)) {
  const json = JSON.stringify(value);
  if (!pool) {
    const p = file;
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p + '.tmp', json, 'utf8');
    renameSync(p + '.tmp', p);
    return;
  }
  docs.set(name, { rev, value: JSON.parse(json) });
  pending.set(name, { rev, json });
  if (!flying.has(name)) flying.set(name, drain(name));
}

async function drain(name: string) {
  try {
    for (let next = pending.get(name); next; next = pending.get(name)) {
      pending.delete(name);
      try {
        await pool!.query('INSERT INTO store (name, rev, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE rev = VALUES(rev), value = VALUES(value)', [name, next.rev, next.json]);
        lastError = null;
      } catch (e: any) {
        lastError = `store.${name} 저장 실패: ${e?.message}`;
        console.error('[저장] ' + lastError);
        if (!pending.has(name)) pending.set(name, next);   // 더 새 값이 없으면 다음 쓰기 때 다시
        break;
      }
    }
  } finally { flying.delete(name); }
}

// ── 감사 로그 ──
export interface AuditRow { at: string; login: string; action: string; target: string; detail?: string; ok: boolean; url?: string }

export async function appendAudit(e: AuditRow) {
  if (pool) {
    await pool.query('INSERT INTO audit (at, login, action, target, detail, ok, url) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [new Date(e.at), e.login, e.action, e.target.slice(0, 500), e.detail ?? null, e.ok ? 1 : 0, e.url ?? null]);
    return;
  }
  await mkdir(cfg.dataDir, { recursive: true });
  await appendFile(`${cfg.dataDir}/audit.jsonl`, JSON.stringify(e) + '\n', 'utf8');
}

export async function readAudit(n: number): Promise<AuditRow[]> {
  if (pool) {
    const rows: any[] = await pool.query('SELECT at, login, action, target, detail, ok, url FROM audit ORDER BY id DESC LIMIT ?', [n]);
    return rows.map((r) => ({ at: new Date(r.at).toISOString(), login: r.login, action: r.action, target: r.target, ...(r.detail != null ? { detail: r.detail } : {}), ok: !!r.ok, ...(r.url ? { url: r.url } : {}) }));
  }
  try {
    const lines = (await readFile(`${cfg.dataDir}/audit.jsonl`, 'utf8')).trim().split('\n').filter(Boolean);
    return lines.slice(-n).reverse().map((l) => JSON.parse(l));
  } catch { return []; }
}

// ── 파일(로고 등) — 이름이 내용 해시라 한 번 쓰면 바뀌지 않는다. 이름 목록은 메모리에(동기 확인용) ──
/** blob 이름은 '<폴더>/<파일>' 하나뿐 — '..'·절대 경로로 DATA_DIR 밖을 건드리지 못하게 */
const BLOB_RE = /^[a-z0-9-]{1,40}\/[A-Za-z0-9_-][A-Za-z0-9._-]{0,120}$/;
const blobPath = (name: string) => {
  if (!BLOB_RE.test(name) || name.includes('..')) throw new Error(`blob 이름이 올바르지 않습니다: ${name.slice(0, 80)}`);
  return `${cfg.dataDir}/${name}`;
};
const blobNames = new Set<string>();
const blobWrites = new Set<Promise<void>>();

/** 쓰기 — 파일은 바로, DB 는 이름을 먼저 기억하고 내용은 뒤에서 보낸다 */
export function putBlob(name: string, mime: string, body: Buffer) {
  if (!pool) {
    const p = blobPath(name);
    mkdirSync(p.slice(0, p.lastIndexOf('/')), { recursive: true });
    try { writeFileSync(p, body, { flag: 'wx' }); }   // 이미 있으면(같은 내용 = 같은 해시 이름) 그대로 둔다
    catch (e: any) { if (e?.code !== 'EEXIST') throw e; }
    return;
  }
  if (blobNames.has(name)) return;
  blobNames.add(name);
  const w = pool.query('INSERT IGNORE INTO blob_file (name, mime, body) VALUES (?, ?, ?)', [name, mime, body])
    .then(() => undefined)
    .catch((e: any) => { blobNames.delete(name); lastError = `blob ${name} 저장 실패: ${e?.message}`; console.error('[저장] ' + lastError); })
    .finally(() => { blobWrites.delete(w); });
  blobWrites.add(w);
}

export function hasBlob(name: string) {
  return pool ? blobNames.has(name) : existsSync(blobPath(name));
}

export async function getBlob(name: string): Promise<Buffer | null> {
  if (pool) {
    await Promise.all([...blobWrites]);
    const rows: any[] = await pool.query('SELECT body FROM blob_file WHERE name = ?', [name]);
    return rows[0] ? Buffer.from(rows[0].body) : null;
  }
  const p = blobPath(name);
  return existsSync(p) ? readFileSync(p) : null;
}

/** 밀린 쓰기를 다 보내고 닫는다(종료·시험) */
export async function flushPersist() {
  while (flying.size || blobWrites.size) await Promise.all([...flying.values(), ...blobWrites]);
}
export async function closePersist() {
  await flushPersist();
  await pool?.end();
  pool = null;
  docs.clear();
  blobNames.clear();
}
