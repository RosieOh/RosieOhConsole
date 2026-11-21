import { CheckCircle2, Download, FlaskConical, GitBranch, GitMerge, Hash, Package, Play, Rocket, Settings2, ShieldCheck, Tag, Upload, XCircle } from 'lucide-react';
import type { LaneKind } from '../api';

// 갈래별 단계 — 아이콘과 한 줄 설명(비개발자도 읽게)
export const STEP_INFO: Record<LaneKind, { icon: any; desc: string }[]> = {
  testbed: [
    { icon: GitMerge, desc: '작업이 dev 에 합쳐지면 시작' },
    { icon: FlaskConical, desc: '자동 테스트' },
    { icon: Package, desc: '서버에 올릴 이미지 만들기' },
    { icon: Rocket, desc: '테스트배드에 새 버전 띄우기' },
    { icon: ShieldCheck, desc: '주소로 접속해 정상인지 확인' },
  ],
  prod: [
    { icon: GitMerge, desc: 'main 에 합치고 운영 배포 실행' },
    { icon: Settings2, desc: '서버 설정, 환경변수 확인' },
    { icon: Package, desc: '서버에 올릴 이미지 만들기' },
    { icon: Rocket, desc: '끊김 없이 새 버전으로 교체' },
    { icon: ShieldCheck, desc: '60초 동안 정상인지 지켜봄' },
  ],
  apk: [
    { icon: GitMerge, desc: 'main 에 합치면 시작' },
    { icon: Hash, desc: '버전 번호 올림' },
    { icon: Package, desc: '서명된 APK 만들기' },
    { icon: Tag, desc: '버전 기록 남기기' },
    { icon: Download, desc: 'APK 보관함에 올라감' },
  ],
  store: [
    { icon: GitMerge, desc: 'main 에 합치면 시작' },
    { icon: Settings2, desc: '빌드 준비' },
    { icon: GitBranch, desc: 'JS 만 바뀌면 OTA, 아니면 스토어' },
    { icon: Upload, desc: 'OTA 배포 또는 스토어 업로드' },
    { icon: Tag, desc: '버전 기록 남기기' },
  ],
  // 앱 테스트 빌드(#182): 개발 서버 연동 빌드, 고객에게 나가지 않는다
  apptest: [
    { icon: GitMerge, desc: '작업이 dev 에 합쳐지면 시작' },
    { icon: Hash, desc: '직전 버전에서 테스트 버전 올림' },
    { icon: Package, desc: '개발 서버를 보는 APK, iOS 만들기' },
    { icon: Download, desc: 'APK 보관함 내부 테스트, TestFlight 에 올라감' },
  ],
};

export type StepState = 'done' | 'now' | 'next' | 'fail';

export function StepBar({ lane, labels, states, color, caption, onPlay, playing }: {
  lane: LaneKind; labels: string[]; states: StepState[]; color: string; caption: React.ReactNode; onPlay?: () => void; playing?: boolean;
}) {
  const info = STEP_INFO[lane];
  return (
    <div className="stepbar">
      <div className="stepbar-top">
        <span className="stepbar-cap">{caption}</span>
        {onPlay && <button className="btn sm" onClick={onPlay} disabled={playing}><Play size={14} />{playing ? '재생 중' : '처음부터 재생'}</button>}
      </div>
      <ol className="steps" style={{ '--lane': color } as any}>
        {labels.map((l, i) => {
          const I = states[i] === 'done' ? CheckCircle2 : states[i] === 'fail' ? XCircle : info[i]?.icon ?? Package;
          return (
            <li key={i} className={'step ' + states[i]}>
              <span className="step-dot"><I size={18} /></span>
              <span className="step-label">{l}</span>
              <span className="step-desc">{info[i]?.desc}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
