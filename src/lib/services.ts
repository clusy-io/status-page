// ──────────────────────────────────────────────────────────────────────────
// Service probing — glue between status.config.ts and the rest of the app.
//
// The service list itself lives in status.config.ts (the file you edit);
// probe helpers live in lib/probes.ts. This module runs the probes and
// rolls results up into an overall status.
// ──────────────────────────────────────────────────────────────────────────

import { SERVICES } from "../../status.config";
import type { Health, ProbeResult } from "./probes";

export type { Health, ProbeResult, ServiceDef } from "./probes";
export { SERVICES };

/** Probe every service in parallel and return normalised results. */
export async function probeAll(): Promise<ProbeResult[]> {
  const checkedAt = new Date().toISOString();
  return Promise.all(
    SERVICES.map(async (svc): Promise<ProbeResult> => {
      const { status, latencyMs } = await svc.probe();
      return {
        id: svc.id,
        name: svc.name,
        description: svc.description,
        status,
        latencyMs,
        checkedAt,
      };
    }),
  );
}

/** Roll per-service statuses into one headline status for the banner. */
export function overallStatus(results: ProbeResult[]): Health {
  if (results.some((r) => r.status === "maintenance")) {
    if (results.every((r) => r.status === "operational" || r.status === "maintenance"))
      return "maintenance";
  }
  if (results.some((r) => r.status === "down")) return "down";
  if (results.some((r) => r.status === "degraded")) return "degraded";
  return "operational";
}
