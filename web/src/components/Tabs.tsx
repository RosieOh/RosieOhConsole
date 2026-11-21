import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

const SPRING = { type: 'spring' as const, stiffness: 520, damping: 42, mass: 0.9 };
let seq = 0;

// 화면 탭 — 늘 제목 바로 아래 같은 자리(탭마다 다른 검색창·버튼은 탭 내용 안 도구 줄로). 탭을 바꿔도 아무것도 밀리지 않게
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: [T, React.ReactNode][]; value: T; onChange: (t: T) => void }) {
  // 탭 묶음이 여러 개 있어도 서로 알약이 날아가지 않게 묶음마다 다른 id
  const gid = useRef('tabs-' + ++seq).current;
  return (
    <nav className="tabs" role="tablist">
      <LayoutGroup id={gid}>
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={value === id} className={'tab' + (value === id ? ' on' : '')}
            onClick={() => { onChange(id); const next = location.hash.split('?')[0].split('/')[0] + '/' + id; if (location.hash !== next) history.pushState(null, '', next); }}>
            {value === id && <motion.span layoutId="tab-bg" className="tab-bg" transition={SPRING} />}
            <span className="tab-in">{label}</span>
          </button>
        ))}
      </LayoutGroup>
    </nav>
  );
}

/** 탭 내용 — 바뀔 때 교차된다. mode="wait" 라 나간 뒤 들어와서 높이가 겹치지 않는다. */
export function TabPanel({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={k}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0, transitionEnd: { transform: 'none' } }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}>
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/** 주소의 #페이지/탭 에서 탭 읽기 — 새로고침해도 같은 탭 */
export function tabFromHash<T extends string>(ids: T[], fallback: T): T {
  const t = location.hash.split('?')[0].split('/')[1] as T;
  return ids.includes(t) ? t : fallback;
}

/** 탭 상태 + 뒤로/앞으로 따라가기. useState(tabFromHash(...)) 자리에 그대로 쓴다. */
export function useHashTab<T extends string>(ids: T[], fallback: T): [T, (t: T) => void] {
  const [tab, setTab] = useState<T>(() => tabFromHash(ids, fallback));
  useEffect(() => {
    const sync = () => setTab(tabFromHash(ids, fallback));
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, [ids.join(','), fallback]);   // eslint-disable-line react-hooks/exhaustive-deps
  return [tab, setTab];
}

/** 주소의 ?이름=값 — 다른 화면에서 넘어올 때 어느 항목에 초점을 맞출지(#deploy/history?run=123) */
export function hashParam(name: string): string | null {
  const q = location.hash.split('?')[1];
  return q ? new URLSearchParams(q).get(name) : null;
}

/** 탭 내용 위 도구 줄 — 높이를 고정해 탭마다 내용이 같은 높이에서 시작 */
export function Toolbar({ children, right }: { children?: React.ReactNode; right?: React.ReactNode }) {
  return <div className="toolbar"><div className="toolbar-l">{children}</div><div className="toolbar-r">{right}</div></div>;
}
