import axios, { AxiosInstance } from 'axios';
import { EnsureRepoResult, GitProvider, GitProviderCapabilities, ProviderConfig } from '../types.js';
import { registerProvider } from './factory.js';

export class GitlabProvider implements GitProvider {
  name = 'GitLab';
  type = 'gitlab';
  capabilities: GitProviderCapabilities = {
    supportsPushMirror: true,
    supportsPullMirror: true,
    envTokenKeys: ['GITLAB_TOKEN', 'GIT_GITLAB_TOKEN'],
  };

  private client: AxiosInstance;
  private token: string;
  private host: string;
  private group?: string;

  constructor(config: ProviderConfig) {
    this.token = config.token;
    this.host = (config.host || 'https://gitlab.com').replace(/\/$/, '');
    this.group = config.group;

    this.client = axios.create({
      baseURL: `${this.host}/api/v4`,
      headers: {
        'PRIVATE-TOKEN': this.token,
        Accept: 'application/json',
        'User-Agent': 'git-cli',
      },
    });
  }

  async getCurrentUser(): Promise<{ username: string; id: number }> {
    try {
      const res = await this.client.get('/user');
      return { username: res.data.username, id: res.data.id };
    } catch (err: any) {
      throw new Error(`[GitLab] 사용자 정보 조회 실패: ${err.response?.data?.message || err.message}`);
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

  private getPossiblePaths(targetOwner: string, repoName: string, username: string): string[] {
    const isUserRepo = targetOwner.toLowerCase() === username.toLowerCase();
    if (isUserRepo) {
      return [`${username}/${repoName}`];
    }
    return [
      `${targetOwner}/${repoName}`,
      `${username}/${targetOwner}/${repoName}`,
    ];
  }

  private getSshUrl(fullPath: string): string {
    try {
      const urlObj = new URL(this.host);
      return `git@${urlObj.hostname}:${fullPath}.git`;
    } catch {
      return `git@gitlab.com:${fullPath}.git`;
    }
  }

  async ensureRepo(targetPath: string): Promise<EnsureRepoResult> {
    const user = await this.getCurrentUser();
    const { targetOwner, repoName } = this.resolveOwnerAndRepo(targetPath, user.username);
    const possiblePaths = this.getPossiblePaths(targetOwner, repoName, user.username);

    for (const fullPath of possiblePaths) {
      try {
        const encoded = encodeURIComponent(fullPath);
        const res = await this.client.get(`/projects/${encoded}`);
        if (res.status === 200) {
          const cloneUrl = `${this.host}/${fullPath}.git`;
          const authenticatedCloneUrl = `${this.host.replace(
            /^https?:\/\//,
            `https://oauth2:${this.token}@`
          )}/${fullPath}.git`;
          const sshUrl = this.getSshUrl(fullPath);

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
        if (err.response?.status !== 404 && err.response?.status !== 403) {
          // continue
        }
      }
    }

    const isUserRepo = targetOwner.toLowerCase() === user.username.toLowerCase();
    let namespaceId: number | undefined;
    let chosenFullPath = '';

    if (isUserRepo) {
      chosenFullPath = `${user.username}/${repoName}`;
      try {
        const userRes = await this.client.get(`/users/${user.id}`);
        namespaceId = userRes.data.namespace_id;
      } catch {
        const nsRes = await this.client.get(`/namespaces?search=${user.username}`);
        if (nsRes.data && nsRes.data.length > 0) {
          namespaceId = nsRes.data[0].id;
        }
      }
    } else {
      try {
        const topGroupRes = await this.client.get(`/groups/${encodeURIComponent(targetOwner)}`);
        namespaceId = topGroupRes.data.id;
        chosenFullPath = `${targetOwner}/${repoName}`;
      } catch (err: any) {
        const subgroupPath = `${user.username}/${targetOwner}`;
        chosenFullPath = `${subgroupPath}/${repoName}`;

        try {
          const subGroupRes = await this.client.get(`/groups/${encodeURIComponent(subgroupPath)}`);
          namespaceId = subGroupRes.data.id;
        } catch (subErr: any) {
          if (subErr.response?.status === 404) {
            let parentGroupId: number | undefined;
            try {
              const userGroupRes = await this.client.get(`/groups/${encodeURIComponent(user.username)}`);
              parentGroupId = userGroupRes.data.id;
            } catch {}

            try {
              const createGroupPayload: any = {
                name: targetOwner,
                path: targetOwner,
                visibility: 'private', // 기본 Private 설정
              };
              if (parentGroupId) {
                createGroupPayload.parent_id = parentGroupId;
              }

              const newGroupRes = await this.client.post('/groups', createGroupPayload);
              namespaceId = newGroupRes.data.id;
              console.log(`[GitLab API] 하위 그룹 생성 완료: ${subgroupPath}`);
            } catch (createGroupErr: any) {
              try {
                const topCreateRes = await this.client.post('/groups', {
                  name: targetOwner,
                  path: targetOwner,
                  visibility: 'private', // 기본 Private 설정
                });
                namespaceId = topCreateRes.data.id;
                chosenFullPath = `${targetOwner}/${repoName}`;
                console.log(`[GitLab API] 최상위 그룹 생성 완료: ${targetOwner}`);
              } catch (topCreateErr: any) {
                throw new Error(`[GitLab API] 그룹(${targetOwner}) 접근/생성 권한이 없습니다. GitLab 그룹 권한을 확인하세요.`);
              }
            }
          }
        }
      }
    }

    const cloneUrl = `${this.host}/${chosenFullPath}.git`;
    const authenticatedCloneUrl = `${this.host.replace(
      /^https?:\/\//,
      `https://oauth2:${this.token}@`
    )}/${chosenFullPath}.git`;
    const sshUrl = this.getSshUrl(chosenFullPath);

    try {
      const createRes = await this.client.post('/projects', {
        name: repoName,
        path: repoName,
        namespace_id: namespaceId,
        visibility: 'private', // 기본 Private 설정
      });
      console.log(`[GitLab API] Private 프로젝트 생성 완료: ${chosenFullPath}`);
      return {
        cloneUrl,
        authenticatedCloneUrl,
        sshUrl,
        exists: false,
        owner: targetOwner,
        repoName,
        fullPath: chosenFullPath,
        id: createRes.data.id,
      };
    } catch (err: any) {
      throw new Error(`[GitLab API] 프로젝트 생성 실패 (${chosenFullPath}): ${err.response?.data?.message || JSON.stringify(err.response?.data) || err.message}`);
    }
  }

  async addPushMirror(targetPath: string, mirrorCloneUrl: string): Promise<void> {
    const user = await this.getCurrentUser();
    const { targetOwner, repoName } = this.resolveOwnerAndRepo(targetPath, user.username);
    const possiblePaths = this.getPossiblePaths(targetOwner, repoName, user.username);

    let activeFullPath = possiblePaths[0];
    for (const p of possiblePaths) {
      try {
        const res = await this.client.get(`/projects/${encodeURIComponent(p)}`);
        if (res.status === 200) {
          activeFullPath = p;
          break;
        }
      } catch {}
    }

    const encodedFullPath = encodeURIComponent(activeFullPath);
    console.log(`[GitLab API] Main 프로젝트(${activeFullPath})에 Push Mirror 등록 중 -> ${mirrorCloneUrl}`);

    try {
      await this.client.post(`/projects/${encodedFullPath}/remote_mirrors`, {
        url: mirrorCloneUrl,
        enabled: true,
        keep_divergent_refs: true,
        only_protected_branches: false,
      });
      console.log(`[GitLab API] Push Mirror 등록 성공!`);
    } catch (err: any) {
      if (err.response?.data?.message && JSON.stringify(err.response.data).includes('has already been taken')) {
        console.log(`[GitLab API] 해당 Push Mirror가 이미 등록되어 있습니다.`);
      } else {
        throw new Error(`[GitLab API] Push Mirror 등록 실패: ${err.response?.data?.message || JSON.stringify(err.response?.data) || err.message}`);
      }
    }
  }

  async addPullMirror(targetPath: string, mainCloneUrl: string): Promise<void> {
    const user = await this.getCurrentUser();
    const { targetOwner, repoName } = this.resolveOwnerAndRepo(targetPath, user.username);
    const possiblePaths = this.getPossiblePaths(targetOwner, repoName, user.username);

    let activeFullPath = possiblePaths[0];
    for (const p of possiblePaths) {
      try {
        const res = await this.client.get(`/projects/${encodeURIComponent(p)}`);
        if (res.status === 200) {
          activeFullPath = p;
          break;
        }
      } catch {}
    }

    const encodedFullPath = encodeURIComponent(activeFullPath);

    try {
      await this.client.put(`/projects/${encodedFullPath}`, {
        import_url: mainCloneUrl,
        mirror: true,
      });
      await this.client.post(`/projects/${encodedFullPath}/mirror/pull`);
      console.log(`[GitLab API] Pull Mirror 등록 및 트리거 완료: ${activeFullPath}`);
    } catch (err: any) {
      console.warn(`[GitLab API] Pull Mirror 등록 경고: ${err.response?.data?.message || err.message}`);
    }
  }

  private async isProjectEmpty(proj: any, encodedPath: string): Promise<boolean> {
    if (typeof proj.empty_repo === 'boolean') {
      return proj.empty_repo;
    }
    try {
      const branchesRes = await this.client.get(`/projects/${encodedPath}/repository/branches`);
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
      ? `/groups/${encodeURIComponent(this.group!.trim())}/projects?include_subgroups=true&per_page=100`
      : `/projects?membership=true&per_page=100`;

    try {
      const res = await this.client.get(endpoint);
      const repoInfos: import('../types.js').RepoInfo[] = [];

      for (const proj of res.data) {
        const encoded = encodeURIComponent(proj.path_with_namespace);
        const isEmpty = await this.isProjectEmpty(proj, encoded);
        repoInfos.push({
          name: proj.name,
          fullPath: proj.path_with_namespace,
          cloneUrl: proj.web_url,
          isEmpty,
          defaultBranch: proj.default_branch,
        });
      }

      return repoInfos;
    } catch (err: any) {
      throw new Error(`[GitLab API] 프로젝트 목록 조회 실패: ${err.response?.data?.message || err.message}`);
    }
  }

  async checkRepositoryEmpty(targetPath: string): Promise<import('../types.js').RepoInfo> {
    const user = await this.getCurrentUser();
    const { targetOwner, repoName } = this.resolveOwnerAndRepo(targetPath, user.username);
    const possiblePaths = this.getPossiblePaths(targetOwner, repoName, user.username);

    for (const fullPath of possiblePaths) {
      try {
        const encoded = encodeURIComponent(fullPath);
        const res = await this.client.get(`/projects/${encoded}`);
        if (res.status === 200) {
          const proj = res.data;
          const isEmpty = await this.isProjectEmpty(proj, encoded);
          return {
            name: proj.name,
            fullPath: proj.path_with_namespace,
            cloneUrl: proj.web_url,
            isEmpty,
            defaultBranch: proj.default_branch,
          };
        }
      } catch {}
    }

    throw new Error(`[GitLab API] 프로젝트(${targetPath})를 찾을 수 없습니다.`);
  }

  async deleteRepo(targetPath: string): Promise<void> {
    const user = await this.getCurrentUser();
    const { targetOwner, repoName } = this.resolveOwnerAndRepo(targetPath, user.username);
    const possiblePaths = this.getPossiblePaths(targetOwner, repoName, user.username);

    for (const fullPath of possiblePaths) {
      try {
        const encoded = encodeURIComponent(fullPath);
        const res = await this.client.get(`/projects/${encoded}`);
        if (res.status === 200) {
          await this.client.delete(`/projects/${encoded}`);
          console.log(`🗑️ [GitLab API] 프로젝트 삭제 요청 완료: ${fullPath}`);
          return;
        }
      } catch {}
    }

    console.warn(`⚠️ [GitLab API] 삭제 대상 프로젝트를 찾을 수 없거나 이미 삭제되었습니다: ${targetPath}`);
  }
}

registerProvider('gitlab', GitlabProvider);
