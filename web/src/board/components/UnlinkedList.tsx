import type { Unlinked } from '../lib/types';
import { kstShort, repoShort } from '../lib/format';
import { Avatar } from './Avatar';

/**
 * 미연결 작업 — 이슈와 이어지지 않아 보드·주간보고에 안 잡히는 일.
 * 열린 PR 은 본문에 closes #번호 가 없고, 브랜치는 최근 커밋에 #번호 도 PR 도 없다.
 */
export function UnlinkedList({ items, at, q, who, repo }: { items: Unlinked[]; at: string | null; q: string; who: string; repo: string }) {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = items.filter((x) => {
    const hay = `${x.title} ${x.repo} ${x.branch || ''} ${x.author}`.toLowerCase();
    return words.every((w) => hay.includes(w)) && (!who || x.author === who) && (!repo || x.repo === repo);
  });
  return (
    <section className="board-report" aria-label="미연결 작업">
      <header className="board-unl-head">
        <h2>이슈와 연결되지 않은 작업 <span className="board-n">{shown.length}</span></h2>
        <p>
          보드와 주간보고는 커밋의 <code>#번호</code>, PR 본문의 <code>closes #번호</code> 로만 일을 셉니다.
          아래 작업은 어느 이슈의 일인지 알 수 없어 빠져 있습니다. PR 은 본문에 한 줄을 넣으면 바로 머지할 수 있게 되고(필수 검사 <code>mx/issue-link</code>), 브랜치는 다음 커밋에 번호를 넣거나 PR 을 올리면 사라집니다.
          {at && <span className="at">점검 {kstShort(at)}</span>}
        </p>
      </header>
      {shown.length === 0 ? (
        <p className="board-empty">{items.length ? '필터에 맞는 미연결 작업이 없습니다' : '미연결 작업이 없습니다, 모두 이슈와 이어져 있습니다'}</p>
      ) : (
        <ul className="board-unl">
          {shown.map((x) => (
            <li key={`${x.kind}:${x.repo}:${x.number ?? x.branch}`}>
              <a href={x.url} target="_blank" rel="noreferrer" className="board-unl-item">
                <span className={x.kind === 'pr' ? 'board-unl-kind pr' : 'board-unl-kind'}>
                  {x.kind === 'pr' ? `PR #${x.number}${x.draft ? ' 초안' : ''}` : '브랜치'}
                </span>
                <span className="board-unl-body">
                  <span className="board-unl-t">{x.title || x.branch}</span>
                  <span className="board-unl-s">{repoShort(x.repo)}{x.branch ? `, ${x.branch}` : ''}{x.updated ? `, ${kstShort(x.updated)}` : ''}</span>
                </span>
                {x.author && <span className="board-unl-by"><Avatar login={x.author} size={18} ring="transparent" />{x.author}</span>}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
