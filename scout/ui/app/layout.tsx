import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Scout · Saturday tickets",
  description: "Find, review, and promote family Saturday places. Local only.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        <nav className="nav">
          <span className="brand">
            Scout <span className="muted">· Saturday tickets</span>
          </span>
          <Link href="/">Runs</Link>
          <Link href="/promote">Promote</Link>
          <Link href="/places">Places</Link>
        </nav>
        <main className="page">{children}</main>
      </body>
    </html>
  );
}
