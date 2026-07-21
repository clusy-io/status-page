"use client";

import { useState } from "react";
import type { UptimeDay } from "@/lib/history";
import type { Health } from "@/lib/services";
import {
  uptimeColor,
  formatUptime,
  HEALTH_RANK,
  STATUS_LABEL,
  STATUS_VAR,
} from "@/lib/present";
import { aggregateUptime } from "@/lib/history";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// A day bucket is a UTC *calendar day*, not an instant — render it from its
// parts so it never shifts across a timezone boundary.
function labelDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

// Implied health of a recorded day, so we can compare it against the live
// status and never downgrade a worse recorded day (e.g. a real outage) to the
// milder live reading.
function dayHealth(d: UptimeDay | undefined): Health {
  if (!d || d.uptime === null) return "operational";
  if (d.uptime < 0.98) return "down";
  if (d.uptime < 0.999 || d.degraded) return "degraded";
  return "operational";
}

// A 90-day uptime strip. Each tick is a day; colour encodes that day's uptime,
// empty days render as faint placeholders. A single tooltip tracks the hovered
// day and is anchored so it never spills past the card edge.
//
// `liveStatus` is the current, incident-adjusted health of the service. The
// blind probes can't observe some issues (e.g. an upstream model degradation),
// so when the live status is worse than what today's samples recorded, it wins
// on the "Today" tick — otherwise an active incident shows a green today.
export function UptimeBar({
  days,
  liveStatus,
}: {
  days: UptimeDay[];
  liveStatus?: Health;
}) {
  const agg = aggregateUptime(days);
  const hasData = days.some((d) => d.uptime !== null);
  const [hover, setHover] = useState<number | null>(null);
  const n = days.length;
  const todayIdx = n - 1;

  // Overlay the live status onto today's tick only when it's strictly worse
  // than what the probe recorded for today.
  const overlayToday: Health | null =
    liveStatus &&
    n > 0 &&
    HEALTH_RANK[liveStatus] > HEALTH_RANK[dayHealth(days[todayIdx])] &&
    liveStatus !== "operational"
      ? liveStatus
      : null;

  const active = hover !== null ? days[hover] : null;
  // Anchor the tooltip to the hovered bar's centre, but flip alignment near
  // the edges so a wide tooltip stays fully inside the strip.
  const centrePct = hover !== null ? ((hover + 0.5) / n) * 100 : 0;
  const nearLeft = hover !== null && hover <= n * 0.12;
  const nearRight = hover !== null && hover >= n * 0.88;
  const anchor = nearLeft
    ? "translateX(0)"
    : nearRight
      ? "translateX(-100%)"
      : "translateX(-50%)";

  return (
    <div className="mt-3">
      <div
        className="relative flex items-end gap-[2px] h-7"
        onMouseLeave={() => setHover(null)}
      >
        {days.map((d, i) => {
          const isTodayOverlay = i === todayIdx && overlayToday !== null;
          return (
            <div
              key={d.date}
              className="h-full flex-1 rounded-[1px] transition-opacity"
              style={{
                background: isTodayOverlay
                  ? STATUS_VAR[overlayToday].fg
                  : uptimeColor(d.uptime, d.degraded),
                opacity: d.uptime === null && !isTodayOverlay ? 0.25 : 1,
                minWidth: 2,
                outline:
                  hover === i ? "1px solid var(--text-faint)" : "none",
                outlineOffset: 1,
              }}
              onMouseEnter={() => setHover(i)}
            />
          );
        })}

        {active && (
          <div
            className="pointer-events-none absolute bottom-full z-20 mb-2 whitespace-nowrap rounded-lg border bg-[var(--surface)] px-2.5 py-1.5 text-[11px] shadow-md"
            style={{ left: `${centrePct}%`, transform: anchor }}
          >
            <span className="font-medium text-[var(--text)]">
              {hover === todayIdx && overlayToday !== null
                ? STATUS_LABEL[overlayToday]
                : active.uptime === null
                  ? "No data"
                  : formatUptime(active.uptime)}
            </span>
            <span className="text-[var(--text-faint)]">
              {" · "}
              {labelDate(active.date)}
            </span>
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between text-[11px] text-[var(--text-faint)]">
        <span>90 days ago</span>
        <span className="text-[var(--text-soft)]">
          {hasData ? `${formatUptime(agg)} uptime` : "Building uptime history"}
        </span>
        <span>Today</span>
      </div>
    </div>
  );
}
