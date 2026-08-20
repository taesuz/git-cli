import axios, { AxiosInstance } from 'axios';
import { EnsureRepoResult, GitProvider, GitProviderCapabilities, ProviderConfig } from '../types.js';
import { registerProvider } from './factory.js';

export class GithubProvider implements GitProvider {
  name = 'GitHub';
  type = 'github';
  capabilities: GitProviderCapabilities = {
    supportsPushMirror: false,
    supportsPullMirror: true,
    envTokenKeys: ['GITHUB_TOKEN', 'GIT_MAIN_TOKEN'],
  };

  private client: AxiosInstance;
  private token: string;
  private host: string;
  private group?: string;

  constructor(config: ProviderConfig) {
    this.token = config.token;
    this.host = config.host || 'https://github.com';
    this.group = config.group;

    const baseUrl = this.host.includes('github.com')
      ? 'https://api.github.com'
      : `${this.host.replace(/\/$/, '')}/api/v3`;

    this.client = axios.create({
      baseURL: baseUrl,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'git-cli',
      },
    });
  }

  async getCurrentUser(): Promise<{ username: string }> {
    try {
      const res = await this.client.get('/user');
      return { username: res.data.login };
    } catch (err: any) {
      throw new Error(`[GitHub] 사용자 정보 조회 실패: ${err.response?.data?.message || err.message}`);
    }
  }

  private resolveOwnerAndRepo(targetPath: string, username: string): { targetOwner: string; repoName: string } {
    const parts = targetPath.split('/');
    if (parts.length > 1) {
      return { targetOwner: parts[0], repoName: parts[1] };
    }
    const targetOwner = this.group && this.group.trim() !== '' ? this.group.trim() : username;
    return { targetOwner, repoName: parts[0] };
  }

  private getSshUrl(fullPath: string): string {
    try {
      const urlObj = new URL(this.host);
      return `git@${urlObj.hostname}:${fullPath}.git`;
    } catch {
      return `git@github.com:${fullPath}.git`;
    }
  }

  async ensureRepo(targetPath: string): Promise<EnsureRepoResult> {
    const user = await this.getCurrentUser();
    const { targetOwner, repoName } = this.resolveOwnerAndRepo(targetPath, user.username);

    const fullPath = `${targetOwner}/${repoName}`;
    const cloneUrl = `${this.host.replace(/\/$/, '')}/${fullPath}.git`;
    const authenticatedCloneUrl = `${this.host.replace(
      /^https?:\/\//,
      `https://x-access-token:${this.token}@`
    )}/${fullPath}.git`;
    const sshUrl = this.getSshUrl(fullPath);

    try {
      const res = await this.client.get(`/repos/${targetOwner}/${repoName}`);
      if (res.status === 200) {
        return {
          cloneUrl,
          authenticatedCloneUrl,
          sshUrl,
          exists: true,
          owner: targetOwner,
          repoName,
          fullPath,
          id: res.data.id,
        };
      }
    } catch (err: any) {
      if (err.response?.status !== 404) {
        throw new Error(`[GitHub] 저장소(${fullPath}) 조회 실패: ${err.response?.data?.message || err.message}`);
      }
    }

    const isUserRepo = targetOwner.toLowerCase() === user.username.toLowerCase();

    if (isUserRepo) {
      try {
        const createRes = await this.client.post('/user/repos', {
          name: repoName,
          private: true, // 기본 Private 설정
        });
        console.log(`[GitHub API] 메인 사용자 Private 저장소 생성 완료: ${fullPath}`);
        return {
          cloneUrl,
          authenticatedCloneUrl,
          sshUrl,
          exists: false,
          owner: targetOwner,
          repoName,
          fullPath,
          id: createRes.data.id,
        };
      } catch (err: any) {
        throw new Error(`[GitHub API] 저장소 생성 실패: ${err.response?.data?.message || err.message}`);
      }
    } else {
      try {
        const createRes = await this.client.post(`/orgs/${targetOwner}/repos`, {
          name: repoName,
          private: true, // 기본 Private 설정
        });
        console.log(`[GitHub API] 조직 Private 저장소 생성 완료: ${fullPath}`);
        return {
          cloneUrl,
          authenticatedCloneUrl,
          sshUrl,
          exists: false,
          owner: targetOwner,
          repoName,
          fullPath,
          id: createRes.data.id,
        };
      } catch (err: any) {
        throw new Error(`[GitHub API] 조직 저장소 생성 실패: ${err.response?.data?.message || err.message}`);
      }
    }
  }

  async checkRepoExists(targetPath: string): Promise<EnsureRepoResult> {
    const user = await this.getCurrentUser();
    const { targetOwner, repoName } = this.resolveOwnerAndRepo(targetPath, user.username);

    const fullPath = `${targetOwner}/${repoName}`;
    const cloneUrl = `${this.host.replace(/\/$/, '')}/${fullPath}.git`;
    const authenticatedCloneUrl = `${this.host.replace(
      /^https?:\/\//,
      `https://x-access-token:${this.token}@`
    )}/${fullPath}.git`;
    const sshUrl = this.getSshUrl(fullPath);

    try {
      const res = await this.client.get(`/repos/${targetOwner}/${repoName}`);
      if (res.status === 200) {
        return {
          cloneUrl,
          authenticatedCloneUrl,
          sshUrl,
          exists: true,
          owner: targetOwner,
          repoName,
          fullPath,
          id: res.data.id,
        };
      }
    } catch (err: any) {
      if (err.response?.status !== 404) {
        throw new Error(`[GitHub] 저장소(${fullPath}) 조회 실패: ${err.response?.data?.message || err.message}`);
      }
    }

    return {
      cloneUrl,
      authenticatedCloneUrl,
      sshUrl,
      exists: false,
      owner: targetOwner,
      repoName,
      fullPath,
    };
  }

  async addPushMirror(_targetPath: string, _mirrorCloneUrl: string): Promise<void> {
    console.warn(`[GitHub API] GitHub은 REST API를 통한 Push Mirror 등록을 지원하지 않으므로 건너뜁니다.`);
  }

  async addPullMirror(targetPath: string, mainCloneUrl: string): Promise<void> {
    const user = await this.getCurrentUser();
    const { targetOwner, repoName } = this.resolveOwnerAndRepo(targetPath, user.username);
    const fullPath = `${targetOwner}/${repoName}`;

    try {
      console.log(`[GitHub API] Import API를 통해 가져오기 등록 중: ${fullPath}...`);
      await this.client.put(`/repos/${targetOwner}/${repoName}/import`, {
        vcs_url: mainCloneUrl,
        vcs: 'git',
      });
      console.log(`[GitHub API] External Repository Import 등록 성공!`);
    } catch (err: any) {
      console.warn(`[GitHub API] Import API 등록 경고: ${err.response?.data?.message || err.message}`);
    }
  }

  private async isRepoEmpty(targetOwner: string, repoName: string, size?: number): Promise<boolean> {
    if (typeof size === 'number' && size === 0) {
      return true;
    }
    try {
      const branchesRes = await this.client.get(`/repos/${targetOwner}/${repoName}/branches`);
      return Array.isArray(branchesRes.data) && branchesRes.data.length === 0;
    } catch (err: any) {
      if (err.response?.status === 409 || err.response?.status === 404) {
        return true;
      }
      return false;
    }
  }

  async listRepositories(): Promise<import('../types.js').RepoInfo[]> {
    const user = await this.getCurrentUser();
    const isGroup = !!(this.group && this.group.trim() !== '');
    const endpoint = isGroup
      ? `/orgs/${encodeURIComponent(this.group!.trim())}/repos?per_page=100`
      : `/user/repos?type=owner&per_page=100`;

    try {
      const res = await this.client.get(endpoint);
      const repoInfos: import('../types.js').RepoInfo[] = [];

      for (const repo of res.data) {
        const isEmpty = await this.isRepoEmpty(repo.owner.login, repo.name, repo.size);
        repoInfos.push({
          name: repo.name,
          fullPath: repo.full_name,
          cloneUrl: repo.html_url,
          isEmpty,
          defaultBranch: repo.default_branch,
          size: repo.size,
        });
      }

      return repoInfos;
    } catch (err: any) {
      throw new Error(`[GitHub API] 저장소 목록 조회 실패: ${err.response?.data?.message || err.message}`);
    }
  }

  async checkRepositoryEmpty(targetPath: string): Promise<import('../types.js').RepoInfo> {
    const user = await this.getCurrentUser();
    const { targetOwner, repoName } = this.resolveOwnerAndRepo(targetPath, user.username);
    const fullPath = `${targetOwner}/${repoName}`;

    try {
      const res = await this.client.get(`/repos/${targetOwner}/${repoName}`);
      const repo = res.data;
      const isEmpty = await this.isRepoEmpty(targetOwner, repoName, repo.size);
      return {
        name: repo.name,
        fullPath: repo.full_name,
        cloneUrl: repo.html_url,
        isEmpty,
        defaultBranch: repo.default_branch,
        size: repo.size,
      };
    } catch (err: any) {
      throw new Error(`[GitHub API] 저장소(${fullPath}) 정보 조회 실패: ${err.response?.data?.message || err.message}`);
    }
  }

  async deleteRepo(targetPath: string): Promise<void> {
    const user = await this.getCurrentUser();
    const { targetOwner, repoName } = this.resolveOwnerAndRepo(targetPath, user.username);
    const fullPath = `${targetOwner}/${repoName}`;

    try {
      await this.client.delete(`/repos/${targetOwner}/${repoName}`);
      console.log(`🗑️ [GitHub API] 저장소 삭제 완료: ${fullPath}`);
    } catch (err: any) {
      if (err.response?.status === 404) {
        console.warn(`⚠️ [GitHub API] 삭제 대상 저장소가 존재하지 않습니다: ${fullPath}`);
      } else {
        throw new Error(`[GitHub API] 저장소(${fullPath}) 삭제 실패: ${err.response?.data?.message || err.message}`);
      }
    }
  }
}

registerProvider('github', GithubProvider);
