"use client";

import { useEffect, useState } from "react";
import { GoToStepLink } from "@/components/go-to-step";

/**
 * D80 (brief #5n §3, her decision) — a slim bar that appears once the
 * filing page's own header scrolls out of the top of the window, so she
 * always knows which client and period she's in while working down the
 * steps. Fixed to the content area (left-60 = the menu's own width), so it
 * sits beside the menu, never over it. Three things only: who and which
 * period, the next step, and "Go to step" (D77's behaviour). On a
 * complete filing it reads "Complete" with no link. Gone again as soon as
 * the real header is back in view.
 */
export function FilingStickyBar({
  headerId,
  title,
  next,
  waitingText = null,
}: {
  headerId: string;
  /** e.g. "Rosario Garcia — TY2026 Q3" */
  title: string;
  next: { stepCode: string; sequence: number; title: string } | null;
  /** D84 — when nothing of hers is left but a BIR wait: "waiting on BIR — TRRC, 3 days". No link. */
  waitingText?: string | null;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const header = document.getElementById(headerId);
    if (!header) return;
    const observer = new IntersectionObserver(([entry]) => {
      // Only "scrolled past the top" counts — not "below the fold".
      setVisible(!entry.isIntersecting && entry.boundingClientRect.top < 0);
    });
    observer.observe(header);
    return () => observer.disconnect();
  }, [headerId]);

  // Not rendered at all while the real header is in view — a hidden bar would
  // still leave its "Go to step" link in the tab order.
  if (!visible) return null;

  return (
    <div className="fixed left-60 right-0 top-0 z-20 border-b border-line bg-surface px-6 py-2">
      <div className="mx-auto flex max-w-3xl items-center gap-2 overflow-hidden whitespace-nowrap text-sm">
        <span className="truncate font-medium text-ink">{title}</span>
        <span className="text-faint">·</span>
        {next ? (
          <>
            <span className="truncate text-ink-secondary">
              Next: Step {next.sequence} {next.title}
            </span>
            <span className="text-faint">·</span>
            <GoToStepLink stepCode={next.stepCode} className="flex-shrink-0 text-ink-secondary underline hover:text-ink" />
          </>
        ) : waitingText ? (
          <span className="truncate text-ink-secondary">Next: {waitingText}</span>
        ) : (
          <span className="font-medium text-green">Complete</span>
        )}
      </div>
    </div>
  );
}
