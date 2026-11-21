import { render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { Card, ReportData } from '../lib/types';
import { CardView } from './CardView';
import { Sidebar } from './Sidebar';
import { ReportPage } from './ReportPage';
import { UnlinkedList } from './UnlinkedList';

const card = (over: Partial<Card> = {}): Card => ({
  repo: 'RosieOh/demo-web', number: 66, title: '데모 웹 UI 개선', url: 'http://g/RosieOh/x/issues/66',
  assignees: ['carol'], milestone: 'M', due: null, overdue: false, stale: false, flags: [], stage: 'started',
  human: null, manual: false, derivedStage: 'started', prevStage: null, evidence: [], disagree: false, dupStage: false, ...over,
});

test('카드: 사람이 정한 단계와 기록이 다르면 "사람이 정함"과 "기록: 리뷰 중"을 보여 준다', () => {
  render(<CardView card={card({ stage: 'started', human: 'started', manual: true, derivedStage: 'review', disagree: true })} />);
  expect(screen.getByText('사람이 정함')).toBeInTheDocument();
  expect(screen.getByText('기록: 리뷰 중')).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'carol' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'demo-web#66' })).toHaveAttribute('href', 'http://g/RosieOh/x/issues/66');
});

test('카드: 제목에 넣은 태그는 글자로만 보인다', () => {
  const { container } = render(<CardView card={card({ title: '</div><img src=x onerror=alert(1)>' })} />);
  expect(container.querySelector('img')).toBeNull();
  expect(screen.getByText('</div><img src=x onerror=alert(1)>')).toBeInTheDocument();
});

test('카드: 지연·막힘은 빨간 딱지, 정체는 노란 딱지', () => {
  render(<CardView card={card({ overdue: true, stale: true, flags: ['blocked'], due: '2026-09-20T00:00:00Z' })} />);
  expect(screen.getByText('지연').className).toMatch(/chip-d/);
  expect(screen.getByText('막힘').className).toMatch(/chip-d/);
  expect(screen.getByText('정체').className).toMatch(/chip-w/);
});

const sidebar = (admin: boolean) => render(
  <Sidebar cards={[card(), card({ number: 3, assignees: ['bob'] })]} me={{ login: 'alice', admin }} view="all" who="" repo="" batchAt={null}
    counts={{ all: 2, mine: 0, risk: 0, unlinked: 0 }} onView={() => {}} onWho={() => {}} onRepo={() => {}} onViewers={() => {}} onRepos={() => {}} />);

test('사이드바: 담당·저장소 제목에 아이콘이 있고, 관리 메뉴는 관리자에게만 보인다', () => {
  const { unmount } = sidebar(false);
  expect(screen.getByRole('navigation', { name: '담당' }).querySelector('h4 svg')).not.toBeNull();
  expect(screen.getByRole('navigation', { name: '저장소' }).querySelector('h4 svg')).not.toBeNull();
  expect(screen.queryByRole('navigation', { name: '관리' })).toBeNull();
  unmount();
  sidebar(true);
  const admin = screen.getByRole('navigation', { name: '관리' });
  expect(within(admin).getByText('열람 권한')).toBeInTheDocument();
  expect(within(admin).getByText('저장소')).toBeInTheDocument();
});

const report: ReportData = { ok: true, week: '09.28~10.02', weekFound: true, legacyRemoved: 0, projects: [
  { name: '데모 웹', repos: ['RosieOh/x'], milestone: '', tasks: [], auto: '[실적]\n- 없음', text: '[실적]\n- 데모 웹 완료 (#66)', edited: true,
    editedBy: 'bob', editedAt: '2026-10-01T08:00:00Z', reflectedAt: null, reflectedBy: null, sheetText: '', status: 'edited',
    warnings: ['"데모 웹"은(는) 아직 리뷰 중 단계인데 "완료"로 적혀 있습니다'] },
  { name: '데모 앱', repos: ['RosieOh/m'], milestone: '', tasks: [], auto: 'a', text: 'a', edited: false, editedBy: null, editedAt: null,
    reflectedAt: null, reflectedBy: null, sheetText: '', status: 'auto', warnings: [] },
] };

test('주간보고: 완료 오류 경고를 보여 주고, 전체 반영은 두 번 눌러야 실행된다', async () => {
  const calls: Array<{ url: string; body?: unknown }> = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(String(url) === '/board/api/report' && !init?.body ? report : { ok: true }), { status: 200 });
  });
  const user = userEvent.setup();
  await act(async () => { render(<ReportPage me="alice" active />); });
  expect(await screen.findByText(/아직 리뷰 중 단계인데 "완료"로/)).toBeInTheDocument();
  const all = screen.getByRole('button', { name: '전체 반영 (2)' });
  await user.click(all);
  expect(calls.filter((c) => (c.body as { action?: string })?.action === 'reflect')).toHaveLength(0);
  expect(screen.getByRole('button', { name: /2개 프로젝트를 반영할까요/ })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /2개 프로젝트를 반영할까요/ }));
  expect(calls.filter((c) => (c.body as { action?: string })?.action === 'reflect').map((c) => (c.body as { project: string }).project)).toEqual(['데모 웹', '데모 앱']);
  vi.restoreAllMocks();
});

test('미연결 작업: PR·브랜치를 보여 주고 필터를 따른다', () => {
  const items = [
    { kind: 'pr' as const, repo: 'RosieOh/x', number: 4, branch: 'feat/a', title: '재시도', author: 'bob', updated: '2026-10-06T05:00:00Z', url: 'http://g/RosieOh/x/pulls/4' },
    { kind: 'branch' as const, repo: 'RosieOh/y', branch: 'feat/b', title: '작업만', author: 'carol', updated: null, url: 'http://g/RosieOh/y/src/branch/feat/b' },
  ];
  const { getByText, queryByText, rerender } = render(<UnlinkedList items={items} at={null} q="" who="" repo="" />);
  expect(getByText('PR #4')).toBeTruthy();
  expect(getByText('작업만')).toBeTruthy();
  rerender(<UnlinkedList items={items} at={null} q="" who="bob" repo="" />);
  expect(queryByText('작업만')).toBeNull();
  rerender(<UnlinkedList items={[]} at={null} q="" who="" repo="" />);
  expect(getByText(/미연결 작업이 없습니다/)).toBeTruthy();
});

/**
 * 배포를 두 번 멈춘 것이 이 자리다(#154). 축하 효과는 캔버스와 Web Animations 를
 * 쓰는데 jsdom 에는 둘 다 없다. 막아 두지 않으면 테스트가 끝난 뒤 프레임이
 * 돌면서 잡히지 않는 예외가 나고, vitest 는 그걸 실패로 센다 — 로컬에서는
 * 테스트가 먼저 끝나 버려 안 보이고 느린 CI 에서만 터지는 종류다.
 */
test('축하 효과: 그릴 수 없는 곳에서는 조용히 넘어간다', async () => {
  const { bloom, cheer, reflected, shockwave } = await import('../lib/cheer');
  const at = { x: 10, y: 10 };
  expect(() => { cheer('done', at); reflected(at, true); shockwave(at, '#3df5b0'); }).not.toThrow();
  expect(() => bloom(document.createElement('div'))).not.toThrow();
  // 프레임이 한 바퀴 돌 틈을 준다 — 터진다면 여기서 터진다
  await new Promise((r) => setTimeout(r, 120));
  expect(document.querySelectorAll('canvas').length).toBe(0);
});
