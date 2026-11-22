// 배포 흐름(서비스별 파이프라인) — 커밋 → 빌드 → 배포 → 사이트.
// GitHub Deployments 환경(github-pages·Vercel Production·콘솔 production)이 있는 구성요소만, GraphQL 한 번으로 전부 읽는다
// (REST 는 저장소마다 여러 번 불러야 하고 한도도 콘솔 전체와 나눠 쓴다 — GraphQL 은 한도가 따로다)

export type StageState = 'done' | 'running' | 'queued' | 'failed' | 'skipped' | 'idle';
export type Provider = 'pages' | 'vercel' | 'actions';

export interface PipeTarget { key: string; name: string; repo: string; owner: string; repoName: string; environment: string; site?: string; logo?: string | null }
export interface PipeStage { state: StageState; title: string; detail?: string; url?: string; at?: string | null; endedAt?: string | null }
export interface PipeDeploy { id: number; sha: string; message: string; state: StageState; at: string; endedAt?: string | null; url?: string }
export interface Pipeline {
  key: string; name: string; repo: string; logo?: string | null; provider: Provider; environment: string; site?: string;
  active: boolean;                       // 빌드나 배포가 도는 중
  stages: { commit: PipeStage; build: PipeStage; deploy: PipeStage };
  history: PipeDeploy[];                 // 최근 배포(새것부터)
  lastDeployAt: string | null;
  error?: string;
}

const SUITE = `checkSuites(first: 10) { nodes { app { slug } status conclusion workflowRun { databaseId url createdAt updatedAt workflow { name } } } }`;

/** 구성요소마다 별칭 r0, r1 … 로 묶은 질의 하나 */
export function pipelineQuery(targets: PipeTarget[]): string {
  const parts = targets.map((t, i) => `r${i}: repository(owner: ${JSON.stringify(t.owner)}, name: ${JSON.stringify(t.repoName)}) {
    defaultBranchRef { target { ... on Commit { oid messageHeadline committedDate ${SUITE} } } }
    deployments(last: 5, environments: [${JSON.stringify(t.environment)}], orderBy: { field: CREATED_AT, direction: ASC }) {
      nodes { databaseId createdAt creator { login } latestStatus { state createdAt logUrl environmentUrl } commit { oid messageHeadline committedDate ${SUITE} } }
    }
  }`);
  return `query { ${parts.join('\n')} }`;
}

/** 배포 상태(GitHub DeploymentStatusState) → 단계 상태. INACTIVE 는 다음 배포로 바뀐 옛 성공 */
export function deployState(s?: string | null): StageState {
  switch (s) {
    case 'SUCCESS': case 'INACTIVE': return 'done';
    case 'IN_PROGRESS': return 'running';
    case 'FAILURE': case 'ERROR': return 'failed';
    default: return 'queued';   // QUEUED·PENDING·WAITING·상태 없음
  }
}

/** Actions 체크 묶음 → 단계 상태 */
export function suiteState(s: { status?: string; conclusion?: string | null }): StageState {
  if (s.status === 'IN_PROGRESS') return 'running';
  if (s.status !== 'COMPLETED') return 'queued';
  switch (s.conclusion) {
    case 'SUCCESS': return 'done';
    case 'SKIPPED': case 'NEUTRAL': case 'STALE': return 'skipped';
    default: return 'failed';   // FAILURE·TIMED_OUT·CANCELLED·STARTUP_FAILURE·ACTION_REQUIRED
  }
}

const runIdOf = (url?: string | null) => Number(/\/actions\/runs\/(\d+)/.exec(url || '')?.[1] || 0);
const actionsSuites = (commit: any) => ((commit?.checkSuites?.nodes || []) as any[]).filter((s) => s?.app?.slug === 'github-actions' && s.workflowRun);
const commitUrl = (repo: string, oid: string) => `https://github.com/${repo}/commit/${oid}`;
const commitStage = (repo: string, c: any): PipeStage => ({ state: 'done', title: '커밋', detail: `${String(c.oid).slice(0, 7)} ${c.messageHeadline || ''}`.trim(), url: commitUrl(repo, c.oid), at: c.committedDate ?? null });
const isRunning = (s: StageState) => s === 'running' || s === 'queued';

/** 저장소 하나의 질의 결과 → 파이프라인 */
export function toPipeline(t: PipeTarget, d: any): Pipeline {
  const base = { key: t.key, name: t.name, repo: t.repo, logo: t.logo ?? null, environment: t.environment, site: t.site };
  const idle = (title: string, detail?: string): PipeStage => ({ state: 'idle', title, detail });
  if (!d) {
    return { ...base, provider: t.environment === 'github-pages' ? 'pages' : 'actions', active: false, lastDeployAt: null, history: [], error: '저장소를 읽지 못했습니다',
      stages: { commit: idle('커밋'), build: idle('빌드'), deploy: idle('배포') } };
  }
  const deps: any[] = [...(d.deployments?.nodes || [])].reverse();   // 새것부터
  const latest = deps[0];
  const head = d.defaultBranchRef?.target;
  const provider: Provider = t.environment === 'github-pages' ? 'pages' : /vercel/i.test(latest?.creator?.login || '') ? 'vercel' : 'actions';

  // 배포를 만든 워크플로 — 마지막 배포의 로그 주소(…/actions/runs/<id>/…)로 그 커밋의 실행을 찾는다
  const deployRun = latest ? actionsSuites(latest.commit).find((s) => s.workflowRun.databaseId === runIdOf(latest.latestStatus?.logUrl)) : undefined;
  const deployer: string | undefined = deployRun?.workflowRun.workflow?.name;

  const history: PipeDeploy[] = deps.map((x) => {
    const st = deployState(x.latestStatus?.state);
    return { id: x.databaseId, sha: String(x.commit?.oid || '').slice(0, 7), message: x.commit?.messageHeadline || '', state: st, at: x.createdAt,
      endedAt: st === 'done' || st === 'failed' ? x.latestStatus?.createdAt ?? null : null, url: x.latestStatus?.logUrl || undefined };
  });
  const out = (stages: Pipeline['stages']): Pipeline => ({ ...base, provider, stages, history, lastDeployAt: latest?.createdAt ?? null,
    active: isRunning(stages.build.state) || isRunning(stages.deploy.state) });

  // 1) main 의 최신 커밋이 아직 배포되지 않았고, 배포 워크플로가 그 커밋에서 돌고 있거나 실패했다(Actions 기반만 — Vercel 은 배포를 바로 만든다)
  if (provider !== 'vercel' && head?.oid && head.oid !== latest?.commit?.oid) {
    const suites = actionsSuites(head);
    const s = (deployer ? suites.find((x) => x.workflowRun.workflow?.name === deployer) : undefined) ?? (!latest ? suites[0] : undefined);
    if (s) {
      const st = suiteState(s);
      if (st === 'running' || st === 'queued' || st === 'failed') {
        const wr = s.workflowRun;
        return out({
          commit: commitStage(t.repo, head),
          build: { state: st, title: '빌드', detail: wr.workflow?.name, url: wr.url, at: wr.createdAt, endedAt: st === 'failed' ? wr.updatedAt : null },
          deploy: st === 'failed' ? { state: 'skipped', title: '배포', detail: '빌드 실패로 배포 안 함' } : { state: 'idle', title: '배포', detail: t.environment },
        });
      }
    }
  }

  // 2) 마지막 배포
  if (!latest) return out({ commit: head?.oid ? commitStage(t.repo, head) : idle('커밋'), build: idle('빌드'), deploy: idle('배포', '배포 기록 없음') });
  const ds = deployState(latest.latestStatus?.state);
  const ended = ds === 'done' || ds === 'failed' ? latest.latestStatus?.createdAt ?? null : null;
  const deployUrl = latest.latestStatus?.logUrl || latest.latestStatus?.environmentUrl || undefined;
  let build: PipeStage; let deploy: PipeStage;
  if (provider === 'vercel') {
    // Vercel 은 빌드와 배포가 한 덩어리 — 배포 상태 하나로 둘을 그린다
    build = { state: ds === 'failed' ? 'failed' : isRunning(ds) ? ds : 'done', title: '빌드', detail: 'Vercel', url: deployUrl, at: latest.createdAt, endedAt: ended };
    deploy = ds === 'failed' ? { state: 'skipped', title: '배포', detail: '빌드 실패' }
      : { state: isRunning(ds) ? 'idle' : 'done', title: '배포', detail: t.environment, url: deployUrl, at: ended };
  } else {
    const wr = deployRun?.workflowRun;
    // 배포 작업이 시작됐으면 빌드는 끝난 것 — 체크 묶음은 배포 작업까지 끝나야 완료가 된다
    build = { state: 'done', title: '빌드', detail: wr?.workflow?.name || 'GitHub Actions', url: wr?.url, at: wr?.createdAt ?? null, endedAt: latest.createdAt };
    deploy = { state: ds, title: '배포', detail: t.environment, url: deployUrl, at: latest.createdAt, endedAt: ended };
  }
  return out({ commit: commitStage(t.repo, latest.commit), build, deploy });
}
