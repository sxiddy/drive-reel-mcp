import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono, Newsreader } from "next/font/google";
import "./globals.css";

// Three departments: condensed grotesk for the poster, serif for the script, mono for the camera report.
const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo" });
const newsreader = Newsreader({ subsets: ["latin"], variable: "--font-newsreader" });
const plex = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono" });

export const metadata: Metadata = {
  title: "It's a Wrap",
  description: "Paste a Google Drive folder. Claude watches every clip, pitches ways to cut it, and delivers a finished film you can edit.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${newsreader.variable} ${plex.variable}`}>
      <body className="min-h-dvh font-sans text-body">{children}</body>
    </html>
  );
}
