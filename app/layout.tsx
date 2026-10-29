import type { Metadata } from "next";
import Script from "next/script";
import { Heebo } from "next/font/google";
import { SiteNav } from "@/components/SiteNav";
import { THEME_INIT_SCRIPT } from "@/components/ThemeToggle";
import "./globals.css";

const heebo = Heebo({
  subsets: ["hebrew", "latin"],
  variable: "--font-heebo",
});

export const metadata: Metadata = {
  title: "מדלן-בדק | שולחן בירור תלונות",
  description: "כלי לנציגי שירות לבדיקת תלונות לקוחות על נתוני עסקאות",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="he" dir="rtl" suppressHydrationWarning className={`${heebo.variable} h-full antialiased`}>
      <head>
        <Script id="theme-init" strategy="beforeInteractive">{THEME_INIT_SCRIPT}</Script>
      </head>
      <body className="min-h-full flex flex-col font-sans">
        <SiteNav />
        {children}
      </body>
    </html>
  );
}
