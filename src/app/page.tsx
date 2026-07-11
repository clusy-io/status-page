import { probeAll, SERVICES } from "@/lib/services";
import { readHistory, type UptimeDay } from "@/lib/history";
import Image from "next/image";
import { LiveStatus } from "@/components/LiveStatus";
import { StatusDot } from "@/components/StatusDot";
import { IncidentList } from "@/components/IncidentList";
import { INCIDENTS } from "@/lib/incidents";
import { readAutoIncidents, mergeIncidents, applyIncidents } from "@/lib/autoIncidents";
import { SITE } from "../../status.config";

// The page probes every service at request time so the first paint is already
// live, then <LiveStatus> keeps it fresh client-side.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Page() {
  const probed = await probeAll();

  // Uptime history per service (empty arrays until KV is configured).
  const historyEntries = await Promise.all(
    SERVICES.map(async (s) => [s.id, await readHistory(s.id)] as const),
  );
  const history: Record<string, UptimeDay[]> = Object.fromEntries(historyEntries);

  // Auto-detected incidents (from the cron state machine) merged with any
  // hand-curated ones, newest activity first.
  const incidents = mergeIncidents(await readAutoIncidents(), INCIDENTS);

  // Fold any ongoing incident into the banner + affected rows, so a known
  // issue the probes can't see (e.g. an upstream degradation) still shows.
  const { services, overall } = applyIncidents(probed, incidents);

  const generatedAt = new Date().toISOString();
  const year = new Date().getFullYear();

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-12 sm:py-16">
      {/* Header */}
      <header className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          {SITE.logo ? (
            <Image
              src={SITE.logo}
              alt={SITE.name}
              width={26}
              height={26}
              priority
              className="h-[26px] w-[26px] object-contain"
            />
          ) : (
            <StatusDot status={overall} size={12} />
          )}
          <span className="text-[15px] font-semibold tracking-[-0.01em] text-[var(--text)]">
            {SITE.name}
            <span className="ml-1.5 font-normal text-[var(--text-faint)]">
              Status
            </span>
          </span>
        </div>
        {SITE.homepage && (
          <a
            href={SITE.homepage}
            className="text-[13px] text-[var(--text-soft)] transition-colors hover:text-[var(--text)]"
          >
            {SITE.homepage.replace(/^https?:\/\//, "").replace(/\/$/, "")} ↗
          </a>
        )}
      </header>

      <LiveStatus
        initial={{ overall, services, generatedAt }}
        history={history}
      />

      <IncidentList incidents={incidents} />

      <footer className="mt-12 flex items-center justify-between border-t pt-6 text-[12px] text-[var(--text-faint)]">
        <span>© {year} {SITE.name}</span>
        {SITE.showPoweredBy && (
          <a
            href="https://github.com/clusy-io/status-page"
            className="transition-colors hover:text-[var(--text)]"
          >
            Powered by status-page
          </a>
        )}
      </footer>
    </main>
  );
}
