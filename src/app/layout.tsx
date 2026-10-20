import type { Metadata } from "next";
import Link from "next/link";
import { Inter, Instrument_Serif } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", variable: "--font-serif" });

export const metadata: Metadata = {
  title: "Drive Reel",
  description: "Videos made by Claude from Google Drive footage. Watch, share and edit.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${serif.variable}`}>
      <body className="min-h-dvh font-sans antialiased">
        <header className="sticky top-0 z-20 border-b border-line/70 bg-ink/80 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
            <Link href="/" className="flex items-center gap-2.5">
              <span className="grid size-7 place-items-center rounded-md bg-brand text-ink">
                <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
                  <path d="M8 5.5v13l10-6.5z" />
                </svg>
              </span>
              <span className="font-display text-xl tracking-tight">Drive Reel</span>
            </Link>
            <span className="hidden text-sm text-muted sm:block">Made by Claude from your Drive footage</span>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
