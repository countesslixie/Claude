import Link from "next/link";

export default function DashboardPlaceholder() {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-lg font-semibold text-slate-900">Dashboard</h1>
      <p className="mt-2 text-sm text-slate-600">
        The full dashboard — needs-action, waiting-on-BIR aging, waiting-on-client,
        upcoming deadlines, missing documents, and threshold/election alerts — is
        built in Phase 3 once filings and workflow steps exist (SPEC.md section 11).
      </p>
      <p className="mt-4 text-sm text-slate-600">
        Phase 1 foundation is in place. Start with{" "}
        <Link href="/clients" className="font-medium text-slate-900 underline">
          Clients
        </Link>{" "}
        or{" "}
        <Link href="/settings" className="font-medium text-slate-900 underline">
          Settings
        </Link>
        .
      </p>
    </div>
  );
}
