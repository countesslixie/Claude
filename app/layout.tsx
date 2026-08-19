import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BIR 8% Practice Manager",
  description: "Local-first filing cycle tracker for 8% income tax clients.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
