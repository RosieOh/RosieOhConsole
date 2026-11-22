import { describe, expect, it } from 'vitest';
import { ago, order, span } from './Pipelines';
import type { Pipeline, StageState } from '../api';

const NOW = Date.parse('2026-11-22T12:00:00Z');
const p = (key: string, o: { active?: boolean; build?: StageState; at?: string | null }): Pipeline => ({
  key, name: key, repo: `RosieOh/${key}`, provider: 'pages', environment: 'github-pages', active: !!o.active, history: [], lastDeployAt: o.at ?? null,
  stages: { commit: { state: 'done', title: '커밋' }, build: { state: o.build ?? 'done', title: '빌드' }, deploy: { state: 'done', title: '배포' } },
});

describe('배포 흐름', () => {
  it('지난 시간', () => {
    expect(ago('2026-11-22T11:59:30Z', NOW)).toBe('방금');
    expect(ago('2026-11-22T11:55:00Z', NOW)).toBe('5분 전');
    expect(ago('2026-11-22T09:00:00Z', NOW)).toBe('3시간 전');
    expect(ago('2026-11-20T12:00:00Z', NOW)).toBe('2일 전');
    expect(ago(null, NOW)).toBe('');
  });
  it('걸린 시간', () => {
    expect(span('2026-11-22T11:59:15Z', '2026-11-22T11:59:57Z')).toBe('42초');
    expect(span('2026-11-22T11:58:00Z', '2026-11-22T11:59:12Z')).toBe('1분 12초');
    expect(span('2026-11-22T11:59:00Z', null, NOW)).toBe('1분 0초');
  });
  it('진행 중 → 실패 → 최근 배포 순', () => {
    const list = order([
      p('old', { at: '2026-01-01T00:00:00Z' }),
      p('new', { at: '2026-11-20T00:00:00Z' }),
      p('fail', { build: 'failed', at: '2025-01-01T00:00:00Z' }),
      p('none', { at: null }),
      p('run', { active: true, at: '2024-01-01T00:00:00Z' }),
    ]);
    expect(list.map((x) => x.key)).toEqual(['run', 'fail', 'new', 'old', 'none']);
  });
});
