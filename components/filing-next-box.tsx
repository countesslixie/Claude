import Link from "next/link";
import { Card, CardBody } from "@/components/ui/card";

/**
 * §4.2 / D204 — the Next box at the top of the filing page: text and one
 * "Go to checklist" link, never a step button (Mark done, Start …). Every step's
 * own card keeps its controls; the server-side locks are untouched. D84's
 * nextActionForFiling still decides what the text says (the caller passes it in).
 */
export function FilingNextBox({
  next,
  stepCount,
  birWaitText,
  filingOrderReason,
  earlierUnfiled,
}: {
  next: { sequence: number; title: string; stepCode: string } | null;
  stepCount: number;
  birWaitText: string | null;
  filingOrderReason?: string | null;
  earlierUnfiled?: { href: string; label: string } | null;
}) {
  return (
    <Card className="mb-3 border-line bg-background">
      <CardBody className="py-3">
        {next ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-medium text-ink">
              Next: Step {next.sequence} of {stepCount} — {next.title}
              {next.stepCode === "FILE_RETURN" && filingOrderReason && (
                <span className="ml-2 font-normal text-faint">
                  {filingOrderReason}
                  {earlierUnfiled && (
                    <>
                      {" "}
                      <Link href={earlierUnfiled.href} className="underline">
                        Open {earlierUnfiled.label}
                      </Link>
                    </>
                  )}
                </span>
              )}
            </p>
            <a href="#checklist" className="text-xs text-faint underline hover:text-ink">
              Go to checklist
            </a>
          </div>
        ) : birWaitText ? (
          <p className="text-sm font-medium text-ink">Next: {birWaitText}</p>
        ) : (
          <p className="text-sm font-medium text-green">All 16 steps resolved — nothing left to do on this filing.</p>
        )}
      </CardBody>
    </Card>
  );
}
