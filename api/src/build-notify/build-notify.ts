import { cfg } from '../core/config.js';
import { JsonStore, Versioned } from '../core/json-store.js';

// 빌드 알림 메일 받는 사람(#187). 개발용, 운영 빌드가 올라가면 빌드 워크플로의 알림 스크립트가
// GET /dashapi/build-notify/recipients 로 이 목록을 읽어 메일을 보낸다. 꺼 두거나 비우면 보내지 않는다.
// 화면: 설정 > 빌드 알림(관리자). 보내는 계정과 메일 서버는 저장소 시크릿, 변수에 둔다(BUILD_MAIL_*).
export interface Recipient { email: string; by: string; at: string }
export interface BuildNotifyFile extends Versioned { on: boolean; to: Recipient[]; by: string | null; at: string | null }
export interface BuildNotifyChange { on?: boolean; add?: string; remove?: string }

// 주소 하나만(쉼표나 공백으로 여럿 넣지 못하게)
export const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
export const MAX_RECIPIENTS = 30;

let store: JsonStore<BuildNotifyFile> | null = null;
const theStore = () => (store ??= new JsonStore<BuildNotifyFile>(`${cfg.dataDir}/build-notify.json`, () => ({ rev: 0, on: true, to: [], by: null, at: null })));
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

export function getBuildNotify() {
  const s = theStore().get();
  return { rev: s.rev, on: s.on, to: s.to, by: s.by, at: s.at, warning: theStore().broken };
}

/** 빌드가 읽는 값: 켜짐 여부와 주소만 */
export function buildRecipients() {
  const s = theStore().get();
  return { on: s.on, to: s.to.map((r) => r.email) };
}

/** 한 번에 하나만 바꾼다(켜고 끄기, 추가, 빼기). rev 가 다르면 RevConflict */
export function changeBuildNotify(by: string, c: BuildNotifyChange, rev?: number) {
  if (c.on !== undefined && typeof c.on !== 'boolean') throw new Error('보내기는 켜기 또는 끄기입니다');
  const add = c.add === undefined ? '' : norm(c.add);
  const remove = c.remove === undefined ? '' : norm(c.remove);
  if (c.add !== undefined && !EMAIL_RE.test(add)) throw new Error(`메일 주소 형식이 아닙니다: ${c.add}`);
  if (c.on === undefined && !add && !remove) throw new Error('바꿀 것이 없습니다');
  const cur = theStore().get();
  if (add && cur.to.some((r) => r.email === add)) throw new Error(`이미 있는 주소입니다: ${add}`);
  if (add && cur.to.length >= MAX_RECIPIENTS) throw new Error(`받는 사람은 ${MAX_RECIPIENTS}명까지입니다`);
  if (remove && !cur.to.some((r) => r.email === remove)) throw new Error(`목록에 없는 주소입니다: ${remove}`);
  const at = new Date().toISOString();
  return theStore().update(rev, (d) => {
    if (typeof c.on === 'boolean' && c.on !== d.on) { d.on = c.on; d.by = by; d.at = at; }
    if (add) d.to.push({ email: add, by, at });
    if (remove) d.to = d.to.filter((r) => r.email !== remove);
  });
}

/** 시험용: 다른 dataDir 로 다시 읽는다 */
export function _resetBuildNotifyStore() { store = null; }
