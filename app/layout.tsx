// OWNER: Dev 4.
import type { Metadata } from "next";
import { EB_Garamond, Figtree, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { SiteChrome } from "@/components/site/SiteChrome";
import { SiteStoreProvider } from "@/components/site/SiteStore";
import { ThemeProvider } from "@/components/site/ThemeContext";
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
    <html lang="en" suppressHydrationWarning className={`${serifFont.variable} ${sansFont.variable} ${monoFont.variable}`}>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('vera-theme')||'dark';document.documentElement.setAttribute('data-theme',t);if(document.body)document.body.setAttribute('data-theme',t);}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-screen antialiased selection:bg-emerald-500/30 selection:text-emerald-300">
        <ThemeProvider>
          <SiteStoreProvider>
            <SiteChrome>{children}</SiteChrome>
          </SiteStoreProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
