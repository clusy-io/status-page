import type { Health } from "@/lib/services";
import { STATUS_VAR } from "@/lib/present";

export function StatusDot({
  status,
  size = 9,
  pulse = false,
}: {
  status: Health;
  size?: number;
  pulse?: boolean;
}) {
  const { fg } = STATUS_VAR[status];
  return (
    <span
      className="relative inline-flex shrink-0"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {pulse && status !== "operational" && (
        <span
          className="absolute inset-0 rounded-full opacity-60 animate-ping"
          style={{ background: fg }}
        />
      )}
      <span
        className="relative inline-block rounded-full"
        style={{ width: size, height: size, background: fg }}
      />
    </span>
  );
}
