// ──────────────────────────────────────────────────────────────────────────
// Notifications — pushes incident updates to subscribers and webhooks.
//
// Called once per cron tick with the full merged incident list (auto +
// hand-curated). A KV ledger (`notif:sent:v1`) records which updates have
// already been announced, so each update notifies exactly once — including
// hand-written updates that arrive via a deploy. On the very first tick the
// ledger is seeded with everything currently visible WITHOUT sending, so
// enabling notifications never replays history.
//
// Channels (all optional, all env-driven):
//   • Email — Resend HTTP API (RESEND_API_KEY), double-opt-in subscribers
//     from lib/subscribers.ts, per-recipient unsubscribe links.
//   • Slack — incoming webhook (NOTIFY_SLACK_WEBHOOK_URL).
//   • Discord — webhook (NOTIFY_DISCORD_WEBHOOK_URL).
//   • Generic — JSON POST of the raw update (NOTIFY_WEBHOOK_URL).
//
// Requires KV (the ledger). No KV → no-op, like every other persistent
// feature in this template.
// ──────────────────────────────────────────────────────────────────────────

import { NOTIFICATIONS, SITE } from "../../status.config";
import type { Incident, IncidentUpdate } from "./incidents";
import { kvEnabled, kvGetJSON, kvSetJSON } from "./kv";
import { confirmedSubscribers, emailNotificationsEnabled } from "./subscribers";

const SENT_KEY = "notif:sent:v1";
/** Ledger entries older than this are pruned (mirrors the 90d incident log, plus slack). */
const SENT_RETENTION_DAYS = 120;
const RESEND_BASE = process.env.RESEND_BASE_URL ?? "https://api.resend.com";
const RESEND_BATCH_LIMIT = 100;

type SentLedger = Record<string, string>; // updateKey -> sentAt ISO

const LEVEL_LABEL: Record<IncidentUpdate["level"], string> = {
  investigating: "Investigating",
  identified: "Identified",
  monitoring: "Monitoring",
  resolved: "Resolved",
};

function updateKey(inc: Incident, u: IncidentUpdate): string {
  return `${inc.id}|${u.at}|${u.level}`;
}

function webhookTargets(): { slack?: string; discord?: string; generic?: string } {
  return {
    slack: process.env.NOTIFY_SLACK_WEBHOOK_URL || undefined,
    discord: process.env.NOTIFY_DISCORD_WEBHOOK_URL || undefined,
    generic: process.env.NOTIFY_WEBHOOK_URL || undefined,
  };
}

export function anyChannelConfigured(): boolean {
  const t = webhookTargets();
  return emailNotificationsEnabled() || Boolean(t.slack || t.discord || t.generic);
}

// ── Resend ──────────────────────────────────────────────────────────────────

async function resendPost(path: string, payload: unknown): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  try {
    const res = await fetch(`${RESEND_BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(`resend ${path} failed: HTTP ${res.status}`);
    }
    return res.ok;
  } catch (err) {
    console.error(`resend ${path} failed:`, err);
    return false;
  }
}

function unsubscribeUrl(token: string): string {
  return `${SITE.url}/api/subscribe?action=unsubscribe&token=${token}`;
}

function emailShell(bodyHtml: string, token: string): string {
  return `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:24px 16px;color:#1a1a18;">
  <p style="font-size:13px;color:#9a9a93;margin:0 0 16px;">${SITE.title}</p>
  ${bodyHtml}
  <hr style="border:none;border-top:1px solid #ececea;margin:24px 0 12px;">
  <p style="font-size:12px;color:#9a9a93;margin:0;">
    You're receiving this because you subscribed to updates at
    <a href="${SITE.url}" style="color:#6b6b66;">${SITE.url.replace(/^https?:\/\//, "")}</a>.
    <a href="${unsubscribeUrl(token)}" style="color:#6b6b66;">Unsubscribe</a>
  </p>
</div>`;
}

/** The double-opt-in confirmation email sent by POST /api/subscribe. */
export async function sendConfirmationEmail(
  email: string,
  token: string,
): Promise<boolean> {
  const confirmUrl = `${SITE.url}/api/subscribe?action=confirm&token=${token}`;
  return resendPost("/emails", {
    from: NOTIFICATIONS.emailFrom,
    to: [email],
    subject: `Confirm your subscription to ${SITE.title}`,
    html: emailShell(
      `<h2 style="font-size:17px;margin:0 0 8px;">Confirm your subscription</h2>
       <p style="font-size:14px;line-height:1.6;color:#6b6b66;margin:0 0 16px;">
         You (or someone using this address) asked to receive incident updates
         from ${SITE.title}. Confirm to start receiving them — otherwise you
         can ignore this email.
       </p>
       <p style="margin:0;">
         <a href="${confirmUrl}" style="display:inline-block;background:#1a1a18;color:#ffffff;font-size:14px;padding:9px 16px;border-radius:6px;text-decoration:none;">Confirm subscription</a>
       </p>`,
      token,
    ),
  });
}

async function emailUpdate(inc: Incident, u: IncidentUpdate): Promise<void> {
  if (!emailNotificationsEnabled()) return;
  const recipients = await confirmedSubscribers();
  if (recipients.length === 0) return;

  const subject = `[${SITE.title}] ${LEVEL_LABEL[u.level]}: ${inc.title}`;
  const body = (token: string) =>
    emailShell(
      `<h2 style="font-size:17px;margin:0 0 4px;">${inc.title}</h2>
       <p style="font-size:13px;margin:0 0 12px;">
         <strong>${LEVEL_LABEL[u.level]}</strong>
         <span style="color:#9a9a93;"> · ${new Date(u.at).toUTCString()}</span>
       </p>
       <p style="font-size:14px;line-height:1.6;color:#3a3a36;margin:0 0 16px;">${u.body}</p>
       <p style="margin:0;">
         <a href="${SITE.url}" style="font-size:13px;color:#4a73d6;">View the status page →</a>
       </p>`,
      token,
    );

  for (let i = 0; i < recipients.length; i += RESEND_BATCH_LIMIT) {
    const chunk = recipients.slice(i, i + RESEND_BATCH_LIMIT);
    await resendPost(
      "/emails/batch",
      chunk.map(({ email, token }) => ({
        from: NOTIFICATIONS.emailFrom,
        to: [email],
        subject,
        html: body(token),
        headers: {
          "List-Unsubscribe": `<${unsubscribeUrl(token)}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      })),
    );
  }
}

// ── Webhooks ────────────────────────────────────────────────────────────────

async function postJSON(url: string, payload: unknown): Promise<void> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) console.error(`webhook POST failed: HTTP ${res.status}`);
  } catch (err) {
    console.error("webhook POST failed:", err);
  }
}

async function webhookUpdate(inc: Incident, u: IncidentUpdate): Promise<void> {
  const { slack, discord, generic } = webhookTargets();
  const line = `${LEVEL_LABEL[u.level]}: ${inc.title} — ${u.body} (${SITE.url})`;
  await Promise.all([
    slack ? postJSON(slack, { text: line }) : null,
    discord ? postJSON(discord, { content: line }) : null,
    generic
      ? postJSON(generic, {
          site: SITE.title,
          url: SITE.url,
          incident: {
            id: inc.id,
            title: inc.title,
            impact: inc.impact,
            affected: inc.affected,
          },
          update: u,
        })
      : null,
  ]);
}

// ── The per-tick entry point ────────────────────────────────────────────────

function pruneLedger(ledger: SentLedger, now: Date): SentLedger {
  const cutoff = now.getTime() - SENT_RETENTION_DAYS * 86_400_000;
  for (const [key, sentAt] of Object.entries(ledger)) {
    if (new Date(sentAt).getTime() < cutoff) delete ledger[key];
  }
  return ledger;
}

/**
 * Announce every not-yet-announced incident update whose level is in
 * NOTIFICATIONS.levels. Idempotent across ticks via the KV ledger.
 */
export async function notifyNewUpdates(
  incidents: Incident[],
  now: Date,
): Promise<number> {
  if (!kvEnabled() || !anyChannelConfigured()) return 0;

  const existing = await kvGetJSON<SentLedger>(SENT_KEY);
  const ledger = existing ?? {};
  const firstRun = existing === null;

  // Oldest update first so a subscriber's inbox reads chronologically.
  const pending: Array<{ inc: Incident; u: IncidentUpdate }> = [];
  for (const inc of incidents) {
    for (const u of inc.updates) {
      const key = updateKey(inc, u);
      if (ledger[key]) continue;
      ledger[key] = now.toISOString();
      if (!firstRun && NOTIFICATIONS.levels.includes(u.level)) {
        pending.push({ inc, u });
      }
    }
  }
  pending.sort((a, b) => new Date(a.u.at).getTime() - new Date(b.u.at).getTime());

  for (const { inc, u } of pending) {
    await emailUpdate(inc, u);
    await webhookUpdate(inc, u);
  }

  await kvSetJSON(SENT_KEY, pruneLedger(ledger, now));
  return pending.length;
}
