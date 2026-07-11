// ──────────────────────────────────────────────────────────────────────────
// Email subscribers — KV-backed store with double opt-in.
//
// Flow: POST /api/subscribe stores a *pending* subscriber and emails a
// confirmation link; following the link flips them to confirmed. Every
// notification email carries a one-click unsubscribe link keyed by the same
// token. Requires KV (subscribers must persist) and a Resend API key (to
// send anything) — with either missing, the subscribe UI is hidden and every
// function here degrades to a no-op.
//
// Storage model: one JSON document at `subs:v1` mapping email -> subscriber.
// A status page's subscriber list is small (hundreds, not millions), so a
// single read-modify-write document keeps us on the plain GET/SET KV API.
// ──────────────────────────────────────────────────────────────────────────

import { kvEnabled, kvGetJSON, kvSetJSON } from "./kv";

export interface Subscriber {
  /** Random token used in confirm + unsubscribe links. */
  token: string;
  confirmed: boolean;
  /** ISO timestamp of the initial subscribe request. */
  at: string;
}

type SubscriberDoc = Record<string, Subscriber>; // email -> subscriber

const KEY = "subs:v1";
/** Unconfirmed addresses are dropped after this many days. */
const PENDING_TTL_DAYS = 7;
const MAX_EMAIL_LEN = 254;
// Deliberately loose — real validation is the confirmation email itself.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function emailNotificationsEnabled(): boolean {
  return kvEnabled() && Boolean(process.env.RESEND_API_KEY);
}

export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (email.length > MAX_EMAIL_LEN || !EMAIL_RE.test(email)) return null;
  return email;
}

async function readDoc(): Promise<SubscriberDoc> {
  return (await kvGetJSON<SubscriberDoc>(KEY)) ?? {};
}

function prunePending(doc: SubscriberDoc, now: Date): SubscriberDoc {
  const cutoff = now.getTime() - PENDING_TTL_DAYS * 86_400_000;
  for (const [email, sub] of Object.entries(doc)) {
    if (!sub.confirmed && new Date(sub.at).getTime() < cutoff) {
      delete doc[email];
    }
  }
  return doc;
}

/**
 * Register a (possibly repeated) subscribe request. Returns the subscriber
 * record to build the confirmation email from, plus whether the address was
 * already confirmed (in which case no email should be sent — this also keeps
 * the endpoint from being used to spam an already-subscribed address).
 */
export async function addPending(
  email: string,
  now: Date,
): Promise<{ subscriber: Subscriber; alreadyConfirmed: boolean }> {
  const doc = prunePending(await readDoc(), now);
  const existing = doc[email];
  if (existing?.confirmed) {
    return { subscriber: existing, alreadyConfirmed: true };
  }
  // Re-requesting resends the same token rather than minting a new one, so
  // an earlier confirmation email still works.
  const subscriber: Subscriber = existing ?? {
    token: crypto.randomUUID(),
    confirmed: false,
    at: now.toISOString(),
  };
  doc[email] = subscriber;
  await kvSetJSON(KEY, doc);
  return { subscriber, alreadyConfirmed: false };
}

/** Flip the subscriber with this token to confirmed. Returns their email, or null if unknown. */
export async function confirmByToken(token: string): Promise<string | null> {
  const doc = await readDoc();
  for (const [email, sub] of Object.entries(doc)) {
    if (sub.token === token) {
      if (!sub.confirmed) {
        sub.confirmed = true;
        await kvSetJSON(KEY, doc);
      }
      return email;
    }
  }
  return null;
}

/** Remove the subscriber with this token. Returns their email, or null if unknown. */
export async function removeByToken(token: string): Promise<string | null> {
  const doc = await readDoc();
  for (const [email, sub] of Object.entries(doc)) {
    if (sub.token === token) {
      delete doc[email];
      await kvSetJSON(KEY, doc);
      return email;
    }
  }
  return null;
}

/** All confirmed recipients, with the token needed for their unsubscribe links. */
export async function confirmedSubscribers(): Promise<
  Array<{ email: string; token: string }>
> {
  const doc = await readDoc();
  return Object.entries(doc)
    .filter(([, sub]) => sub.confirmed)
    .map(([email, sub]) => ({ email, token: sub.token }));
}
