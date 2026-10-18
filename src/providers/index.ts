/**
 * The provider registry.
 *
 * This is the boundary named in §25: no provider name appears in a conditional
 * above this layer. Everything upstream asks for an adapter by id and then
 * talks to the interface.
 */
import type { ProviderId } from '../core/types';
import type { AdapterConfig, ProviderAdapter } from './types';
import { anthropic } from './anthropic';
import { openai } from './openai';
import { gemini } from './gemini';
import { openrouter, compatible } from './openrouter';
import { mock } from './mock';

export const ADAPTERS: Record<ProviderId, ProviderAdapter> = {
  anthropic,
  openai,
  gemini,
  openrouter,
  compatible,
  mock,
};

/** Every adapter, in a stable order. Only two are reachable from the product (§5). */
export const PROVIDER_ORDER: ProviderId[] = [
  'anthropic',
  'openai',
  'gemini',
  'openrouter',
  'compatible',
  'mock',
];

export function adapterFor(id: ProviderId): ProviderAdapter {
  return ADAPTERS[id] ?? mock;
}

export function configFor(id: ProviderId, apiKey: string, baseUrl?: string): AdapterConfig {
  return id === 'compatible' ? { apiKey, baseUrl } : { apiKey };
}

export type { ProviderAdapter, AdapterConfig };
export { mock, anthropic, openai, gemini, openrouter, compatible };
