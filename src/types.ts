export interface ProviderConfig {
  provider: 'github' | 'gitlab' | 'gitea' | string;
  token: string;
  host?: string;
  group?: string;
}

export interface Config {
  git: {
    main: ProviderConfig;
    mirrors: ProviderConfig[];
  };
}

export interface EnsureRepoResult {
  cloneUrl: string;
  authenticatedCloneUrl: string;
  sshUrl: string;
  exists: boolean;
  owner: string;
  repoName: string;
  fullPath: string;
  id?: number | string;
}

export interface SetupMirrorOptions {
  targetPath: string;
  mainCloneUrl: string;
  mainToken?: string;
  repoExists: boolean;
}

export interface MirrorRepoStatus {
  providerName: string;
  fullPath: string;
  cloneUrl: string;
  exists: boolean;
  isEmpty?: boolean;
}

export interface RepoInfo {
  name: string;
  fullPath: string;
  cloneUrl: string;
  isEmpty: boolean;
  defaultBranch?: string;
  size?: number;
  mirrors?: MirrorRepoStatus[];
}

export interface GitProviderCapabilities {
  supportsPushMirror: boolean;
  supportsPullMirror: boolean;
  envTokenKeys: string[];
}

export interface GitProvider {
  name: string;
  type: string;
  capabilities: GitProviderCapabilities;
  getCurrentUser(): Promise<{ username: string; id?: number }>;
  ensureRepo(targetPath: string): Promise<EnsureRepoResult>;
  checkRepoExists?(targetPath: string): Promise<EnsureRepoResult | null>;
  addPushMirror?(targetPath: string, mirrorCloneUrl: string): Promise<void>;
  addPullMirror?(targetPath: string, mainCloneUrl: string): Promise<void>;
  getPushMirrors?(targetPath: string): Promise<string[]>;
  listRepositories?(): Promise<RepoInfo[]>;
  checkRepositoryEmpty?(targetPath: string): Promise<RepoInfo>;
  deleteRepo?(targetPath: string): Promise<void>;
}
