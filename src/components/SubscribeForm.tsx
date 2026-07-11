"use client";

import { useRef, useState } from "react";
import { Bell, Check } from "lucide-react";

type Phase = "idle" | "open" | "sending" | "sent" | "error";

// Header affordance for email subscriptions: a quiet "Subscribe" button that
// expands into an inline email form. Only rendered when the server says email
// notifications are configured (see page.tsx).
export function SubscribeForm() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [email, setEmail] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setPhase("sending");
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setPhase(res.ok ? "sent" : "error");
    } catch {
      setPhase("error");
    }
  }

  if (phase === "sent") {
    return (
      <span className="flex items-center gap-1.5 text-[12.5px] text-[var(--text-soft)]">
        <Check size={14} style={{ color: "var(--ok)" }} />
        Check your inbox to confirm
      </span>
    );
  }

  if (phase === "idle") {
    return (
      <button
        onClick={() => {
          setPhase("open");
          // Focus once the input exists.
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12.5px] text-[var(--text-soft)] transition-colors hover:text-[var(--text)]"
      >
        <Bell size={13} />
        Subscribe
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-1.5">
      <input
        ref={inputRef}
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        disabled={phase === "sending"}
        className="w-44 rounded-md border bg-[var(--surface)] px-2.5 py-1 text-[12.5px] text-[var(--text)] placeholder:text-[var(--text-faint)] focus:outline-none focus:ring-1 focus:ring-[var(--text-faint)]"
      />
      <button
        type="submit"
        disabled={phase === "sending"}
        className="rounded-md border px-2.5 py-1 text-[12.5px] text-[var(--text-soft)] transition-colors hover:text-[var(--text)] disabled:opacity-60"
      >
        {phase === "sending" ? "Sending…" : "Get updates"}
      </button>
      {phase === "error" && (
        <span className="text-[12px]" style={{ color: "var(--down)" }}>
          Try again
        </span>
      )}
    </form>
  );
}
