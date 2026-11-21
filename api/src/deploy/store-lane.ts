// 부모앱 릴리스(공용 템플릿 app-store-release · 예전 release.yml) 한 번이 어느 갈래로 나갔나 — jobs 의 단계 이름으로 본다.
//   "OTA 배포 …" 성공 → ota · "스토어 빌드 …" 성공 → store · "dry-run …" 성공 → dry-run · 판정만 돌고 둘 다 건너뜀 → none
export type StoreLane = 'ota' | 'store' | 'dry-run' | 'none' | 'failed';

export interface Step { name: string; status?: string; conclusion?: string | null }

export function readStoreLane(steps: Step[], runConclusion: string): StoreLane {
  const ok = (re: RegExp) => steps.some((s) => re.test(s.name) && s.conclusion === 'success');
  if (ok(/스토어 빌드/)) return 'store';
  if (ok(/OTA 배포/)) return 'ota';
  if (ok(/dry-run/i)) return 'dry-run';
  if (runConclusion !== 'success') return 'failed';
  return 'none';
}

/** store/1.3.5 → 1.3.5 — 숫자 비교로 가장 높은 버전 */
export function latestStoreTag(tags: string[], prefix = 'store/'): string | null {
  const vs = tags.filter((t) => t.startsWith(prefix)).map((t) => t.slice(prefix.length)).filter((v) => /^\d+(\.\d+)*$/.test(v));
  vs.sort((a, b) => {
    const x = a.split('.').map(Number), y = b.split('.').map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
    return 0;
  });
  return vs[0] ?? null;
}
