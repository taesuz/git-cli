import { loadConfig, validateConfig } from '../config/index.js';
import { createProvider } from '../providers/index.js';
import { confirm } from '../utils/prompt.js';
import { detectProjectName } from '../utils/project.js';

export async function checkAndRegisterPushMirror(repository?: string): Promise<void> {
  let targetRepo = repository;

  if (!targetRepo || targetRepo.trim() === '') {
    targetRepo = detectProjectName();
    console.log(`💡 [git-cli] 저장소 인자가 지정되지 않아 현재 프로젝트 이름('${targetRepo}')을 기본 대상으로 사용합니다.`);
  }

  console.log(`\n──────────────────────────────────────────────────────────`);
  console.log(` 🪞  git-cli | 리포지토리 푸시 미러링(Push Mirror) 상태 확인`);
  console.log(` 🎯  대상 저장소: ${targetRepo}`);
  console.log(`──────────────────────────────────────────────────────────\n`);

  const config = loadConfig();
  const validation = validateConfig(config);

  if (!validation.valid) {
    console.error(`\n❌ [git-cli 오류] 설정 검증에 실패했습니다:`);
    validation.errors.forEach((err) => console.error(`  - ${err}`));
    process.exit(1);
  }

  const mainProvider = createProvider(config.git.main);

  // 1. GitHub 또는 Push Mirror 미지원 Provider 예외 처리
  if (mainProvider.type === 'github' || !mainProvider.capabilities.supportsPushMirror) {
    console.log(`❌ [git-cli] ${mainProvider.name}은(는) REST API를 통한 저장소 푸시 미러링(Push Mirror)을 지원하지 않습니다.`);
    console.log(`   (GitHub은 REST API 기반 Push Mirror 기능을 공식 제공하지 않습니다.)\n`);
    return;
  }

  // 2. Main 저장소 확인 및 기존 등록된 Push Mirror 목록 조회
  console.log(`🔍 [${mainProvider.name}] Main 저장소 상태 및 푸시 미러 목록 확인 중...`);
  const mainRepo = mainProvider.checkRepoExists
    ? await mainProvider.checkRepoExists(targetRepo)
    : await mainProvider.ensureRepo(targetRepo);

  let existingMirrors: string[] = [];
  if (mainProvider.getPushMirrors) {
    try {
      existingMirrors = await mainProvider.getPushMirrors(targetRepo);
    } catch (err: any) {
      console.warn(`⚠️ [${mainProvider.name}] 기존 푸시 미러 목록 조회 실패: ${err.message}`);
    }
  }

  if (!config.git.mirrors || config.git.mirrors.length === 0) {
    console.log(`\nℹ️ 설정 파일(~/.git-cli/config.yaml)에 등록된 Mirror Provider가 없습니다.\n`);
    return;
  }

  // 3. 각 Mirror Provider에 대해 미러링 등록 여부 검사 및 대화형 등록
  for (const mirrorConfig of config.git.mirrors) {
    const mirrorProvider = createProvider(mirrorConfig);
    console.log(`\n----------------------------------------------------------`);
    console.log(`🔎 [Mirror Target] ${mirrorProvider.name} 저장소 정보 확인 중...`);

    let mirrorRepo;
    try {
      mirrorRepo = mirrorProvider.checkRepoExists
        ? await mirrorProvider.checkRepoExists(targetRepo)
        : await mirrorProvider.ensureRepo(targetRepo);
    } catch (err: any) {
      console.error(`❌ [${mirrorProvider.name}] 저장소 정보 조회 실패: ${err.message}`);
      continue;
    }

    // 이미 등록되어 있는지 확인 (URL 내 fullPath 또는 repoName / host 비교)
    const isAlreadyRegistered = existingMirrors.some((url) => {
      if (!url) return false;
      const cleanUrl = url.toLowerCase();
      const cleanPath = mirrorRepo.fullPath.toLowerCase();
      const cleanName = mirrorRepo.repoName.toLowerCase();
      return cleanUrl.includes(cleanPath) || cleanUrl.includes(cleanName);
    });

    if (isAlreadyRegistered) {
      console.log(`✅ [${mainProvider.name}] '${targetRepo}' 저장소에 ${mirrorProvider.name} 푸시 미러링이 이미 등록되어 있습니다.`);
      console.log(`   • Target URL: ${mirrorRepo.cloneUrl}`);
    } else {
      console.log(`⚠️  [${mainProvider.name}] '${targetRepo}' 저장소에 ${mirrorProvider.name} 푸시 미러링이 등록되어 있지 않습니다.`);
      
      const shouldRegister = await confirm(
        `❓ ${mirrorProvider.name} (${mirrorRepo.fullPath}) 저장소로 푸시 미러링(Push Mirror)을 등록하시겠습니까?`,
        true
      );

      if (shouldRegister) {
        if (mainProvider.addPushMirror) {
          try {
            // 등록을 진행할 때 미러 저장소가 없는 경우에 한해 ensureRepo 호출
            const activeMirrorRepo = mirrorRepo.exists
              ? mirrorRepo
              : await mirrorProvider.ensureRepo(targetRepo);

            console.log(`🔄 [${mainProvider.name}] Push Mirror API 호출 중...`);
            await mainProvider.addPushMirror(targetRepo, activeMirrorRepo.authenticatedCloneUrl);
            console.log(`🎉 [git-cli] ${mirrorProvider.name} 푸시 미러링 등록 완료!`);
          } catch (err: any) {
            console.error(`❌ [git-cli] 푸시 미러링 등록 실패: ${err.message}`);
          }
        } else {
          console.warn(`⚠️ [${mainProvider.name}] Push Mirror 등록 메서드가 구현되어 있지 않습니다.`);
        }
      } else {
        console.log(`ℹ️ [git-cli] ${mirrorProvider.name} 푸시 미러링 등록을 건너뜁니다.`);
      }
    }
  }

  console.log(`\n──────────────────────────────────────────────────────────`);
  console.log(` ✨ 푸시 미러링 상태 확인 및 작업이 완료되었습니다.`);
  console.log(`──────────────────────────────────────────────────────────\n`);
}
