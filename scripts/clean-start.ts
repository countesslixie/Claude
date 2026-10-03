import readline from "node:readline";
import { PrismaClient } from "@prisma/client";
import { runCleanStart } from "../lib/cleanStart/cleanStart";
import { getStorageRoot } from "../lib/documents/storage";

/**
 * D178 — `npm run clean-start`. Run once, right after a backup, to remove every
 * sample and test client and every stored file before real clients are entered.
 * Options:  --app-is-closed   skip the "is something answering on port 3000?" check
 *                             (only if that check is wrong, e.g. another program uses 3000).
 */
async function main() {
  const prisma = new PrismaClient();
  // Lines are queued as they arrive, so typed or piped input both work; no answer at all means "cancel".
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  const queue: string[] = [];
  const waiting: ((line: string) => void)[] = [];
  let closed = false;
  rl.on("line", (line) => (waiting.length > 0 ? waiting.shift()!(line) : queue.push(line)));
  rl.on("close", () => {
    closed = true;
    while (waiting.length > 0) waiting.shift()!("");
  });
  const ask = (q: string) => {
    process.stdout.write(q);
    if (queue.length > 0) return Promise.resolve(queue.shift()!);
    if (closed) return Promise.resolve("");
    return new Promise<string>((resolve) => waiting.push(resolve));
  };
  const appIsClosed = process.argv.includes("--app-is-closed");
  const port = Number(process.env.PORT) || 3000;
  try {
    console.log("BIR Filing Manager — clean start");
    console.log(`Database: ${process.env.DATABASE_URL ?? "(from your .env file)"}`);
    console.log(`Documents folder: ${getStorageRoot()}`);
    const result = await runCleanStart({
      prisma,
      storageRoot: getStorageRoot(),
      io: { print: (l) => console.log(l), ask },
      appPort: appIsClosed ? null : port,
    });
    process.exitCode = result.status === "done" || result.status === "cancelled" ? 0 : 1;
  } finally {
    rl.close();
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("The clean start stopped with an error. Nothing was deleted unless the line above says Done.");
  console.error(err);
  process.exitCode = 1;
});
