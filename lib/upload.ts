/**
 * D64 (brief #5k §1) — Server Actions reject any request body over
 * next.config.ts's configured limit (25 MB) by throwing Next's own
 * dev-only error overlay ("Body exceeded ... limit"), not a message the
 * bookkeeper can act on. Every upload control (the generic doc slot, step
 * 2's certificate form, and steps 6/7/10's own upload box) checks the
 * file's size client-side BEFORE submitting and shows the plain message
 * below instead, so a too-large file never reaches the server at all.
 * Kept a little under the server's own limit so this message is always
 * the one that fires first, never a race with the server's own rejection.
 */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** null when the file is within bounds; otherwise the plain-language line to show under the file picker. */
export function fileTooLargeMessage(file: File): string | null {
  if (file.size <= MAX_UPLOAD_BYTES) return null;
  const fileMb = (file.size / (1024 * 1024)).toFixed(1);
  const limitMb = Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024));
  return `This file is ${fileMb} MB — the limit is ${limitMb} MB.`;
}
