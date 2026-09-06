import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Subscription Tracker",
  description: "Upload bank statements, auto-detect subscriptions, track spend",
  manifest: "/manifest.json",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-neutral-950 text-neutral-100 min-h-screen">{children}</body>
    </html>
  );
}
