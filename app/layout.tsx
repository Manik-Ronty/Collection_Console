import type { Metadata } from "next";
import { DM_Sans, DM_Mono } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: { default: "HT Pilot", template: "%s · HT Pilot" },
  description: "Collections tracker",
};

// Every load starts light, like the live app; the topbar toggle switches data-theme.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-theme="light" className={`${dmSans.variable} ${dmMono.variable} h-full`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
