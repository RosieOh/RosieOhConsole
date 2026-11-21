import { Handle, Position } from '@xyflow/react';

const KIND_COLOR: Record<string, string> = {
  app: '#5b9dff', service: '#3ecf8e', sso: '#c084fc', db: '#f5a623', redis: '#f0526d', ext: '#8a8a8a', admin: '#3ecf8e', static: '#5b9dff',
};

export function ArchNodeBox({ data }: { data: any }) {
  const color = KIND_COLOR[data.kind] || '#8a8a8a';
  const active = data.active;
  return (
    <div style={{
      minWidth: 120, padding: '8px 11px', borderRadius: 8,
      background: active ? 'var(--selected)' : 'var(--node)',
      border: `1px solid ${active ? color : 'var(--border-2)'}`,
      boxShadow: active ? `0 0 0 3px ${color}33` : 'none',
      transition: 'all .25s ease', cursor: 'pointer',
    }}>
      <Handle type="target" position={Position.Left} style={{ background: 'var(--edge)', width: 6, height: 6 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ width: 7, height: 7, borderRadius: 2, background: color, flexShrink: 0 }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{data.label}</span>
      </div>
      {data.sub && <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 3, fontFamily: 'var(--mono)' }}>{data.sub}</div>}
      <Handle type="source" position={Position.Right} style={{ background: 'var(--edge)', width: 6, height: 6 }} />
    </div>
  );
}

export function TableNodeBox({ data }: { data: any }) {
  return (
    <div style={{ minWidth: 170, background: 'var(--node)', border: '1px solid var(--border-2)', borderRadius: 8, overflow: 'hidden' }}>
      <Handle type="target" position={Position.Left} style={{ background: 'var(--edge)', width: 6, height: 6 }} />
      <div style={{ background: 'var(--panel-2)', borderBottom: '1px solid var(--border)', padding: '6px 10px', fontSize: 12.5, fontWeight: 600, color: '#3ecf8e', fontFamily: 'var(--mono)' }}>{data.name}</div>
      <div style={{ padding: '4px 0' }}>
        {data.cols.map((c: any) => (
          <div key={c.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '2px 10px', fontSize: 11, fontFamily: 'var(--mono)' }}>
            <span style={{ color: c.key === 'PRI' ? '#f5a623' : c.key === 'MUL' ? '#5b9dff' : 'var(--text-2)' }}>
              {c.key === 'PRI' ? '◆ ' : c.key === 'MUL' ? '◇ ' : ''}{c.name}
            </span>
            <span style={{ color: 'var(--muted-2)' }}>{c.type}</span>
          </div>
        ))}
      </div>
      <Handle type="source" position={Position.Right} style={{ background: 'var(--edge)', width: 6, height: 6 }} />
    </div>
  );
}

export const nodeTypes = { arch: ArchNodeBox, table: TableNodeBox };
