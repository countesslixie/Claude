import Link from "next/link";
import { logout } from "@/lib/actions/auth";

// Calendar is Phase 4 (SPEC.md 15) and not built yet. Books, SAWT
// keying worksheet, Transactions, and the 2307 register are all
// per-client, reached from the client detail page, not top-level nav
// items.
const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/filings", label: "Filings" },
  { href: "/clients", label: "Clients" },
  { href: "/settings", label: "Settings" },
];

export function Nav() {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="flex items-center justify-between px-4 py-2">
        <div className="flex items-center gap-6">
          <span className="text-sm font-semibold text-slate-900">
            BIR 8% Practice Manager
          </span>
          <nav className="flex items-center gap-4">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm text-slate-600 hover:text-slate-900"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <form action={logout}>
          <button
            type="submit"
            className="text-sm text-slate-500 hover:text-slate-800"
          >
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
