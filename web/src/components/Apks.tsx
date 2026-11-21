import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, CheckCircle2, Plus, Trash2, Truck, X as XIcon, GitCommitHorizontal, ChevronDown, ChevronLeft, ChevronRight, Code2, Copy, Download, FileText, FlaskConical, Gauge, Pencil, ShieldCheck, Smartphone, Sparkles, Undo2, Users, Wrench } from 'lucide-react';
import { api, apkApi, apkDownloadUrl, ApkChange, ApkRelease, ApkRepo, ApkShipped, ApkStatus, ApkVersion } from '../api';
import { copyText } from '../copy';
import { RefreshBar, usePoll } from '../poll';
import { User } from '../users';
import { Logo } from './Logo';
import { Modal } from './Modal';
import { DownloadButton } from './DownloadButton';

// APK 보관함 — 주로 비개발자 담당자가 쓴다. 앱 카드 + 다운로드, 버전 골라 받기, 버전별 업데이트 내역(창, 종류별 탭), 녹스 적용 표시(받기만 하면 "QA 중")
type Rel = ApkRepo['releases'][number];
const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }) : '');
const dt = (iso?: string) => (iso ? new Date(iso).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const md = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' }) : '');
const sdt = (iso?: string) => { if (!iso) return ''; const d = new Date(iso), p = (n: number) => String(n).padStart(2, '0'); return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(0)}MB`;
const DEV_KEY = 'mxc.apk.dev';
const NAME_KEY = 'mxc.apk.name';
const VIEW_KEY = 'mxc.apk.view';
/** 내부 테스트 칸의 자녀앱/부모앱 탭(#175). 부모앱은 운영 칸에 나오지 않는다 */
const KIND_KEY = 'mxc.apk.testKind';

const STATUS: Record<ApkStatus, [string, React.ReactNode]> = {
  knox: ['녹스 적용됨', <ShieldCheck key="k" size={13} />],
  qa: ['QA 중', <FlaskConical key="q" size={13} />],
  new: ['새 버전', <Sparkles key="n" size={13} />],
};
const STATUS_SHORT: Record<ApkStatus, string> = { knox: '녹스', qa: 'QA', new: '새 버전' };
/** compact — 개요의 좁은 표처럼 자리가 없는 곳에서는 짧게(전체 문구는 말풍선으로) */
export function StatusBadge({ s, compact }: { s: ApkStatus; compact?: boolean }) {
  return <span className={'badge ' + s} title={compact ? STATUS[s][0] : undefined}>{STATUS[s][1]}{compact ? STATUS_SHORT[s] : STATUS[s][0]}</span>;
}

function CopyBtn({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return <button className="btn ghost sm" onClick={() => copyText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); })}><Copy size={13} />{done ? '복사됨' : label}</button>;
}

function DevInfo({ app, r }: { app: ApkRepo; r: ApkRelease }) {
  const a = r.assets[0];
  return (
    <div className="apk-dev">
      <div><span>파일</span><b className="mono">{a.name}</b></div>
      {r.versionCode && <div><span>versionCode</span><b className="mono">{r.versionCode}</b></div>}
      {r.sha256 && <div><span>SHA-256</span><b className="mono" style={{ wordBreak: 'break-all' }}>{r.sha256}</b></div>}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
        {r.sha256 && <CopyBtn text={r.sha256} label="SHA" />}
        <CopyBtn text={`adb install -r ${a.name}`} label="adb" />
        <a className="btn ghost sm" href={app.url} target="_blank" rel="noreferrer">저장소</a>
        {r.buildUrl && <a className="btn ghost sm" href={r.buildUrl} target="_blank" rel="noreferrer">빌드 기록</a>}
      </div>
    </div>
  );
}

const KIND: Record<ApkChange['kind'], [string, React.ReactNode]> = {
  feat: ['새 기능', <Sparkles key="f" size={15} />], fix: ['고친 것', <Wrench key="x" size={15} />],
  perf: ['개선', <Gauge key="p" size={15} />], other: ['그 밖의 변경', <Pencil key="o" size={15} />],
};
type Tab = ApkChange['kind'] | 'dev';
const TAB: Record<Tab, [string, React.ReactNode]> = { ...KIND, dev: ['개발 기록', <GitCommitHorizontal key="d" size={15} />] };

/** 버전 고르기. 앞뒤 버튼으로 한 칸씩, 누르면 버전 목록(날짜, 녹스 상태, 바뀐 것 수). 보관함에 파일이 없는 옛 버전은 "파일 없음"
 *  목록은 창 본문 스크롤에 잘리지 않게 body 로 띄운다 */
/** 파일이 없는 버전의 표시. 출고한 버전이면 "출고", 아니면 "내부 빌드" */
function ShipPill({ v }: { v: ApkVersion }) {
  return v.shipped ? <span className="ver-pill ship" title={v.shipped.channel}><Truck size={12} />출고</span> : <span className="ver-pill none">내부 빌드</span>;
}

function VerSelect({ list, tag, rels, onPick, extra }: { list: ApkVersion[]; tag: string; rels: Rel[]; onPick: (tag: string) => void; extra?: React.ReactNode }) {
  const anyShipped = list.some((x) => x.shipped);
  const [all, setAll] = useState(false);   // 출고 기록이 있는 앱은 출고 버전(과 파일 있는 버전)만 먼저 보인다
  const shown = !anyShipped || all ? list : list.filter((x) => x.shipped || x.release || x.tag === tag);
  const i = shown.findIndex((v) => v.tag === tag);
  const v = shown[i];
  const rel = (t: string) => rels.find((x) => x.tag === t);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number; width: number; maxH: number } | null>(null);
  const close = () => setAt(null);
  const open = () => {
    const b = btn.current!.getBoundingClientRect();
    const width = Math.min(Math.max(b.width, 300), window.innerWidth - 24);
    setAt({ left: Math.max(12, Math.min(b.left, window.innerWidth - width - 12)), top: b.bottom + 6, width, maxH: Math.min(380, window.innerHeight - b.bottom - 24) });
  };
  useEffect(() => {
    if (!at) return;
    const down = (e: MouseEvent) => { if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); } };   // 창은 닫지 않고 목록만
    const away = (e: Event) => { if (!pop.current?.contains(e.target as Node)) close(); };
    document.addEventListener('mousedown', down);
    window.addEventListener('keydown', key, true);
    window.addEventListener('resize', close);
    document.addEventListener('scroll', away, true);
    pop.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
    return () => { document.removeEventListener('mousedown', down); window.removeEventListener('keydown', key, true); window.removeEventListener('resize', close); document.removeEventListener('scroll', away, true); };
  }, [at]);
  const pick = (t: string) => { onPick(t); close(); };
  const r = v && rel(v.tag);
  return (
    <div className="ver-select">
      <button className="ver-step" disabled={i >= shown.length - 1} onClick={() => pick(shown[i + 1].tag)} aria-label="이전 버전" title="이전 버전"><ChevronLeft size={16} /></button>
      <button ref={btn} className={'ver-trigger' + (at ? ' open' : '')} onClick={() => (at ? close() : open())} aria-haspopup="listbox" aria-expanded={!!at}>
        <span className="mono ver-tag">{v?.label ?? tag}</span>
        {list[0]?.tag === tag && <span className="ver-pill latest">최신</span>}
        {v && <span className="muted ver-date">{md(v.date)}{v.shipped ? ' 출고' : ''}</span>}
        <span className="ver-trigger-end">
          <span className="ver-trigger-st">{r ? <StatusBadge s={r.status} /> : v && !v.label && <ShipPill v={v} />}</span>
          <ChevronDown size={16} className="muted" style={{ transform: at ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }} />
        </span>
      </button>
      <button className="ver-step" disabled={i <= 0} onClick={() => pick(shown[i - 1].tag)} aria-label="다음 버전" title="다음 버전"><ChevronRight size={16} /></button>
      {extra}
      {at && createPortal(
        <div ref={pop} className="ver-pop" role="listbox" style={{ left: at.left, top: at.top, width: at.width, maxHeight: at.maxH }}>
          <div className="ver-pop-head">
            {anyShipped ? (
              <div className="seg sm">
                <button className={'segbtn' + (!all ? ' on' : '')} onClick={() => setAll(false)}>출고 버전 {list.filter((x) => x.shipped).length}</button>
                <button className={'segbtn' + (all ? ' on' : '')} onClick={() => setAll(true)}>내부 빌드까지 {list.length}</button>
              </div>
            ) : <>버전 {list.length}개</>}
          </div>
          {shown.map((x) => {
            const xr = rel(x.tag);
            return (
              <button key={x.tag} role="option" aria-selected={x.tag === tag} className={'ver-opt' + (x.tag === tag ? ' on' : '') + (x.release || x.shipped ? '' : ' nofile')} onClick={() => pick(x.tag)}>
                <span className="ver-check">{x.tag === tag && <Check size={14} />}</span>
                <span className="ver-opt-main">
                  <span className="ver-opt-top"><span className="mono ver-tag">{x.label ?? x.tag}</span>{x.tag === list[0]?.tag && <span className="ver-pill latest">최신</span>}</span>
                  <span className="ver-opt-sub">{x.shipped ? `${md(x.date)} 출고, ${x.shipped.channel}` : `${md(x.date)}${x.count >= 0 ? `, 바뀐 것 ${x.count}개` : ''}`}</span>
                </span>
                {xr ? <StatusBadge s={xr.status} /> : x.label ? null : <ShipPill v={x} />}
              </button>
            );
          })}
        </div>, document.body)}
    </div>
  );
}

/** 출고 기록 등록, 고치기. 로그인한 사람만. 기본값은 코드에 있고, 한 번 고치면 그 앱의 기록은 콘솔에 저장된 것을 쓴다 */
type Draft = { version: string; at: string; channel: string; line: string; items: { kind: ApkChange['kind']; title: string; detail: string }[] };
const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
function ShippedEditor({ app, from, seed, onClose, onSaved }: { app: ApkRepo; from: string | null; seed: { version: string; items: ApkChange[] }; onClose: () => void; onSaved: (version: string | null) => void }) {
  const [rev, setRev] = useState<number | undefined>(undefined);
  const [all, setAll] = useState<ApkShipped[]>([]);
  const [f, setF] = useState<Draft | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);
  const seeded = !from && seed.items.length > 0;
  useEffect(() => {
    apkApi.shipped(app.repo).then((x) => {
      setRev(x.rev); setAll(x.list);
      const cur = from ? x.list.find((s) => s.version === from.replace(/^v/, '')) : null;
      if (from && !cur) { setErr('이 출고 기록이 그새 바뀌었거나 지워졌습니다, 창을 닫고 다시 여세요'); return; }
      setF(cur
        ? { version: cur.version, at: cur.at, channel: cur.channel, line: cur.line ?? '', items: cur.items.map((i) => ({ kind: i.kind, title: i.title, detail: i.detail ?? '' })) }
        : { version: seed.version.replace(/^v/, ''), at: today(), channel: x.list[0]?.channel ?? '', line: x.list[0]?.line ?? '',
            items: seed.items.length ? seed.items.slice(0, 40).map((i) => ({ kind: i.kind, title: i.title, detail: i.detail ?? '' })) : [{ kind: 'feat', title: '', detail: '' }] });
    }).catch((e) => setErr(String(e?.message || e)));
  }, [app.repo, from]);   // eslint-disable-line
  const channels = [...new Set(all.map((x) => x.channel))];
  const lines = [...new Set(all.map((x) => x.line).filter(Boolean))] as string[];
  const set = (p: Partial<Draft>) => setF((d) => (d ? { ...d, ...p } : d));
  const setItem = (k: number, p: Partial<Draft['items'][number]>) => setF((d) => (d ? { ...d, items: d.items.map((x, i) => (i === k ? { ...x, ...p } : x)) } : d));
  async function save(remove = false) {
    if (!f) return;
    setBusy(true); setErr('');
    try {
      await apkApi.saveShipped(app.repo, remove ? { from: from!, remove: true, rev } : { from: from ?? undefined, rev, rec: { version: f.version, at: f.at, channel: f.channel, line: f.line || undefined, items: f.items } });
      onSaved(remove ? null : f.version.replace(/^v/i, ''));
    } catch (e: any) { setErr(String(e?.message || e)); setSure(false); } finally { setBusy(false); }
  }
  return createPortal(
    <Modal width={680} height={820} onClose={onClose} icon={<Truck size={22} color="var(--violet)" />} title={<>{app.name} 출고 기록 {from ? '고치기' : '등록'}</>}
      footer={<>
        {from && <button className={'btn ' + (sure ? 'danger' : 'ghost')} style={{ marginRight: 'auto' }} disabled={busy || !f} onClick={() => (sure ? save(true) : setSure(true))}><Trash2 size={15} />{sure ? '한 번 더 누르면 지웁니다' : '이 출고 기록 지우기'}</button>}
        <button className="btn ghost" onClick={onClose}>취소</button>
        <button className="btn primary" disabled={busy || !f} onClick={() => save()}>{busy ? '저장 중' : '저장'}</button>
      </>}>
      {err && <div className="err" style={{ marginBottom: 12 }}>{err}</div>}
      {!f && !err && <div className="skeleton" style={{ height: 200 }} />}
      {f && (
        <div className="ship-form">
          <div className="ship-grid">
            <div className="fld"><span>버전</span><div className="ship-ver mono" title="버전은 빌드할 때 정해져 바꿀 수 없습니다">v{f.version}</div></div>
            <label className="fld"><span>출고일</span><input type="date" value={f.at} onChange={(e) => set({ at: e.target.value })} /></label>
            <label className="fld wide"><span>출고처</span><input list="ship-channels" value={f.channel} onChange={(e) => set({ channel: e.target.value })} placeholder="예: 노란마켓 2종(앱차단폰)" />
              <datalist id="ship-channels">{channels.map((c) => <option key={c} value={c} />)}</datalist></label>
            {(lines.length > 0 || f.line) && (
              <label className="fld"><span>출고 줄</span><input list="ship-lines" value={f.line} onChange={(e) => set({ line: e.target.value })} placeholder="비우면 한 줄" />
                <datalist id="ship-lines">{lines.map((c) => <option key={c} value={c} />)}</datalist></label>
            )}
          </div>
          {lines.length > 0 && <div className="muted" style={{ fontSize: 12, marginTop: -4 }}>출고 줄은 같은 앱에서 따로 나가는 버전 묶음입니다(예: 2.x 줄과 4.x 줄). 앞 출고와 비교할 때 같은 줄끼리 봅니다.</div>}
          <div className="ship-sec">
            <span>바뀐 내용</span>
            <span className="ship-count">{f.items.filter((i) => i.title.trim()).length}개</span>
          </div>
          <div className="ship-guide">
            {seeded
              ? <>저장소 작업 기록으로 <b>미리 채워 두었습니다</b>. 고객이나 담당자가 알아야 할 것만 남기고 쉬운 말로 고쳐 주세요. 내부 작업은 오른쪽 <Trash2 size={12} /> 로 지우면 됩니다.</>
              : <>항목마다 <b>종류</b>를 고르고, <b>바뀐 점</b>을 한 문장으로 적으세요. 이유나 조건이 있으면 <b>설명</b>에 덧붙입니다.</>}
          </div>
          <ol className="ship-items">
            {f.items.map((it, k) => (
              <li key={k} className={'ship-item ' + it.kind}>
                <span className="ship-no">{k + 1}</span>
                <div className="ship-body">
                  <div className="ship-item-top">
                    <div className="ship-kinds" role="radiogroup" aria-label="종류">
                      {(['feat', 'fix', 'perf', 'other'] as const).map((kd) => (
                        <button key={kd} role="radio" aria-checked={it.kind === kd} className={'ship-kind ' + kd + (it.kind === kd ? ' on' : '')} onClick={() => setItem(k, { kind: kd })}>{KIND[kd][1]}{KIND[kd][0]}</button>
                      ))}
                    </div>
                    <button className="icon-btn" style={{ marginLeft: 'auto' }} aria-label={`${k + 1}번 지우기`} title="이 항목 지우기" onClick={() => set({ items: f.items.filter((_, i) => i !== k) })}><Trash2 size={15} /></button>
                  </div>
                  <label className="ship-fld"><span>바뀐 점</span>
                    <input value={it.title} onChange={(e) => setItem(k, { title: e.target.value })} placeholder="예: 잠긴 상태에서도 긴급전화를 걸 수 있음" maxLength={200} /></label>
                  <label className="ship-fld sub"><span>설명 <i>선택</i></span>
                    <input value={it.detail} onChange={(e) => setItem(k, { detail: e.target.value })} placeholder="예: 기기관리자가 꺼져 있어도 전화, 문자는 쓸 수 있게" maxLength={300} /></label>
                </div>
              </li>
            ))}
          </ol>
          <button className="ship-add" onClick={() => set({ items: [...f.items, { kind: 'feat', title: '', detail: '' }] })}><Plus size={15} />항목 추가</button>
        </div>
      )}
    </Modal>, document.body);
}

/** 업데이트 내역 — 버전을 골라 그 버전에서 바뀐 점을 종류별 탭으로 본다 */
function ChangesModal({ app, r: first, me, onClose, onKnox, onChanged }: { app: ApkRepo; r: Rel; me: string | null; onClose: () => void; onKnox: (r: Rel) => void; onChanged: () => void }) {
  const [tag, setTag] = useState(first.tag);
  const [vers, setVers] = useState<ApkVersion[]>(() => app.releases.map((x) => ({ tag: x.tag, date: x.date, release: true, count: -1 })));
  const r = app.releases.find((x) => x.tag === tag) ?? null;   // null 이면 보관함에 파일이 없는 옛 버전
  const v = vers.find((x) => x.tag === tag);
  const [d, setD] = useState<Awaited<ReturnType<typeof apkApi.changes>> | null>(null);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState('');
  const [tab, setTab] = useState<Tab | null>(null);
  const [editing, setEditing] = useState(false);
  const [ver, setVer] = useState(0);   // 출고 기록을 고치면 목록과 내역을 다시 읽는다
  const want = useRef(tag);   // 버전을 빨리 바꿔 누르면 늦게 온 앞 버전 응답은 버린다
  const load = (t = tag) => apkApi.changes(app.repo, t).then((x) => { if (want.current !== t) return; setD(x); setText(x.note?.text ?? ''); }).catch((e) => { if (want.current === t) setErr(String(e?.message || e)); });
  useEffect(() => { apkApi.versions(app.repo).then((x) => { if (x.versions.length) setVers(x.versions); }).catch(() => {}); }, [app.repo, ver]);
  useEffect(() => { want.current = tag; setD(null); setErr(''); setEdit(false); setTab(null); void load(tag); }, [app.repo, tag, ver]);   // eslint-disable-line
  const groups = ([...(['feat', 'fix', 'perf', 'other'] as const).map((k) => [k, (d?.changes ?? []).filter((c) => c.kind === k)] as const), ['dev', d?.dev ?? []] as const] as (readonly [Tab, ApkChange[]])[]).filter(([, l]) => l.length);
  const cur = groups.find(([k]) => k === tab) ?? groups[0];
  return (
    <Modal height={820} onClose={() => { if (!editing) onClose(); }} icon={<Logo file={app.logo} name={app.name} size={36} />} title={<>{app.name} 업데이트 내역</>}
      footer={r ? <>
        <span style={{ marginRight: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}><span className="mono" style={{ fontWeight: 700 }}>{r.tag}</span><StatusBadge s={r.status} /></span>
        {r.status !== 'knox' && <button className="btn" onClick={() => onKnox(r)}><ShieldCheck size={15} />녹스 적용 완료</button>}
        <DownloadButton href={apkDownloadUrl(app.repo, r.assets[0].id)} name={r.assets[0].name} size={r.assets[0].size} label={`${r.tag} 다운로드`} onDone={onChanged} />
      </> : <>
        <span style={{ marginRight: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}><span className="mono" style={{ fontWeight: 700 }}>{tag}</span><span className="muted" style={{ fontSize: 13 }}>보관함에 파일이 없는 버전입니다</span></span>
        <button className="btn primary" disabled><Download size={15} />다운로드</button>
      </>}>
      <VerSelect list={vers} tag={tag} rels={app.releases} onPick={setTag}
        extra={me && d ? <button className="btn sm ver-edit" onClick={() => setEditing(true)}><Truck size={14} />{d.shipped ? '출고 기록 고치기' : '출고 기록 등록'}</button> : null} />
      <div style={{ height: 14 }} />
      {r && (d?.note || (me && d)) && (
        <div className="note-box">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, marginBottom: 6 }}><FileText size={15} />담당자 메모
            {me && !edit && <button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => setEdit(true)}><Pencil size={13} />{d?.note ? '고치기' : '쓰기'}</button>}
          </div>
          {edit ? (
            <>
              <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="QA 에서 확인할 점, 알려진 문제 등" style={{ fontFamily: 'var(--sans)', minHeight: 90 }} />
              <div style={{ display: 'flex', gap: 6, marginTop: 6, justifyContent: 'flex-end' }}>
                <button className="btn ghost sm" onClick={() => { setEdit(false); setText(d?.note?.text ?? ''); }}>취소</button>
                <button className="btn primary sm" onClick={async () => { try { await apkApi.note(app.repo, tag, text); setEdit(false); await load(); } catch (e: any) { setErr(String(e?.message || e)); } }}>저장</button>
              </div>
            </>
          ) : d?.note ? (
            <>
              <div style={{ whiteSpace: 'pre-wrap', fontSize: 13.5 }}>{d.note.text}</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}><User login={d.note.by} size={16} />{dt(d.note.at)}</div>
            </>
          ) : <div className="muted" style={{ fontSize: 13 }}>메모가 없습니다</div>}
        </div>
      )}
      {err && <div className="err">{err}</div>}
      {!d && !err && <div className="skeleton" style={{ height: 160 }} />}
      {d && groups.length === 0 && <div className="muted">정리된 변경 내용이 없습니다(버전 번호만 바뀐 배포).</div>}
      {cur && (
        <>
          <div className="tabs chg-tabs" role="tablist">
            {groups.map(([k, list]) => (
              <button key={k} role="tab" aria-selected={k === cur[0]} className={'tab' + (k === cur[0] ? ' on' : '')} onClick={() => setTab(k)}>
                {TAB[k][1]}{TAB[k][0]}<span className="tab-n">{list.length}</span>
              </button>
            ))}
          </div>
          {cur[0] === 'dev' && <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>{d?.base ? `${d.base} 출고 다음 날부터 이번 출고일까지` : '이번 출고일까지 최근'} 저장소에 올라온 작업입니다. 출고본에 모두 들어갔는지는 따로 확인해야 합니다.</div>}
          {cur[1].map((c) => (
            <div key={c.sha + c.title} className="chg-item">
              <div className="t">{c.title}</div>
              {c.detail && <div className="d">{c.detail}</div>}
            </div>
          ))}
        </>
      )}
      {editing && d && (
        <ShippedEditor app={app} from={d.shipped ? tag : null} seed={{ version: tag, items: d.shipped ? [] : d.changes }} onClose={() => setEditing(false)}
          onSaved={(v) => { setEditing(false); if (v) setTag(app.releases.find((x) => x.tag.replace(/^v/, '') === v)?.tag ?? `v${v}`); setVer((n) => n + 1); }} />
      )}
    </Modal>
  );
}

/** 녹스 적용 표시 — 로그인 안 했으면 이름을 받는다 */
function KnoxModal({ app, r, me, undo, onClose, onDone }: { app: ApkRepo; r: Rel; me: string | null; undo?: boolean; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(() => { try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; } });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function go() {
    setBusy(true); setErr('');
    try {
      if (!me) try { localStorage.setItem(NAME_KEY, name); } catch { /* 무시 */ }
      await apkApi.knox(app.repo, r.tag, me ?? name, undo); onDone();
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }
  return (
    <Modal width={460} onClose={onClose} icon={undo ? <Undo2 size={22} /> : <ShieldCheck size={22} color="var(--green)" />} title={undo ? '녹스 적용 취소' : '녹스 적용 완료'}
      footer={<><button className="btn ghost" onClick={onClose}>닫기</button><button className={'btn ' + (undo ? '' : 'primary')} disabled={busy || (!me && !name.trim())} onClick={go}>{undo ? '적용 취소' : '적용 완료로 표시'}</button></>}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <Logo file={app.logo} name={app.name} size={40} />
        <div><div style={{ fontWeight: 700 }}>{app.name}</div><div className="mono" style={{ fontSize: 15, fontWeight: 700 }}>{r.tag}</div></div>
      </div>
      <div className="muted" style={{ fontSize: 13 }}>{undo ? '이 버전의 녹스 적용 표시를 지웁니다.' : '녹스에 이 버전을 올렸으면 표시하세요. 표시하기 전까지는 "QA 중"으로 보입니다.'}</div>
      {!me && <label className="fld" style={{ marginTop: 12 }}><span>이름</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 홍길동" maxLength={30} /></label>}
      {err && <div className="err">{err}</div>}
    </Modal>
  );
}

function AppCard({ app, dev, me, reload }: { app: ApkRepo; dev: boolean; me: string | null; reload: () => void }) {
  const [tag, setTag] = useState<string | null>(null);
  const [pick, setPick] = useState(false);
  const [show, setShow] = useState<Rel | null>(null);
  const [knox, setKnox] = useState<{ r: Rel; undo?: boolean } | null>(null);
  const latest = app.releases[0];
  const r = app.releases.find((x) => x.tag === tag) ?? latest;
  const many = app.releases.length > 1;
  return (
    <article className="scard apk2" style={{ cursor: 'default' }}>
      <header className="scard-head">
        <Logo file={app.logo} name={app.name} size={44} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="scard-title">{app.name}</div>
          <div className="scard-sub">{app.path[app.path.length - 1] ?? ''}</div>
        </div>
        {r && <StatusBadge s={r.status} />}
      </header>
      <div className="scard-body">
        {app.error && <div className="err">목록을 불러오지 못했습니다</div>}
        {!app.error && !r && <div className="scard-empty">아직 올라온 파일이 없습니다</div>}
        {r && (
          <>
            <div className="metric ver-box" style={{ marginBottom: 12 }}>
              <div className="metric-label" style={{ display: 'flex', alignItems: 'center' }}>{r === latest ? '최신 버전' : '이전 버전'}
                {r !== latest && <button className="link-btn" style={{ marginLeft: 'auto' }} onClick={() => { setTag(null); setPick(false); }}>최신으로</button>}
              </div>
              {many ? (
                <button className="ver-btn" aria-expanded={pick} onClick={() => setPick(!pick)} title="다른 버전 고르기">
                  <span className="metric-value" style={{ fontSize: 26, margin: 0 }}>{r.tag}</span>
                  <span className="ver-btn-hint">버전 {app.releases.length}개<ChevronDown size={15} style={{ transform: pick ? 'rotate(180deg)' : undefined }} /></span>
                </button>
              ) : <div className="metric-value" style={{ fontSize: 26 }}>{r.tag}</div>}
              {pick && (
                <div className="ver-list" role="listbox">
                  {app.releases.map((x, i) => (
                    <button key={x.id} role="option" aria-selected={x.tag === r.tag} className={'ver-row' + (x.tag === r.tag ? ' on' : '')} onClick={() => { setTag(i === 0 ? null : x.tag); setPick(false); }}>
                      <span className="mono" style={{ fontWeight: 700 }}>{x.tag}</span>
                      <span className="muted">{md(x.date)}</span>
                      <StatusBadge s={x.status} />
                    </button>
                  ))}
                </div>
              )}
            </div>
            <dl className="lv">
              <dt>배포일</dt><dd>{day(r.date)}</dd>
              <dt>크기</dt><dd>{mb(r.assets[0].size)}</dd>
              <dt>녹스</dt><dd>{app.knox ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}><ShieldCheck size={14} color="var(--green)" /><span className="mono" style={{ whiteSpace: 'nowrap' }}>{app.knox.tag}</span><span className="muted" style={{ fontWeight: 500 }}>{dt(app.knox.at)}</span></span> : <span className="muted" style={{ fontWeight: 500 }}>적용 기록 없음</span>}</dd>
            </dl>
            {dev && <DevInfo app={app} r={r} />}
          </>
        )}
      </div>
      {r && (
        <footer className="scard-foot">
          <DownloadButton className="apk-dl" href={apkDownloadUrl(app.repo, r.assets[0].id)} name={r.assets[0].name} size={r.assets[0].size} label={r === latest ? '다운로드' : `${r.tag} 다운로드`} onDone={reload} />
          <div className="apk-actions">
            <button className="btn" onClick={() => setShow(r)}><FileText size={15} />업데이트 내역</button>
            {r.status === 'knox'
              ? <button className="btn ghost" onClick={() => setKnox({ r, undo: true })}><CheckCircle2 size={15} />적용됨</button>
              : <button className="btn" onClick={() => setKnox({ r })}><ShieldCheck size={15} />녹스 적용 완료</button>}
          </div>
        </footer>
      )}
      {show && <ChangesModal app={app} r={show} me={me} onClose={() => setShow(null)} onChanged={reload} onKnox={(x) => { setKnox({ r: x }); setShow(null); }} />}
      {knox && <KnoxModal app={app} r={knox.r} undo={knox.undo} me={me} onClose={() => setKnox(null)} onDone={() => { setKnox(null); reload(); }} />}
    </article>
  );
}

/** 내부 테스트 빌드 태그 testbed-1.6.3-12 → { ver: 'v1.6.3', no: 12 } */
export function testLabel(tag: string) {
  const m = tag.match(/^testbed-v?([\d.]+)-(\d+)$/);
  return m ? { ver: `v${m[1]}`, no: Number(m[2]) } : { ver: tag, no: null as number | null };
}
const TestTag = ({ tag, big }: { tag: string; big?: boolean }) => {
  const t = testLabel(tag);
  return <span className={big ? 'test-tag big' : 'test-tag'}><span className="mono">{t.ver}</span>{t.no != null && <span className="test-no">#{t.no}</span>}</span>;
};
const host = (u?: string | null) => (u ? u.replace(/^https?:\/\//, '') : '');

/** 내부 테스트 빌드의 업데이트 내역 — 바로 앞 테스트 빌드 이후 들어온 작업 */
function TestChangesModal({ app, r: first, onClose }: { app: ApkRepo; r: ApkRelease; onClose: () => void }) {
  const tests = app.tests ?? [];
  const [tag, setTag] = useState(first.tag);
  const r = tests.find((x) => x.tag === tag) ?? first;
  const [d, setD] = useState<Awaited<ReturnType<typeof apkApi.changes>> | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<Tab | null>(null);
  const want = useRef(tag);
  useEffect(() => {
    want.current = tag; setD(null); setErr(''); setTab(null);
    apkApi.changes(app.repo, tag).then((x) => { if (want.current === tag) setD(x); }).catch((e) => { if (want.current === tag) setErr(String(e?.message || e)); });
  }, [app.repo, tag]);
  const groups = (['feat', 'fix', 'perf', 'other'] as const).map((k) => [k, (d?.changes ?? []).filter((c) => c.kind === k)] as const).filter(([, l]) => l.length);
  const cur = groups.find(([k]) => k === tab) ?? groups[0];
  const vers: ApkVersion[] = tests.map((x) => { const t = testLabel(x.tag); return { tag: x.tag, date: x.date, release: true, count: -1, label: `${t.ver}${t.no != null ? ` #${t.no}` : ''}` } as ApkVersion; });
  return (
    <Modal height={820} onClose={onClose} icon={<Logo file={app.logo} name={app.name} size={36} />} title={<>{app.name} 테스트용 업데이트 내역</>}
      footer={<>
        <span style={{ marginRight: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}><TestTag tag={r.tag} /><span className="badge test"><FlaskConical size={13} />테스트용</span></span>
        <DownloadButton href={apkDownloadUrl(app.repo, r.assets[0].id)} name={r.assets[0].name} size={r.assets[0].size} label="테스트용 다운로드" />
      </>}>
      <VerSelect list={vers} tag={tag} rels={[]} onPick={setTag} />
      <div className="muted" style={{ fontSize: 12.5, margin: '10px 0 14px' }}>{d ? (d.base ? `바로 전 테스트용(${testLabel(d.base).ver} #${testLabel(d.base).no}) 이후 바뀐 점입니다` : '첫 테스트용이라 최근에 바뀐 점을 보여 줍니다') : ''}</div>
      {err && <div className="err">{err}</div>}
      {!d && !err && <div className="skeleton" style={{ height: 160 }} />}
      {d && groups.length === 0 && <div className="muted">정리된 변경 내용이 없습니다.</div>}
      {cur && (
        <>
          <div className="tabs chg-tabs" role="tablist">
            {groups.map(([k, list]) => (
              <button key={k} role="tab" aria-selected={k === cur[0]} className={'tab' + (k === cur[0] ? ' on' : '')} onClick={() => setTab(k)}>{TAB[k][1]}{TAB[k][0]}<span className="tab-n">{list.length}</span></button>
            ))}
          </div>
          {cur[1].map((c) => <div key={c.sha + c.title} className="chg-item"><div className="t">{c.title}</div>{c.detail && <div className="d">{c.detail}</div>}</div>)}
        </>
      )}
    </Modal>
  );
}

/** 내부 테스트 빌드 카드 — 테스트배드 서버를 보는 dev 빌드. 녹스, 출고와는 상관없다 */
function TestCard({ app, dev }: { app: ApkRepo; dev: boolean }) {
  const tests = app.tests ?? [];
  const [tag, setTag] = useState<string | null>(null);
  const [pick, setPick] = useState(false);
  const [show, setShow] = useState<ApkRelease | null>(null);
  const latest = tests[0];
  const r = tests.find((x) => x.tag === tag) ?? latest;
  return (
    <article className="scard apk2 test" style={{ cursor: 'default' }}>
      <header className="scard-head">
        <Logo file={app.logo} name={app.name} size={44} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="scard-title">{app.name}</div>
          <div className="scard-sub">{app.path[app.path.length - 1] ?? ''}</div>
        </div>
        <span className="badge test"><FlaskConical size={13} />테스트용</span>
      </header>
      <div className="scard-body">
        {!r && <div className="scard-empty">아직 테스트용 앱이 없습니다<br /><span className="muted" style={{ fontSize: 12 }}>개발 내용이 바뀌면 자동으로 올라옵니다</span></div>}
        {r && (
          <>
            <div className="metric ver-box" style={{ marginBottom: 12 }}>
              <div className="metric-label" style={{ display: 'flex', alignItems: 'center' }}>{r === latest ? '최신 테스트용' : '이전 테스트용'}
                {r !== latest && <button className="link-btn" style={{ marginLeft: 'auto' }} onClick={() => { setTag(null); setPick(false); }}>최신으로</button>}
              </div>
              {tests.length > 1 ? (
                <button className="ver-btn" aria-expanded={pick} onClick={() => setPick(!pick)} title="다른 테스트용 고르기">
                  <span className="metric-value" style={{ fontSize: 26, margin: 0 }}><TestTag tag={r.tag} big /></span>
                  <span className="ver-btn-hint">{tests.length}개<ChevronDown size={15} style={{ transform: pick ? 'rotate(180deg)' : undefined }} /></span>
                </button>
              ) : <div className="metric-value" style={{ fontSize: 26 }}><TestTag tag={r.tag} big /></div>}
              {pick && (
                <div className="ver-list" role="listbox">
                  {tests.map((x, i) => (
                    <button key={x.id} role="option" aria-selected={x.tag === r.tag} className={'ver-row' + (x.tag === r.tag ? ' on' : '')} onClick={() => { setTag(i === 0 ? null : x.tag); setPick(false); }}>
                      <TestTag tag={x.tag} /><span className="muted">{sdt(x.date)}</span><span className="mono muted" style={{ fontSize: 11.5 }}>{x.commit?.slice(0, 7) ?? ''}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <dl className="lv">
              <dt>올라온 때</dt><dd>{dt(r.date)}</dd>
              <dt>크기</dt><dd>{mb(r.assets[0].size)}</dd>
              <dt>연결</dt><dd>테스트 서버</dd>
              {dev && r.server && <><dt>서버 주소</dt><dd className="mono" style={{ fontSize: 12.5 }}>{host(r.server)}</dd></>}
              {dev && r.commit && <><dt>커밋</dt><dd><a className="mono" href={`${app.url}/commit/${r.commit}`} target="_blank" rel="noreferrer">{r.commit.slice(0, 7)}</a></dd></>}
            </dl>
            {dev && <DevInfo app={app} r={r} />}
          </>
        )}
      </div>
      {r && (
        <footer className="scard-foot">
          <DownloadButton className="apk-dl" href={apkDownloadUrl(app.repo, r.assets[0].id)} name={r.assets[0].name} size={r.assets[0].size} label={r === latest ? '테스트용 다운로드' : `#${testLabel(r.tag).no} 다운로드`} />
          <button className="btn" onClick={() => setShow(r)}><FileText size={15} />업데이트 내역</button>
        </footer>
      )}
      {show && <TestChangesModal app={app} r={show} onClose={() => setShow(null)} />}
    </article>
  );
}

export function Apks({ publicPage = false }: { publicPage?: boolean }) {
  const [apps, setApps] = useState<ApkRepo[] | null>(null);
  const [err, setErr] = useState('');
  const [me, setMe] = useState<string | null>(null);
  const [dev, setDev] = useState(() => { try { return localStorage.getItem(DEV_KEY) === '1'; } catch { return false; } });
  const load = (refresh = false) => { setErr(''); return api.apks(refresh).then((r) => setApps(r.apps)).catch((e) => { setErr(String(e?.message || e)); throw e; }); };
  const poll = usePoll(load, 60000);
  useEffect(() => { api.me().then((m) => setMe(m.authenticated ? m.login : null)).catch(() => {}); }, []);
  const toggleDev = () => { const v = !dev; setDev(v); try { localStorage.setItem(DEV_KEY, v ? '1' : '0'); } catch { /* 무시 */ } };
  const qa = (apps ?? []).filter((a) => a.releases[0]?.status === 'qa').length;
  const [view, setView] = useState<'prod' | 'test'>(() => { try { return localStorage.getItem(VIEW_KEY) === 'test' ? 'test' : 'prod'; } catch { return 'prod'; } });
  const setV = (v: 'prod' | 'test') => { setView(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* 무시 */ } };
  const nTests = (apps ?? []).reduce((n, a) => n + (a.tests?.length ? 1 : 0), 0);
  const [kind, setKind] = useState<'device' | 'store'>(() => { try { return localStorage.getItem(KIND_KEY) === 'store' ? 'store' : 'device'; } catch { return 'device'; } });
  const setK = (k: 'device' | 'store') => { setKind(k); try { localStorage.setItem(KIND_KEY, k); } catch { /* 무시 */ } };
  const deviceApps = (apps ?? []).filter((a) => a.kind !== 'store-app');
  // 부모앱은 내부 테스트 빌드가 있을 때만: 테스트 빌드를 만들지 않는 부모앱에 빈 칸을 띄우지 않는다
  const storeApps = (apps ?? []).filter((a) => a.kind === 'store-app' && (a.tests?.length ?? 0) > 0);
  const nDevice = deviceApps.filter((a) => a.tests?.length).length;
  return (
    <div>
      <div className="topbar">
        <div>
          <h1><Smartphone size={22} />APK 보관함</h1>
          <div className="sub">기기에 설치할 앱 파일{qa ? `, QA 중 ${qa}개` : ''}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className={'btn sm' + (dev ? ' primary' : '')} onClick={toggleDev}><Code2 size={14} />개발자 정보</button>
          {publicPage && <a className="btn sm" href="/">Rosie 콘솔</a>}
          <RefreshBar poll={poll} />
        </div>
      </div>
      <div className="apk-view-row">
        <div className="seg apk-view" role="tablist">
          <button role="tab" aria-selected={view === 'prod'} className={'segbtn' + (view === 'prod' ? ' on' : '')} onClick={() => setV('prod')}><ShieldCheck size={14} />운영</button>
          <button role="tab" aria-selected={view === 'test'} className={'segbtn' + (view === 'test' ? ' on' : '')} onClick={() => setV('test')}><FlaskConical size={14} />내부 테스트{nTests ? <span className="tab-n">{nTests}</span> : null}</button>
        </div>
        {view === 'test' && (
          <div className="seg apk-view" role="tablist" aria-label="앱 종류">
            <button role="tab" aria-selected={kind === 'device'} className={'segbtn' + (kind === 'device' ? ' on' : '')} onClick={() => setK('device')}><Smartphone size={14} />자녀앱{nDevice ? <span className="tab-n">{nDevice}</span> : null}</button>
            <button role="tab" aria-selected={kind === 'store'} className={'segbtn' + (kind === 'store' ? ' on' : '')} onClick={() => setK('store')}><Users size={14} />부모앱{storeApps.length ? <span className="tab-n">{storeApps.length}</span> : null}</button>
          </div>
        )}
      </div>
      {err && <div className="panel err">{err}</div>}
      {apps === null && !err && <div className="apk-grid">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 300 }} />)}</div>}
      {/* 운영 칸은 기기앱만: 부모앱은 스토어로 나가고 보관함에 운영 파일이 올라오지 않는다 */}
      {apps && view === 'prod' && <div className="apk-grid">{deviceApps.map((a) => <AppCard key={a.key} app={a} dev={dev} me={me} reload={() => poll.refresh()} />)}</div>}
      {apps && view === 'test' && (
        <>
          <div className="test-guide"><FlaskConical size={15} /><span>개발 중인 앱을 <b>미리 써 보는 테스트용</b>입니다. 실제 서비스가 아닌 <b>테스트 서버</b>에 연결되고, 고객에게 나가지 않습니다. 개발 내용이 바뀔 때마다 새로 올라오고 지난 것도 모두 남아 있습니다.</span></div>
          {kind === 'store' && !storeApps.length && <div className="panel muted" style={{ fontSize: 13 }}>아직 부모앱 테스트용 앱이 없습니다</div>}
          <div className="apk-grid">{(kind === 'store' ? storeApps : deviceApps).map((a) => <TestCard key={a.key} app={a} dev={dev} />)}</div>
        </>
      )}
      {dev && <div className="muted" style={{ fontSize: 12, marginTop: 12 }}>SHA-256 확인: 맥 <span className="mono">shasum -a 256 파일.apk</span>, 윈도우 <span className="mono">certutil -hashfile 파일.apk SHA256</span></div>}
    </div>
  );
}
