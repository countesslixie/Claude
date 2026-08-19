import Link from "next/link";
import { logout } from "@/lib/actions/auth";

// Only screens that exist as of Phase 1. Filings, Transactions, 2307
// Register, Books, and Calendar are built in later phases (SPEC.md 15).
const LINKS = [
  { href: "/", label: "Dashboard" },
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
