import type { ComponentDef, ComponentKind, NodeDef } from './types.js';
import type { Endpoint } from '../registry.js';

// 카탈로그 기본값 — 그룹 → 프로젝트 → 구성요소. RosieOh 의 저장소(포크·프로필 저장소 제외) + 조직 저장소('<조직>/<저장소>'), 2026-11-21 기준.
// 이름·로고·소속·순서는 화면(설정 › 서비스 카탈로그)에서 바꾼다(편집값이 이긴다). 새 저장소는 화면에서 추가해도 된다.
// 기술 연결(헬스 주소·배포 워크플로·되돌리기)은 여기 코드로 적는다 — 지금은 공개 사이트가 있는 것만 운영 헬스를 단다.
//
// 종류(kind): backend = 서버·CLI·라이브러리·노트북 등 화면이 없는 코드, web = 웹·정적 사이트·데스크톱 UI, device-app = 안드로이드 기기앱

type C = [key: string, name: string, kind: ComponentKind, repo: string, extra?: { prod?: Endpoint; note?: string }];
type P = [id: string, name: string, comps: C[]];
type G = [id: string, name: string, projects: P[]];

const site = (url: string): Endpoint => ({ health: url, link: url });

const TREE: G[] = [
  ['ai', 'AI·LLM', [
    ['trove', 'Trove', [['trove', 'Trove', 'web', 'trove', { note: 'Claude Code 기록 검색·보관 데스크톱 앱(Electron)' }]]],
    ['illinare', 'Illinare', [['illinare', 'Illinare', 'web', 'Illinare', { note: '개인 업무용 AI 인터랙션' }]]],
    ['claude-tools', 'Claude 도구', [
      ['claude-bridge', 'Claude Bridge', 'backend', 'Claude_Bridge', { note: '토큰 사용량을 맥북에서 실시간 확인하는 프록시 중계 서버' }],
      ['promptory', 'Promptory', 'web', 'Promptory', { note: 'Claude Code 프롬프트 히스토리 모니터링 익스텐션' }],
    ]],
    ['mcp', 'MCP 서버', [
      ['korean-notice-mcp', '공고 비교 MCP', 'backend', 'korean-notice-mcp', { note: 'HWP/HWPX 공고의 신청조건·제출서류 변경 비교' }],
      ['korea-benefits-mcp', '정부 지원금 MCP', 'backend', 'korea-benefits-mcp', { note: '보조금24 자격조건 판정' }],
    ]],
    ['llm-ops', 'LLM 운영', [
      ['roundhouse', 'RoundHouse', 'backend', 'RoundHouse', { note: 'Kubernetes 위 LiteLLM 게이트웨이(SLO·오토스케일링)' }],
      ['vecshift', 'VecShift', 'backend', 'VecShift', { note: 'Milvus 임베딩 모델 무중단 교체 하네스' }],
      ['otel-canary', 'otel-canary', 'backend', 'otel-canary', { note: 'LLM 관측 SDK × OpenTelemetry 호환성 매일 점검' }],
    ]],
    ['autofillfit', 'AutoFillFit', [['autofillfit', 'AutoFillFit', 'web', 'AutoFillFit', { note: '채용정보 자동 입력 Chrome 확장' }]]],
  ]],
  ['platform', '플랫폼·인프라', [
    ['console', 'Rosie 콘솔', [['console', 'Rosie 콘솔', 'web', 'RosieOhConsole', { note: '이 콘솔' }]]],
    ['aetherdesk', 'AetherDesk', [['aetherdesk', 'AetherDesk', 'web', 'AetherDesk', { note: 'Dockerode + Traefik 멀티테넌트 웹 클라우드 데스크톱' }]]],
    ['basketshared', 'BasketShared', [['basketshared', 'BasketShared', 'backend', 'BasketShared', { note: 'FTP 연동 S3 방식 바스킷 자동화 모듈' }]]],
    ['monitoring-mw', '모니터링 중개서버', [['monitoring-mw', '모니터링 중개서버', 'backend', 'Monitoring_MiddleWare']]],
  ]],
  ['backend', '백엔드 서비스', [
    ['tosspay', '토스 결제 서버', [['toss-api', '토스 결제 서버', 'backend', 'tossApi', { note: '승인·취소·웹훅·결과 불명 보정' }]]],
    ['kopring-core', 'Kopring Core', [['kopring-core', 'Kopring Core', 'backend', 'Kopring_Core']]],
    ['tspoon', '티스푼 차세대', [['tspoon', '티스푼', 'backend', 'tSpoon', { note: '레거시 Maven 프로젝트 차세대 전환' }]]],
    ['ipcc', 'IPCC 플레이그라운드', [['ipcc', 'IPCC 플레이그라운드', 'backend', 'IPCC_PlayGround', { note: '콜 인프라 CTI 수신호·호전환 학습' }]]],
    ['mediplug', 'MediPlug', [['mediplug', 'MediPlug', 'backend', 'MediPlug', { note: '병원 EMR 구축' }]]],
    ['insurance', '보험 시스템', [['insurance', '보험 시스템', 'backend', 'Insurance_System', { note: '보험사 대외계·계정계 인터페이스' }]]],
    ['n8n-bridge', 'n8n 중계서버', [['n8n-bridge', 'n8n 중계서버', 'backend', 'SpringBoot_n8n']]],
    ['hoonshop', 'hoonShop', [['hoonshop', 'hoonShop', 'backend', 'hoonShop']]],
    ['sb-components', 'SpringBoot 컴포넌트', [['sb-components', 'SpringBoot 컴포넌트(MSA)', 'backend', 'SpringBoot_Components']]],
  ]],
  ['web', '웹·블로그', [
    ['daedong', '대동여지도', [['daedong', '대동여지도', 'web', 'DaeDongYeoJiDo', { prod: site('https://rosieoh.github.io/DaeDongYeoJiDo/'), note: '수묵 산수화 여행 지도 + 무협풍 3D 시뮬레이션' }]]],
    ['blog', '블로그', [
      ['betweenthelines', 'BetweenTheLines', 'web', 'BetweenTheLines', { note: '리뉴얼 기술 블로그' }],
      ['rosietechblog', 'RosieTechBlog', 'web', 'RosieTechBlog', { prod: site('https://rosiesblog.vercel.app') }],
      ['devshiplog', 'DevShiplog', 'web', 'DevShiplog', { note: '개발 블로그 작성 플랫폼' }],
    ]],
    ['chagok', '차곡 리포트', [['chagok-report', '차곡 고객 리포트', 'web', 'chagok-report', { note: 'QR 로 여는 정적 페이지' }]]],
    ['palladium', 'Palladium', [['create-palladium', 'Create-Palladium', 'web', 'Create-Palladium', { note: 'React + Vite + TS 웹 빌더' }]]],
    ['poklog', 'Pok-Log', [['poklog', 'Pok-Log', 'web', 'Pok-Log', { note: 'Vue 포켓몬 도감' }]]],
    ['devdash', 'DevDash', [['devdash', 'DevDash', 'web', 'DevDash', { note: 'Perry 프레임워크 학습' }]]],
  ]],
  ['apps', '앱·디바이스', [
    ['drivercare', 'DriverCare', [['drivercare', 'DriverCare', 'device-app', 'DriverCare', { note: '커넥티드 차량 인포테인먼트' }]]],
    ['sedo-kiosk', 'SEDO 키오스크', [['sedo-kiosk', 'SEDO MES 키오스크', 'web', 'SEDO_IHMES_Kiosk', { note: '베트남 공장 장비 인터페이스 키오스크' }]]],
  ]],
  ['lab', '실험·OS·게임', [
    ['os', 'OS', [
      ['paladiumos', 'PaladiumOS', 'web', 'PaladiumOS'],
      ['terraos', 'TerraOS', 'backend', 'TerraOS', { note: '임베디드 OS' }],
    ]],
    ['actrus', '악튜러스 리뉴얼', [['actrus', '악튜러스 리뉴얼', 'backend', 'Actrus_Renewal']]],
    ['i9dongseong', 'I9DongSeong', [['i9dongseong', 'I9DongSeong', 'backend', 'I9DongSeong']]],
  ]],
  ['data', '데이터·ML', [
    ['ds-core', '데이터 분석 코어', [
      ['ds-core', 'DS Core 모듈', 'backend', 'DS_Core_Module', { note: '함수형 EDA 코어 모듈' }],
      ['datascience', 'DataScience 저장소', 'backend', 'DataScience_Repo'],
    ]],
    ['ml-models', '모델링', [
      ['sedo-ts', 'SEDO 주문량 시계열 예측', 'backend', 'SEDO_Time_Series_Modeling'],
      ['deepseek-lora', 'DeepSeek V3 LoRA', 'backend', 'DeepSeek_V3_LoRa'],
      ['yolo-common', 'YOLO 객체인식 공통 모델', 'web', 'YOLO_Detection_CommonModel'],
      ['da-django', '분석 결과 Django API', 'backend', 'DA-DjangoAPI'],
    ]],
    ['contests', '공모전', [
      ['gwangya', '광진구 빅데이터 공모전', 'backend', 'GwangYa_Interface'],
      ['mafra', '농식품 공공데이터 창업 경진대회', 'web', 'MAFRA-OpenData-Competition'],
      ['ecotvy', 'EcoTvy', 'backend', 'EcoTvy_Service'],
      ['emergency', '응급 데이터 분석', 'backend', 'emergency_DataAnalysis'],
    ]],
  ]],
  ['study', '학습·아카이브', [
    ['spring-study', 'Spring 학습', [
      ['sb-summary', 'SpringBoot 총정리', 'backend', 'SpringBoot_Summary'],
      ['sb-study', 'SpringBoot 정복기', 'web', 'SpringBoot_Study'],
      ['sb-boilerplate', 'SpringBoot 보일러플레이트', 'web', 'SpringBoot_BoilerPlate'],
      ['sb-restful', 'SpringBoot RESTful API', 'backend', 'SpringBoot_RestFulAPI'],
      ['spring-fw-study', 'Spring Framework 스터디', 'backend', 'Spring_Framework_Study'],
      ['springfw-study', 'SpringFramework 스터디', 'backend', 'SpringFramework_Study'],
      ['spring-inflearn', 'Spring 인프런', 'backend', 'Spring_inflearn'],
      ['java-backend', '취업을 위한 백엔드 스터디', 'backend', 'JavaForBackend'],
      ['kopring', 'Kopring 학습', 'backend', 'Kopring'],
    ]],
    ['playgrounds', '언어 플레이그라운드', [
      ['rust-pg', 'Rust', 'backend', 'RustPlayGround'],
      ['go-pg', 'Go', 'backend', 'Go_PlayGround'],
      ['deno-pg', 'Deno', 'backend', 'Deno_PlayGround'],
      ['node-pg', 'Node', 'backend', 'Node_PlayGround'],
      ['express-bp', 'Express 보일러플레이트', 'backend', 'Express_BoilerPlate'],
      ['express-landing', 'Express 랜딩 인터페이스', 'web', 'Express_Landing_Interface'],
      ['vue-pg', 'Vue', 'web', 'Vue-Playground'],
      ['next-bigsur', 'Next BigSur', 'web', 'Next_BigSur'],
    ]],
    ['cs', '알고리즘·CS', [
      ['java-codingtest', '자바 코딩테스트', 'backend', 'Java_CodingTest'],
      ['til', 'TIL', 'backend', 'TIL'],
      ['sql-summary', 'SQL 요약', 'backend', 'SQL_Summarize'],
    ]],
    ['coursework', '교육·팀 프로젝트', [
      ['legonego-jpa', '레고네고 (JPA)', 'web', 'LegoNego_JPA'],
      ['legonego-mybatis', '레고네고 (MyBatis)', 'web', 'LegoNego_MyBatis'],
      ['travel-guru', 'Travel GURU', 'web', 'Travel_GURU'],
      ['t-store', 'T Store', 'web', 'T_Store_Test'],
      ['tspoon-solo3', '티스푼 Solo3', 'web', 'tSpoon_Solo3'],
      ['tspoon-proj3', '티스푼 Proj3', 'web', 'tSpoon_Proj3'],
      ['pro04', 'Pro04', 'web', 'Pro04'],
      ['cornedu', 'CornEDU', 'web', 'CornEDU_Pro01'],
      ['cornbooks', 'CornBooks', 'web', 'CornBooks_Pro02'],
      ['trainee-ims', '교육생 통합 관리시스템', 'web', 'Trainee_Integrated_Management_System'],
      ['smarthaebeop', '스마트 해법', 'web', 'SmartHaebeop'],
      ['kdt-landing', 'KDT 랜딩', 'web', 'KDT_Landing'],
      ['retro-future', 'Retro Future', 'web', 'Retro_Future'],
      ['headspak', 'HeadSpaK', 'web', 'HeadSpaK'],
      ['mendorong', '멘도롱 대학', 'web', 'Mendorong_Univ'],
      ['elderlinker', '멋사 해커톤 ElderLinker', 'web', 'likelion-hackathon-elderlinker'],
      ['leeeung', 'LeeEung 테스트', 'web', 'LeeEung_test'],
    ]],
    // 조직 MarioChunjaeIT(GITHUB_ORGS 에 넣어야 실행 기록 등이 읽힌다) — 천재교육 풀스택 과정 2기 팀 '마리오'
    ['mario', '천재교육 팀 마리오', [
      ['mario-proj01', '1차 팀 프로젝트', 'web', 'MarioChunjaeIT/Chunjae_Team_Proj01'],
      ['mario-proj02', '2차 팀 프로젝트', 'web', 'MarioChunjaeIT/Chunjae_Team_Proj02'],
      ['mario-backup-0831', '2차 백업 (08-31)', 'web', 'MarioChunjaeIT/BackUp_Pro02_20230831'],
      ['mario-backup-0901', '2차 최종본 백업 (09-01)', 'web', 'MarioChunjaeIT/BackUp_Pro02_20230901'],
      ['mario-yeeun', 'Yeeun 저장소', 'web', 'MarioChunjaeIT/Yeeun_GithubRepo'],
      ['mario-bk', 'BK 저장소', 'backend', 'MarioChunjaeIT/BK_GithubRepo'],
    ]],
  ]],
];

export const DEFAULT_NODES: NodeDef[] = TREE.flatMap(([gid, gname, projects], gi) => [
  { id: gid, type: 'group' as const, name: gname, order: (gi + 1) * 10 },
  ...projects.map(([pid, pname], pi) => ({ id: pid, type: 'project' as const, name: pname, parent: gid, order: (pi + 1) * 10 })),
]);

export const DEFAULT_COMPONENTS: ComponentDef[] = TREE.flatMap(([, , projects]) => projects.flatMap(([pid, , comps]) =>
  comps.map(([key, name, kind, repo, extra], ci) => ({ key, name, kind, repo, parent: pid, order: (ci + 1) * 10, ...extra }))));
