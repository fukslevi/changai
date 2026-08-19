import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "SOSIMPLE Sourcing",
  description: "RFQ intake, supplier discovery, outreach and quote comparison",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    /*
     * The interface is Hebrew, so the document is Hebrew. English still appears
     * inside it - supplier names, email drafts, prices - and each of those
     * carries its own dir="ltr", which is the right way round: an RTL document
     * with LTR islands, rather than an LTR document that fights every label.
     */
    <html lang="he" dir="rtl">
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
