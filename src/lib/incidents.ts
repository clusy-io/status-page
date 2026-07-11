// ──────────────────────────────────────────────────────────────────────────
// Incidents — hand-curated history shown on the public page.
//
// This is intentionally a plain data file: to post an incident, add an entry,
// commit, and the deploy publishes it. No CMS, no database. Keep the newest
// incident first. Times are ISO 8601 (UTC).
//
// Incidents that the probes detect on their own are logged automatically
// (see lib/autoIncidents.ts) — this file is for anything the probes can't
// see: an upstream degradation, a post-mortem note, planned maintenance.
// A hand-written entry overrides an auto incident with the same id.
// ──────────────────────────────────────────────────────────────────────────

export type IncidentImpact = "minor" | "major" | "critical" | "maintenance";
export type UpdateLevel =
  | "investigating"
  | "identified"
  | "monitoring"
  | "resolved";

export interface IncidentUpdate {
  at: string; // ISO timestamp
  level: UpdateLevel;
  body: string;
}

export interface Incident {
  id: string;
  title: string;
  impact: IncidentImpact;
  /** Service ids affected (see status.config.ts). Shown as quiet tags. */
  affected: string[];
  updates: IncidentUpdate[]; // newest first
}

export const INCIDENTS: Incident[] = [
  // To post an incident, add an entry here (newest first). Example shape:
  //
  // {
  //   id: "2026-06-15-api-latency",
  //   title: "Elevated API latency",
  //   impact: "minor",
  //   affected: ["api"],
  //   updates: [
  //     { at: "2026-06-15T14:40:00Z", level: "resolved",
  //       body: "Latency is back to normal. Root cause was a slow database query." },
  //     { at: "2026-06-15T14:05:00Z", level: "investigating",
  //       body: "We're seeing slower-than-usual API responses and are looking into it." },
  //   ],
  // },
];
