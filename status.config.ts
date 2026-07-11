// ──────────────────────────────────────────────────────────────────────────
// status.config.ts — the one file you edit.
//
// Everything customer-facing lives here: your branding and the list of
// services to monitor. Probes run server-side only, so probe targets are
// never exposed to visitors.
// ──────────────────────────────────────────────────────────────────────────

import type { UpdateLevel } from "@/lib/incidents";
import { httpProbe, type ServiceDef } from "@/lib/probes";

export const SITE = {
  /** Product or company name, shown in the header and the © footer. */
  name: "Acme",
  /** Browser tab + Open Graph title. */
  title: "Acme Status",
  description: "Live status and uptime for everything at Acme.",
  /** Canonical URL of this status page (used for Open Graph metadata). */
  url: "https://status.example.com",
  /** Where the header link points. Set to null to hide the link. */
  homepage: "https://example.com" as string | null,
  /**
   * Optional logo, as a path under /public (e.g. "/logo-mark.png").
   * With null, the header renders a live status dot as the mark.
   */
  logo: null as string | null,
  /**
   * The calendar timezone for daily uptime buckets. Probes are aggregated
   * per *day*, so pick the timezone your team (or most of your users) lives
   * in — otherwise an evening probe lands in the "wrong" day.
   * Can be overridden with the STATUS_TIMEZONE env var.
   */
  timezone: "UTC",
  /** Small "powered by" credit in the footer. Set false to hide. */
  showPoweredBy: true,
};

// ──────────────────────────────────────────────────────────────────────────
// Notifications — automatic alerts when an incident opens, changes, or
// resolves. Channels activate through env vars (see .env.example):
// RESEND_API_KEY enables email subscriptions (double opt-in, KV required);
// NOTIFY_SLACK_WEBHOOK_URL / NOTIFY_DISCORD_WEBHOOK_URL / NOTIFY_WEBHOOK_URL
// enable webhooks. With nothing configured, nothing is sent and the
// subscribe UI stays hidden.
// ──────────────────────────────────────────────────────────────────────────

export const NOTIFICATIONS = {
  /**
   * Which incident-update levels get announced. "monitoring" is omitted by
   * default so subscribers hear "we found a problem" and "it's fixed"
   * without the intermediate chatter.
   */
  levels: ["investigating", "identified", "resolved"] as UpdateLevel[],
  /**
   * From address for email notifications. The domain must be verified in
   * your Resend account. Use a subdomain (e.g. updates.example.com) so
   * status mail can't hurt your primary domain's reputation.
   */
  emailFrom: "Acme Status <status@updates.example.com>",
};

// ──────────────────────────────────────────────────────────────────────────
// Services — one entry per row on the page. The API routes, cron sampling,
// uptime history, and auto-incident detection all follow this list.
//
// Probe helpers (import from "@/lib/probes"):
//   httpProbe(url)                    any 2xx → operational, other response
//                                     → degraded, timeout/network → down
//   dependencyProbe(url, name)        reads `dependencies.<name>` (or
//                                     `checks.<name>`) from a JSON readiness
//                                     endpoint — for services that aren't
//                                     publicly routable
//   supabaseAuthProbe(base, anonKey?) checks a Supabase project's auth
//                                     health endpoint
//
// Or write your own: any async () => { status, latencyMs } works.
// ──────────────────────────────────────────────────────────────────────────

export const SERVICES: ServiceDef[] = [
  {
    id: "web",
    name: "Website",
    description: "The site you open in your browser",
    probe: httpProbe("https://example.com/"),
  },
  {
    id: "api",
    name: "API",
    description: "Powers every request behind the app",
    probe: httpProbe("https://example.org/"),
  },

  // A service that isn't publicly routable, read through your API's
  // readiness endpoint:
  //
  // {
  //   id: "worker",
  //   name: "Background Worker",
  //   description: "Processes jobs and scheduled tasks",
  //   probe: dependencyProbe("https://api.example.com/health/ready", "worker"),
  // },

  // A Supabase project (anon key optional — without it, an answering
  // gateway still counts as reachable):
  //
  // {
  //   id: "database",
  //   name: "Database & Auth",
  //   description: "Keeps your data and sign in working",
  //   probe: supabaseAuthProbe(
  //     "https://yourproject.supabase.co",
  //     process.env.STATUS_SUPABASE_ANON_KEY,
  //   ),
  // },
];
