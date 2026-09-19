import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agents · Saturday tickets",
  description: "Local agent framework: executions, audit logs, memory, and human stops. Local only.",
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
            Agents <span className="muted">· Saturday tickets</span>
          </span>
          <Link href="/">Inbox</Link>
          <Link href="/agents">Agents</Link>
          <Link href="/tools">Tools</Link>
          <Link href="/memory">Memory</Link>
          <Link href="/places">Places</Link>
        </nav>
        <main className="page">{children}</main>
      </body>
    </html>
  );
}
