import fs from 'fs';
import path from 'path';
import os from 'os';
import YAML from 'yaml';
import { Config, ProviderConfig } from '../types.js';
import { getRegisteredProviders } from '../providers/factory.js';

export const CONFIG_DIR = path.join(os.homedir(), '.git-cli');
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.yaml');

const DEFAULT_CONFIG_TEMPLATE = `git:
  main:
    provider: github
    token: "" # GitHub Personal Access Token (or set GITHUB_TOKEN env)
    host: "https://github.com"
    group: "" # Optional group/org name. If empty, creates under main user repo.
  mirrors:
    - provider: gitea
      token: "" # Gitea Access Token (or set GITEA_TOKEN env)
      host: "https://gitea.example.com"
      group: "" # Optional group/org name. If empty, creates under main user repo.
    - provider: gitlab
      token: "" # GitLab Access Token (or set GITLAB_TOKEN env)
      host: "https://gitlab.com"
      group: "" # Optional subgroup/group name. If empty, creates under user repo.
`;

export function ensureConfigFile(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, DEFAULT_CONFIG_TEMPLATE, 'utf-8');
    console.log(`✨ [git-cli] 기본 설정 파일이 생성되었습니다: ${CONFIG_FILE}`);
  }
}

export function loadConfig(): Config {
  ensureConfigFile();

  const fileContent = fs.readFileSync(CONFIG_FILE, 'utf-8');
  let parsed: Config;

  try {
    parsed = YAML.parse(fileContent) as Config;
  } catch (err: any) {
    throw new Error(`❌ [git-cli] 설정 파일(${CONFIG_FILE}) 구문 분석 실패: ${err.message}`);
  }

  if (!parsed || !parsed.git || !parsed.git.main) {
    throw new Error(`❌ [git-cli] 설정 파일 구성이 올바르지 않습니다. 'git.main' 및 'git.mirrors'를 확인하세요.`);
  }

  // Handle single object mirror fallback
  if (parsed.git.mirrors && !Array.isArray(parsed.git.mirrors) && typeof parsed.git.mirrors === 'object') {
    parsed.git.mirrors = [parsed.git.mirrors as unknown as ProviderConfig];
  } else if (!Array.isArray(parsed.git.mirrors)) {
    parsed.git.mirrors = [];
  }

  // 환경변수 및 토큰 유효성 동적 검사
  resolveProviderToken(parsed.git.main, 'main');

  parsed.git.mirrors.forEach((mirror, index) => {
    resolveProviderToken(mirror, `mirror[${index}]`);
  });

  return parsed;
}

function resolveProviderToken(pConfig: ProviderConfig, label: string): void {
  const providerType = (pConfig.provider || '').toLowerCase();

  if (pConfig.token && pConfig.token.trim() !== '' && !isDummyToken(pConfig.token)) {
    return;
  }

  // Provider Registry에서 동적으로 envTokenKeys 가져오기
  const registry = getRegisteredProviders();
  const ProviderClass = registry.get(providerType);

  let possibleEnvKeys: string[] = [];
  if (ProviderClass) {
    const tempInst = new ProviderClass({ provider: providerType, token: 'temp' });
    possibleEnvKeys = tempInst.capabilities?.envTokenKeys || [];
  } else {
    // Fallback standard keys
    possibleEnvKeys = [`${providerType.toUpperCase()}_TOKEN`, `GIT_${providerType.toUpperCase()}_TOKEN`];
  }

  for (const envKey of possibleEnvKeys) {
    const val = process.env[envKey];
    if (val && val.trim() !== '') {
      pConfig.token = val.trim();
      return;
    }
  }

  console.warn(`\n⚠️  [git-cli 경고] ${label} (${providerType})의 Access Token이 설정되지 않았거나 더미값입니다.`);
  console.warn(`  - ${CONFIG_FILE} 파일의 'token' 항목을 수정하시거나,`);
  console.warn(`  - 환경변수(${possibleEnvKeys.join(' 또는 ')})를 설정해 주세요.\n`);
}

function isDummyToken(token: string): boolean {
  const dummyValues = ['asdfasdfasdf', 'your_token', 'your_github_token', 'your_gitlab_token', 'your_gitea_token', 'your_forgejo_token', 'xxxx'];
  return dummyValues.includes(token.trim().toLowerCase());
}

export function validateConfig(config: Config): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config.git?.main?.provider) {
    errors.push('git.main.provider 설정이 필요합니다.');
  }

  if (!config.git?.main?.token || isDummyToken(config.git.main.token)) {
    errors.push(`git.main (${config.git.main.provider}) 토큰이 올바르지 않습니다. ${CONFIG_FILE} 또는 환경변수(${config.git.main.provider.toUpperCase()}_TOKEN)를 확인하세요.`);
  }

  for (let i = 0; i < (config.git.mirrors || []).length; i++) {
    const mirror = config.git.mirrors[i];
    if (!mirror.provider) {
      errors.push(`git.mirrors[${i}].provider 설정이 필요합니다.`);
    }
    if (!mirror.token || isDummyToken(mirror.token)) {
      errors.push(`git.mirrors[${i}] (${mirror.provider}) 토큰이 올바르지 않습니다. ${CONFIG_FILE} 또는 환경변수(${mirror.provider.toUpperCase()}_TOKEN)를 확인하세요.`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
