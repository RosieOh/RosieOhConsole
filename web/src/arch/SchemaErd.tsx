import { useMemo, useState } from 'react';
import { ReactFlow, Background, BackgroundVariant } from '@xyflow/react';
import { nodeTypes } from './nodes';
import schema from './schema.json';

// 스키마는 schema.json 에 { "<스키마>": { tables: [{ name, cols: [...] }] } } 로 넣고 여기 한 줄 추가한다
const SERVICES: { key: string; schema: string }[] = [];

export function SchemaErd() {
  const [svc, setSvc] = useState(SERVICES[0]?.key ?? '');
  const sch = (schema as any)[SERVICES.find((s) => s.key === svc)?.schema ?? ''];

  const rfNodes = useMemo(() => {
    const tables = sch?.tables || [];
    const COLW = 230, ROWH_BASE = 60;
    let col = 0, x = 0; const colY = [0, 0, 0, 0];
    return tables.map((t: any) => {
      col = col % 4;
      const node = { id: t.name, type: 'table', position: { x: col * COLW, y: colY[col] }, data: t };
      colY[col] += ROWH_BASE + t.cols.length * 17;
      col++;
      return node;
    });
  }, [svc]);

  if (!SERVICES.length) return <div className="panel muted">아직 등록한 DB 스키마가 없습니다. web/src/arch/schema.json 과 SchemaErd.tsx 의 SERVICES 에 추가하세요.</div>;

  return (
    <div>
      <div className="seg" style={{ marginBottom: 12, display: 'inline-flex' }}>
        {SERVICES.map((s) => <button key={s.key} className={'segbtn' + (svc === s.key ? ' on' : '')} onClick={() => setSvc(s.key)}>{s.key}</button>)}
      </div>
      <span className="code" style={{ marginLeft: 12 }}>{sch?.db}, {sch?.tables?.length} tables, <span style={{ color: '#f5a623' }}>◆</span> PK <span style={{ color: '#5b9dff' }}>◇</span> index/FK</span>
      <div className="panel" style={{ padding: 0, height: 560, overflow: 'hidden', marginTop: 10 }}>
        <ReactFlow nodes={rfNodes} edges={[]} nodeTypes={nodeTypes} fitView minZoom={0.2}
          proOptions={{ hideAttribution: true }} nodesDraggable nodesConnectable={false}>
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#2a2a2a" />
        </ReactFlow>
      </div>
    </div>
  );
}
