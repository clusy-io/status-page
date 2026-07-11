// ──────────────────────────────────────────────────────────────────────────
// Uptime history — optional, zero-infra-by-default.
//
// If an Upstash-compatible KV is wired up (env: KV_REST_API_URL +
// KV_REST_API_TOKEN, which Vercel KV provides automatically), the cron route
// records a daily up/total tally per service and the UI renders a 90-day
// uptime bar. With no KV configured every function degrades gracefully to
// "no history yet" so the page still deploys and shows live status.
//
// Storage model: one JSON blob per service at key `hist:{serviceId}`, mapping
// `YYYY-MM-DD` -> { up, total }. One GET + one SET per service per cron tick.
// ──────────────────────────────────────────────────────────────────────────

import type { Health } from "./probes";
import { SITE } from "../../status.config";

export interface DayBucket {
  up: number;
  total: number;
}
export type HistoryMap = Record<string, DayBucket>; // date -> bucket

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const RETENTION_DAYS = 90;

// Daily uptime buckets are aggregated server-side, so they can't be per-viewer.
// They're keyed to one canonical timezone (status.config.ts `timezone`, or the
// STATUS_TIMEZONE env var) so "today" lines up with your team — otherwise an
// evening probe lands in the next UTC day.
const DISPLAY_TZ = process.env.STATUS_TIMEZONE ?? SITE.timezone ?? "UTC";
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: DISPLAY_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}); // en-CA renders as YYYY-MM-DD

export function historyEnabled(): boolean {
  return Boolean(KV_URL && KV_TOKEN);
}

function key(serviceId: string) {
  return `hist:${serviceId}`;
}

/** The calendar day (in the canonical display tz) that an instant falls on. */
export function dayKey(d: Date): string {
  return dayKeyFmt.format(d);
}

async function kvGet(k: string): Promise<HistoryMap | null> {
  if (!historyEnabled()) return null;
  const res = await fetch(`${KV_URL}/get/${encodeURIComponent(k)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { result: string | null };
  if (!data.result) return null;
  try {
    return JSON.parse(data.result) as HistoryMap;
  } catch {
    return null;
  }
}

async function kvSet(k: string, value: HistoryMap): Promise<void> {
  if (!historyEnabled()) return;
  await fetch(`${KV_URL}/set/${encodeURIComponent(k)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(value),
  });
}

/** Prune buckets older than the retention window. Mutates and returns the map. */
function prune(map: HistoryMap): HistoryMap {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - RETENTION_DAYS);
  const cutoffKey = dayKey(cutoff);
  for (const d of Object.keys(map)) {
    if (d < cutoffKey) delete map[d];
  }
  return map;
}

/** Record one probe sample for a service into today's bucket. */
export async function recordSample(
  serviceId: string,
  status: Health,
  now: Date,
): Promise<void> {
  if (!historyEnabled()) return;
  const map = (await kvGet(key(serviceId))) ?? {};
  const d = dayKey(now);
  const bucket = map[d] ?? { up: 0, total: 0 };
  bucket.total += 1;
  // "maintenance" doesn't count against uptime; everything else that isn't a
  // hard outage counts as up for the purposes of the public uptime number.
  if (status === "operational" || status === "maintenance" || status === "degraded") {
    bucket.up += 1;
  }
  map[d] = bucket;
  await kvSet(key(serviceId), prune(map));
}

export interface UptimeDay {
  date: string;
  uptime: number | null; // 0..1, or null if no data that day
}

/** Read the last `days` of history for a service, oldest→newest, gap-filled. */
export async function readHistory(
  serviceId: string,
  days = RETENTION_DAYS,
): Promise<UptimeDay[]> {
  const map = (await kvGet(key(serviceId))) ?? {};
  const out: UptimeDay[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const k = dayKey(d);
    const bucket = map[k];
    out.push({
      date: k,
      uptime: bucket && bucket.total > 0 ? bucket.up / bucket.total : null,
    });
  }
  return out;
}

/** Aggregate uptime ratio across the window (ignores days with no data). */
export function aggregateUptime(days: UptimeDay[]): number | null {
  const withData = days.filter((d) => d.uptime !== null);
  if (withData.length === 0) return null;
  const sum = withData.reduce((acc, d) => acc + (d.uptime as number), 0);
  return sum / withData.length;
}
