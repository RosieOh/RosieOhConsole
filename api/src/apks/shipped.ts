import { ChangeKind } from './changes.js';
import { cfg } from '../config.js';
import { JsonStore, Versioned } from '../json-store.js';

// 출고한 버전 기록의 기본값(콘솔에서 고치면 apk-shipped.json 이 이 앱의 기록을 대신한다).
// line 은 같은 앱 안의 출고 줄. 앞 출고와 비교할 때 같은 줄끼리만 본다.
export interface ShippedItem { kind: ChangeKind; title: string; detail?: string }
export interface Shipped { version: string; at: string; channel: string; line?: string; items: ShippedItem[]; note?: string; by?: string; updatedAt?: string }

export const SHIPPED: Record<string, Shipped[]> = {};

/** 같은 줄에서 바로 앞 출고 */
export function prevShipped(list: Shipped[], s: Shipped): Shipped | null {
  const same = list.filter((x) => (x.line ?? '') === (s.line ?? '') && x.at < s.at).sort((a, b) => (a.at < b.at ? 1 : -1));
  return same[0] ?? null;
}

/** 앞 출고 다음 날부터 이번 출고일까지의 커밋(최신부터). 앞 출고가 없으면 출고일까지 최근 max 개 */
export function windowCommits<T extends { date: string }>(commits: T[], from: string | null, to: string, max = 40): T[] {
  const day = (d: string) => d.slice(0, 10);
  const hit = commits.filter((c) => day(c.date) <= to && (!from || day(c.date) > from));
  return from ? hit : hit.slice(0, max);
}

export interface VersionRow { tag: string; date: string; release: boolean; count: number; shipped?: { at: string; channel: string } }
/** 커밋 기록의 버전 구간, 보관함 릴리스, 출고 기록을 한 목록으로(같은 버전은 하나로). 출고 버전 날짜는 출고일 */
export function mergeVersions(segs: { version: string; date: string; count: number }[], rels: { tag: string; date: string }[], shipped: Shipped[], norm: (v: string) => string): VersionRow[] {
  const rel = new Map(rels.map((x) => [norm(x.tag), x]));
  const out = new Map<string, VersionRow>();
  for (const g of segs) { const x = rel.get(g.version); out.set(g.version, { tag: x?.tag ?? `v${g.version}`, date: x?.date ?? g.date, release: !!x, count: g.count }); }
  for (const x of rels) if (!out.has(norm(x.tag))) out.set(norm(x.tag), { tag: x.tag, date: x.date, release: true, count: -1 });
  for (const s of shipped) {
    const v = norm(s.version), x = rel.get(v), cur = out.get(v);
    out.set(v, { tag: x?.tag ?? cur?.tag ?? `v${v}`, date: s.at, release: !!x, count: s.items.length, shipped: { at: s.at, channel: s.channel } });
  }
  return [...out.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

// ── 콘솔에서 고친 출고 기록 ──
export interface ShippedFile extends Versioned { apps: Record<string, Shipped[]> }
export const shippedStore = () => new JsonStore<ShippedFile>(`${cfg.dataDir}/apk-shipped.json`, () => ({ rev: 0, apps: {} }));

const KINDS: ChangeKind[] = ['feat', 'fix', 'perf', 'other'];
const str = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
/** 화면에서 온 출고 기록을 검사하고 다듬는다. 틀리면 사람이 읽을 말로 Error */
export function cleanShipped(x: any): Shipped {
  const version = str(x?.version, 20).replace(/^v/i, '');
  if (!/^\d+(\.\d+){1,3}$/.test(version)) throw new Error('버전은 1.6.3 처럼 숫자와 점으로 적으세요');
  const at = str(x?.at, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(at) || Number.isNaN(Date.parse(at))) throw new Error('출고일을 고르세요');
  const channel = str(x?.channel, 60);
  if (!channel) throw new Error('출고처를 적으세요');
  const line = str(x?.line, 10);
  const items = (Array.isArray(x?.items) ? x.items : []).slice(0, 40)
    .map((i: any) => ({ kind: KINDS.includes(i?.kind) ? i.kind : 'other', title: str(i?.title, 200), detail: str(i?.detail, 300) }))
    .filter((i: any) => i.title)
    .map((i: any) => (i.detail ? i : { kind: i.kind, title: i.title })) as ShippedItem[];
  if (!items.length) throw new Error('바뀐 내용을 한 줄 이상 적으세요');
  const note = String(x?.note ?? '').trim().slice(0, 1000);
  return { version, at, channel, ...(line ? { line } : {}), items, ...(note ? { note } : {}) };
}

/** 목록에서 from 버전을 rec 로 바꾸거나(from 없으면 추가) 지운다(rec 없으면). 같은 버전이 둘이면 Error */
export function upsertShipped(list: Shipped[], from: string | null, rec: Shipped | null): Shipped[] {
  const n = (v: string) => v.replace(/^v/i, '');
  const out = from ? list.filter((x) => n(x.version) !== n(from)) : [...list];
  if (from && out.length === list.length) throw new Error('없는 출고 기록입니다, 새로고침하세요');
  if (rec) {
    if (out.some((x) => x.version === rec.version)) throw new Error(`v${rec.version} 출고 기록이 이미 있습니다`);
    out.push(rec);
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
