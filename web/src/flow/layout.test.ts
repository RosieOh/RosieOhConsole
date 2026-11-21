import { describe, expect, it } from 'vitest';
import { LANE_COLOR, LANE_NAME } from '../api';
import { SEG_OF_STAGE } from './layout';

// 갈래를 더할 때 도식 표를 빠뜨리면 그 갈래가 실행되는 순간 배포 흐름 화면이 통째로 멈춘다(#182)
describe('배포 흐름 갈래 표', () => {
  it('모든 갈래에 색, 이름, 선분 표가 있다', () => {
    for (const lane of Object.keys(LANE_COLOR)) {
      expect(LANE_NAME[lane as keyof typeof LANE_NAME], lane).toBeTruthy();
      expect(SEG_OF_STAGE[lane as keyof typeof SEG_OF_STAGE]?.length, lane).toBeGreaterThan(0);
    }
    expect(Object.keys(SEG_OF_STAGE).sort()).toEqual(Object.keys(LANE_COLOR).sort());
  });
});
