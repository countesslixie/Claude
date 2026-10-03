import Link from "next/link";
import { Button } from "@/components/ui/button";

/** D166 — the Back button at the top right of Tax Rules, ATC and Holidays; goes to the Settings hub. */
export function BackToSettings() {
  return (
    <Link href="/settings">
      <Button variant="secondary" size="sm">
        Back
      </Button>
    </Link>
  );
}
