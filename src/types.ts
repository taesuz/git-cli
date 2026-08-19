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
  addPushMirror?(targetPath: string, mirrorCloneUrl: string): Promise<void>;
  addPullMirror?(targetPath: string, mainCloneUrl: string): Promise<void>;
}
