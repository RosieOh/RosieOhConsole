import { STAGES, STAGE_KO } from './stages';
import { orbBackground, undoPlan, dueText, needsCheck } from './format';
import { STAGES as SERVER_STAGES, STAGE_KO as SERVER_KO } from '../../../../api/src/board/derive';

test('단계 목록·이름은 서버(api/src/board/derive.ts)와 같다', () => {
  expect(STAGES).toEqual([...SERVER_STAGES]);
  for (const s of STAGES) expect(STAGE_KO[s]).toBe(SERVER_KO[s]);
});

test('되돌리기: 기록을 따르던 카드는 기록 따르기, 사람이 정한 카드는 원래 칸으로', () => {
  expect(undoPlan({ from: 'started', prevHuman: null })).toEqual({ path: '/api/follow' });
  expect(undoPlan({ from: 'unstaged', prevHuman: null })).toEqual({ path: '/api/follow' });
  expect(undoPlan({ from: 'planned', prevHuman: 'planned' })).toEqual({ path: '/api/move', to: 'planned' });
});

test('오브는 아이디마다 정해져 있고 사람마다 다르다', () => {
  expect(orbBackground('alice')).toBe(orbBackground('alice'));
  expect(orbBackground('alice')).not.toBe(orbBackground('bob'));
});

test('마감 문구와 확인 필요 기준', () => {
  const now = Date.parse('2026-09-28T03:00:00Z');
  expect(dueText('2026-10-08T14:59:59Z', now)).toBe('10-08 10일 남음');
  expect(dueText('2026-09-26T14:59:59Z', now)).toBe('09-26 2일 지남');
  expect(needsCheck({ overdue: false, flags: [] })).toBe(false);
  expect(needsCheck({ overdue: false, flags: ['blocked'] })).toBe(true);
});
