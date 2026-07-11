import { NextResponse } from "next/server";
import { probeAll } from "@/lib/services";
import { historyEnabled, recordSample } from "@/lib/history";
import {
  autoIncidentsEnabled,
  mergeIncidents,
  processTick,
  readAutoIncidents,
} from "@/lib/autoIncidents";
import { INCIDENTS } from "@/lib/incidents";
import { anyChannelConfigured, notifyNewUpdates } from "@/lib/notify";

// Invoked by the Vercel cron schedule in vercel.json. Probes every service,
// records one sample per service into the daily uptime history, advances the
// auto-incident state machine, and announces any not-yet-announced incident
// updates to subscribers/webhooks (all persistent parts need KV). Safe to
// hit manually too.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  // Vercel sets this header on cron invocations and also sends the
  // CRON_SECRET as a bearer token when configured. Reject anything else so the
  // endpoint can't be spammed to inflate history.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const now = new Date();
  const results = await probeAll();

  if (historyEnabled()) {
    await Promise.all(
      results.map((r) => recordSample(r.id, r.status, now)),
    );
  }

  // Advance the auto-incident timeline (open / escalate / resolve).
  await processTick(results, now);

  // Announce new updates — auto-detected AND hand-curated (a deploy that
  // adds an entry to lib/incidents.ts notifies on the next tick).
  const merged = mergeIncidents(await readAutoIncidents(), INCIDENTS);
  const notified = await notifyNewUpdates(merged, now);

  return NextResponse.json({
    ok: true,
    recorded: historyEnabled(),
    incidents: autoIncidentsEnabled(),
    notifications: anyChannelConfigured(),
    notified,
    at: now.toISOString(),
    services: results.map((r) => ({ id: r.id, status: r.status })),
  });
}
