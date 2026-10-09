import { z } from "zod";

/**
 * D180 — one client's eAFS and Alphalist logins. Every field is optional text.
 * Only the ends are trimmed; everything inside (spaces, quotes, symbols) is kept
 * exactly as typed, because a password can contain any character. An empty box is
 * stored as nothing (null). Error messages are fixed words — they never echo a value.
 */
const field = (max: number) =>
  z
    .string()
    .max(max, "Too long")
    .transform((v) => v.trim())
    .transform((v) => (v === "" ? null : v));

export const BIR_LOGIN_FIELDS = [
  "eafsUsername",
  "eafsPassword",
  "eafsNotes",
  "alphalistUsername",
  "alphalistPassword",
  "alphalistNotes",
] as const;

export type BirLoginField = (typeof BIR_LOGIN_FIELDS)[number];

export const birLoginSchema = z.object({
  eafsUsername: field(200),
  eafsPassword: field(200),
  eafsNotes: field(1000),
  alphalistUsername: field(200),
  alphalistPassword: field(200),
  alphalistNotes: field(1000),
});

export type BirLoginInput = z.infer<typeof birLoginSchema>;
