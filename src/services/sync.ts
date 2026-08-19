import { execa } from 'execa';
import { loadConfig, validateConfig } from '../config/index.js';
import { createProvider } from '../providers/index.js';
import { EnsureRepoResult, GitProvider } from '../types.js';
import { confirm, selectChoice, promptInput } from '../utils/prompt.js';

export async function syncRepository(targetPath: string): Promise<void> {
  console.log(`\n──────────────────────────────────────────────────────────`);
  console.log(` 🚀  git-cli | Git 저장소 미러 동기화`);
  console.log(` 🎯  대상 저장소: ${targetPath}`);
  console.log(`──────────────────────────────────────────────────────────\n`);

  // 1. Load & Validate Config
  const config = loadConfig();
  const validation = validateConfig(config);

  if (!validation.valid) {
    console.error(`\n❌ [git-cli 오류] 설정 검증에 실패했습니다:`);
    validation.errors.forEach((err) => console.error(`  - ${err}`));
    process.exit(1);
  }

  const currentDir = process.cwd();

  // 2. Check Local Git Status
  let isGitRepo = false;
  let currentOriginUrl: string | null = null;

  try {
    const { stdout } = await execa('git', ['rev-parse', '--is-inside-work-tree'], { cwd: currentDir });
    if (stdout.trim() === 'true') {
      isGitRepo = true;
      try {
        const { stdout: originUrl } = await execa('git', ['remote', 'get-url', 'origin'], { cwd: currentDir });
        currentOriginUrl = originUrl.trim();
      } catch {
        currentOriginUrl = null;
      }
    }
  } catch {
    isGitRepo = false;
  }

  // 3. Inspect Main Provider & Repo Status
  const mainProvider = createProvider(config.git.main);
  let mainRepo: EnsureRepoResult;

  try {
    mainRepo = await mainProvider.ensureRepo(targetPath);
  } catch (err: any) {
    console.error(`\n❌ [Main Provider 오류] 저장소 정보 조회 실패: ${err.message}`);
    process.exit(1);
  }

  // 4. Inspect Mirror Providers & Repo Status
  const mirrorResults: { provider: GitProvider; repo: EnsureRepoResult }[] = [];

  for (const mirrorConfig of config.git.mirrors) {
    const mirrorProvider = createProvider(mirrorConfig);
    try {
      const repoResult = await mirrorProvider.ensureRepo(targetPath);
      mirrorResults.push({ provider: mirrorProvider, repo: repoResult });
    } catch (err: any) {
      console.error(`\n❌ [Mirror Provider 오류 - ${mirrorProvider.name}] 저장소 정보 조회 실패: ${err.message}`);
    }
  }

  // 5. Clean & Modern Summary Output (Decoupled with Provider Capabilities)
  const supportsPushMirror = mainProvider.capabilities.supportsPushMirror;

  console.log(` 📋 [git-cli 동기화 설정 정보 요약]\n`);

  console.log(` 📁 [로컬 디렉터리 상태]`);
  console.log(`   • 경로: ${currentDir}`);
  console.log(`   • Git 레포 여부: ${isGitRepo ? '✅ 설정됨 (.git)' : '🆕 미설정 (동기화 시 git init 실행)'}`);
  console.log(`   • Remote origin: ${currentOriginUrl ? `🔗 ${currentOriginUrl}` : '⚠️ 미설정 (동기화 시 선택한 주소로 설정)'}`);
  console.log(``);

  console.log(` 👑 [Main 저장소]`);
  console.log(`   • Provider: ${mainProvider.name}`);
  console.log(`   • 경로: ${mainRepo.fullPath}`);
  console.log(`   • SSH URL: ${mainRepo.sshUrl}`);
  console.log(`   • HTTPS URL: ${mainRepo.cloneUrl}`);
  console.log(`   • 저장소 상태: ${mainRepo.exists ? '✅ 기존 저장소 존재함' : '🆕 미존재 (자동 생성 예정)'}`);
  console.log(``);

  console.log(` 🪞 [Mirror 저장소 목록 (${mirrorResults.length}개)]`);
  if (mirrorResults.length === 0) {
    console.log(`   (등록된 미러 저장소가 없습니다)`);
  } else {
    mirrorResults.forEach((m, idx) => {
      console.log(`   ${idx + 1}. ${m.provider.name}: ${m.repo.fullPath} [${m.repo.exists ? '✅ 기존 저장소 존재' : '🆕 자동 생성 예정'}]`);
    });
  }
  console.log(``);

  console.log(` ⚡ [동기화 방식]`);
  if (supportsPushMirror) {
    console.log(`   • Push Mirroring: Main (${mainProvider.name}) 저장소에 Mirror ${mirrorResults.length}개 등록`);
  } else {
    console.log(`   • Pull Mirroring: 각 Mirror 저장소에 Main (${mainProvider.name}) 소스 가져오기 등록`);
  }
  console.log(`\n──────────────────────────────────────────────────────────\n`);

  // 6. Interactive Step 1: Proceed confirmation
  const proceed = await confirm('❓ 위 설정 정보로 저장소 생성 및 미러 동기화를 진행하시겠습니까?', true);

  if (!proceed) {
    console.log(`\n🚫 [git-cli] 동기화 작업이 취소되었습니다.\n`);
    return;
  }

  // 7. Interactive Step 2: Choose Remote Protocol (SSH vs HTTPS)
  const protocolIdx = await selectChoice('❓ 로컬 Remote origin 프로토콜 방식을 선택해 주세요:', [
    `SSH (${mainRepo.sshUrl})`,
    `HTTPS (${mainRepo.cloneUrl})`,
  ], 0);

  const defaultUrl = protocolIdx === 0 ? mainRepo.sshUrl : mainRepo.cloneUrl;

  // 8. Interactive Step 3: Enter or confirm Remote URL
  const finalOriginUrl = await promptInput('❓ 로컬 Remote origin 주소를 확인/입력해 주세요:', defaultUrl);

  console.log(`\n✨ [git-cli] 설정된 주소(${finalOriginUrl})로 동기화 작업을 진행합니다...\n`);

  // 9. Execute Local Git Setup with chosen Origin URL
  await ensureLocalGitSetup(finalOriginUrl, isGitRepo, currentOriginUrl);

  // 10. Execute Mirror Strategy using Provider Capabilities
  if (mirrorResults.length === 0) {
    console.log(`\nℹ️ 동기화할 Mirror 저장소가 없어 설정을 마칩니다.`);
    return;
  }

  if (supportsPushMirror && mainProvider.addPushMirror) {
    console.log(`\n🔄 [Push Mirror] Main Provider (${mainProvider.name}) 에 Push Mirror 등록 중...`);
    for (const target of mirrorResults) {
      console.log(` ➡️ Main (${mainProvider.name}) 에 Push Mirror 등록: ${target.provider.name} (${target.repo.fullPath})`);
      try {
        await mainProvider.addPushMirror(targetPath, target.repo.authenticatedCloneUrl);
      } catch (err: any) {
        console.error(` ❌ Push Mirror 등록 실패: ${err.message}`);
      }
    }
  } else {
    console.log(`\n🔄 [Pull Mirror] 각 Mirror 저장소에 Pull Mirror 등록 중...`);
    for (const target of mirrorResults) {
      console.log(` ➡️ Mirror (${target.provider.name}) 에 Pull Mirror 등록: ${mainRepo.fullPath}`);
      if (target.provider.addPullMirror) {
        try {
          await target.provider.addPullMirror(targetPath, mainRepo.authenticatedCloneUrl);
        } catch (err: any) {
          console.error(` ❌ Pull Mirror 등록 실패: ${err.message}`);
        }
      }
    }
  }

  console.log(`\n──────────────────────────────────────────────────────────`);
  console.log(` 🎉  git-cli 미러링 동기화 및 로컬 Remote 설정 완료!`);
  console.log(`──────────────────────────────────────────────────────────\n`);
}

async function ensureLocalGitSetup(targetOriginUrl: string, isGitRepo: boolean, currentOriginUrl: string | null): Promise<void> {
  const currentDir = process.cwd();

  if (!isGitRepo) {
    console.log(`🛠️  [Local Git] 'git init' 실행 중...`);
    try {
      await execa('git', ['init'], { cwd: currentDir });
      console.log(`✅ [Local Git] 'git init' 완료.`);
    } catch (err: any) {
      console.warn(`⚠️  [Local Git] 'git init' 실행 경고: ${err.message}`);
    }
  }

  try {
    if (currentOriginUrl) {
      await execa('git', ['remote', 'set-url', 'origin', targetOriginUrl], { cwd: currentDir });
      console.log(`🔗 [Local Git] 로컬 Remote (origin) URL 업데이트 ➡️ ${targetOriginUrl}`);
    } else {
      await execa('git', ['remote', 'add', 'origin', targetOriginUrl], { cwd: currentDir });
      console.log(`🔗 [Local Git] 로컬 Remote (origin) 등록 ➡️ ${targetOriginUrl}`);
    }
  } catch (err: any) {
    console.warn(`⚠️  [Local Git] Remote (origin) 설정 경고: ${err.message}`);
  }
}
