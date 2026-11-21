import { useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import { BellOff, BellRing, MailWarning } from 'lucide-react';
import { api, BuildNotify, BuildNotifyRecipient } from '../api';
import { defaultColDef, gridTheme, localeKo, when } from '../grid';
import { RefreshBar, usePoll } from '../poll';

// 설정 > 빌드 알림: 개발용, 운영 빌드가 올라가면 빌드 워크플로의 알림 스크립트가 이 목록을 읽어 메일을 보낸다(#187).
// 바꾸면 다음 빌드부터 바로 쓰인다(배포 없음). 한 번에 하나씩 바꾸고 rev 로 동시 편집을 막는다
export function BuildNotifyAdmin() {
  const [data, setData] = useState<BuildNotify | null>(null);
  const [err, setErr] = useState('');
  const [addr, setAddr] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => api.buildNotify().then(setData).catch((e) => setErr(String(e?.message || e)));
  const poll = usePoll(load, 60000);

  async function change(b: { on?: boolean; add?: string; remove?: string }) {
    setErr(''); setBusy(true);
    try {
      setData(await api.setBuildNotify({ ...b, rev: data?.rev }));
      if (b.add !== undefined) setAddr('');
    } catch (e: any) {
      const m = String(e?.message || e);
      await load();
      setErr(m);
    } finally { setBusy(false); }
  }

  const n = data?.to.length ?? 0;
  const state = !data ? null
    : !data.on ? { cls: 'red', icon: <BellOff size={18} />, text: '꺼짐', sub: '빌드가 올라가도 메일을 보내지 않습니다.' }
    : n === 0 ? { cls: 'amber', icon: <MailWarning size={18} />, text: '받는 사람 없음', sub: '켜져 있지만 받는 사람이 없어 보내지 않습니다.' }
    : { cls: 'green', icon: <BellRing size={18} />, text: `켜짐, ${n}명`, sub: `빌드가 올라갈 때마다 ${n}명에게 한 통씩 보냅니다.` };

  const cols: ColDef<BuildNotifyRecipient>[] = useMemo(() => [
    { headerName: '받는 주소', field: 'email', minWidth: 200, flex: 1.4,
      cellRenderer: (p: ICellRendererParams<BuildNotifyRecipient>) => <span style={{ fontWeight: 600 }}>{p.value}</span> },
    { headerName: '넣은 사람', field: 'by', minWidth: 110, flex: 0.6 },
    { headerName: '넣은 때', minWidth: 130, flex: 0.6, valueGetter: (p) => p.data?.at ?? '', valueFormatter: (p) => when(p.value) },
    { headerName: '', colId: 'remove', width: 80, pinned: 'right', sortable: false, filter: false, resizable: false,
      cellRenderer: (p: ICellRendererParams<BuildNotifyRecipient>) => p.data && (
        <button className="btn sm ghost" style={{ color: 'var(--red)' }} disabled={busy} onClick={() => void change({ remove: p.data!.email })}>빼기</button>) },
  ], [busy, data]);   // eslint-disable-line

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 14, maxWidth: 920 }}>
      {data?.warning && <div className="panel amber">{data.warning}</div>}
      {err && <div className="panel err" style={{ marginTop: 0 }}>{err}</div>}

      <section className="panel bn-card">
        <div className="bn-head">
          {/* 폭이 좁으면 새로고침 줄이 아래로 내려간다(제목이 글자 단위로 끊기지 않게) */}
          <div style={{ flex: '1 1 300px', minWidth: 0 }}>
            <h3 className="bn-title">빌드 알림 메일 보내기</h3>
            <div className="muted bn-desc">개발용 테스트 빌드, 운영 스토어와 OTA, 기기 APK 가 올라가면 그동안 바뀐 점을 정리해 받는 사람에게 메일로 보냅니다. 여기서 바꾸면 다음 빌드부터 바로 쓰입니다.</div>
          </div>
          <RefreshBar poll={poll} />
        </div>
        {data && state && (
          <div className="bn-state">
            <span className={'bn-icon ' + state.cls}>{state.icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="bn-big">{state.text}</div>
              <div className="muted" style={{ fontSize: 12.5 }}>{state.sub}</div>
            </div>
            <button type="button" role="switch" aria-checked={data.on} aria-label="빌드 알림 메일 보내기" title={data.on ? '끄기' : '켜기'}
              className="switch" disabled={busy} onClick={() => void change({ on: !data.on })} />
          </div>
        )}
        {data?.by && <div className="muted" style={{ fontSize: 12 }}>마지막으로 켜고 끈 사람: {data.by}, {when(data.at)}</div>}
      </section>

      <section className="panel bn-card">
        <h3 className="bn-title">받는 사람 {n}명</h3>
        <form className="bn-add" onSubmit={(e) => { e.preventDefault(); if (addr.trim()) void change({ add: addr }); }}>
          <input type="email" placeholder="메일 주소 하나 (예: me@example.com)" value={addr} onChange={(e) => setAddr(e.target.value)} disabled={!data} />
          <button className="btn primary" disabled={busy || !addr.trim() || !data}>추가</button>
        </form>
        <div style={{ height: Math.min(92 + n * 42, 520) }}>
          <AgGridReact<BuildNotifyRecipient> theme={gridTheme} localeText={{ ...localeKo, noRowsToShow: '받는 사람이 없습니다' }} rowData={data?.to ?? []}
            columnDefs={cols} defaultColDef={defaultColDef} rowHeight={42} getRowId={(p) => p.data.email} loading={!data && !err} suppressCellFocus />
        </div>
        <div className="muted" style={{ fontSize: 12 }}>보내는 계정과 메일 서버는 저장소 시크릿 BUILD_MAIL_USER, BUILD_MAIL_PASSWORD 와 변수 BUILD_MAIL_HOST, BUILD_MAIL_PORT 입니다(인프라 &gt; 시크릿).</div>
      </section>
    </div>
  );
}
