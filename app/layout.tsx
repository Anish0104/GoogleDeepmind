// OWNER: Dev 4.
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { SiteChrome } from "@/components/site/SiteChrome";
import { SiteStoreProvider } from "@/components/site/SiteStore";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], weight: ["300", "400", "500", "600", "700"], variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "RASHOMON",
  description: "Checks spoken claims against several synced cameras.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">
        <SiteStoreProvider>
          <SiteChrome>{children}</SiteChrome>
        </SiteStoreProvider>
      </body>
    </html>
  );
}
