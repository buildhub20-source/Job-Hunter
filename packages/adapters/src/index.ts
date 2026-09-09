import { greenhouseAdapter } from './greenhouse.js';
import { leverAdapter } from './lever.js';
import type { DiscoveryAdapter } from './types.js';

export * from './types.js';
export * from './normalize.js';
export * from './registry.js';
export { greenhouseAdapter, parseGreenhouse } from './greenhouse.js';
export { leverAdapter, parseLever } from './lever.js';

export const ADAPTERS: Record<string, DiscoveryAdapter> = {
  greenhouse: greenhouseAdapter,
  lever: leverAdapter,
};

export function getAdapter(id: string): DiscoveryAdapter | null {
  return ADAPTERS[id.toLowerCase()] ?? null;
}
