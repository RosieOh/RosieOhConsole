import { Workflow as WorkflowIcon } from 'lucide-react';
import { SystemFlow } from './SystemFlow';

// 배포 흐름 — 전체 도식 위에서 지금 도는 배포가 움직인다(서비스 하나만 잘라 보여 주지 않는다)
export function FlowPage({ focus, onOpenFlags }: { focus?: string; onOpenFlags?: () => void }) {
  return (
    <div>
      <div className="topbar">
        <div>
          <h1><WorkflowIcon size={22} />배포 흐름</h1>
          <div className="sub">서비스가 어떤 단계를 거쳐 서버, 스토어에 올라가는지, 지금 어디까지 왔는지</div>
        </div>
      </div>
      <SystemFlow mode="deploy" initialFocus={focus} onOpenFlags={onOpenFlags} />
    </div>
  );
}
