import { GitProviderCapabilities, ProviderConfig } from '../types.js';
import { registerProvider } from './factory.js';
import { GiteaProvider } from './gitea.js';

export class ForgejoProvider extends GiteaProvider {
  override name = 'Forgejo';
  override type = 'forgejo';
  override capabilities: GitProviderCapabilities = {
    supportsPushMirror: true,
    supportsPullMirror: true,
    envTokenKeys: ['FORGEJO_TOKEN', 'GIT_FORGEJO_TOKEN'],
  };

  constructor(config: ProviderConfig) {
    super(config);
  }
}

registerProvider('forgejo', ForgejoProvider);
