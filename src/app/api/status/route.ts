import { NextResponse } from "next/server";
import { probeAll } from "@/lib/services";
import { INCIDENTS } from "@/lib/incidents";
import {
  readAutoIncidents,
  mergeIncidents,
  applyIncidents,
} from "@/lib/autoIncidents";

// Always run fresh — a status endpoint must never be cached.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const probed = await probeAll();
  const incidents = mergeIncidents(await readAutoIncidents(), INCIDENTS);
  const { services, overall } = applyIncidents(probed, incidents);
  return NextResponse.json(
    { overall, services, generatedAt: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
