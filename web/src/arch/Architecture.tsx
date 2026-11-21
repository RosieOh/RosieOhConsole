import { Network as NetworkIcon } from 'lucide-react';
import { useState } from 'react';
import { SystemFlow } from '../flow/SystemFlow';
import { RelationsTable } from '../flow/RelationsTable';
import { SchemaErd } from './SchemaErd';
import { Tabs, tabFromHash } from '../components/Tabs';

// Architecture — 손으로 그린 그림 대신 카탈로그·인프라·연관 관계(자동 수집 + 확정)로 만든 전체 도식(#23)
export function Architecture({ admin, onOpenFlags }: { admin: boolean; onOpenFlags?: () => void }) {
  const [view, setView] = useState<'map' | 'relations' | 'schema'>(() => tabFromHash(['map', 'relations', 'schema'], 'map'));
  return (
    <div>
      <div className="topbar">
        <div>
          <h1><NetworkIcon size={22} />Architecture</h1>
          <div className="sub">서비스, 서버, 데이터 연결 구조</div>
        </div>
      </div>
      <Tabs tabs={[['map', '전체 도식'], ['relations', '연관 관계'], ['schema', 'DB 스키마']]} value={view} onChange={setView} />
      {view === 'map' && <SystemFlow mode="architecture" onOpenFlags={onOpenFlags} />}
      {view === 'relations' && <RelationsTable admin={admin} />}
      {view === 'schema' && <SchemaErd />}
    </div>
  );
}
