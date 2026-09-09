export interface RawPosting {
  /** Stable id from the source system. */
  sourceId: string;
  requisitionId: string | null;
  title: string;
  locationText: string;
  workplaceType: string | null;
  descriptionText: string;
  url: string;
  applyUrl: string | null;
  postedAt: string | null;
  team: string | null;
  commitment: string | null;
}

export interface BoardRef {
  /** Canonical employer id, e.g. 'razorpay'. */
  employerId: string;
  displayName: string;
  /** Tenant slug on the ATS, e.g. the Greenhouse board token. */
  tenant: string;
  adapter: string;
  enabled: boolean;
}

export interface DiscoveryResult {
  board: BoardRef;
  postings: RawPosting[];
  ok: boolean;
  error?: string;
  fetchedAt: string;
  /** Milliseconds the fetch took — feeds adapter health. */
  durationMs: number;
}

export interface AdapterHealth {
  adapterId: string;
  ok: boolean;
  checkedAt: string;
  error?: string;
}

export interface DiscoveryAdapter {
  readonly id: string;
  readonly displayName: string;
  /** Fetch every open posting for one board. Never throws — returns ok:false. */
  discover(board: BoardRef, fetchImpl?: typeof fetch): Promise<DiscoveryResult>;
  healthCheck(fetchImpl?: typeof fetch): Promise<AdapterHealth>;
}
