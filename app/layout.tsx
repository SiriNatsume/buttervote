import type { Metadata } from "next";
import { Inter, Noto_Sans_SC } from "next/font/google";
import "highlight.js/styles/github.css";
import "./globals.css";
import { AppProviders } from "@/components/app-providers";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const notoSansSc = Noto_Sans_SC({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-noto-sans-sc",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Butter Vote",
  description: "参与提名、投票和活动评选，发现大家共同喜欢的选择。",
  icons: { icon: "/icon.png", apple: "/apple-icon.png" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body
        className={`${inter.variable} ${notoSansSc.variable} flex min-h-screen flex-col`}
      >
        <AppProviders>
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </AppProviders>
      </body>
    </html>
  );
}
