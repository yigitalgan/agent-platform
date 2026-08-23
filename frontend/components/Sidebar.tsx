"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavItem {
  href: string;
  label: string;
  icon: string;
  // "/" must match exactly; others match as a prefix (so /agents/new is active).
  exact?: boolean;
}

const NAV: NavItem[] = [
  { href: "/", label: "Sohbet", icon: "💬", exact: true },
  { href: "/agents", label: "Agent'lar", icon: "🤖" },
  { href: "/workflows", label: "Workflow'lar", icon: "🔗" },
  { href: "/knowledge-bases", label: "Knowledge Base'ler", icon: "📚" },
  { href: "/mcp-servers", label: "MCP Server'lar", icon: "🔌" },
  { href: "/conversations", label: "Konuşmalar", icon: "🗂️" },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-800 bg-slate-900/60 md:flex">
      <div className="px-5 py-6">
        <Link href="/" className="text-lg font-bold tracking-tight">
          Agent Platform
        </Link>
        <p className="mt-1 text-xs text-slate-500">Kod yazmadan AI agent</p>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-3">
        {NAV.map((item) => {
          const active = isActive(pathname, item);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-blue-600/20 font-medium text-blue-200 ring-1 ring-inset ring-blue-700/40"
                  : "text-slate-300 hover:bg-slate-800/70 hover:text-slate-100"
              }`}
            >
              <span aria-hidden className="text-base">
                {item.icon}
              </span>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
