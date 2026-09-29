"use client";

/**
 * D77/D80 — one "Go to step" behaviour for every link that offers it (the
 * Next banner's, and the slim bar pinned to the top of the filing page):
 * expand the group the step lives in, then scroll to the step's own card,
 * leaving room for the slim bar (each step wrapper carries scroll-mt-20,
 * taller than the bar, so its first line is never covered).
 */
export const OPEN_STEP_EVENT = "open-workflow-step";

export function goToStep(stepCode: string) {
  window.dispatchEvent(new CustomEvent(OPEN_STEP_EVENT, { detail: { stepCode } }));
  // Two frames: the first lets React expand the group, the second lets the
  // expanded card lay out before we measure where to scroll.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const target = document.getElementById(`step-${stepCode}`) ?? document.getElementById("checklist");
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    }),
  );
}

export function GoToStepLink({
  stepCode,
  className,
  children = "Go to step",
}: {
  stepCode: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <a
      href={`#step-${stepCode}`}
      className={className}
      onClick={(e) => {
        e.preventDefault();
        goToStep(stepCode);
      }}
    >
      {children}
    </a>
  );
}
