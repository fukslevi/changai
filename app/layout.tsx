import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "SOSIMPLE Sourcing",
  description: "RFQ intake, supplier discovery, outreach and quote comparison",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header className="top">
            <h1>
              <Link href="/" style={{ color: "inherit" }}>
                SOSIMPLE Sourcing
              </Link>
            </h1>
            <span className="sub">RFQ → suppliers → quotes</span>
            <Link href="/settings" className="muted" style={{ marginInlineStart: "auto" }}>
              הגדרות
            </Link>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
