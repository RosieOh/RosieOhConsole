import { useMemo, useState } from 'react';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import { Plus, Trash2, __ICON__ as PageIcon } from 'lucide-react';
import { api, __PASCAL__Item, __PASCAL__View } from '../api';
import { when } from '../grid';
import { RefreshBar, usePoll } from '../poll';
import { MiniGrid } from './MiniGrid';
import { Modal } from './Modal';
import { Section } from './Section';

const EMPTY = { id: '', name: '', note: '' };

// __TITLE__ — DATA_DIR/__NAME__.json 에 두는 목록. 추가·수정·삭제는 관리자·배포 담당만
export function __PASCAL__({ deployer = false }: { deployer?: boolean }) {
  const [d, setD] = useState<__PASCAL__View | null>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState<typeof EMPTY | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async (force: boolean) => {
    try { setD(await api.__CAMEL__(force)); setErr(''); } catch (e: any) { setErr(String(e?.message || e)); throw e; }
  };
  const poll = usePoll(load, 30_000);

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true); setErr('');
    try { await fn(); setMsg(done); setForm(null); await load(true); }
    catch (e: any) { setErr(String(e?.message || e)); }
    finally { setBusy(false); }
  }
  const save = () => form && run(() => api.__CAMEL__Save({ rev: d?.rev, ...form }), `${form.name} 를 저장했습니다`);
  const remove = (r: __PASCAL__Item) => confirm(`${r.name} 를 지울까요?`) && run(() => api.__CAMEL__Delete(r.id, d?.rev), `${r.name} 를 지웠습니다`);

  const cols = useMemo<ColDef<__PASCAL__Item>[]>(() => [
    { headerName: '이름', field: 'name', flex: 1, minWidth: 160 },
    { headerName: 'ID', field: 'id', width: 160, cellClass: 'mono' },
    { headerName: '메모', field: 'note', flex: 2, minWidth: 200 },
    { headerName: '바꾼 때', field: 'updatedAt', width: 130, valueFormatter: (p) => (p.value ? when(p.value) : '') },
    ...(deployer ? [{
      headerName: '', width: 70, sortable: false,
      cellRenderer: (p: ICellRendererParams<__PASCAL__Item>) => p.data && (
        <button className="btn ghost sm" title="지우기" onClick={(e) => { e.stopPropagation(); remove(p.data!); }}><Trash2 size={14} /></button>
      ),
    } as ColDef<__PASCAL__Item>] : []),
  ], [deployer, d?.rev]);   // eslint-disable-line

  return (
    <div>
      <div className="topbar">
        <div>
          <h1><PageIcon size={22} />__TITLE__</h1>
          <div className="sub">{d ? `${d.items.length}개, 갱신 ${when(d.updatedAt)}` : ' '}</div>
        </div>
        <RefreshBar poll={poll} />
      </div>
      {d?.warning && <div className="panel amber" style={{ marginBottom: 12 }}>{d.warning}</div>}
      {msg && <div className="panel ok-note" style={{ marginBottom: 12 }}>{msg}</div>}
      {err && !form && <div className="panel err" style={{ marginBottom: 12 }}>{err}</div>}

      <Section icon={PageIcon} title="목록" flush
        right={deployer && <button className="btn ghost sm" onClick={() => { setErr(''); setForm({ ...EMPTY }); }}><Plus size={14} />추가</button>}>
        {d && (d.items.length
          ? <MiniGrid rows={d.items} cols={cols} rowId={(r) => r.id} onRow={deployer ? (r) => { setErr(''); setForm({ id: r.id, name: r.name, note: r.note ?? '' }); } : undefined} />
          : <div className="muted" style={{ padding: 16 }}>아직 없습니다{deployer && ', 오른쪽 위 추가를 누르세요'}</div>)}
      </Section>

      {form && (
        <Modal title="__TITLE__ 저장" onClose={() => setForm(null)}>
          <div style={{ display: 'grid', gap: 10 }}>
            <label>ID <input className="mono" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} placeholder="소문자-숫자" /></label>
            <label>이름 <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label>메모 <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
            {err && <div className="panel err">{err}</div>}
            <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn ghost" onClick={() => setForm(null)}>닫기</button>
              <button className="btn" disabled={busy || !form.id || !form.name} onClick={save}>{busy ? '저장 중…' : '저장'}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
