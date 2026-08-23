import type { Metadata } from "next";
import "./globals.css";
import ConfigBanner from "@/components/ConfigBanner";
import Sidebar from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "Agent Platform",
  description: "Build AI agents without writing code.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">
        <ConfigBanner />
        <div className="flex min-h-screen">
          <Sidebar />
          {/* Content area sits beside the sidebar and scrolls independently. */}
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </body>
    </html>
  );
}
