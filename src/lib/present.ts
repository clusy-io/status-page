import type { Health } from "./services";

// Presentation helpers shared by server and client components. Keep all
// customer-facing copy here — no internal hostnames or vendor names.

export const STATUS_LABEL: Record<Health, string> = {
  operational: "Operational",
  degraded: "Running slow",
  down: "Down",
  maintenance: "Maintenance",
};

export const HEADLINE: Record<Health, string> = {
  operational: "Everything is running smoothly",
  degraded: "A few things are running slow",
  down: "We're looking into a problem",
  maintenance: "We're doing some scheduled upkeep",
};

// Maps to the CSS custom properties declared in globals.css.
export const STATUS_VAR: Record<Health, { fg: string; bg: string }> = {
  operational: { fg: "var(--ok)", bg: "var(--ok-soft)" },
  degraded: { fg: "var(--degraded)", bg: "var(--degraded-soft)" },
  down: { fg: "var(--down)", bg: "var(--down-soft)" },
  maintenance: { fg: "var(--maint)", bg: "var(--maint-soft)" },
};

// Colour for a day tick. `degraded` flags a day that stayed available (so its
// uptime ratio can still round to ~100%) but ran slow or partial — those days
// must read amber, never the all-clear green.
export function uptimeColor(uptime: number | null, degraded = false): string {
  if (uptime === null) return "var(--muted)";
  if (uptime >= 0.999) return degraded ? "var(--degraded)" : "var(--ok)";
  if (uptime >= 0.98) return "var(--degraded)";
  return "var(--down)";
}

// Health-worst ordering, shared by the uptime overlay logic.
export const HEALTH_RANK: Record<Health, number> = {
  operational: 0,
  maintenance: 1,
  degraded: 2,
  down: 3,
};

export function formatUptime(ratio: number | null): string {
  if (ratio === null) return "—";
  return `${(ratio * 100).toFixed(ratio >= 0.9995 ? 2 : 1)}%`;
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.round(diff / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
