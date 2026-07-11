// ──────────────────────────────────────────────────────────────────────────
// Minimal Upstash-compatible KV client.
//
// Shared by uptime history (lib/history.ts), auto-incident logging
// (lib/autoIncidents.ts), subscriptions (lib/subscribers.ts), and the
// notification ledger (lib/notify.ts). Uses the same env Vercel injects when
// you link a
// KV / Upstash store to the project: KV_REST_API_URL + KV_REST_API_TOKEN.
// With nothing configured every call degrades to "disabled" so the page still
// deploys and serves live status — it just can't persist across cron ticks.
//
// Storage convention: each value is a JSON document serialised to a string.
// One GET or one SET per key per call.
// ──────────────────────────────────────────────────────────────────────────

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

export function kvEnabled(): boolean {
  return Boolean(KV_URL && KV_TOKEN);
}

export async function kvGetJSON<T>(key: string): Promise<T | null> {
  if (!kvEnabled()) return null;
  const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { result: string | null };
  if (!data.result) return null;
  try {
    return JSON.parse(data.result) as T;
  } catch {
    return null;
  }
}

/** Set a JSON document, optionally expiring after `ttlSeconds` (Upstash EX). */
export async function kvSetJSON(
  key: string,
  value: unknown,
  ttlSeconds?: number,
): Promise<void> {
  if (!kvEnabled()) return;
  const ttl = ttlSeconds ? `?EX=${Math.round(ttlSeconds)}` : "";
  await fetch(`${KV_URL}/set/${encodeURIComponent(key)}${ttl}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(value),
  });
}
