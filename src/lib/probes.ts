// ──────────────────────────────────────────────────────────────────────────
// Probe helpers — the building blocks for status.config.ts.
//
// Each service is probed server-side (never from the browser) so probes
// avoid CORS and never leak the visitor's IP to your infra. Probes are
// intentionally dependency-free: a timed fetch + a small evaluator. A probe
// is just an async function returning { status, latencyMs } — write your
// own when the helpers below don't fit.
// ──────────────────────────────────────────────────────────────────────────

export type Health = "operational" | "degraded" | "down" | "maintenance";

export interface ProbeResult {
  id: string;
  name: string;
  description: string;
  status: Health;
  /** Round-trip latency in ms, or null if the probe never got a response. */
  latencyMs: number | null;
  checkedAt: string; // ISO timestamp
}

export interface ServiceDef {
  id: string;
  name: string;
  description: string;
  probe: () => Promise<{ status: Health; latencyMs: number | null }>;
}

const TIMEOUT_MS = 8000;

/** A single timed GET. Returns the Response plus elapsed ms, or throws on timeout/network error. */
export async function timedFetch(
  url: string,
  init?: RequestInit,
): Promise<{ res: Response; ms: number }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const start = performance.now();
  try {
    const res = await fetch(url, {
      ...init,
      method: init?.method ?? "GET",
      signal: controller.signal,
      cache: "no-store",
      redirect: "follow",
      headers: { "user-agent": "status-page/1.0", ...(init?.headers ?? {}) },
    });
    return { res, ms: Math.round(performance.now() - start) };
  } finally {
    clearTimeout(t);
  }
}

/** Generic "is this URL serving 2xx" probe. Any 2xx → operational, other response → degraded, no response → down. */
export function httpProbe(url: string, init?: RequestInit) {
  return async (): Promise<{ status: Health; latencyMs: number | null }> => {
    try {
      const { res, ms } = await timedFetch(url, init);
      if (res.ok) return { status: "operational", latencyMs: ms };
      // Reached the service but it answered unhealthily.
      return { status: "degraded", latencyMs: ms };
    } catch {
      return { status: "down", latencyMs: null };
    }
  };
}

/**
 * Probe a service that isn't publicly routable by reading it as a named
 * dependency of a JSON readiness endpoint you do expose. Expects a payload
 * like `{ dependencies: { worker: "ok", ... } }` or `{ checks: { ... } }` —
 * entries can be strings ("ok"/"down") or objects ({ ok: true } /
 * { status: "healthy" }). Falls back to the endpoint's overall HTTP status
 * when the named dependency can't be read.
 */
export function dependencyProbe(url: string, dependency: string) {
  return async (): Promise<{ status: Health; latencyMs: number | null }> => {
    try {
      const { res, ms } = await timedFetch(url);
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        /* non-JSON body */
      }
      const dep = extractDependency(body, dependency);
      if (dep === "ok") return { status: "operational", latencyMs: ms };
      if (dep === "down") return { status: "down", latencyMs: ms };
      // Couldn't read the dependency specifically: fall back to the overall
      // readiness signal so we still say something truthful.
      return {
        status: res.ok ? "operational" : "degraded",
        latencyMs: ms,
      };
    } catch {
      return { status: "down", latencyMs: null };
    }
  };
}

/**
 * Supabase health probe against `<base>/auth/v1/health`. The auth gateway
 * requires an apikey, so:
 *   2xx          → operational (authenticated health check passed)
 *   401 / 403    → operational (the gateway answered — service is reachable)
 *   5xx          → degraded (service is up but erroring)
 *   timeout/err  → down
 * Pass your *publishable* anon key (it's already shipped in your web app)
 * for a true authenticated signal; without it a gateway-level 401 still
 * counts as reachable.
 */
export function supabaseAuthProbe(base: string, anonKey?: string) {
  return async (): Promise<{ status: Health; latencyMs: number | null }> => {
    try {
      const headers: Record<string, string> = {};
      if (anonKey) {
        headers.apikey = anonKey;
        headers.Authorization = `Bearer ${anonKey}`;
      }
      const { res, ms } = await timedFetch(`${base}/auth/v1/health`, {
        headers,
      });
      if (res.ok) return { status: "operational", latencyMs: ms };
      if (res.status === 401 || res.status === 403)
        return { status: "operational", latencyMs: ms };
      return { status: "degraded", latencyMs: ms };
    } catch {
      return { status: "down", latencyMs: null };
    }
  };
}

/**
 * Best-effort read of `dependencies.<name>` (or `checks.<name>`) from a
 * readiness payload, normalised to "ok" | "down" | "unknown".
 */
function extractDependency(
  body: unknown,
  name: string,
): "ok" | "down" | "unknown" {
  if (!body || typeof body !== "object") return "unknown";
  const obj = body as Record<string, unknown>;
  const bag =
    (obj.dependencies as Record<string, unknown> | undefined) ??
    (obj.checks as Record<string, unknown> | undefined);
  if (!bag || typeof bag !== "object") return "unknown";
  const entry = bag[name];
  if (entry === undefined) return "unknown";
  // Entry can be a string ("ok") or an object ({ status: "ok", ok: true }).
  if (typeof entry === "string") {
    return /ok|up|healthy|ready/i.test(entry) ? "ok" : "down";
  }
  if (entry && typeof entry === "object") {
    const e = entry as Record<string, unknown>;
    if (e.ok === true) return "ok";
    if (e.ok === false) return "down";
    if (typeof e.status === "string") {
      return /ok|up|healthy|ready/i.test(e.status) ? "ok" : "down";
    }
  }
  return "unknown";
}
