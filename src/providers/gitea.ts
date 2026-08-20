import axios, { AxiosInstance } from 'axios';
import { EnsureRepoResult, GitProvider, GitProviderCapabilities, ProviderConfig } from '../types.js';
import { registerProvider } from './factory.js';

export class GiteaProvider implements GitProvider {
  name = 'Gitea';
  type = 'gitea';
  capabilities: GitProviderCapabilities = {
    supportsPushMirror: true,
    supportsPullMirror: true,
    envTokenKeys: ['GITEA_TOKEN', 'GIT_GITEA_TOKEN'],
  };

  protected client: AxiosInstance;
  protected token: string;
  protected host: string;
  protected group?: string;

  constructor(config: ProviderConfig) {
    this.token = config.token;
    this.host = (config.host || 'http://localhost:3000').replace(/\/$/, '');
    this.group = config.group;

    this.client = axios.create({
      baseURL: `${this.host}/api/v1`,
      headers: {
        Authorization: `token ${this.token}`,
        Accept: 'application/json',
        'User-Agent': 'git-cli',
      },
    });
  }

  async getCurrentUser(): Promise<{ username: string }> {
    try {
      const res = await this.client.get('/user');
      return { username: res.data.username || res.data.login };
    } catch (err: any) {
      throw new Error(`[${this.name}] 사용자 정보 조회 실패: ${err.response?.data?.message || err.message}`);
    }
  }

  protected resolveOwnerAndRepo(targetPath: string, username: string): { targetOwner: string; repoName: string } {
    const parts = targetPath.split('/');
    if (parts.length > 1) {
      return { targetOwner: parts[0], repoName: parts[1] };
    }
    const targetOwner = this.group && this.group.trim() !== '' ? this.group.trim() : username;
    return { targetOwner, repoName: parts[0] };
  }

  protected getSshUrl(fullPath: string): string {
    try {
      const urlObj = new URL(this.host);
      return `git@${urlObj.hostname}:${fullPath}.git`;
    } catch {
      return `git@localhost:${fullPath}.git`;
    }
  }

  async ensureRepo(targetPath: string): Promise<EnsureRepoResult> {
    const user = await this.getCurrentUser();
    const { targetOwner, repoName } = this.resolveOwnerAndRepo(targetPath, user.username);

    const fullPath = `${targetOwner}/${repoName}`;
    const cloneUrl = `${this.host}/${fullPath}.git`;
    const authenticatedCloneUrl = `${this.host.replace(
      /^https?:\/\//,
      `https://${user.username}:${this.token}@`
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
        throw new Error(`[${this.name}] 저장소(${fullPath}) 조회 실패: ${err.response?.data?.message || err.message}`);
      }
    }

    const isUserRepo = targetOwner.toLowerCase() === user.username.toLowerCase();

    if (isUserRepo) {
      try {
        const createRes = await this.client.post('/user/repos', {
          name: repoName,
          private: true, // 기본 Private 설정
        });
        console.log(`[${this.name} API] 사용자 개인 Private 저장소 생성 완료: ${fullPath}`);
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
        throw new Error(`[${this.name} API] 저장소 생성 실패: ${err.response?.data?.message || err.message}`);
      }
    } else {
      try {
        await this.client.get(`/orgs/${targetOwner}`);
      } catch (err: any) {
        if (err.response?.status === 404) {
          try {
            await this.client.post('/orgs', {
              username: targetOwner,
              visibility: 'private',
            });
            console.log(`[${this.name} API] 조직 생성 완료: ${targetOwner}`);
          } catch (orgErr: any) {
            console.warn(`[${this.name} API] 조직 생성 경고: ${orgErr.response?.data?.message || orgErr.message}`);
          }
        }
      }

      try {
        const createRes = await this.client.post(`/orgs/${targetOwner}/repos`, {
          name: repoName,
          private: true, // 기본 Private 설정
        });
        console.log(`[${this.name} API] 조직 Private 저장소 생성 완료: ${fullPath}`);
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
        throw new Error(`[${this.name} API] 조직 저장소 생성 실패: ${err.response?.data?.message || err.message}`);
      }
    }
  }

  async checkRepoExists(targetPath: string): Promise<EnsureRepoResult> {
    const user = await this.getCurrentUser();
    const { targetOwner, repoName } = this.resolveOwnerAndRepo(targetPath, user.username);

    const fullPath = `${targetOwner}/${repoName}`;
    const cloneUrl = `${this.host}/${fullPath}.git`;
    const authenticatedCloneUrl = `${this.host.replace(
      /^https?:\/\//,
      `https://${user.username}:${this.token}@`
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
        throw new Error(`[${this.name}] 저장소(${fullPath}) 조회 실패: ${err.response?.data?.message || err.message}`);
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

  async addPushMirror(targetPath: string, mirrorCloneUrl: string): Promise<void> {
    const user = await this.getCurrentUser();
    const { targetOwner, repoName } = this.resolveOwnerAndRepo(targetPath, user.username);
    const fullPath = `${targetOwner}/${repoName}`;

    console.log(`[${this.name} API] Main 저장소(${fullPath})에 Push Mirror 등록 중 -> ${mirrorCloneUrl}`);

    try {
      await this.client.post(`/repos/${targetOwner}/${repoName}/push_mirrors`, {
        remote_address: mirrorCloneUrl,
        sync_on_commit: true,
      });
      console.log(`[${this.name} API] Push Mirror 등록 성공!`);
    } catch (err: any) {
      console.warn(`[${this.name} API] Push Mirror 등록 경고: ${err.response?.data?.message || err.message}`);
    }
  }

  async getPushMirrors(targetPath: string): Promise<string[]> {
    const user = await this.getCurrentUser();
    const { targetOwner, repoName } = this.resolveOwnerAndRepo(targetPath, user.username);
    const fullPath = `${targetOwner}/${repoName}`;

    try {
      const res = await this.client.get(`/repos/${targetOwner}/${repoName}/push_mirrors`);
      if (Array.isArray(res.data)) {
        return res.data
          .map((m: any) => m.remote_address)
          .filter((addr: any) => typeof addr === 'string');
      }
      return [];
    } catch (err: any) {
      if (err.response?.status === 404) {
        return [];
      }
      throw new Error(`[${this.name} API] Push Mirror 목록 조회 실패 (${fullPath}): ${err.response?.data?.message || err.message}`);
    }
  }

  async addPullMirror(targetPath: string, mainCloneUrl: string): Promise<void> {
    const user = await this.getCurrentUser();
    const { targetOwner, repoName } = this.resolveOwnerAndRepo(targetPath, user.username);
    const fullPath = `${targetOwner}/${repoName}`;

    try {
      await this.client.post('/repos/migrate', {
        clone_addr: mainCloneUrl,
        mirror: true,
        repo_name: repoName,
        repo_owner: targetOwner,
        service: 'git',
        private: true, // 기본 Private 설정
      });
      console.log(`[${this.name} API] Pull Mirror 등록 성공: ${fullPath}`);
    } catch (err: any) {
      if (err.response?.status === 409 || JSON.stringify(err.response?.data).includes('already exists')) {
        try {
          await this.client.post(`/repos/${targetOwner}/${repoName}/mirror-sync`);
          console.log(`[${this.name} API] 기존 저장소 Mirror Sync 트리거 완료: ${fullPath}`);
        } catch (syncErr: any) {
          console.warn(`[${this.name} API] Mirror Sync 트리거 경고: ${syncErr.message}`);
        }
      } else {
        throw new Error(`[${this.name} API] Pull Mirror 등록 실패: ${err.response?.data?.message || err.message}`);
      }
    }
  }

  protected async isRepoEmpty(targetOwner: string, repoName: string, repoData: any): Promise<boolean> {
    if (typeof repoData.empty === 'boolean') {
      return repoData.empty;
    }
    if (typeof repoData.size === 'number' && repoData.size === 0) {
      return true;
    }
    try {
      const branchesRes = await this.client.get(`/repos/${targetOwner}/${repoName}/branches`);
      return Array.isArray(branchesRes.data) && branchesRes.data.length === 0;
    } catch (err: any) {
      if (err.response?.status === 404) {
        return true;
      }
      return false;
    }
  }

  async listRepositories(): Promise<import('../types.js').RepoInfo[]> {
    const user = await this.getCurrentUser();
    const isGroup = !!(this.group && this.group.trim() !== '');
    const endpoint = isGroup
      ? `/orgs/${encodeURIComponent(this.group!.trim())}/repos?limit=100`
      : `/user/repos?limit=100`;

    try {
      const res = await this.client.get(endpoint);
      const repoInfos: import('../types.js').RepoInfo[] = [];

      for (const repo of res.data) {
        const owner = repo.owner?.username || repo.owner?.login || user.username;
        const isEmpty = await this.isRepoEmpty(owner, repo.name, repo);
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
      throw new Error(`[${this.name} API] 저장소 목록 조회 실패: ${err.response?.data?.message || err.message}`);
    }
  }

  async checkRepositoryEmpty(targetPath: string): Promise<import('../types.js').RepoInfo> {
    const user = await this.getCurrentUser();
    const { targetOwner, repoName } = this.resolveOwnerAndRepo(targetPath, user.username);
    const fullPath = `${targetOwner}/${repoName}`;

    try {
      const res = await this.client.get(`/repos/${targetOwner}/${repoName}`);
      const repo = res.data;
      const isEmpty = await this.isRepoEmpty(targetOwner, repoName, repo);
      return {
        name: repo.name,
        fullPath: repo.full_name,
        cloneUrl: repo.html_url,
        isEmpty,
        defaultBranch: repo.default_branch,
        size: repo.size,
      };
    } catch (err: any) {
      throw new Error(`[${this.name} API] 저장소(${fullPath}) 정보 조회 실패: ${err.response?.data?.message || err.message}`);
    }
  }

  async deleteRepo(targetPath: string): Promise<void> {
    const user = await this.getCurrentUser();
    const { targetOwner, repoName } = this.resolveOwnerAndRepo(targetPath, user.username);
    const fullPath = `${targetOwner}/${repoName}`;

    try {
      await this.client.delete(`/repos/${targetOwner}/${repoName}`);
      console.log(`🗑️ [${this.name} API] 저장소 삭제 완료: ${fullPath}`);
    } catch (err: any) {
      if (err.response?.status === 404) {
        console.warn(`⚠️ [${this.name} API] 삭제 대상 저장소가 존재하지 않습니다: ${fullPath}`);
      } else {
        throw new Error(`[${this.name} API] 저장소(${fullPath}) 삭제 실패: ${err.response?.data?.message || err.message}`);
      }
    }
  }
}

registerProvider('gitea', GiteaProvider);
