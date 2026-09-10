import type { DiscoveryAdapter, BoardRef, DiscoveryResult, RawPosting, AdapterHealth } from './types.js';
import { stripHtml } from './normalize.js';

interface GhJob {
  id: number;
  internal_job_id?: number;
  requisition_id?: string | null;
  title: string;
  absolute_url: string;
  location?: { name?: string };
  offices?: { name?: string }[];
  updated_at?: string;
  first_published?: string;
  content?: string;
  metadata?: { name?: string; value?: unknown }[];
}

const BASE = 'https://boards-api.greenhouse.io/v1/boards';

/** Greenhouse's public board API. No key, no auth, JSON. The most deterministic source there is. */
export function parseGreenhouse(payload: unknown, board: BoardRef): RawPosting[] {
  const jobs = (payload as { jobs?: GhJob[] })?.jobs;
  if (!Array.isArray(jobs)) return [];
  return jobs.map((j) => {
    const location = j.location?.name ?? j.offices?.map((o) => o.name).filter(Boolean).join(', ') ?? '';
    // Greenhouse double-escapes content; strip once decoded.
    const description = stripHtml(j.content ?? '');
    return {
      sourceId: String(j.id),
      requisitionId: j.requisition_id?.toString().trim() || null,
      title: j.title?.trim() ?? '',
      locationText: location,
      workplaceType: null,
      descriptionText: description,
      url: j.absolute_url,
      applyUrl: j.absolute_url,
      postedAt: j.first_published ?? j.updated_at ?? null,
      team: null,
      commitment: null,
    } satisfies RawPosting;
  }).filter((p) => p.title && p.url);
}

export const greenhouseAdapter: DiscoveryAdapter = {
  id: 'greenhouse',
  displayName: 'Greenhouse',

  async discover(board: BoardRef, fetchImpl: typeof fetch = fetch): Promise<DiscoveryResult> {
    const started = Date.now();
    const url = `${BASE}/${encodeURIComponent(board.tenant)}/jobs?content=true`;
    try {
      const res = await fetchImpl(url, { headers: { accept: 'application/json' } });
      if (!res.ok) {
        return { board, postings: [], ok: false, error: `HTTP ${res.status}`, fetchedAt: new Date().toISOString(), durationMs: Date.now() - started };
      }
      const json = await res.json();
      return { board, postings: parseGreenhouse(json, board), ok: true, fetchedAt: new Date().toISOString(), durationMs: Date.now() - started };
    } catch (err) {
      return { board, postings: [], ok: false, error: err instanceof Error ? err.message : String(err), fetchedAt: new Date().toISOString(), durationMs: Date.now() - started };
    }
  },

  async healthCheck(fetchImpl: typeof fetch = fetch): Promise<AdapterHealth> {
    // postman is our own registered board (data/boards.md), verified live 2026-09-10 —
    // more durable than a third-party tenant we don't control and can't detect renaming.
    try {
      const res = await fetchImpl(`${BASE}/postman/jobs`, { headers: { accept: 'application/json' } });
      return { adapterId: 'greenhouse', ok: res.ok, checkedAt: new Date().toISOString(), error: res.ok ? undefined : `HTTP ${res.status}` };
    } catch (err) {
      return { adapterId: 'greenhouse', ok: false, checkedAt: new Date().toISOString(), error: err instanceof Error ? err.message : String(err) };
    }
  },
};
