import { Workflow as WorkflowIcon } from 'lucide-react';
import { Pipelines } from './Pipelines';

// 배포 흐름 — 배포되는 서비스마다 커밋 → 빌드 → 배포 → 사이트. 도는 배포는 위로 올라와 단계마다 움직인다
// (전체 도식은 구성도 화면에 있다)
export function FlowPage({ focus }: { focus?: string; onOpenFlags?: () => void }) {
  return (
    <div>
      <div className="topbar">
        <div>
          <h1><WorkflowIcon size={22} />배포 흐름</h1>
          <div className="sub">배포되는 서비스마다 커밋 → 빌드 → 배포 → 사이트, 지금 어디까지 왔는지</div>
        </div>
      </div>
      <Pipelines focus={focus} />
    </div>
  );
}
