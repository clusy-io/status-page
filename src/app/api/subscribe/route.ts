import { NextResponse } from "next/server";
import {
  addPending,
  confirmByToken,
  emailNotificationsEnabled,
  normalizeEmail,
  removeByToken,
} from "@/lib/subscribers";
import { sendConfirmationEmail } from "@/lib/notify";
import { kvGetJSON, kvSetJSON } from "@/lib/kv";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Modest per-IP throttle so the endpoint can't be used to carpet-bomb
// confirmation emails. KV-backed with an expiring key; approximate is fine.
const RATE_LIMIT_PER_HOUR = 5;

async function rateLimited(request: Request): Promise<boolean> {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const key = `rl:sub:v1:${ip}`;
  const count = (await kvGetJSON<number>(key)) ?? 0;
  if (count >= RATE_LIMIT_PER_HOUR) return true;
  await kvSetJSON(key, count + 1, 3600);
  return false;
}

/** Subscribe: body {email} → stores a pending subscriber + sends the confirm link. */
export async function POST(request: Request) {
  if (!emailNotificationsEnabled()) {
    return NextResponse.json(
      { error: "email notifications aren't configured" },
      { status: 503 },
    );
  }
  if (await rateLimited(request)) {
    return NextResponse.json({ error: "too many requests" }, { status: 429 });
  }

  let email: string | null = null;
  try {
    const body = (await request.json()) as { email?: unknown };
    if (typeof body.email === "string") email = normalizeEmail(body.email);
  } catch {
    /* fall through to the invalid-email response */
  }
  if (!email) {
    return NextResponse.json({ error: "invalid email" }, { status: 400 });
  }

  const { subscriber, alreadyConfirmed } = await addPending(email, new Date());
  if (!alreadyConfirmed) {
    await sendConfirmationEmail(email, subscriber.token);
  }
  // Same response either way — don't leak whether an address is subscribed.
  return NextResponse.json({ ok: true });
}

/** Confirm / unsubscribe links from emails: ?action=confirm|unsubscribe&token=… */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const action = url.searchParams.get("action");
  const token = url.searchParams.get("token") ?? "";

  let outcome = "invalid";
  if (token) {
    if (action === "confirm") {
      outcome = (await confirmByToken(token)) ? "confirmed" : "invalid";
    } else if (action === "unsubscribe") {
      outcome = (await removeByToken(token)) ? "unsubscribed" : "invalid";
    }
  }
  return NextResponse.redirect(new URL(`/?sub=${outcome}`, request.url));
}
