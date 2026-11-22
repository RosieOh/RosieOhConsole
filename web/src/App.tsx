import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion, MotionConfig } from 'framer-motion';
import { api, Me } from './api';
import { CatalogProvider } from './catalog';
import { Avatar, UsersProvider } from './users';
import { LiquidBg } from './components/LiquidBg';
import { AuthPages } from './components/Login';
import { MyPage } from './components/MyPage';
import { Splash } from './components/Splash';
import { Overview } from './components/Overview';
import { Tools } from './components/Tools';
import { Docs } from './components/Docs';
import { MxTools } from './components/MxTools';
import { Apks } from './components/Apks';
import { Deploy } from './components/Deploy';
import { Runners } from './components/Runners';
import { Settings } from './components/Settings';
import { Secrets } from './components/Secrets';
import { Servers } from './components/Servers';
import { Flags } from './components/Flags';
import { Architecture } from './arch/Architecture';
import { FlowPage } from './flow/FlowPage';
import { BoardPage, prefetchBoard } from './board/BoardPage';
import './board/board.css';
import './grid';
import { BookOpen, ChevronDown, Code2, Cpu, FileText, FlaskConical, KanbanSquare, KeyRound, LayoutDashboard, LogOut, Moon, Network, Package, Rocket, Server, Settings as SettingsIcon, Sun, ToggleRight, Workflow, Wrench, Boxes, UserRound } from 'lucide-react';
import { applyTheme, currentTheme } from './theme';

// 틀(#131) — 검은 프레임 위쪽에 묶음 알약 메뉴, 고른 알약 아래로 맥북 노치처럼 검은 탭이 캔버스로 파고든다(스프링으로 따라감).
// 캔버스 왼쪽 레일은 그 묶음의 화면들, 아래 도크는 자주 가는 곳. 화면이 바뀔 때 살짝 떠오르며 바뀐다.
type Page = 'account' | 'overview' | 'deploy' | 'flow' | 'flags' | 'servers' | 'runners' | 'apks' | 'secrets' | 'mxtools' | 'architecture' | 'tools' | 'docs' | 'settings' | 'board' | 'report';
type Icon = React.ComponentType<{ size?: number; strokeWidth?: number }>;
type NavDef = { id: Page; label: string; icon: Icon; admin?: boolean };
/** 콘솔 밖으로 나가는 자리. 페이지가 아니라 새 탭으로 연다. */
type RailLink = { label: string; icon: Icon; href: string };
type Group = { id: string; label: string; icon: Icon; items: NavDef[]; links?: RailLink[]; admin?: boolean };
const GROUPS: Group[] = [
  { id: 'home', label: '개요', icon: LayoutDashboard, items: [{ id: 'overview', label: '개요', icon: LayoutDashboard }] },
  { id: 'deploy', label: '배포', icon: Rocket, items: [{ id: 'deploy', label: '배포', icon: Rocket }, { id: 'flow', label: '배포 흐름', icon: Workflow }, { id: 'flags', label: '기능 스위치', icon: ToggleRight }, { id: 'apks', label: 'APK', icon: Package }] },
  { id: 'infra', label: '인프라', icon: Boxes, items: [{ id: 'servers', label: '서버', icon: Server }, { id: 'runners', label: '러너', icon: Cpu }, { id: 'secrets', label: '시크릿', icon: KeyRound }, { id: 'architecture', label: '구성도', icon: Network }] },
  { id: 'board', label: '업무', icon: KanbanSquare, items: [{ id: 'board', label: '보드', icon: KanbanSquare }, { id: 'report', label: '주간보고', icon: FileText }] },
  {
    id: 'dev', label: '개발', icon: Code2,
    items: [{ id: 'docs', label: 'API 문서', icon: BookOpen }, { id: 'tools', label: 'Tools', icon: FlaskConical }, { id: 'mxtools', label: 'MX 도구', icon: Wrench }],
  },
  { id: 'settings', label: '설정', icon: SettingsIcon, admin: true, items: [{ id: 'settings', label: '설정', icon: SettingsIcon, admin: true }] },
];
const NAV = GROUPS.flatMap((g) => g.items);
// 메뉴에 없는 화면(마이페이지)은 개요 묶음 아래에 그린다
const groupOf = (p: Page) => GROUPS.find((g) => g.items.some((i) => i.id === p)) ?? GROUPS[0];

// 아래 도크 — 자주 가는 곳. 색은 파스텔 동그라미
const DOCK: { id: Page | 'board'; label: string; icon: Icon; tone: string }[] = [
  { id: 'deploy', label: '배포', icon: Rocket, tone: 'blue' },
  { id: 'flow', label: '배포 흐름', icon: Workflow, tone: 'lilac' },
  { id: 'apks', label: 'APK', icon: Package, tone: 'pink' },
  { id: 'servers', label: '서버', icon: Server, tone: 'yellow' },
  { id: 'board', label: '업무보드', icon: KanbanSquare, tone: 'lime' },
];

const initialPage = (): Page => {
  const h = location.hash.slice(1).split('?')[0].split('/')[0] as Page;
  return NAV.some((n) => n.id === h) || h === 'account' ? h : 'overview';
};
const SPRING = { type: 'spring', stiffness: 520, damping: 40, mass: 0.9 } as const;

function UserMenu({ me, onTheme, onAccount }: { me: Me & { authenticated: true }; onTheme: () => void; onAccount: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const f = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', f);
    return () => document.removeEventListener('mousedown', f);
  }, [open]);
  const ROLE = me.role === 'admin' ? '관리자' : me.role === 'deployer' ? '배포 담당' : '보기';
  const dark = currentTheme() === 'dark';
  return (
    <div className="fr-user" ref={ref}>
      <button className="fr-user-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Avatar login={me.login} size={30} />
        <span className="fr-user-txt"><b>{me.name || me.login}</b><small>{ROLE}</small></span>
        <ChevronDown size={15} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .2s' }} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className="fr-user-pop" initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.97 }} transition={{ duration: 0.16 }}>
            <button onClick={() => { onAccount(); setOpen(false); }}><UserRound size={15} />마이페이지</button>
            <button onClick={() => { onTheme(); setOpen(false); }}>{dark ? <Sun size={15} /> : <Moon size={15} />}{dark ? '밝게 보기' : '어둡게 보기'}</button>
            <button onClick={() => api.logout().then(() => location.replace('/'))}><LogOut size={15} />로그아웃</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [page, setPageState] = useState<Page>(initialPage);
  const [docsService, setDocsService] = useState<string | undefined>();
  const [, setThemeTick] = useState(0);

  /* 이스터 에그 — 'Rosie 콘솔' 꼬리표를 7번 연달아(한 번에 1.2초 안에) 누르면
     배경 오로라가 7초 동안 과충전된다. 누르다 쉬면 세던 수는 지워진다. */
  const taps = useRef({ n: 0, at: 0 });
  const [egg, setEgg] = useState(false);
  const stopDisco = useRef<(() => void) | null>(null);
  // Esc 로 언제든 중단 — 10초를 못 기다릴 수도 있다
  useEffect(() => {
    if (!egg) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { stopDisco.current?.(); setEgg(false); } };
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('keydown', esc); stopDisco.current?.(); };
  }, [egg]);
  const bump = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const now = Date.now();
    taps.current = { n: now - taps.current.at > 1200 ? 1 : taps.current.n + 1, at: now };
    if (taps.current.n >= 7) {
      taps.current = { n: 0, at: 0 };
      window.dispatchEvent(new CustomEvent('mx:aurora'));
      setEgg(true);
      import('./disco').then(({ playDisco }) => { stopDisco.current = playDisco(10000); });
      window.setTimeout(() => setEgg(false), 10000);
    }
  };

  /* 주소를 바꿀 때 replaceState 만 쓰면 히스토리에 아무것도 안 쌓여서 뒤로가기가
     앱 밖으로 나가 버린다. 사람이 누른 이동은 pushState 로 한 칸씩 쌓고,
     같은 자리로의 이동은 쌓지 않는다(연타해도 뒤로가기가 한 번에 돌아가게). */
  const nav = (target: string) => {
    const next = '#' + target;
    if (location.hash === next) return;
    history.pushState(null, '', next);
  };
  const setPage = (p: Page) => { setPageState(p); nav(p); };
  // 'deploy/history' 처럼 탭까지 — 그 화면이 주소의 탭을 읽는다
  const go = (target: string) => { const p = target.split('?')[0].split('/')[0]; nav(target); setPageState(p as Page); };
  const openDocs = (key: string) => { setDocsService(key); setPage('docs'); };
  const [flowFocus, setFlowFocus] = useState<string | undefined>();
  const openFlow = (key: string) => { setFlowFocus(key); setPage('flow'); };

  useEffect(() => { api.me().then(setMe).catch(() => setMe({ authenticated: false })); }, []);
  // 시작 로고는 잠깐이라도 보이게(0.7초) — 응답이 빠르면 깜빡이고 사라진다
  const [splashDone, setSplashDone] = useState(false);
  useEffect(() => { const t = window.setTimeout(() => setSplashDone(true), 700); return () => window.clearTimeout(t); }, []);

  /* 뒤로/앞으로 — 주소가 바뀌면 화면도 따라간다. 탭까지 바뀌는 경우는 각 화면이
     같은 popstate 를 듣고 자기 탭을 다시 읽는다(Tabs 의 useHashTab). */
  useEffect(() => {
    const sync = () => {
      const p = (location.hash.replace(/^#/, '').split('?')[0].split('/')[0] || 'overview') as Page;
      setPageState(p);
    };
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  if (me === null || !splashDone) return <Splash />;
  if (!me.authenticated) return <AuthPages />;
  const groups = GROUPS.filter((g) => !g.admin || me.admin);
  const g = groupOf(page);
  const rail = g.items.filter((n) => !n.admin || me.admin);
  const railCount = rail.length + (g.links?.length ?? 0);
  const toggleTheme = () => { applyTheme(currentTheme() === 'dark' ? 'light' : 'dark'); setThemeTick((x) => x + 1); };

  return (
    <MotionConfig reducedMotion="user">
    <CatalogProvider><UsersProvider>
      <div className={'frame' + (egg ? ' egg' : '')}>
        <LiquidBg />
        {egg && <div className="egg-toast" role="status">🪩 디스코 모드 · 10초 · Esc 로 중단</div>}
        <header className="fr-top">
          <a className="fr-brand" href="#overview" onClick={(e) => { e.preventDefault(); setPage('overview'); }}>
            <span className="brand-logo" aria-label="RosieOh" />
            <span className="fr-tag" onClick={bump} title="Rosie 콘솔">Rosie 콘솔</span>
          </a>
          <LayoutGroup id="topnav">
            <nav className="fr-nav" aria-label="메뉴 묶음">
              {groups.map((x) => {
                const on = x.id === g.id;
                return (
                  // 업무에 손이 올라가면 보드를 미리 받아 둔다 — 누르고 나서 받으면 한 박자 늦는다(#159)
                  <a key={x.id} href={'#' + x.items[0].id} className={'fr-pill' + (on ? ' on' : '')}
                    onMouseEnter={x.id === 'board' ? prefetchBoard : undefined}
                    onClick={(e) => { e.preventDefault(); if (!on) setPage(x.items[0].id); }}>
                    {on && <motion.span layoutId="fr-pill-bg" className="fr-pill-bg" transition={SPRING} />}
                    {on && <motion.span layoutId="fr-notch" className="fr-notch" transition={SPRING} aria-hidden />}
                    <span className="fr-pill-in"><x.icon size={15} strokeWidth={2} />{x.label}</span>
                  </a>
                );
              })}
            </nav>
          </LayoutGroup>
          <UserMenu me={me as Me & { authenticated: true }} onTheme={toggleTheme} onAccount={() => setPage('account')} />
        </header>

        <div className="fr-canvas">
          {railCount > 1 && (
            <LayoutGroup id="rail">
              <aside className="fr-rail" aria-label={g.label}>
                {rail.map((n) => {
                  const on = n.id === page;
                  return (
                    <a key={n.id} href={'#' + n.id} className={'fr-rail-item' + (on ? ' on' : '')}
                      onMouseEnter={n.id === 'board' || n.id === 'report' ? prefetchBoard : undefined}
                      onClick={(e) => { e.preventDefault(); setPage(n.id); }} title={n.label}>
                      <span className="fr-rail-ic">
                        {on && <motion.span layoutId="fr-rail-bg" className="fr-rail-bg" transition={SPRING} />}
                        <n.icon size={18} strokeWidth={1.9} />
                      </span>
                      <span className="fr-rail-label">{n.label}</span>
                    </a>
                  );
                })}
                {g.links?.map((l) => (
                  <a key={l.href} href={l.href} target="_blank" rel="noreferrer"
                    className="fr-rail-item fr-rail-ext" title={`${l.label} — 새 탭으로 열린다`}>
                    <span className="fr-rail-ic"><l.icon size={18} strokeWidth={1.9} /></span>
                    <span className="fr-rail-label">{l.label} ↗</span>
                  </a>
                ))}
              </aside>
            </LayoutGroup>
          )}
          <main className={'main fr-main' + (page === 'board' || page === 'report' ? ' fr-main-flush' : '')}>
            <AnimatePresence mode="wait" initial={false}>
              {/* ⚠ key 가 바뀌면 화면이 통째로 다시 만들어진다. 보드와 주간보고는
                  한 화면의 두 갈래라 같은 key 를 준다 — 안 그러면 둘을 오갈 때마다
                  BoardPage 가 버려져서 데이터를 다시 받고 등장 애니메이션도 다시
                  돈다(#159). #148 이 노린 '탭 전환처럼' 이 깨진다. */}
              <motion.div key={page === 'report' ? 'board' : page} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0, transitionEnd: { transform: 'none' } }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}>
                {page === 'overview' && <Overview go={go} onOpenComp={(k) => { location.hash = 'deploy'; setPage('deploy'); setTimeout(() => window.dispatchEvent(new CustomEvent('mxc:open-comp', { detail: k })), 50); }} />}
                {page === 'deploy' && <Deploy deployer={me.deployer} admin={me.admin} onOpenDocs={openDocs} onOpenFlow={openFlow} />}
                {page === 'servers' && <Servers deployer={me.deployer} />}
                {page === 'runners' && <Runners />}
                {page === 'flags' && <Flags deployer={me.deployer} />}
                {page === 'apks' && <Apks />}
                {page === 'secrets' && <Secrets admin={me.admin} />}
                {page === 'mxtools' && <MxTools />}
                {page === 'architecture' && <Architecture admin={me.admin} onOpenFlags={() => setPage('flags')} />}
                {page === 'flow' && <FlowPage focus={flowFocus} onOpenFlags={() => setPage('flags')} />}
                {(page === 'board' || page === 'report') && (
                  <BoardPage me={{ login: me.login, admin: me.admin }} sub={page} onSub={(s) => setPage(s)} />
                )}
                {page === 'tools' && <Tools />}
                {page === 'docs' && <Docs initial={docsService} />}
                {page === 'settings' && me.admin && <Settings me={me.login} />}
                {page === 'account' && <MyPage onChanged={() => api.me().then(setMe).catch(() => undefined)} />}
              </motion.div>
            </AnimatePresence>
          </main>

          <motion.nav className="fr-dock" aria-label="바로 가기" initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ ...SPRING, delay: 0.15 }}>
            {DOCK.map((d) => {
              const on = d.id === page;
              const props = { href: '#' + d.id, onClick: (e: React.MouseEvent) => { e.preventDefault(); setPage(d.id as Page); } };
              return (
                <motion.a key={d.id} {...props} className={'fr-dock-item ' + d.tone + (on ? ' on' : '')} aria-label={d.label}
                  onMouseEnter={d.id === 'board' ? prefetchBoard : undefined}
                  whileHover={{ scale: 1.22, y: -6 }} whileTap={{ scale: 0.92 }} transition={{ type: 'spring', stiffness: 500, damping: 22 }}>
                  <d.icon size={16} strokeWidth={2.1} />
                  <span className="fr-dock-tip">{d.label}</span>
                </motion.a>
              );
            })}
            <span className="fr-dock-sep" />
            <motion.button className="fr-dock-item plain" aria-label="테마 바꾸기" onClick={toggleTheme} whileHover={{ scale: 1.22, y: -6, rotate: 20 }} whileTap={{ scale: 0.9 }} transition={{ type: 'spring', stiffness: 500, damping: 22 }}>
              {currentTheme() === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              <span className="fr-dock-tip">{currentTheme() === 'dark' ? '밝게' : '어둡게'}</span>
            </motion.button>
          </motion.nav>
        </div>
      </div>
    </UsersProvider></CatalogProvider>
    </MotionConfig>
  );
}
