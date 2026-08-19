#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { Command } from 'commander';
import { ensureConfigFile, CONFIG_FILE, loadConfig, validateConfig } from './config/index.js';
import { syncRepository } from './services/sync.js';

const program = new Command();

program
  .name('git-cli')
  .description('Git multi-provider repository mirror synchronization CLI')
  .version('1.0.0');

program
  .command('init')
  .description('기본 설정 파일(~/.git-cli/config.yaml)을 생성하고 유효성을 검사합니다.')
  .action(() => {
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
  });

program
  .command('sync [repository]')
  .description('지정한 저장소를 Main에서 읽어 Mirror 플랫폼들에 레포 생성/동기화합니다. (인자 생략 시 현재 폴더 이름/package.json 기준 자동 감지)')
  .action(async (repository?: string) => {
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
  });

function detectProjectName(): string {
  const currentDir = process.cwd();
  const packageJsonPath = path.join(currentDir, 'package.json');

  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      if (pkg.name && typeof pkg.name === 'string' && pkg.name.trim() !== '') {
        const cleanName = pkg.name.replace(/^@[^/]+\//, '');
        return cleanName;
      }
    } catch {}
  }

  return path.basename(currentDir);
}

program.parse(process.argv);
