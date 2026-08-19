const STYLES = {
  pending: "bg-[var(--status-pending-bg)] text-[var(--status-pending-fg)]",
  progress: "bg-[var(--status-progress-bg)] text-[var(--status-progress-fg)]",
  waiting: "bg-[var(--status-waiting-bg)] text-[var(--status-waiting-fg)]",
  overdue: "bg-[var(--status-overdue-bg)] text-[var(--status-overdue-fg)]",
  done: "bg-[var(--status-done-bg)] text-[var(--status-done-fg)]",
} as const;

export type StatusTone = keyof typeof STYLES;

export function StatusBadge({ tone, children }: { tone: StatusTone; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[tone]}`}
    >
      {children}
    </span>
  );
}
