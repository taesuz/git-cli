# git-cli 🚀

`git-cli`는 **npx**를 통해 간편하게 사용할 수 있는 Git 멀티 서비스 저장소 동기화 및 미러링 자동화 CLI 도구입니다.

GitHub, GitLab, Gitea 간의 저장소 생성, 조직(Organization) 및 GitLab 하위그룹(Subgroup) 자동 구성, Push/Pull Mirroring 설정을 원클릭 API 통신으로 자동화합니다.

---

## 🌟 주요 기능

- **npx 즉시 실행**: 별도 글로벌 설치 없이 `npx git-cli`로 즉시 사용 가능
- **멀티 Provider 지원**: GitHub, GitLab, Gitea 호환
- **자동 조직 / 하위그룹 구조 생성**:
  - **GitHub / Gitea**: 서브그룹 미지원으로 인해 조직(Organization) 자동 생성 또는 조회 후 저장소 구성 (`roro-papa/Telab`)
  - **GitLab**: 하위그룹 지원으로 로그인 유저(`taesuz`) 하위에 하위그룹(`roro-papa`)을 자동 생성하여 저장소 구성 (`taesuz/roro-papa/Telab`)
- **3단계 대화형 선택 & 커스텀 Remote URL 입력**:
  1. `예 (Yes)` 선택 시 **SSH / HTTPS 프로토콜 선택창**을 화살표 키로 제공
  2. 선택한 프로토콜의 기본 URL이 제안되며, **엔터를 누르면 기본값 적용** 또는 커스텀 주소 직접 입력 가능
  3. 지정된 최종 URL로 로컬 `origin` remote 자동 등록/업데이트
- **로컬 저장소 자동 초기화 및 SSH Remote 등록**:
  - CLI를 실행한 로컬 폴더에 Git이 설정되어 있지 않은 경우 `git init`을 자동으로 실행
  - Main 저장소의 **SSH URL** (예: `git@github.com:roro-papa/Telab.git` 또는 `git@gitlab.com:taesuz/git-cli.git`)을 로컬 레포지토리의 `origin` remote로 자동 등록/업데이트 (`git remote add/set-url origin <sshUrl>`)
- **API 기반 미러링 자동 등록 (No Local Git Command)**:
  - Main 저장소가 GitLab / Gitea인 경우 **Remote Push Mirroring API**를 통해 Mirror 저장소들을 Push 대상으로 자동 2개 이상 등록
  - Main 저장소가 GitHub인 경우 Mirror 저장소(Gitea, GitLab)에 **Pull Mirroring API** 자동 등록
- **대화형 덮어쓰기 안내 (Interactive Confirmation)**:
  - 이미 저장소가 존재하는 경우 소스가 다를 수 있으므로 푸시/미러 등록 전 사용자 확인 대화창 제공
- **환경변수 지원 및 자동 설정 검증**:
  - `~/.git-cli/config.yaml` 자동 생성 및 `GITHUB_TOKEN`, `GITLAB_TOKEN`, `GITEA_TOKEN` 환경변수 지원

---

## 🛠️ 설치 및 사전 준비

Node.js (v18 이상) 환경이 필요합니다.

### 로컬 개발 시 시스템 어디서나 실행되도록 등록하는 방법

```bash
# 1. 의존성 설치 및 빌드
npm install
npm run build

# 2. 로컬 글로벌 링크 등록 (어느 폴더에서나 git-cli 명령어로 사용 가능)
npm link
```

npm registry에 패키지를 배포한 후에는 `npx git-cli`로 누구나 등록 없이 즉시 실행하실 수 있습니다.

---

## ⚙️ 설정 파일 (`~/.git-cli/config.yaml`)

최초 실행 시 `~/.git-cli/config.yaml` 파일이 없으면 자동으로 기본 템플릿이 생성됩니다.

```bash
npx git-cli init
```

### `config.yaml` 예시

```yaml
git:
  main:
    provider: github      # github | gitlab | gitea
    token: ""             # 토큰을 직접 입력하거나 환경변수(GITHUB_TOKEN) 이용
    host: "https://github.com"
    group: "roro-papa"   # (선택) 조직/그룹명. 비어있으면 로그인 사용자의 메인 저장소에 생성됨

  mirrors:
    - provider: gitea
      token: ""           # 토큰을 직접 입력하거나 환경변수(GITEA_TOKEN) 이용
      host: "https://gitea.example.com"
      group: "roro-papa"   # (선택) 조직/그룹명

    - provider: gitlab
      token: ""           # 토큰을 직접 입력하거나 환경변수(GITLAB_TOKEN) 이용
      host: "https://gitlab.com"
      group: ""            # 비어있으므로 유저 개인 네임스페이스(taesuz/repo)에 생성
```

> 💡 **Tip**: 토큰 값을 `config.yaml`에 직접 작성하지 않고 shell 환경변수 (`GITHUB_TOKEN`, `GITLAB_TOKEN`, `GITEA_TOKEN`)로 주입해도 자동으로 인식합니다.

---

## 📖 사용 방법

### 1. 설정 초기화 및 검증

```bash
npx git-cli init
```
설정 파일 경로(`~/.git-cli/config.yaml`)를 안내하고 설정 및 환경변수 유효성을 점검합니다.

---

### 2. 저장소 자동 생성 및 미러 동기화

```bash
# 인자를 생략하면 현재 폴더의 package.json "name" 또는 폴더 이름으로 자동 감지
npx git-cli sync

# 저장소명을 명시적으로 지정할 수도 있습니다.
npx git-cli sync <organization-or-user>/<repository>
```

#### 💡 사용 예시 1: 조직 / 하위그룹 저장소 동기화 (`roro-papa/Telab`)

```bash
npx git-cli sync roro-papa/Telab
```

- **Main이 GitHub인 경우**:
  - GitHub: Organization `roro-papa` 및 Repo `Telab` 생성
  - Gitea: Organization `roro-papa` 및 Repo `Telab` 생성 후 Pull Mirror 등록
  - GitLab: Subgroup `taesuz/roro-papa` 생성 후 Repo `Telab` 생성 및 Pull Mirror 등록
- **Main이 GitLab인 경우**:
  - GitLab Main 저장소에 Gitea 및 기타 Mirror 저장소 URL이 **Push Mirror 2개로 자동 등록**됨

#### 💡 사용 예시 2: 개인 유저 저장소 동기화 (`taesuz/2dgame-js`)

```bash
npx git-cli sync taesuz/2dgame-js
```

- GitHub: User `taesuz` / Repo `2dgame-js`
- Gitea: User `taesuz` / Repo `2dgame-js`
- GitLab: User `taesuz` / Repo `2dgame-js`

---

## 📄 라이선스

MIT License
