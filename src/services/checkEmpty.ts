import os from 'os';
import path from 'path';
import fs from 'fs';
import { execa } from 'execa';
import { loadConfig, validateConfig } from '../config/index.js';
import { createProvider } from '../providers/index.js';
import { MirrorRepoStatus, RepoInfo } from '../types.js';
import { confirm, selectChoice, selectMultiChoices } from '../utils/prompt.js';

export async function checkEmptyRepositories(targetRepo?: string): Promise<void> {
  console.log(`\n──────────────────────────────────────────────────────────`);
  console.log(` 🔍  \x1b[1m\x1b[36mgit-cli\x1b[0m | Main & Mirror 저장소 비어있음 검사`);
  if (targetRepo) {
    console.log(` 🎯  대상 지정 저장소: \x1b[33m${targetRepo}\x1b[0m`);
  } else {
    console.log(` 🌐  대상: \x1b[33mMain Provider 저장소 전체\x1b[0m`);
  }
  console.log(`──────────────────────────────────────────────────────────\n`);

  // 1. Load & Validate Config
  const config = loadConfig();
  const validation = validateConfig(config);

  if (!validation.valid) {
    console.error(`\n❌ [git-cli 오류] 설정 검증에 실패했습니다:`);
    validation.errors.forEach((err) => console.error(`  - ${err}`));
    process.exit(1);
  }

  // 2. Create Main Provider
  const mainProvider = createProvider(config.git.main);
  console.log(` 👑 [Main Provider] \x1b[1m${mainProvider.name}\x1b[0m`);

  let repos: RepoInfo[] = [];

  if (targetRepo && targetRepo.trim() !== '') {
    if (mainProvider.checkRepositoryEmpty) {
      try {
        const repoInfo = await mainProvider.checkRepositoryEmpty(targetRepo.trim());
        repos.push(repoInfo);
      } catch (err: any) {
        console.error(`❌ [git-cli 오류] 저장소('${targetRepo}') 정보 조회 실패: ${err.message}`);
        process.exit(1);
      }
    } else {
      console.error(`❌ [git-cli 오류] ${mainProvider.name} Provider는 단일 저장소 empty 검사를 지원하지 않습니다.`);
      process.exit(1);
    }
  } else {
    if (mainProvider.listRepositories) {
      try {
        console.log(` ⏳ Main 저장소 목록을 조회하는 중...`);
        repos = await mainProvider.listRepositories();
      } catch (err: any) {
        console.error(`❌ [git-cli 오류] 저장소 목록 조회 실패: ${err.message}`);
        process.exit(1);
      }
    } else {
      console.error(`❌ [git-cli 오류] ${mainProvider.name} Provider는 저장소 목록 조회를 지원하지 않습니다.`);
      process.exit(1);
    }
  }

  // 3. Filter Empty Main Repositories
  const emptyRepos = repos.filter((r) => r.isEmpty);
  const nonEmptyRepos = repos.filter((r) => !r.isEmpty);

  // 4. Inspect Mirror Status ONLY for Empty Main Repositories
  if (emptyRepos.length > 0 && config.git.mirrors && config.git.mirrors.length > 0) {
    console.log(` ⏳ 비어있는 Main 저장소(\x1b[36m${emptyRepos.length}개\x1b[0m)에 대한 Mirror 상태를 조회하는 중...`);
    for (const repo of emptyRepos) {
      repo.mirrors = [];
      const repoName = repo.name || repo.fullPath.split('/').pop()!;
      for (const mirrorConfig of config.git.mirrors) {
        const mirrorProvider = createProvider(mirrorConfig);
        try {
          if (mirrorProvider.checkRepositoryEmpty) {
            const mirrorInfo = await mirrorProvider.checkRepositoryEmpty(repoName);
            repo.mirrors.push({
              providerName: mirrorProvider.name,
              fullPath: mirrorInfo.fullPath,
              cloneUrl: mirrorInfo.cloneUrl,
              exists: true,
              isEmpty: mirrorInfo.isEmpty,
            });
          } else {
            const repoRes = await mirrorProvider.ensureRepo(repoName);
            repo.mirrors.push({
              providerName: mirrorProvider.name,
              fullPath: repoRes.fullPath,
              cloneUrl: repoRes.cloneUrl,
              exists: repoRes.exists,
            });
          }
        } catch {
          repo.mirrors.push({
            providerName: mirrorProvider.name,
            fullPath: `${mirrorProvider.name}/${repoName}`,
            cloneUrl: '(미존재 또는 접근 불가)',
            exists: false,
          });
        }
      }
    }
  }

  console.log(`\n──────────────────────────────────────────────────────────`);
  console.log(` 📊  \x1b[1m검사 결과 요약\x1b[0m`);
  console.log(`   • 총 검사 저장소      : \x1b[1m${repos.length}개\x1b[0m`);
  console.log(`   • 정상 저장소 (커밋 존재) : \x1b[32m\x1b[1m${nonEmptyRepos.length}개\x1b[0m`);
  console.log(`   • 📭 비어있는 저장소     : \x1b[33m\x1b[1m${emptyRepos.length}개\x1b[0m`);
  console.log(`──────────────────────────────────────────────────────────\n`);

  if (emptyRepos.length === 0) {
    console.log(` 🎉 비어있는 저장소가 없습니다! 모든 저장소가 정상 상태입니다.\n`);
    return;
  }

  console.log(` 📭 \x1b[1m[비어있는 저장소 상세 목록 - ${emptyRepos.length}개]\x1b[0m\n`);
  emptyRepos.forEach((repo, idx) => {
    const indexStr = `\x1b[36m[${idx + 1}]\x1b[0m`;

    console.log(` ${indexStr} 🚨 \x1b[1m${repo.fullPath}\x1b[0m`);

    // Main
    const mainStatusBadge = '\x1b[43m\x1b[30m 📭 비어있음 \x1b[0m';
    const hasMirrors = repo.mirrors && repo.mirrors.length > 0;

    console.log(`   ├── 👑 \x1b[1mMain (${mainProvider.name})\x1b[0m : ${repo.cloneUrl} ${mainStatusBadge}`);

    // Mirrors
    if (hasMirrors) {
      repo.mirrors!.forEach((m, mIdx) => {
        const isLastMirror = mIdx === repo.mirrors!.length - 1 && !repo.defaultBranch;
        const treeChar = isLastMirror ? '└──' : '├──';
        const mirrorStatusBadge = !m.exists
          ? '\x1b[31m[⚠️ 저장소 미존재]\x1b[0m'
          : m.isEmpty
          ? '\x1b[43m\x1b[30m 📭 비어있음 \x1b[0m'
          : '\x1b[32m[✅ 커밋 있음]\x1b[0m';
        console.log(`   ${treeChar} 🪞 \x1b[1mMirror (${m.providerName})\x1b[0m : ${m.cloneUrl} ${mirrorStatusBadge}`);
      });
    }

    if (repo.defaultBranch) {
      console.log(`   └── 🌿 \x1b[90m기본 브랜치 : ${repo.defaultBranch}\x1b[0m`);
    }

    console.log(``);
  });

  // 5. Select Action Menu
  const actionIdx = await selectChoice(
    '❓ 비어있는 저장소에 대해 실행할 작업을 선택해 주세요:',
    [
      '🔄  [동기화] Mirror 소스 ➔ Main으로 Push 후 미러링 동기화 설정',
      '🗑️  [삭제]   Main과 Mirror 둘 다 비어있는 저장소 일괄 삭제',
      '🚫  [종료]   작업 없이 종료',
    ],
    0
  );

  if (actionIdx === 2) {
    console.log(`\nℹ️ 작업을 진행하지 않고 종료합니다.\n`);
    return;
  }

  // Action 1: 동기화 (Sync) - Mirror에 커밋이 있는 저장소 소스를 Main으로 git push --mirror 하고 동기화
  if (actionIdx === 0) {
    const syncCandidateRepos = emptyRepos.filter((repo) => {
      const mainEmpty = repo.isEmpty;
      const hasValidMirrorSource = repo.mirrors && repo.mirrors.some((m) => m.exists && !m.isEmpty);
      return mainEmpty && hasValidMirrorSource;
    });

    if (syncCandidateRepos.length === 0) {
      console.log(`\nℹ️ Main만 비어있고 커밋이 존재하는 Mirror 저장소가 있는 동기화 대상이 없습니다.\n`);
      return;
    }

    const syncOptions = syncCandidateRepos.map((repo) => {
      const mainBadge = '\x1b[33m[📭 비어있음]\x1b[0m';
      const details: string[] = [
        `├── 👑 Main (${mainProvider.name}) : ${repo.cloneUrl} ${mainBadge}`,
      ];

      if (repo.mirrors && repo.mirrors.length > 0) {
        repo.mirrors.forEach((m, mIdx) => {
          const isLast = mIdx === repo.mirrors!.length - 1;
          const treeChar = isLast ? '└──' : '├──';
          const mBadge = !m.exists
            ? '\x1b[31m[⚠️ 미존재]\x1b[0m'
            : m.isEmpty
            ? '\x1b[33m[📭 비어있음]\x1b[0m'
            : '\x1b[32m[✅ 커밋 있음]\x1b[0m';
          details.push(`${treeChar} 🪞 Mirror (${m.providerName}) : ${m.cloneUrl} ${mBadge}`);
        });
      }

      return {
        label: repo.fullPath,
        details,
      };
    });

    const selectedIndexes = await selectMultiChoices(
      '❓ 동기화를 진행할 저장소를 선택해 주세요 (Mirror 커밋 ➔ Main 푸시 및 미러 설정):',
      syncOptions
    );

    if (selectedIndexes.length === 0) {
      console.log(`\nℹ️ 선택된 저장소가 없습니다. 동기화 작업을 취소합니다.\n`);
      return;
    }

    const targetReposToSync = selectedIndexes.map((idx) => syncCandidateRepos[idx]);

    console.log(`\n🔄 [git-cli] \x1b[1m${targetReposToSync.length}개 저장소\x1b[0m에 대한 소스 Push 및 미러 동기화를 진행합니다...\n`);

    for (const repo of targetReposToSync) {
      const repoName = repo.name || repo.fullPath.split('/').pop()!;
      console.log(`──────────────────────────────────────────────────────────`);
      console.log(` 🎯 저장소 소스 동기화 처리 중: \x1b[1m\x1b[36m${repo.fullPath}\x1b[0m`);

      let sourceUrl: string | null = null;
      let sourceProviderName = '';

      // Find first non-empty mirror source
      if (repo.mirrors) {
        for (const mirrorConfig of config.git.mirrors) {
          const mirrorProvider = createProvider(mirrorConfig);
          const mirrorStatus = repo.mirrors.find((m) => m.providerName === mirrorProvider.name);
          if (mirrorStatus && mirrorStatus.exists && !mirrorStatus.isEmpty) {
            try {
              const mirrorRepoRes = await mirrorProvider.ensureRepo(repoName);
              sourceUrl = mirrorRepoRes.authenticatedCloneUrl || mirrorRepoRes.cloneUrl;
              sourceProviderName = mirrorProvider.name;
              break;
            } catch {
              sourceUrl = mirrorStatus.cloneUrl;
              sourceProviderName = mirrorProvider.name;
              break;
            }
          }
        }
      }

      if (!sourceUrl) {
        console.warn(` ⚠️ [동기화 건너뜀] ${repo.fullPath}: 커밋이 존재하는 Mirror 소스 저장소가 없습니다.`);
        continue;
      }

      console.log(` 💡 Mirror 소스 저장소 감지: [\x1b[1m${sourceProviderName}\x1b[0m] ${sourceUrl}`);

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-cli-sync-'));

      try {
        console.log(` 🛠️  Mirror 소스 코드를 임시 클론 중 (git clone --mirror)...`);
        await execa('git', ['clone', '--mirror', sourceUrl, tmpDir]);

        // 1. Push mirror source to Main repository
        const mainRepoRes = await mainProvider.ensureRepo(repoName);
        const mainTargetUrl = mainRepoRes.authenticatedCloneUrl || mainRepoRes.cloneUrl;
        console.log(` 🚀 Main (${mainProvider.name}) 저장소로 소스 코드 Push 중 (git push --mirror)...`);
        await execa('git', ['push', '--mirror', mainTargetUrl], { cwd: tmpDir });
        console.log(` ✅ Main (${mainProvider.name}) 에 소스 코드가 성공적으로 올랐습니다!`);

        // 2. Push to other empty Mirrors if any
        if (config.git.mirrors && config.git.mirrors.length > 0) {
          for (const mirrorConfig of config.git.mirrors) {
            const mirrorProvider = createProvider(mirrorConfig);
            const mirrorStatus = repo.mirrors?.find((m) => m.providerName === mirrorProvider.name);

            if (!mirrorStatus || !mirrorStatus.exists || mirrorStatus.isEmpty) {
              try {
                const mirrorRepoRes = await mirrorProvider.ensureRepo(repoName);
                const mirrorTargetUrl = mirrorRepoRes.authenticatedCloneUrl || mirrorRepoRes.cloneUrl;
                console.log(` 🚀 Mirror (${mirrorProvider.name}) 비어있는 저장소로 소스 Push 중...`);
                await execa('git', ['push', '--mirror', mirrorTargetUrl], { cwd: tmpDir });
                console.log(` ✅ Mirror (${mirrorProvider.name}) 소스 Push 성공!`);
              } catch (mirrorPushErr: any) {
                console.warn(` ⚠️ Mirror (${mirrorProvider.name}) Push 경고: ${mirrorPushErr.message}`);
              }
            }

            // 3. Register Push/Pull Mirror settings if supported
            if (mainProvider.capabilities.supportsPushMirror && mainProvider.addPushMirror) {
              try {
                const mirrorRepoRes = await mirrorProvider.ensureRepo(repoName);
                console.log(` 🔄 Main (${mainProvider.name}) 에 Push Mirror 설정 등록 중 -> ${mirrorProvider.name}`);
                await mainProvider.addPushMirror(repoName, mirrorRepoRes.authenticatedCloneUrl);
              } catch {}
            } else if (mirrorProvider.addPullMirror) {
              try {
                console.log(` 🔄 Mirror (${mirrorProvider.name}) 에 Pull Mirror 설정 등록 중...`);
                await mirrorProvider.addPullMirror(repoName, mainRepoRes.authenticatedCloneUrl);
              } catch {}
            }
          }
        }
      } catch (syncErr: any) {
        console.error(` ❌ 저장소 동기화 중 오류 발생: ${syncErr.message}`);
      } finally {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {}
      }
    }

    console.log(`\n──────────────────────────────────────────────────────────`);
    console.log(` 🎉  선택한 저장소의 소스 Push 및 미러 동기화 완료!`);
    console.log(`──────────────────────────────────────────────────────────\n`);
    return;
  }

  // Action 2: 삭제 (Delete) - Main과 Mirror 둘 다 비어있는 저장소만 필터링
  if (actionIdx === 1) {
    const deleteCandidateRepos = emptyRepos.filter((repo) => {
      const mainEmpty = repo.isEmpty;
      const mirrorsAllEmptyOrMissing = !repo.mirrors || repo.mirrors.every((m) => !m.exists || m.isEmpty);
      return mainEmpty && mirrorsAllEmptyOrMissing;
    });

    if (deleteCandidateRepos.length === 0) {
      console.log(`\nℹ️ Main과 Mirror 모두 비어있는 삭제 대상 저장소가 없습니다.\n`);
      return;
    }

    const deleteOptions = deleteCandidateRepos.map((repo) => {
      const mainBadge = '\x1b[33m[📭 비어있음]\x1b[0m';
      const details: string[] = [
        `├── 👑 Main (${mainProvider.name}) : ${repo.cloneUrl} ${mainBadge}`,
      ];

      if (repo.mirrors && repo.mirrors.length > 0) {
        repo.mirrors.forEach((m, mIdx) => {
          const isLast = mIdx === repo.mirrors!.length - 1;
          const treeChar = isLast ? '└──' : '├──';
          const mBadge = !m.exists
            ? '\x1b[31m[⚠️ 미존재]\x1b[0m'
            : m.isEmpty
            ? '\x1b[33m[📭 비어있음]\x1b[0m'
            : '\x1b[32m[✅ 커밋 있음]\x1b[0m';
          details.push(`${treeChar} 🪞 Mirror (${m.providerName}) : ${m.cloneUrl} ${mBadge}`);
        });
      }

      return {
        label: repo.fullPath,
        details,
      };
    });

    const selectedIndexes = await selectMultiChoices(
      '❓ 삭제할 저장소를 선택해 주세요 (Main & Mirror 둘 다 비어있음):',
      deleteOptions
    );

    if (selectedIndexes.length === 0) {
      console.log(`\nℹ️ 선택된 저장소가 없습니다. 삭제 작업을 취소합니다.\n`);
      return;
    }

    const targetReposToDelete = selectedIndexes.map((idx) => deleteCandidateRepos[idx]);

    console.log(`\n⚠️  [삭제 대상 목록 - 총 ${targetReposToDelete.length}개]`);
    targetReposToDelete.forEach((r) => console.log(`   - 🚨 \x1b[1m\x1b[31m${r.fullPath}\x1b[0m`));

    const confirmDelete = await confirm(
      `\n⚠️ 정말로 선택한 ${targetReposToDelete.length}개의 저장소를 Main 및 Mirror 플랫폼에서 삭제하시겠습니까? (되돌릴 수 없음)`,
      false
    );

    if (!confirmDelete) {
      console.log(`\n🚫 [git-cli] 저장소 삭제 작업이 취소되었습니다.\n`);
      return;
    }

    console.log(`\n🗑️ [git-cli] 저장소 일괄 삭제를 진행합니다...\n`);

    for (const repo of targetReposToDelete) {
      const repoName = repo.name || repo.fullPath.split('/').pop()!;
      console.log(`──────────────────────────────────────────────────────────`);
      console.log(` 🗑️ Main 저장소 삭제 중: \x1b[1m${repo.fullPath}\x1b[0m (${mainProvider.name})`);
      try {
        if (mainProvider.deleteRepo) {
          await mainProvider.deleteRepo(repo.name || repo.fullPath);
        } else {
          console.warn(` ⚠️ ${mainProvider.name} Provider는 삭제 기능을 지원하지 않습니다.`);
        }
      } catch (err: any) {
        console.error(` ❌ Main 저장소 삭제 실패: ${err.message}`);
      }

      if (config.git.mirrors && config.git.mirrors.length > 0) {
        for (const mirrorConfig of config.git.mirrors) {
          const mirrorProvider = createProvider(mirrorConfig);
          console.log(` 🗑️ Mirror 저장소 삭제 중: \x1b[1m${repoName}\x1b[0m (${mirrorProvider.name})`);
          try {
            if (mirrorProvider.deleteRepo) {
              await mirrorProvider.deleteRepo(repoName);
            } else {
              console.warn(` ⚠️ ${mirrorProvider.name} Provider는 삭제 기능을 지원하지 않습니다.`);
            }
          } catch (err: any) {
            console.error(` ❌ Mirror 저장소 삭제 실패: ${err.message}`);
          }
        }
      }
    }

    console.log(`\n──────────────────────────────────────────────────────────`);
    console.log(` 🎉  선택한 저장소 일괄 삭제 프로세스가 완료되었습니다!`);
    console.log(`──────────────────────────────────────────────────────────\n`);
  }
}
