"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/**
 * D172 — "Back up now". A plain form POST so the browser itself downloads the
 * zip (nothing is held in the page's memory). The server records the time when
 * the zip has finished streaming, so after the click this polls for that and
 * then refreshes the "Last backup" line.
 */
export function BackupButton({ lastBackupAt }: { lastBackupAt: string | null }) {
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  function startWatching() {
    setWorking(true);
    setFailed(false);
    const startedAt = Date.now();
    timer.current = setInterval(async () => {
      try {
        const res = await fetch("/api/backup", { cache: "no-store" });
        const body = (await res.json()) as { lastBackupAt: string | null };
        if (body.lastBackupAt && body.lastBackupAt !== lastBackupAt) {
          if (timer.current) clearInterval(timer.current);
          setWorking(false);
          router.refresh();
          return;
        }
      } catch {
        // keep trying until the time limit below
      }
      if (Date.now() - startedAt > 5 * 60 * 1000) {
        if (timer.current) clearInterval(timer.current);
        setWorking(false);
        setFailed(true);
      }
    }, 1500);
  }

  return (
    <form method="post" action="/api/backup" onSubmit={startWatching} className="flex items-center gap-3">
      <Button type="submit" disabled={working}>
        {working ? "Preparing backup…" : "Back up now"}
      </Button>
      {failed && <span className="text-sm text-red">The backup did not finish. Try again.</span>}
    </form>
  );
}
