import { useMemo, useState } from 'react';
import type { ColDef } from 'ag-grid-community';
import { __ICON__ as PageIcon } from 'lucide-react';
import { api, __PASCAL__Item, __PASCAL__View } from '../api';
import { when } from '../grid';
import { RefreshBar, usePoll } from '../poll';
import { MiniGrid } from './MiniGrid';
import { Section } from './Section';

// __TITLE__ — GET /dashapi/__NAME__ 를 30초마다 다시 읽는다
export function __PASCAL__({ deployer = false }: { deployer?: boolean }) {
  const [d, setD] = useState<__PASCAL__View | null>(null);
  const [err, setErr] = useState('');
  const load = async (force: boolean) => {
    try { setD(await api.__CAMEL__(force)); setErr(''); } catch (e: any) { setErr(String(e?.message || e)); throw e; }
  };
  const poll = usePoll(load, 30_000);

  const cols = useMemo<ColDef<__PASCAL__Item>[]>(() => [
    { headerName: '이름', field: 'name', flex: 1, minWidth: 160 },
    { headerName: 'ID', field: 'id', width: 160, cellClass: 'mono' },
    { headerName: '메모', field: 'note', flex: 2, minWidth: 200 },
  ], []);

  return (
    <div>
      <div className="topbar">
        <div>
          <h1><PageIcon size={22} />__TITLE__</h1>
          <div className="sub">{d ? `${d.items.length}개, 갱신 ${when(d.updatedAt)}` : ' '}</div>
        </div>
        <RefreshBar poll={poll} />
      </div>
      {err && <div className="panel err" style={{ marginBottom: 12 }}>{err}</div>}

      <Section icon={PageIcon} title="목록" flush>
        {d && (d.items.length
          ? <MiniGrid rows={d.items} cols={cols} rowId={(r) => r.id} />
          : <div className="muted" style={{ padding: 16 }}>아직 없습니다</div>)}
      </Section>
    </div>
  );
}
