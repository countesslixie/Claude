"use client";

import { useEffect, useState } from "react";
import { GoToStepLink } from "@/components/go-to-step";
import { FilingTin } from "@/components/filing-tin";
import { formatTin } from "@/lib/formatTin";

/**
 * D80 (brief #5n §3, her decision), amended by D203 (brief #6v) — a slim bar
 * that appears once the filing page's own header scrolls out of the top of the
 * window, so she always knows which client and period she's in while working
 * down the steps. Fixed to the content area (left-60 = the menu's own width),
 * so it sits beside the menu, never over it. It shows who and which period, the
 * client's TIN (dashed, no Copy; left out when none is stored) and "Go to step"
 * (D77's behaviour, going to the step Next points to). The "Next: …" text is
 * gone; on a filing with nothing to go to it reads "Complete" when everything
 * is resolved and shows no link while only a BIR wait is left. Gone again as
 * soon as the real header is back in view.
 */
export function FilingStickyBar({
  headerId,
  title,
  goToStepCode,
  isComplete,
  tin = null,
}: {
  headerId: string;
  /** e.g. "Rosario Garcia — TY2026 Q3" */
  title: string;
  /** The step "Go to step" goes to (the one Next points to); null when there is nothing to go to. */
  goToStepCode: string | null;
  isComplete: boolean;
  /** D203 — the client's stored TIN; no TIN part when empty. */
  tin?: string | null;
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

  return <FilingStickyBarContent title={title} goToStepCode={goToStepCode} isComplete={isComplete} tin={tin} />;
}

/** The bar's markup, apart from the scroll watching, so it can be rendered on its own. */
export function FilingStickyBarContent({
  title,
  goToStepCode,
  isComplete,
  tin = null,
}: {
  title: string;
  goToStepCode: string | null;
  isComplete: boolean;
  tin?: string | null;
}) {
  return (
    <div className="fixed left-60 right-0 top-0 z-20 border-b border-line bg-surface px-6 py-2">
      <div className="mx-auto flex max-w-3xl items-center gap-2 overflow-hidden whitespace-nowrap text-sm">
        <span className="truncate font-medium text-ink">{title}</span>
        {formatTin(tin) && (
          <>
            <span className="text-faint">·</span>
            <span className="flex-shrink-0 text-ink-secondary">
              <FilingTin tin={tin} />
            </span>
          </>
        )}
        {goToStepCode ? (
          <>
            <span className="text-faint">·</span>
            <GoToStepLink stepCode={goToStepCode} className="flex-shrink-0 text-ink-secondary underline hover:text-ink" />
          </>
        ) : isComplete ? (
          <>
            <span className="text-faint">·</span>
            <span className="font-medium text-green">Complete</span>
          </>
        ) : null}
      </div>
    </div>
  );
}
