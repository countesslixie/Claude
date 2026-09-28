import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

/**
 * Brief #5g §3 — Plus Jakarta Sans, committed into the repo
 * (app/fonts/plus-jakarta-sans) rather than loaded from Google via
 * next/font/google, which would call out to the network on every build
 * or dev start (locked rule #7: no outbound requests at runtime) and
 * silently fall back to a plain font when the laptop is offline.
 * next/font/local self-hosts these same files with no network call.
 */
const plusJakartaSans = localFont({
  src: [
    { path: "./fonts/plus-jakarta-sans/plus-jakarta-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/plus-jakarta-sans/plus-jakarta-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/plus-jakarta-sans/plus-jakarta-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/plus-jakarta-sans/plus-jakarta-sans-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-plus-jakarta-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "BIR 8% Practice Manager",
  description: "Local-first filing cycle tracker for 8% income tax clients.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`h-full antialiased ${plusJakartaSans.variable}`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
