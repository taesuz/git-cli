# AGENT.md - AI Agent 개발 및 컨텍스트 가이드 🤖

이 문서는 AI Coding Agent(Antigravity 등)가 `git-cli` 프로젝트의 구조를 이해하고, 개발 및 확장을 지속할 수 있도록 돕는 기술 가이드입니다.

---

## 📌 1. 프로젝트 개요

`git-cli`는 `npx`로 간편하게 사용할 수 있는 Node.js / TypeScript 기반 Git 멀티 저장소 동기화 CLI 도구입니다.

- **핵심 역할**:
  - GitHub, GitLab, Gitea 간의 저장소 생성 및 미러링(Push / Pull Mirroring API) 설정
  - 조직(Organization) 및 GitLab 하위그룹(Subgroup) 자동 생성
  - 로컬 Git 미설정 시 `git init` 실행 및 SSH/HTTPS Remote Origin 자동 설정
  - 콘솔 내 세로 나열 방식의 대화형 화살표 키 승인 선택창 제공

---

## 📂 2. 디렉터리 구조 및 핵심 모듈

```
git-cli/
├── bin/                 # CLI 실행 스크립트
├── dist/                # tsup 빌드 산출물 (CJS, ESM, d.ts)
├── src/
│   ├── index.ts         # CLI 메인 진입점 (Commander.js, 인자 자동 감지)
│   ├── types.ts         # 공통 인터페이스 (GitProvider, Config, EnsureRepoResult 등)
│   ├── config/
│   │   └── index.ts     # ~/.git-cli/config.yaml 로더, 하위호환 및 토큰 검증
│   ├── providers/
│   │   ├── types.ts     # Provider 인터페이스
│   │   ├── factory.ts   # Provider Registry 및 팩토리 패턴
│   │   ├── github.ts    # GitHub Provider 구현체
│   │   ├── gitlab.ts    # GitLab Provider 구현체 (Subgroup/Top-level 멀티 탐색)
│   │   ├── gitea.ts     # Gitea Provider 구현체
│   │   └── index.ts     # Provider 모듈 자동 등록 진입점
│   ├── services/
│   │   └── sync.ts      # 저장소 상태 검사, 요약 카드 출력, 미러링 동기화 엔진
│   └── utils/
│       └── prompt.ts    # 세로 목록형 화살표 키 선택 및 텍스트 입력 프롬프트
├── package.json
├── tsconfig.json
├── README.md
└── AGENT.md             # 본 가이드 문서 (GEMINI.md 심볼릭 링크)
```

---

## 🏗️ 3. 핵심 아키텍처 및 확장 가이드

### Provider Registry 패턴
새로운 Git Provider (예: Bitbucket, Codeberg 등)를 추가할 때는 기존 코드를 수정할 필요 없이 레지스트리에 클래스를 등록하면 됩니다.

#### 신규 Provider 작성 절차:
1. `GitProvider` 인터페이스 구현체 작성:
   ```ts
   import { GitProvider, GitProviderCapabilities, EnsureRepoResult, ProviderConfig } from '../types.js';
   import { registerProvider } from './factory.js';

   export class BitbucketProvider implements GitProvider {
     name = 'Bitbucket';
     type = 'bitbucket';
     capabilities: GitProviderCapabilities = {
       supportsPushMirror: false,
       supportsPullMirror: true,
       envTokenKeys: ['BITBUCKET_TOKEN'],
     };

     constructor(config: ProviderConfig) { /* ... */ }

     async getCurrentUser() { /* ... */ }
     async ensureRepo(targetPath: string): Promise<EnsureRepoResult> { /* ... */ }
     async addPullMirror(targetPath: string, mainCloneUrl: string) { /* ... */ }
   }

   // 레지스트리에 자동 등록
   registerProvider('bitbucket', BitbucketProvider);
   ```
2. `src/providers/index.ts`에 신규 모듈 import 선언:
   ```ts
   import './bitbucket.js';
   ```

---

## 🛠️ 4. 빌드 및 테스트 명령어

```bash
# 의존성 설치
npm install

# TypeScript 빌드 (컴파일, 실행권한 지정 및 npm link 자동 실행)
npm run build

# 개발 모드 실행
npm run dev -- sync

# CLI 빌드 산출물 직접 실행 테스트
node dist/index.js init
node dist/index.js sync
```

---

## 💡 5. AI 에이전트 주의 사항

1. 모든 텍스트 콘솔 출력은 이모지 및 세로 목록형 UI 가독성을 유지해야 합니다.
2. `~/.git-cli/config.yaml` 읽기/쓰기 시 유저 홈 디렉터리 권한을 체크하고, 토큰 검증 시 경고 메시지를 친절하게 출력해야 합니다.
3. 아티팩트(`task.md`, `implementation_plan.md`, `walkthrough.md`)와 모든 관련 가이드 설명은 **한국어**로 작성합니다.
