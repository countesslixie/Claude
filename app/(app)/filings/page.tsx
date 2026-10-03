import { prisma } from "@/lib/prisma";
import { BoardColumn } from "@/components/board-column";
import { WORKFLOW_GROUPS, currentGroupCode, summarizeGroup } from "@/lib/workflow/groups";
import { deriveStepAging, birWaitTags } from "@/lib/workflow/aging";
import { boardShowsFiling } from "@/lib/workflow/clientWait";
import type { Period } from "@/lib/tax/types";

// D175 — always rendered fresh from the database, never prerendered at build time.
export const dynamic = "force-dynamic";

/**
 * Kanban (was "Filing cycle board"): kanban, columns = the six groups (D70), cards =
 * client-period. D138 — no filter bar and no Complete column (finished filings
 * stay on the client's page). D139 — a card appears only once its period has
 * ended, the same rule as the dashboard's Waiting on client (D130).
 */
export default async function FilingsBoardPage() {
  const now = new Date();
  const filings = await prisma.filing.findMany({
    where: {
      deletedAt: null,
      filedOutsideApp: false,
    },
    include: {
      client: true,
      workflowSteps: {
        select: {
          sequence: true,
          status: true,
          stepCode: true,
          waitingOnLabel: true,
          waitingSince: true,
          expectedResponseDays: true,
        },
      },
    },
    orderBy: [{ adjustedDueDate: "asc" }],
  });

  // §2, §5 — a card sits in its earliest incomplete GROUP (group order,
  // not raw step sequence — group 2/File isn't contiguous), carrying that
  // group's waiting state so a filing awaiting only the TRRC reads as
  // "File — waiting on BIR, 12 days" rather than looking unfiled.
  const cards = filings.filter((f) => boardShowsFiling(f.taxableYear, f.period as Period, now)).map((f) => {
    const groupCode = currentGroupCode(f.workflowSteps);
    const group = groupCode ? WORKFLOW_GROUPS.find((g) => g.code === groupCode) : undefined;
    const outstandingLabel = group
      ? summarizeGroup(
          group,
          f.workflowSteps.map((s) => ({
            stepCode: s.stepCode,
            status: s.status,
            waitingOnLabel: s.waitingOnLabel,
            agingDaysWaiting:
              s.status === "WAITING_EXTERNAL"
                ? deriveStepAging({
                    stepCode: s.stepCode,
                    status: s.status,
                    waitingSince: s.waitingSince,
                    expectedResponseDays: s.expectedResponseDays,
                    certificatesExpectedBy: f.certificatesExpectedBy,
                    now,
                  })?.daysWaiting ?? null
                : null,
          })),
        ).outstandingLabel
      : null;
    // D79 — a card outside BIR Confirmations still shows any BIR wait it's carrying;
    // one inside that column already says so.
    const allBirTags = birWaitTags(f.workflowSteps, f.certificatesExpectedBy, now);
    const birTags = groupCode === "BIR_CONFIRMATIONS" ? [] : allBirTags;
    // Inside BIR Confirmations the group's own wait line carries the colour instead:
    // red once either wait is past twice its expected response days (same thresholds as the pill).
    const outstandingTone: "amber" | "red" =
      groupCode === "BIR_CONFIRMATIONS" && allBirTags.some((t) => t.tone === "overdue") ? "red" : "amber";
    return { ...f, groupCode, outstandingLabel, outstandingTone, birTags };
  });

  const columns = WORKFLOW_GROUPS.map((g) => ({
    code: g.code,
    title: g.name,
    filings: cards.filter((c) => c.groupCode === g.code),
  }));

  return (
    // D141 — the Kanban fills the window below the heading: the layout's 1.5rem top padding is
    // kept, the bottom padding is cancelled (-mb-6) so the sideways scroll bar sits on the
    // window's bottom edge, and each column scrolls up and down inside itself.
    <div className="-mb-6 flex h-[calc(100vh-1.5rem)] min-w-0 flex-col">
      <div className="mb-4 flex shrink-0 items-center justify-between">
        <h1 className="text-2xl font-semibold text-ink">Kanban</h1>
      </div>

      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto overflow-y-hidden pb-2">
        {columns.map((col) => (
          <BoardColumn key={col.code} title={col.title} filings={col.filings} />
        ))}
      </div>
    </div>
  );
}
