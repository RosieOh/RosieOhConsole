import { describe, expect, it } from 'vitest';
import { CX, compactLayout } from './layout';
import { connectedOnly } from './SystemFlow';
import type { FlowGraph } from '../api';

const comp = (key: string, project: string) => ({ key, name: key, project, kind: 'web' }) as any;
const G: FlowGraph = {
  projects: [{ id: 'g', type: 'group', name: '그룹', children: [
    { id: 'p1', type: 'project', name: 'p1', children: [] }, { id: 'p2', type: 'project', name: 'p2', children: [] }, { id: 'p3', type: 'project', name: 'p3', children: [] },
  ] }] as any,
  components: [comp('a', 'p1'), comp('b', 'p2'), comp('lonely', 'p3')],
  infra: [{ id: 'db:a', kind: 'db', name: 'a DB' }, { id: 'redis:a', kind: 'redis', name: 'a Redis' }, { id: 'ext:aws', kind: 'external', name: 'aws' }],
  virtual: [{ id: 'v:host-pages', kind: 'server', name: 'GitHub Pages' }],
  lanes: [],
  relations: [
    { id: '1', from: 'comp:a', to: 'db:a', via: '', state: 'auto' },
    { id: '2', from: 'comp:a', to: 'redis:a', via: '', state: 'auto' },
    { id: '3', from: 'comp:a', to: 'ext:aws', via: '', state: 'auto' },
    { id: '4', from: 'comp:b', to: 'ext:aws', via: '', state: 'auto' },
    { id: 'deploy:b', from: 'comp:b', to: 'v:host-pages', via: '배포', state: 'deploy' },
  ],
  stages: {} as any,
};

describe('구성도', () => {
  it('연결 없는 구성요소와 빈 프로젝트는 숨긴다', () => {
    const s = connectedOnly(G, false);
    expect(s.graph.components.map((c) => c.key)).toEqual(['a', 'b']);
    expect((s.graph.projects[0] as any).children.map((n: any) => n.id)).toEqual(['p1', 'p2']);
    expect(s.hidden).toBe(1);
    expect(connectedOnly(G, true).graph.components).toHaveLength(3);
  });
  it('혼자 쓰는 것은 그 서비스 옆, 같이 쓰는 것·배포 대상은 오른쪽 열', () => {
    const { placed } = compactLayout(connectedOnly(G, false).graph);
    const at = (id: string) => placed.find((p) => p.id === id)!;
    expect(at('db:a').x).toBe(CX.own);
    expect(at('redis:a').x).toBe(CX.own);
    expect(at('ext:aws').x).toBe(CX.shared);        // a·b 가 같이 쓴다
    expect(at('v:host-pages').x).toBe(CX.shared);   // 배포 대상은 늘 오른쪽
    // a 의 줄은 자기 것 두 개를 품는다 — b 는 그 아래
    expect(at('comp:b').y).toBeGreaterThan(at('redis:a').y);
    expect(placed.some((p) => p.kind === 'project')).toBe(false);   // 프로젝트 틀은 그리지 않는다
  });
});
