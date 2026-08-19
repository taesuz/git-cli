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

  private client: AxiosInstance;
  private token: string;
  private host: string;
  private group?: string;

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
      throw new Error(`[Gitea] 사용자 정보 조회 실패: ${err.response?.data?.message || err.message}`);
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
        throw new Error(`[Gitea] 저장소(${fullPath}) 조회 실패: ${err.response?.data?.message || err.message}`);
      }
    }

    const isUserRepo = targetOwner.toLowerCase() === user.username.toLowerCase();

    if (isUserRepo) {
      try {
        const createRes = await this.client.post('/user/repos', {
          name: repoName,
          private: true, // 기본 Private 설정
        });
        console.log(`[Gitea API] 사용자 개인 Private 저장소 생성 완료: ${fullPath}`);
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
        throw new Error(`[Gitea API] 저장소 생성 실패: ${err.response?.data?.message || err.message}`);
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
            console.log(`[Gitea API] 조직 생성 완료: ${targetOwner}`);
          } catch (orgErr: any) {
            console.warn(`[Gitea API] 조직 생성 경고: ${orgErr.response?.data?.message || orgErr.message}`);
          }
        }
      }

      try {
        const createRes = await this.client.post(`/orgs/${targetOwner}/repos`, {
          name: repoName,
          private: true, // 기본 Private 설정
        });
        console.log(`[Gitea API] 조직 Private 저장소 생성 완료: ${fullPath}`);
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
        throw new Error(`[Gitea API] 조직 저장소 생성 실패: ${err.response?.data?.message || err.message}`);
      }
    }
  }

  async addPushMirror(targetPath: string, mirrorCloneUrl: string): Promise<void> {
    const user = await this.getCurrentUser();
    const { targetOwner, repoName } = this.resolveOwnerAndRepo(targetPath, user.username);
    const fullPath = `${targetOwner}/${repoName}`;

    console.log(`[Gitea API] Main 저장소(${fullPath})에 Push Mirror 등록 중 -> ${mirrorCloneUrl}`);

    try {
      await this.client.post(`/repos/${targetOwner}/${repoName}/push_mirrors`, {
        remote_address: mirrorCloneUrl,
        sync_on_commit: true,
      });
      console.log(`[Gitea API] Push Mirror 등록 성공!`);
    } catch (err: any) {
      console.warn(`[Gitea API] Push Mirror 등록 경고: ${err.response?.data?.message || err.message}`);
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
      console.log(`[Gitea API] Pull Mirror 등록 성공: ${fullPath}`);
    } catch (err: any) {
      if (err.response?.status === 409 || JSON.stringify(err.response?.data).includes('already exists')) {
        try {
          await this.client.post(`/repos/${targetOwner}/${repoName}/mirror-sync`);
          console.log(`[Gitea API] 기존 저장소 Mirror Sync 트리거 완료: ${fullPath}`);
        } catch (syncErr: any) {
          console.warn(`[Gitea API] Mirror Sync 트리거 경고: ${syncErr.message}`);
        }
      } else {
        throw new Error(`[Gitea API] Pull Mirror 등록 실패: ${err.response?.data?.message || err.message}`);
      }
    }
  }
}

registerProvider('gitea', GiteaProvider);
