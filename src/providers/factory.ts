import { GitProvider, ProviderConfig } from '../types.js';

export type ProviderConstructor = new (config: ProviderConfig) => GitProvider;

const providerRegistry = new Map<string, ProviderConstructor>();

export function registerProvider(type: string, providerClass: ProviderConstructor): void {
  providerRegistry.set(type.toLowerCase(), providerClass);
}

export function createProvider(config: ProviderConfig): GitProvider {
  const type = (config.provider || '').toLowerCase();
  const ProviderClass = providerRegistry.get(type);

  if (!ProviderClass) {
    const available = Array.from(providerRegistry.keys()).join(', ');
    throw new Error(`[git-cli] 지원하지 않는 Git Provider 입니다: '${config.provider}'. (지원되는 목록: ${available})`);
  }

  return new ProviderClass(config);
}

export function getRegisteredProviderTypes(): string[] {
  return Array.from(providerRegistry.keys());
}

export function getRegisteredProviders(): Map<string, ProviderConstructor> {
  return providerRegistry;
}
