"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * D104 (brief #5r, her request) — the same slim bar as the filing page's
 * (D80, components/filing-sticky-bar.tsx), for the client page and its
 * Income, Form 2307 register and Payors pages: it appears only once the
 * page's own header scrolls out of the top of the window, sits beside the
 * menu (left-60 = the menu's width), never over it, and shows the client's
 * name and TIN plus the Income, Form 2307s and Payors buttons. One
 * component shared by all four pages. Not rendered at all while the real
 * header is in view, so its links stay out of the tab order.
 */
export function ClientStickyBar({
  headerId,
  clientId,
  name,
  tin,
}: {
  headerId: string;
  clientId: string;
  name: string;
  tin: string;
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

  if (!visible) return null;

  return (
    <div className="fixed left-60 right-0 top-0 z-20 border-b border-line bg-surface px-6 py-2">
      <div className="mx-auto flex max-w-4xl items-center gap-2 overflow-hidden whitespace-nowrap text-sm">
        <Link href={`/clients/${clientId}`} className="truncate font-medium text-ink hover:underline">
          {name}
        </Link>
        <span className="text-faint">·</span>
        <span className="flex-shrink-0 font-mono text-xs text-ink-secondary">{tin}</span>
        <span className="flex-1" />
        <Link href={`/clients/${clientId}/income`}>
          <Button variant="secondary" size="sm">
            Income
          </Button>
        </Link>
        <Link href={`/clients/${clientId}/form-2307`}>
          <Button variant="secondary" size="sm">
            Form 2307s
          </Button>
        </Link>
        <Link href={`/clients/${clientId}/payors`}>
          <Button variant="secondary" size="sm">
            Payors
          </Button>
        </Link>
      </div>
    </div>
  );
}
