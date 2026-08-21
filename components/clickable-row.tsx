"use client";

import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

/** A table row that navigates to `href` on click, without nesting an <a> inside <table> (invalid HTML). */
export function ClickableRow({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <tr
      onClick={() => router.push(href)}
      className={cn("cursor-pointer transition-colors hover:bg-slate-50", className)}
    >
      {children}
    </tr>
  );
}

/** Wraps a cell's interactive content (buttons/forms) so clicking it doesn't also trigger the row's navigation. */
export function ActionCell({ children }: { children?: React.ReactNode }) {
  return (
    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
      {children}
    </td>
  );
}
