export const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

export async function apiSend<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json()) as T;
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `${path} -> ${res.status}`);
  return json;
}
