"use client";

import { useEffect, useState } from "react";

function format(iso: string, timeZone?: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    ...(timeZone ? { timeZone } : {}),
  });
}

// Renders an ISO instant in the *viewer's* timezone. Because the page is
// server-rendered (in UTC on Vercel), formatting has to happen after mount to
// pick up the browser's tz. To avoid a hydration mismatch we render a stable
// UTC string on the server and first client paint, then swap to local time.
export function LocalTime({
  iso,
  className,
}: {
  iso: string;
  className?: string;
}) {
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- standard hydration gate: flips exactly once after mount
  useEffect(() => setMounted(true), []);

  return (
    <time className={className} dateTime={iso} suppressHydrationWarning>
      {mounted ? format(iso) : format(iso, "UTC")}
    </time>
  );
}
