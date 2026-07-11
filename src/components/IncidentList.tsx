import { CheckCircle2 } from "lucide-react";
import type { Incident, UpdateLevel } from "@/lib/incidents";
import { SERVICES } from "@/lib/services";
import { isOngoing } from "@/lib/autoIncidents";
import { LocalTime } from "./LocalTime";

const LEVEL_LABEL: Record<UpdateLevel, string> = {
  investigating: "Investigating",
  identified: "Identified",
  monitoring: "Monitoring",
  resolved: "Resolved",
};

const LEVEL_COLOR: Record<UpdateLevel, string> = {
  investigating: "var(--down)",
  identified: "var(--degraded)",
  monitoring: "var(--maint)",
  resolved: "var(--ok)",
};

function serviceName(id: string): string {
  return SERVICES.find((s) => s.id === id)?.name ?? id;
}

export function IncidentList({ incidents }: { incidents: Incident[] }) {
  return (
    <section className="mt-10">
      <h3 className="mb-3 px-1 text-[13px] font-medium uppercase tracking-wide text-[var(--text-faint)]">
        Recent incidents
      </h3>

      {incidents.length === 0 ? (
        <div className="flex items-center gap-2.5 rounded-2xl border bg-[var(--surface)] px-5 py-4 text-[13.5px] text-[var(--text-soft)]">
          <CheckCircle2 size={16} style={{ color: "var(--ok)" }} />
          All quiet for the past 90 days. No incidents to report.
        </div>
      ) : (
        <div className="space-y-3">
          {incidents.map((inc) => (
            <article
              key={inc.id}
              className="rounded-2xl border bg-[var(--surface)] px-5 py-4 sm:px-6"
            >
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-[15px] font-medium text-[var(--text)]">
                  {inc.title}
                </h4>
                {isOngoing(inc) && (
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
                    style={{ color: "var(--down)", background: "color-mix(in srgb, var(--down) 12%, transparent)" }}
                  >
                    <span
                      className="h-1.5 w-1.5 animate-pulse rounded-full"
                      style={{ background: "var(--down)" }}
                    />
                    Ongoing
                  </span>
                )}
                {inc.affected.map((a) => (
                  <span
                    key={a}
                    className="rounded-full border px-2 py-0.5 text-[11px] text-[var(--text-soft)]"
                  >
                    {serviceName(a)}
                  </span>
                ))}
              </div>
              <ol className="mt-3 space-y-3">
                {inc.updates.map((u, i) => (
                  <li key={i} className="flex gap-3">
                    <span
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: LEVEL_COLOR[u.level] }}
                    />
                    <div className="min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span
                          className="text-[12.5px] font-medium"
                          style={{ color: LEVEL_COLOR[u.level] }}
                        >
                          {LEVEL_LABEL[u.level]}
                        </span>
                        <LocalTime
                          iso={u.at}
                          className="font-mono text-[11px] text-[var(--text-faint)]"
                        />
                      </div>
                      <p className="mt-0.5 text-[13.5px] leading-relaxed text-[var(--text-soft)]">
                        {u.body}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
