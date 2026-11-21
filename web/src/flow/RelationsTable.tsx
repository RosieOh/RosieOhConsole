import { useMemo, useState } from 'react';
import { RefreshBar, usePoll } from '../poll';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import { RelEdge, RelGraph, flowApi } from '../api';
import { useCatalog } from '../catalog';
import { defaultColDef, gridTheme, localeKo, when } from '../grid';
import { Logo } from '../components/Logo';
import { Picker } from '../components/Picker';

// 연관 관계 — 저장소 설정 파일에서 자동으로 찾은 연결(확인 필요) · 확정 · 거절 · 직접 추가. 근거(파일·줄)는 키 이름과 호스트만
const STATE_LABEL = { auto: ['확인 필요', 'amber'], confirmed: ['확정', 'green'], rejected: ['거절', 'muted'], manual: ['직접 추가', 'green'] } as const;

export function RelationsTable({ admin }: { admin: boolean }) {
  const { catalog } = useCatalog();
  const [g, setG] = useState<RelGraph | null>(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [only, setOnly] = useState<'all' | 'auto' | 'unknown'>('all');
  const [add, setAdd] = useState({ from: '', to: '', note: '' });
  const load = () => flowApi.relations().then(setG).catch((e) => setErr(String(e?.message || e)));
  const poll = usePoll(load, 20000);

  const label = (id: string) => {
    if (id.startsWith('comp:')) { const c = catalog?.components.find((x) => `comp:${x.key}` === id); return c ? { name: c.name, logo: c.logo } : { name: id }; }
    return { name: g?.nodes.find((n) => n.id === id)?.name ?? id };
  };
  async function act(b: Record<string, unknown>) {
    setErr('');
    try { await flowApi.decide({ ...b, rev: g?.rev }); await load(); } catch (e: any) { setErr(String(e?.message || e)); if (e?.status === 409) await load(); }
  }

  const rows = (g?.edges ?? []).filter((e) => only === 'all' || (only === 'auto' && e.state === 'auto'));
  const cols: ColDef<RelEdge>[] = useMemo(() => [
    { headerName: '서비스', minWidth: 190, flex: 1, valueGetter: (p) => p.data && label(p.data.from).name,
      cellRenderer: (p: ICellRendererParams<RelEdge>) => { const l = label(p.data!.from); return <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><Logo file={(l as any).logo} name={l.name} size={16} />{l.name}</span>; } },
    { headerName: '→ 쓰는 것', minWidth: 200, flex: 1.1, valueGetter: (p) => p.data && label(p.data.to).name,
      cellRenderer: (p: ICellRendererParams<RelEdge>) => { const l = label(p.data!.to); return <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>{(l as any).logo !== undefined && <Logo file={(l as any).logo} name={l.name} size={16} />}{l.name}</span>; } },
    { headerName: '근거', minWidth: 260, flex: 1.6, valueGetter: (p) => p.data && `${p.data.via} ${p.data.evidence.map((e) => e.path).join(' ')}`,
      cellRenderer: (p: ICellRendererParams<RelEdge>) => (
        <div style={{ lineHeight: 1.3, paddingTop: 6 }}>
          <div>{p.data!.via}{p.data!.note ? `, ${p.data!.note}` : ''}</div>
          <div className="muted mono" style={{ fontSize: 10.5 }} title={p.data!.evidence.map((e) => `${e.path}:${e.line} ${e.text}`).join('\n')}>
            {p.data!.evidence.slice(0, 2).map((e) => `${e.path}:${e.line}`).join(', ')}{p.data!.evidence.length > 2 ? ` 외 ${p.data!.evidence.length - 2}` : ''}
          </div>
        </div>
      ) },
    { headerName: '상태', width: 120, valueGetter: (p) => p.data && STATE_LABEL[p.data.state][0],
      cellRenderer: (p: ICellRendererParams<RelEdge>) => { const [t, c] = STATE_LABEL[p.data!.state]; return <span className={'chip ' + c}>{t}</span>; } },
    { headerName: '처음 발견', width: 130, valueGetter: (p) => when(p.data?.firstSeen) },
    { headerName: '', width: 190, sortable: false, filter: false, hide: !admin,
      cellRenderer: (p: ICellRendererParams<RelEdge>) => {
        const e = p.data!;
        if (e.state === 'manual') return <button className="btn ghost" style={{ padding: '2px 8px' }} onClick={() => act({ op: 'remove', id: e.id })}>지우기</button>;
        return (
          <span style={{ display: 'inline-flex', gap: 4 }}>
            {e.state !== 'confirmed' && <button className="btn ghost" style={{ padding: '2px 8px' }} onClick={() => act({ op: 'confirm', id: e.id })}>확정</button>}
            {e.state !== 'rejected' && <button className="btn ghost" style={{ padding: '2px 8px' }} onClick={() => act({ op: 'reject', id: e.id })}>거절</button>}
            {e.state !== 'auto' && <button className="btn ghost" style={{ padding: '2px 8px' }} onClick={() => act({ op: 'reset', id: e.id })}>되돌림</button>}
          </span>
        );
      } },
  ], [g, catalog, admin]);   // eslint-disable-line

  const ids = [...(catalog?.components.map((c) => ({ id: `comp:${c.key}`, name: c.name })) ?? []), ...(g?.nodes.map((n) => ({ id: n.id, name: n.name })) ?? [])];
  const unknownHosts = useMemo(() => {
    const m = new Map<string, { comps: string[]; ev: string }>();
    for (const u of g?.unknown ?? []) { const x = m.get(u.host) ?? { comps: [], ev: `${u.evidence[0]?.path}:${u.evidence[0]?.line}` }; x.comps.push(u.comp); m.set(u.host, x); }
    return [...m.entries()];
  }, [g]);
  const autoCount = g?.edges.filter((e) => e.state === 'auto').length ?? 0;

  return (
    <div>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>저장소 설정 파일에서 찾은 연결입니다. 확인 후 확정하거나 거절하세요.{g && `, 마지막 확인 ${when(g.scannedAt) || '없음'}${g.scanning ? ' (확인 중)' : ''}`}</div>
      {err && <div className="panel err" style={{ marginBottom: 10 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="seg">
          <button className={'segbtn' + (only === 'all' ? ' on' : '')} onClick={() => setOnly('all')}>전체 {g?.edges.length ?? ''}</button>
          <button className={'segbtn' + (only === 'auto' ? ' on' : '')} onClick={() => setOnly('auto')}>확인 필요 {autoCount}</button>
          <button className={'segbtn' + (only === 'unknown' ? ' on' : '')} onClick={() => setOnly('unknown')}>모르는 주소 {unknownHosts.length}</button>
        </div>
        <input placeholder="검색" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 200 }} />
        {admin && <button className="btn ghost" disabled={g?.scanning} onClick={async () => { await flowApi.rescan(); setTimeout(load, 1500); }}>{g?.scanning ? '읽는 중…' : '저장소 다시 읽기'}</button>}
        <span style={{ marginLeft: 'auto' }}><RefreshBar poll={poll} /></span>
      </div>
      {only !== 'unknown' ? (
        <div style={{ height: Math.min(90 + rows.length * 48, 640) }}>
          <AgGridReact<RelEdge> theme={gridTheme} localeText={localeKo} rowData={rows} columnDefs={cols} defaultColDef={defaultColDef} rowHeight={48}
            quickFilterText={q} getRowId={(p) => p.data.id} loading={!g && !err} suppressCellFocus />
        </div>
      ) : (
        <div className="panel">
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>분류되지 않은 주소입니다. 이름을 붙이면 외부 서비스로 표시됩니다.</div>
          {unknownHosts.map(([host, x]) => <UnknownRow key={host} host={host} comps={x.comps.map((k) => label(`comp:${k}`).name)} ev={x.ev} admin={admin} onName={(name) => act({ op: 'host', host, name })} />)}
        </div>
      )}
      {admin && (
        <div className="panel" style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>연결 직접 추가</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Picker label="서비스" placeholder="서비스…" value={add.from} onChange={(v) => setAdd({ ...add, from: v })}
              style={{ width: 220 }} options={(catalog?.components ?? []).map((c) => ({ value: `comp:${c.key}`, label: c.name }))} />
            <span className="muted" style={{ alignSelf: 'center' }}>→</span>
            <Picker label="쓰는 것" placeholder="쓰는 것…" value={add.to} onChange={(v) => setAdd({ ...add, to: v })}
              style={{ width: 240 }} options={ids.map((n) => ({ value: n.id, label: n.name }))} />
            <input placeholder="메모(선택)" value={add.note} onChange={(e) => setAdd({ ...add, note: e.target.value })} style={{ flex: '1 1 160px' }} />
            <button className="btn primary" disabled={!add.from || !add.to} onClick={async () => { await act({ op: 'add', ...add }); setAdd({ from: '', to: '', note: '' }); }}>추가</button>
          </div>
        </div>
      )}
    </div>
  );
}

function UnknownRow({ host, comps, ev, admin, onName }: { host: string; comps: string[]; ev: string; admin: boolean; onName: (n: string) => void }) {
  const [name, setName] = useState('');
  return (
    <div className="kv" style={{ alignItems: 'center', gap: 10 }}>
      <span className="k"><span className="mono">{host}</span> <span className="muted" style={{ fontSize: 11 }}>, {comps.join(', ')}, {ev}</span></span>
      {admin && <span className="v" style={{ display: 'flex', gap: 4 }}>
        <input placeholder="이름(예: 결제 PG)" value={name} onChange={(e) => setName(e.target.value)} style={{ width: 160, padding: '3px 8px' }} />
        <button className="btn ghost" style={{ padding: '2px 8px' }} disabled={!name.trim()} onClick={() => onName(name)}>이름 붙이기</button>
      </span>}
    </div>
  );
}
