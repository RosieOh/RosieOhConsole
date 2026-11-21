import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import type { ViewersData } from '../lib/types';
import { Modal } from './Overlay';
import { Avatar } from './Avatar';
import { SkeletonChips } from './Skeleton';

/** 열람 권한 (관리자) — 여기 있는 GitHub 계정만 보드를 볼 수 있다 */
export function ViewersModal({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<ViewersData | null>(null);
  const [input, setInput] = useState('');
  const load = useCallback(async () => {
    try { setData(await api.viewers()); }
    catch (e) { toast.error(`명단을 불러오지 못했습니다, ${(e as Error).message}`, { action: { label: '다시 시도', onClick: () => void load() } }); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function change(action: 'add' | 'remove', login: string) {
    try {
      await api.changeViewer(action, login);
      toast.success(action === 'add' ? `${login} 님이 볼 수 있습니다` : `${login} 님을 뺐습니다`);
      await load();
    } catch (e) { toast.error(`바꾸지 못했습니다, ${(e as Error).message}`); }
  }
  return (
    <Modal title="열람 권한" onClose={onClose}>
      <p className="board-note">여기 있는 GitHub 계정만 보드를 볼 수 있습니다. 바꾸면 바로 적용됩니다. 관리자는 늘 볼 수 있습니다.</p>
      <h5>볼 수 있는 사람</h5>
      <div className="board-people">
        {!data ? <SkeletonChips n={4} /> : <>
          {data.admins.map((l) => <span key={l} className="board-person"><Avatar login={l} ring="transparent" />{l}, 관리자</span>)}
          {data.viewers.filter((l) => !data.admins.includes(l)).map((l) => (
            <span key={l} className="board-person"><Avatar login={l} ring="transparent" />{l}
              <button type="button" aria-label={`${l} 빼기`} onClick={() => change('remove', l)} className="board-person-x">✕</button></span>
          ))}
        </>}
      </div>
      <h5>추천, 우리 저장소 권한이 있는 사람</h5>
      <div className="board-people">
        {!data ? <SkeletonChips n={3} /> : data.candidates.length ? data.candidates.map((l) => (
          <button key={l} type="button" onClick={() => change('add', l)} className="board-person add">
            <Avatar login={l} ring="transparent" />{l} 추가</button>
        )) : <span className="board-dim">추천할 사람이 없습니다</span>}
      </div>
      <form className="board-row" onSubmit={(e) => { e.preventDefault(); const v = input.trim(); if (v) { void change('add', v); setInput(''); } }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="GitHub 아이디 직접 입력" aria-label="GitHub 아이디" autoFocus />
        <button className="btn primary" type="submit">추가</button>
      </form>
    </Modal>
  );
}
