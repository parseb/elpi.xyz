"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { ElpiLogo } from "@/components/ElpiLogo";
import { NavBar } from "@/components/NavBar";
import { ThemeToggle } from "@/components/ThemeProvider";
import { ConnectButton } from "@/components/ConnectButton";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isDeck = pathname?.startsWith("/deck");

  if (isDeck) {
    return (
      <div className="flex min-h-screen w-full flex-col bg-[var(--background)] text-[var(--foreground)]">
        {children}
      </div>
    );
  }

  return (
    <>
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--background)]/90 px-3 backdrop-blur-md sm:gap-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2 sm:gap-6">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-2 font-bold tracking-tight text-white hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F0FF] focus-visible:rounded-lg"
          >
            <ElpiLogo size="md" showDomain={true} showBadge={false} />
          </Link>
          <NavBar />
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
          <ThemeToggle />
          <ConnectButton />
        </div>
      </header>
      <main
        id="main-content"
        tabIndex={-1}
        className="flex-1 px-4 py-8 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full outline-none"
      >
        {children}
      </main>
    </>
  );
}
