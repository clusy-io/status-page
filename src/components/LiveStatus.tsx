"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { Health, ProbeResult } from "@/lib/services";
import type { UptimeDay } from "@/lib/history";
import { StatusDot } from "./StatusDot";
import { UptimeBar } from "./UptimeBar";
import {
  HEADLINE,
  STATUS_LABEL,
  STATUS_VAR,
  timeAgo,
} from "@/lib/present";

interface StatusPayload {
  overall: Health;
  services: ProbeResult[];
  generatedAt: string;
}

const POLL_MS = 45_000;

export function LiveStatus({
  initial,
  history,
}: {
  initial: StatusPayload;
  history: Record<string, UptimeDay[]>;
}) {
  const [data, setData] = useState<StatusPayload>(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [, forceTick] = useState(0);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as StatusPayload;
      if (mounted.current) setData(json);
    } catch {
      /* keep showing last-known status on a transient failure */
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const poll = setInterval(refresh, POLL_MS);
    // Re-render the "updated Xs ago" label once a second without re-fetching.
    const tick = setInterval(() => forceTick((n) => n + 1), 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      mounted.current = false;
      clearInterval(poll);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const overall = data.overall;
  const tone = STATUS_VAR[overall];

  return (
    <>
      {/* Headline banner */}
      <section
        className="fade-up flex items-center gap-3.5 rounded-2xl border px-5 py-5 sm:px-6"
        style={{ background: tone.bg, borderColor: "transparent" }}
      >
        <StatusDot status={overall} size={12} pulse />
        <div className="flex-1">
          <h2
            className="text-[17px] font-semibold tracking-[-0.01em]"
            style={{ color: tone.fg }}
          >
            {HEADLINE[overall]}
          </h2>
        </div>
        <button
          onClick={refresh}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-[var(--text-soft)] transition-colors hover:text-[var(--text)]"
          aria-label="Refresh status"
          title="Refresh"
        >
          <RefreshCw
            size={13}
            className={refreshing ? "animate-spin" : ""}
            style={{ animationDuration: "0.8s" }}
          />
          <span className="tabular-nums">{timeAgo(data.generatedAt)}</span>
        </button>
      </section>

      {/* Service list */}
      <section className="fade-up mt-6 overflow-hidden rounded-2xl border bg-[var(--surface)]">
        {data.services.map((svc, i) => (
          <div
            key={svc.id}
            className="px-5 py-5 sm:px-6"
            style={{ borderTop: i === 0 ? "none" : "1px solid var(--border)" }}
          >
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2.5">
                  <span className="truncate text-[15px] font-medium text-[var(--text)]">
                    {svc.name}
                  </span>
                  {svc.latencyMs !== null && (
                    <span className="hidden shrink-0 font-mono text-[11px] text-[var(--text-faint)] sm:inline">
                      {svc.latencyMs}ms
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-[12.5px] text-[var(--text-soft)]">
                  {svc.description}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusDot status={svc.status} pulse />
                <span
                  className="text-[12.5px] font-medium"
                  style={{ color: STATUS_VAR[svc.status].fg }}
                >
                  {STATUS_LABEL[svc.status]}
                </span>
              </div>
            </div>
            <UptimeBar days={history[svc.id] ?? []} liveStatus={svc.status} />
          </div>
        ))}
      </section>
    </>
  );
}
