import type { AtsAdapter } from '../types.js';
import { greenhouse } from './greenhouse.js';
import { lever } from './lever.js';

/**
 * ATS router — pick the right adapter based on the job's ATS column.
 * Returns null for unsupported ATSes (they should be parked as Blocked).
 */
const adapters: Record<string, AtsAdapter> = {
  greenhouse,
  lever,
};

export function getAdapter(ats: string): AtsAdapter | null {
  return adapters[ats.toLowerCase()] ?? null;
}

export const SUPPORTED_ATS = Object.keys(adapters);
