import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import type { ReposData } from '../lib/types';
import { repoShort } from '../lib/format';
import { Modal } from './Overlay';
import { Picker } from '../../components/Picker';
import { SkeletonRows } from './Skeleton';

/** 이름을 보고 배포 확인 방법을 미리 짐작한다 (고를 수 있다) */
const guess = (name: string) => /backend|server/i.test(name) ? 'backend-jenkins' : /web/i.test(name) ? 'web'
  : /app|parents|kids|child|protect|mobile|v2/i.test(name) ? 'app-store' : 'none';

/** 저장소 (관리자) — 보드와 주간보고가 보는 저장소를 GitHub 에서 찾아 추가·삭제, 배포 확인 방법 선택 */
export function ReposModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<ReposData | null>(null);
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(true);
  const [legend, setLegend] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const load = useCallback(async (query: string) => {
    setSearching(true);
    try { setData(await api.repos(query)); }
    catch (e) { toast.error(`저장소 목록을 불러오지 못했습니다, ${(e as Error).message}`, { action: { label: '다시 시도', onClick: () => void load(query) } }); }
    finally { setSearching(false); }
  }, []);
  useEffect(() => { void load(''); }, [load]);
  async function change(body: Parameters<typeof api.changeRepo>[0], done: string) {
    try { await api.changeRepo(body); toast.success(done); await load(q); onChanged(); }
    catch (e) { toast.error(`바꾸지 못했습니다, ${(e as Error).message}`); }
  }
  const types = data?.types || {};
  const select = (value: string, onChange: (v: string) => void) => (
    <Picker label="배포 확인 방법" placeholder="고르기" value={value} onChange={onChange}
      options={Object.entries(types).map(([k, v]) => ({ value: k, label: v }))} />
  );
  const Head = () => (
    <div className="board-repo-grid board-repo-head">
      <span>저장소</span>
      <span>배포 확인 방법<button type="button" aria-expanded={legend} onClick={() => setLegend(!legend)} title="무슨 뜻인가요?" className="board-info">ⓘ</button></span><span />
    </div>
  );
  const [pending, setPending] = useState<Record<string, string>>({});
  return (
    <Modal title="저장소" onClose={onClose} wide>
      <p className="board-note">보드와 주간보고가 보는 저장소입니다. 추가하면 보드에는 바로, 주간보고 판정에는 10분 안에 반영됩니다.</p>
      {legend && (
        <div className="board-legend">
          {Object.values(types).map((v) => { const [a, b] = v.split(', '); return <Fragment key={a}><b>{a}</b><span>{b}</span></Fragment>; })}
          <b>잘못 고르면</b>
          <span>카드가 "배포 대기"에서 멈추거나, 출시 전에 "운영 반영"으로 넘어갑니다. 그럴 땐 보드에서 카드를 직접 옮기면 됩니다.</span>
        </div>
      )}
      <h5>지금 보는 저장소 {data ? `${data.tracked.length}개` : ''}</h5>
      <Head />
      <ul className="board-list tall">
        {!data ? <SkeletonRows n={5} /> : data.tracked.length ? data.tracked.map((t) => (
          <li key={t.repo} className="board-repo-grid">
            <span className="board-repo-name">{repoShort(t.repo)}</span>
            {select(t.type, (v) => void change({ action: 'type', repo: t.repo, type: v }, '배포 확인 방법을 바꿨습니다'))}
            <button type="button" className="btn sm board-del" onClick={() => change({ action: 'remove', repo: t.repo }, `${repoShort(t.repo)} 을(를) 뺐습니다`)}>빼기</button>
          </li>
        )) : <li className="board-list-empty">아직 없습니다</li>}
      </ul>
      <h5>GitHub 에서 찾아 추가</h5>
      <input className="board-repo-q" value={q} placeholder="저장소 이름으로 검색 (비우면 최근 수정 순)" aria-label="저장소 검색" autoFocus
        onChange={(e) => { const v = e.target.value; setQ(v); setSearching(true); clearTimeout(timer.current); timer.current = setTimeout(() => void load(v), 250); }} />
      <Head />
      <ul className="board-list short">
        {!data || searching ? <SkeletonRows n={3} /> : data.results.length ? data.results.map((r) => (
          <li key={r.repo} className="board-repo-grid">
            <span className="board-repo-cell"><span className="board-repo-name">{repoShort(r.repo)}</span>
              {r.description && <span className="board-repo-desc">{r.description}</span>}</span>
            {r.tracked ? <span className="board-repo-note">이미 보는 중</span>
              : select(pending[r.repo] || guess(r.repo), (v) => setPending({ ...pending, [r.repo]: v }))}
            {r.tracked ? <span className="board-ok">✓</span>
              : <button type="button" className="btn sm board-add"
                  onClick={() => change({ action: 'add', repo: r.repo, type: pending[r.repo] || guess(r.repo) }, `${repoShort(r.repo)} 을(를) 추가했습니다`)}>추가</button>}
          </li>
        )) : <li className="board-list-empty">찾는 저장소가 없습니다</li>}
      </ul>
    </Modal>
  );
}
