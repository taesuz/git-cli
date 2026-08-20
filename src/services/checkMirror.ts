import { loadConfig, validateConfig } from '../config/index.js';
import { createProvider } from '../providers/index.js';
import { RepoInfo } from '../types.js';

interface MissingMirrorInfo {
  providerName: string;
  reason: string;
}

interface RepoMirrorStatus {
  name: string;
  fullPath: string;
  missingMirrors: MissingMirrorInfo[];
  isFullyMirrored: boolean;
}

export async function checkUnmirroredRepositories(targetRepository?: string): Promise<void> {
  console.log(`\n──────────────────────────────────────────────────────────`);
  console.log(` 🚨  git-cli | 미러 미등록 리포지토리 검사 (check-mirror)`);
  if (targetRepository) {
    console.log(` 🎯  대상 지정 저장소: ${targetRepository}`);
  }
  console.log(`──────────────────────────────────────────────────────────\n`);

  const config = loadConfig();
  const validation = validateConfig(config);

  if (!validation.valid) {
    console.error(`\n❌ [git-cli 오류] 설정 검증에 실패했습니다:`);
    validation.errors.forEach((err) => console.error(`  - ${err}`));
    process.exit(1);
  }

  const mainProvider = createProvider(config.git.main);

  if (!config.git.mirrors || config.git.mirrors.length === 0) {
    console.log(`ℹ️ 설정 파일(~/.git-cli/config.yaml)에 등록된 Mirror Provider가 없습니다.\n`);
    return;
  }

  console.log(`🔍 [${mainProvider.name}] 저장소 목록 조회 중...`);
  let reposToCheck: RepoInfo[] = [];

  if (targetRepository && targetRepository.trim() !== '') {
    try {
      const repoInfo = await mainProvider.checkRepositoryEmpty(targetRepository);
      reposToCheck = [repoInfo];
    } catch {
      reposToCheck = [{
        name: targetRepository,
        fullPath: targetRepository,
        cloneUrl: '',
        isEmpty: false,
      }];
    }
  } else {
    try {
      if (mainProvider.listRepositories) {
        reposToCheck = await mainProvider.listRepositories();
      } else {
        console.error(`❌ [${mainProvider.name}] 저장소 목록 조회를 지원하지 않는 Provider입니다.`);
        return;
      }
    } catch (err: any) {
      console.error(`❌ [${mainProvider.name}] 저장소 목록 조회 실패: ${err.message}`);
      process.exit(1);
    }
  }

  console.log(`📊 [${mainProvider.name}] 총 ${reposToCheck.length}개의 저장소를 대상으로 미러 등록 상태를 검사합니다...\n`);

  const mirrorProviders = config.git.mirrors.map((m) => createProvider(m));
  const results: RepoMirrorStatus[] = [];

  for (const repo of reposToCheck) {
    const missingMirrors: MissingMirrorInfo[] = [];

    // Case A: Main Provider가 Push Mirror를 지원하는 경우 (GitLab, Gitea 등)
    if (mainProvider.capabilities.supportsPushMirror && mainProvider.getPushMirrors) {
      let existingMirrors: string[] = [];
      try {
        existingMirrors = await mainProvider.getPushMirrors(repo.name);
      } catch {
        existingMirrors = [];
      }

      for (const mirrorProvider of mirrorProviders) {
        let mirrorRepo;
        try {
          mirrorRepo = mirrorProvider.checkRepoExists
            ? await mirrorProvider.checkRepoExists(repo.name)
            : await mirrorProvider.ensureRepo(repo.name);
        } catch {
          mirrorRepo = null;
        }

        const isRegistered = existingMirrors.some((url) => {
          if (!url) return false;
          const cleanUrl = url.toLowerCase();
          const cleanPath = (mirrorRepo?.fullPath || repo.fullPath || repo.name).toLowerCase();
          const cleanName = repo.name.toLowerCase();
          return cleanUrl.includes(cleanPath) || cleanUrl.includes(cleanName);
        });

        if (!isRegistered) {
          missingMirrors.push({
            providerName: mirrorProvider.name,
            reason: mirrorRepo && !mirrorRepo.exists ? '미러 저장소 미생성' : '푸시 미러 미등록',
          });
        }
      }
    } else {
      // Case B: Main Provider가 Push Mirror를 지원하지 않는 경우 (GitHub 등)
      for (const mirrorProvider of mirrorProviders) {
        try {
          const mirrorRepo = mirrorProvider.checkRepoExists
            ? await mirrorProvider.checkRepoExists(repo.name)
            : await mirrorProvider.ensureRepo(repo.name);
          if (!mirrorRepo.exists) {
            missingMirrors.push({
              providerName: mirrorProvider.name,
              reason: '미러 저장소 미생성 (Pull Mirror 미동기화)',
            });
          }
        } catch (err: any) {
          missingMirrors.push({
            providerName: mirrorProvider.name,
            reason: `미러 저장소 상태 확인 실패 (${err.message})`,
          });
        }
      }
    }

    results.push({
      name: repo.name,
      fullPath: repo.fullPath,
      missingMirrors,
      isFullyMirrored: missingMirrors.length === 0,
    });
  }

  const unmirroredList = results.filter((r) => !r.isFullyMirrored);
  const mirroredCount = results.length - unmirroredList.length;

  console.log(`──────────────────────────────────────────────────────────`);
  console.log(` 📋 [미러링 상태 검사 결과 요약]`);
  console.log(`──────────────────────────────────────────────────────────\n`);

  if (unmirroredList.length === 0) {
    console.log(`🎉 축하합니다! 모든 저장소(${results.length}개)에 미러링이 정상 등록되어 있습니다.\n`);
    return;
  }

  console.log(`⚠️  미러가 등록되지 않은 저장소 목록 (총 ${unmirroredList.length}개 / 전체 ${results.length}개):\n`);

  unmirroredList.forEach((item, idx) => {
    console.log(` ${idx + 1}. \x1b[1m${item.name}\x1b[0m (${item.fullPath})`);
    item.missingMirrors.forEach((missing) => {
      console.log(`    • ${missing.providerName}: \x1b[31m❌ ${missing.reason}\x1b[0m`);
    });
    console.log(``);
  });

  console.log(`──────────────────────────────────────────────────────────`);
  console.log(` ✅ 모든 미러가 정상 등록된 저장소: ${mirroredCount}개`);
  console.log(` 💡 팁: 'git-cli mirror [저장소명]' 명령어로 미등록 저장소에 미러를 즉시 등록할 수 있습니다.`);
  console.log(`──────────────────────────────────────────────────────────\n`);
}
