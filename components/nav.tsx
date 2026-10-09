"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  KanbanSquare,
  Users,
  Percent,
  Calendar,
  Tag,
  KeyRound,
  LogOut,
} from "lucide-react";
import { logout } from "@/lib/actions/auth";
import { cn } from "@/lib/utils";

/**
 * Brief #5g §4 — left-side menu, replacing the old top bar, modelled on
 * the bookkeeper's other app. Every link the old top bar carried
 * (Dashboard, Kanban, Clients, Settings and its three sub-pages, Sign
 * out) is still here so nothing becomes unreachable — the Settings hub
 * page (app/(app)/settings/page.tsx) is only otherwise linked from here,
 * so its group heading stays a link to it, with its three children
 * listed directly underneath.
 *
 * Icons: lucide-react is already a package.json dependency (unused
 * elsewhere) — used here rather than adding a new icon package.
 */
type NavLink = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

export const TOP: NavLink = { href: "/", label: "Dashboard", icon: LayoutDashboard };

export const WORK: NavLink[] = [
  { href: "/filings", label: "Kanban", icon: KanbanSquare },
  { href: "/clients", label: "Clients", icon: Users },
];

const SETTINGS_GROUP = { href: "/settings", label: "Settings" };
export const SETTINGS: NavLink[] = [
  { href: "/settings/tax-rule-sets", label: "Tax Rules", icon: Percent },
  { href: "/settings/atc-codes", label: "ATC", icon: Tag },
  { href: "/settings/holidays", label: "Holidays", icon: Calendar },
  { href: "/settings/bir-logins", label: "BIR Logins", icon: KeyRound },
];

function NavItem({ link, pathname }: { link: NavLink; pathname: string }) {
  const isActive = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
  const Icon = link.icon;
  return (
    <Link
      href={link.href}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        isActive ? "bg-purple-600 text-white" : "text-ink hover:bg-purple-50",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {link.label}
    </Link>
  );
}

export function Nav() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-10 flex w-60 flex-col border-r border-line bg-surface">
      <div className="flex items-center gap-2.5 px-4 py-5">
        <span className="h-7 w-7 shrink-0 rounded-md bg-purple-600" aria-hidden />
        <div className="leading-tight">
          <p className="text-sm font-semibold text-ink">BIR Filing Manager</p>
          <p className="text-xs text-faint">8% Tax Rate</p>
        </div>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-2">
        <div className="space-y-1">
          <NavItem link={TOP} pathname={pathname} />
        </div>

        <div>
          <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">Work</p>
          <div className="space-y-1">
            {WORK.map((link) => (
              <NavItem key={link.href} link={link} pathname={pathname} />
            ))}
          </div>
        </div>

        <div>
          <Link
            href={SETTINGS_GROUP.href}
            className="block px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-faint hover:text-ink-secondary"
          >
            {SETTINGS_GROUP.label}
          </Link>
          <div className="space-y-1">
            {SETTINGS.map((link) => (
              <NavItem key={link.href} link={link} pathname={pathname} />
            ))}
          </div>
        </div>
      </nav>

      <form action={logout} className="border-t border-line px-3 py-3">
        <button
          type="submit"
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-ink-secondary transition-colors hover:bg-purple-50"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          Sign out
        </button>
      </form>
    </aside>
  );
}
