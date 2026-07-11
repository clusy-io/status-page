// ──────────────────────────────────────────────────────────────────────────
// Auto-incident engine.
//
// The cron route (api/cron) probes every service on a schedule. This module
// turns that stream of probes into a self-maintaining incident timeline:
//
//   • A service goes bad for OPEN_AFTER_BAD consecutive probes  → open an
//     incident with an "investigating" update.
//   • It gets worse (degraded → down) while open                → push an
//     "identified" update and raise the impact.
//   • It starts responding again                                → push a
//     "monitoring" update.
//   • It stays healthy for RESOLVE_AFTER_GOOD consecutive probes → push a
//     "resolved" update and move the incident into the history log.
//
// Consecutive-probe thresholds debounce flapping so a single transient blip
// doesn't post an incident. State lives in one KV document; no KV → no-op
// (the page still renders live status and any hand-written incidents).
//
// One incident is tracked per service. Auto incidents share the same shape as
// the hand-curated ones in lib/incidents.ts, so the UI renders both the same.
// ──────────────────────────────────────────────────────────────────────────

import type { ProbeResult, Health } from "./services";
import { overallStatus } from "./services";
import type { Incident, IncidentImpact, UpdateLevel } from "./incidents";
import { kvEnabled, kvGetJSON, kvSetJSON } from "./kv";

// Tuning. At the default 5-minute cron cadence: open ≈ 10 min of sustained
// failure, resolve ≈ 10 min of sustained recovery. Lower OPEN_AFTER_BAD to 1
// for immediate detection at the cost of more flap-sensitivity.
const OPEN_AFTER_BAD = 2;
const RESOLVE_AFTER_GOOD = 2;
const LOG_RETENTION_DAYS = 90;
const MAX_LOG = 50; // cap stored resolved incidents regardless of age

const STATE_KEY = "inc:state:v1";

interface Streak {
  bad: number;
  good: number;
}

interface MonitorState {
  streaks: Record<string, Streak>; // serviceId -> streak counters
  open: Record<string, Incident>; // serviceId -> currently-open incident
  log: Incident[]; // resolved incidents, newest first
}

function emptyState(): MonitorState {
  return { streaks: {}, open: {}, log: [] };
}

export function autoIncidentsEnabled(): boolean {
  return kvEnabled();
}

// A probe is "bad" if the service is down or degraded. Maintenance and
// operational are treated as healthy for incident purposes.
function severityOf(status: Health): "major" | "minor" | null {
  if (status === "down") return "major";
  if (status === "degraded") return "minor";
  return null;
}

const IMPACT_RANK: Record<IncidentImpact, number> = {
  maintenance: 0,
  minor: 1,
  major: 2,
  critical: 3,
};

function humanState(status: Health): string {
  switch (status) {
    case "down":
      return "unreachable";
    case "degraded":
      return "degraded";
    default:
      return "affected";
  }
}

function incidentTitle(name: string, sev: "major" | "minor"): string {
  return sev === "major"
    ? `${name} outage`
    : `${name} degraded performance`;
}

/** Oldest update timestamp = when the incident began (updates are newest-first). */
function startedAt(inc: Incident): string {
  return inc.updates[inc.updates.length - 1]?.at ?? inc.updates[0]?.at;
}

function durationClause(startIso: string, now: Date): string {
  const mins = Math.max(
    1,
    Math.round((now.getTime() - new Date(startIso).getTime()) / 60000),
  );
  if (mins < 60) return ` Total disruption: about ${mins} min.`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return ` Total disruption: about ${h}h${m ? ` ${m}m` : ""}.`;
}

function makeId(serviceId: string, now: Date): string {
  // e.g. 202606301710-api — sortable and human-readable.
  const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, "");
  return `${stamp}-${serviceId}`;
}

function pushUpdate(
  inc: Incident,
  level: UpdateLevel,
  body: string,
  now: Date,
): void {
  inc.updates.unshift({ at: now.toISOString(), level, body });
}

function pruneLog(log: Incident[], now: Date): Incident[] {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - LOG_RETENTION_DAYS);
  return log
    .filter((inc) => new Date(startedAt(inc)).getTime() >= cutoff.getTime())
    .slice(0, MAX_LOG);
}

/**
 * Advance the incident state machine by one probe cycle and persist it.
 * Called once per cron tick. No-op when KV isn't configured.
 */
export async function processTick(
  results: ProbeResult[],
  now: Date,
): Promise<void> {
  if (!autoIncidentsEnabled()) return;

  const state = (await kvGetJSON<MonitorState>(STATE_KEY)) ?? emptyState();
  state.streaks ??= {};
  state.open ??= {};
  state.log ??= [];

  for (const r of results) {
    const sev = severityOf(r.status);
    const streak = state.streaks[r.id] ?? { bad: 0, good: 0 };
    if (sev) {
      streak.bad += 1;
      streak.good = 0;
    } else {
      streak.good += 1;
      streak.bad = 0;
    }

    const open = state.open[r.id];

    if (open) {
      if (sev) {
        // Still bad — escalate impact if it got worse.
        const nextImpact: IncidentImpact = sev;
        if (IMPACT_RANK[nextImpact] > IMPACT_RANK[open.impact]) {
          open.impact = nextImpact;
          open.title = incidentTitle(r.name, sev);
          pushUpdate(
            open,
            "identified",
            `Impact escalated — ${r.name} is now ${humanState(r.status)}.`,
            now,
          );
        }
      } else if (streak.good >= RESOLVE_AFTER_GOOD) {
        // Confirmed recovery — resolve and move to the log.
        pushUpdate(
          open,
          "resolved",
          `${r.name} is responding normally again.${durationClause(
            startedAt(open),
            now,
          )}`,
          now,
        );
        state.log.unshift(open);
        delete state.open[r.id];
      } else if (streak.good === 1) {
        // First good probe after an outage — recovering, watching to confirm.
        pushUpdate(
          open,
          "monitoring",
          `${r.name} is responding again. Monitoring to confirm full recovery.`,
          now,
        );
      }
    } else if (sev && streak.bad >= OPEN_AFTER_BAD) {
      // Open a fresh incident.
      state.open[r.id] = {
        id: makeId(r.id, now),
        title: incidentTitle(r.name, sev),
        impact: sev,
        affected: [r.id],
        updates: [
          {
            at: now.toISOString(),
            level: "investigating",
            body: `Automated monitoring detected that ${r.name} is ${humanState(
              r.status,
            )}. We're investigating.`,
          },
        ],
      };
    }

    state.streaks[r.id] = streak;
  }

  state.log = pruneLog(state.log, now);
  await kvSetJSON(STATE_KEY, state);
}

/**
 * All auto-generated incidents (open first, then resolved), newest activity
 * first. Empty when KV isn't configured.
 */
export async function readAutoIncidents(): Promise<Incident[]> {
  if (!autoIncidentsEnabled()) return [];
  const state = await kvGetJSON<MonitorState>(STATE_KEY);
  if (!state) return [];
  const open = Object.values(state.open ?? {});
  const log = state.log ?? [];
  return [...open, ...log];
}

/** Latest-update timestamp of an incident, for cross-source sorting. */
export function latestActivity(inc: Incident): number {
  return inc.updates.reduce(
    (max, u) => Math.max(max, new Date(u.at).getTime()),
    0,
  );
}

/** True while the incident's newest update isn't a resolution. */
export function isOngoing(inc: Incident): boolean {
  return inc.updates[0]?.level !== "resolved";
}

// Health ordering, worst last — used to fold incidents into the live snapshot.
const HEALTH_RANK: Record<Health, number> = {
  operational: 0,
  maintenance: 1,
  degraded: 2,
  down: 3,
};

function worseHealth(a: Health, b: Health): Health {
  return HEALTH_RANK[a] >= HEALTH_RANK[b] ? a : b;
}

/** The health an ongoing incident implies for the services it affects. */
function impactToHealth(impact: IncidentImpact): Health {
  switch (impact) {
    case "critical":
    case "major":
      return "down";
    case "minor":
      return "degraded";
    case "maintenance":
      return "maintenance";
  }
}

/**
 * Fold ongoing incidents into a live probe snapshot so the headline banner and
 * the affected service rows reflect a known issue even when the raw probe still
 * looks healthy — e.g. an upstream model degradation that an HTTP health check
 * can't observe. Resolved incidents have no effect. Never upgrades a status:
 * a service that probes worse than its incident implies keeps the worse one.
 */
export function applyIncidents(
  results: ProbeResult[],
  incidents: Incident[],
): { services: ProbeResult[]; overall: Health } {
  const active = incidents.filter(isOngoing);

  // Worst incident health per affected service id.
  const byService = new Map<string, Health>();
  for (const inc of active) {
    const h = impactToHealth(inc.impact);
    for (const id of inc.affected) {
      const prev = byService.get(id);
      byService.set(id, prev ? worseHealth(prev, h) : h);
    }
  }

  const services = results.map((r) => {
    const h = byService.get(r.id);
    return h ? { ...r, status: worseHealth(r.status, h) } : r;
  });

  // Start from the (already-adjusted) probe rollup, then ensure every ongoing
  // incident drags the headline down — including any whose affected service
  // isn't individually probed.
  let overall = overallStatus(services);
  for (const inc of active) {
    overall = worseHealth(overall, impactToHealth(inc.impact));
  }

  return { services, overall };
}

/**
 * Merge auto incidents with hand-curated ones, newest activity first,
 * de-duplicated by id (hand-written entries win on id collision).
 */
export function mergeIncidents(
  auto: Incident[],
  manual: Incident[],
): Incident[] {
  const byId = new Map<string, Incident>();
  for (const inc of auto) byId.set(inc.id, inc);
  for (const inc of manual) byId.set(inc.id, inc); // manual overrides
  return [...byId.values()].sort(
    (a, b) => latestActivity(b) - latestActivity(a),
  );
}
