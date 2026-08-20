import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-inter",
});

/**
 * Staff-only portal, so it must never be indexed. This is a defence in depth
 * measure alongside robots.ts: search engines have no business here, and an
 * indexed login page invites credential stuffing.
 */
export const metadata: Metadata = {
  title: { default: "eShifa Admin", template: "%s | eShifa Admin" },
  description: "eShifa staff portal for managing callback requests.",
  robots: { index: false, follow: false, nocache: true },
  icons: { icon: "/favicon.ico" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0289E8",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen w-full bg-[#F5F7FA] text-[#444444] font-sans">
        {children}
      </body>
    </html>
  );
}
