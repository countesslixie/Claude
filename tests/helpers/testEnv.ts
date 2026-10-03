/** D177 — this test file's own throwaway document folder (never the real storage/). */
export function testStorageRoot(): string {
  const root = process.env.BIR_STORAGE_ROOT;
  if (!root) throw new Error("BIR_STORAGE_ROOT is not set: tests/setupEnv.ts did not run.");
  return root;
}
