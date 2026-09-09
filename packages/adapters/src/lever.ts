import type { DiscoveryAdapter, BoardRef, DiscoveryResult, RawPosting, AdapterHealth } from './types.js';
import { stripHtml } from './normalize.js';

interface LeverPosting {
  id: string;
  text: string;
  hostedUrl: string;
  applyUrl?: string;
  descriptionPlain?: string;
  description?: string;
  workplaceType?: string;
  createdAt?: number;
  categories?: { location?: string; team?: string; commitment?: string; allLocations?: string[] };
  lists?: { text?: string; content?: string }[];
}

const BASE = 'https://api.lever.co/v0/postings';

export function parseLever(payload: unknown, _board: BoardRef): RawPosting[] {
  if (!Array.isArray(payload)) return [];
  return (payload as LeverPosting[]).map((p) => {
    const listText = (p.lists ?? [])
      .map((l) => `${l.text ?? ''}\n${stripHtml(l.content ?? '')}`)
      .join('\n\n');
    const description = [p.descriptionPlain ?? stripHtml(p.description ?? ''), listText]
      .filter(Boolean).join('\n\n').trim();
    const location = p.categories?.location
      ?? (p.categories?.allLocations ?? []).join(', ')
      ?? '';
    return {
      sourceId: p.id,
      // Lever exposes no requisition id; the posting id is the employer job id.
      requisitionId: null,
      title: p.text?.trim() ?? '',
      locationText: location,
      workplaceType: p.workplaceType ?? null,
      descriptionText: description,
      url: p.hostedUrl,
      applyUrl: p.applyUrl ?? p.hostedUrl,
      postedAt: p.createdAt ? new Date(p.createdAt).toISOString() : null,
      team: p.categories?.team ?? null,
      commitment: p.categories?.commitment ?? null,
    } satisfies RawPosting;
  }).filter((p) => p.title && p.url);
}

export const leverAdapter: DiscoveryAdapter = {
  id: 'lever',
  displayName: 'Lever',

  async discover(board: BoardRef, fetchImpl: typeof fetch = fetch): Promise<DiscoveryResult> {
    const started = Date.now();
    const url = `${BASE}/${encodeURIComponent(board.tenant)}?mode=json`;
    try {
      const res = await fetchImpl(url, { headers: { accept: 'application/json' } });
      if (!res.ok) {
        return { board, postings: [], ok: false, error: `HTTP ${res.status}`, fetchedAt: new Date().toISOString(), durationMs: Date.now() - started };
      }
      return { board, postings: parseLever(await res.json(), board), ok: true, fetchedAt: new Date().toISOString(), durationMs: Date.now() - started };
    } catch (err) {
      return { board, postings: [], ok: false, error: err instanceof Error ? err.message : String(err), fetchedAt: new Date().toISOString(), durationMs: Date.now() - started };
    }
  },

  async healthCheck(fetchImpl: typeof fetch = fetch): Promise<AdapterHealth> {
    try {
      const res = await fetchImpl(`${BASE}/leverdemo?mode=json`, { headers: { accept: 'application/json' } });
      return { adapterId: 'lever', ok: res.ok, checkedAt: new Date().toISOString(), error: res.ok ? undefined : `HTTP ${res.status}` };
    } catch (err) {
      return { adapterId: 'lever', ok: false, checkedAt: new Date().toISOString(), error: err instanceof Error ? err.message : String(err) };
    }
  },
};
