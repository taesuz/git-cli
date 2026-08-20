#!/usr/bin/env node

import { Command } from 'commander';
import { ensureConfigFile, CONFIG_FILE, loadConfig, validateConfig } from './config/index.js';
import { syncRepository } from './services/sync.js';
import { checkAndRegisterPushMirror } from './services/mirror.js';
import { checkUnmirroredRepositories } from './services/checkMirror.js';
import { selectChoice } from './utils/prompt.js';
import { detectProjectName } from './utils/project.js';

const program = new Command();

program
  .name('git-cli')
  .description('Git multi-provider repository mirror synchronization CLI')
  .version('1.0.0');

program
  .command('init')
  .description('기본 설정 파일(~/.git-cli/config.yaml)을 생성하고 유효성을 검사합니다.')
  .action(() => {
    runInitCommand();
  });

program
  .command('sync [repository]')
  .description('지정한 저장소를 Main에서 읽어 Mirror 플랫폼들에 레포 생성/동기화합니다. (인자 생략 시 현재 폴더 이름/package.json 기준 자동 감지)')
  .action(async (repository?: string) => {
    await runSyncCommand(repository);
  });

program
  .command('mirror [repository]')
  .description('Main 저장소에 리포지토리 푸시 미러링(Push Mirror) 등록 여부를 확인하고 필요 시 등록합니다.')
  .action(async (repository?: string) => {
    await runMirrorCommand(repository);
  });

program
  .command('check-mirror [repository]')
  .description('미러(Push/Pull Mirror)가 등록되지 않은 저장소 목록을 탐색하여 표시합니다.')
  .action(async (repository?: string) => {
    await runCheckMirrorCommand(repository);
  });

program
  .command('check-empty [repository]')
  .description('Main Provider의 저장소(또는 지정한 저장소)가 비어있는지(Empty) 검사합니다.')
  .action(async (repository?: string) => {
    await runCheckEmptyCommand(repository);
  });

function runInitCommand() {
  ensureConfigFile();
  console.log(`📌 [git-cli] 설정 파일 위치: ${CONFIG_FILE}`);
  try {
    const config = loadConfig();
    const validation = validateConfig(config);
    if (validation.valid) {
      console.log(`✅ [git-cli] 설정 유효성 검사 성공! 정상적으로 사용할 수 있습니다.`);
    } else {
      console.warn(`⚠️  [git-cli] 설정에 일부 주의사항이 있습니다:`);
      validation.errors.forEach((e) => console.warn(`  - ${e}`));
    }
  } catch (err: any) {
    console.error(`❌ [git-cli] 설정 로드 오류: ${err.message}`);
  }
}

async function runSyncCommand(repository?: string) {
  try {
    let targetRepo = repository;

    if (!targetRepo || targetRepo.trim() === '') {
      targetRepo = detectProjectName();
      console.log(`💡 [git-cli] 저장소 인자가 지정되지 않아 현재 프로젝트 이름('${targetRepo}')을 기본 대상으로 자동 사용합니다.`);
    }

    await syncRepository(targetRepo);
  } catch (err: any) {
    console.error(`\n❌ [git-cli 오류] ${err.message}\n`);
    process.exit(1);
  }
}

async function runMirrorCommand(repository?: string) {
  try {
    await checkAndRegisterPushMirror(repository);
  } catch (err: any) {
    console.error(`\n❌ [git-cli 오류] ${err.message}\n`);
    process.exit(1);
  }
}

async function runCheckMirrorCommand(repository?: string) {
  try {
    await checkUnmirroredRepositories(repository);
  } catch (err: any) {
    console.error(`\n❌ [git-cli 오류] ${err.message}\n`);
    process.exit(1);
  }
}

async function runCheckEmptyCommand(repository?: string) {
  try {
    const { checkEmptyRepositories } = await import('./services/checkEmpty.js');
    await checkEmptyRepositories(repository);
  } catch (err: any) {
    console.error(`\n❌ [git-cli 오류] ${err.message}\n`);
    process.exit(1);
  }
}

async function main() {
  // If no subcommand is specified, show interactive main menu
  if (process.argv.length <= 2) {
    console.log(`\n──────────────────────────────────────────────────────────`);
    console.log(` 🚀  \x1b[1m\x1b[36mgit-cli\x1b[0m | Git 멀티 저장소 미러 동기화 CLI`);
    console.log(`──────────────────────────────────────────────────────────\n`);

    const actionIdx = await selectChoice('❓ 실행할 메인 기능을 선택해 주세요:', [
      '🔄  현재 디렉토리 저장소 생성 및 미러 동기화 설정 (sync)',
      '🪞  리포지토리 푸시 미러링 확인 및 등록 (mirror)',
      '🚨  미러 미등록 리포지토리 목록 검사 (check-mirror)',
      '🔍  비어있는 리포지토리 체크 및 동기화/삭제 (check-empty)',
      '⚙️  설정 파일 생성 및 유효성 검사 (init)',
      '🚫  종료',
    ], 0);

    if (actionIdx === 0) {
      await runSyncCommand();
    } else if (actionIdx === 1) {
      await runMirrorCommand();
    } else if (actionIdx === 2) {
      await runCheckMirrorCommand();
    } else if (actionIdx === 3) {
      await runCheckEmptyCommand();
    } else if (actionIdx === 4) {
      runInitCommand();
    } else {
      console.log('\nℹ️ 작업을 진행하지 않고 종료합니다.\n');
    }
  } else {
    program.parse(process.argv);
  }
}

main();
