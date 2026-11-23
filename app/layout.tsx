// OWNER: Dev 4.
import type { Metadata } from "next";
import { EB_Garamond, Figtree, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { SiteChrome } from "@/components/site/SiteChrome";
import { SiteStoreProvider } from "@/components/site/SiteStore";
import "./globals.css";

const serifFont = EB_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
  fallback: ["EB Garamond", "Georgia", "serif"],
});

const sansFont = Figtree({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
  fallback: ["Figtree", "system-ui", "-apple-system", "sans-serif"],
});

const monoFont = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
  fallback: ["JetBrains Mono", "ui-monospace", "monospace"],
});

export const metadata: Metadata = {
  title: "VERA · Multi-Camera Perceptual Reasoning",
  description: "Grounds conflicting spoken accounts in synchronized multi-angle camera proof.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${serifFont.variable} ${sansFont.variable} ${monoFont.variable}`}>
      <body className="min-h-screen bg-[#08090B] text-[#ECECEC] antialiased selection:bg-emerald-500/30 selection:text-emerald-200">
        <SiteStoreProvider>
          <SiteChrome>{children}</SiteChrome>
        </SiteStoreProvider>
      </body>
    </html>
  );
}
