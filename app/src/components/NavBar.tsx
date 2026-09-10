"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CloseIcon } from "@/components/icons";

const LINKS = [
  { href: "/", label: "Take" },
  { href: "/lp", label: "Provide" },
  { href: "/positions", label: "Positions" },
  { href: "/agents", label: "Agents" },
  { href: "/risk", label: "Risk" },
  { href: "/data", label: "Data" },
] as const;

export function NavBar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close menu when Escape key is pressed
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname?.startsWith(`${href}/`);

  const linkClass = (active: boolean) =>
    `inline-flex items-center h-9 rounded-lg px-3 py-1.5 text-sm font-semibold transition-all focus-visible:ring-2 focus-visible:ring-[var(--base-blue)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] ${
      active
        ? "bg-[var(--base-blue-faint)] text-[var(--base-blue-light)] shadow-xs border border-[var(--base-blue-muted)]"
        : "text-[var(--text-muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--foreground)]"
    }`;

  return (
    <>
      <nav aria-label="Main navigation" className="hidden items-center gap-1 text-sm md:flex">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className={linkClass(isActive(l.href))}>
            {l.label}
          </Link>
        ))}
      </nav>

      <button
        type="button"
        aria-label={open ? "Close navigation menu" : "Open navigation menu"}
        aria-expanded={open}
        aria-controls="mobile-navigation"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--foreground)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--base-blue)] md:hidden cursor-pointer"
      >
        {open ? (
          <CloseIcon size={20} />
        ) : (
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M3 5.5h14M3 10h14M3 14.5h14" />
          </svg>
        )}
      </button>

      {open && (
        <div
          id="mobile-navigation"
          role="region"
          aria-label="Mobile menu"
          className="absolute inset-x-0 top-full z-30 border-b border-[var(--border)] bg-[var(--background)] px-4 py-4 shadow-xl md:hidden animate-in fade-in slide-in-from-top-2 duration-150"
        >
          <nav aria-label="Mobile primary navigation" className="flex flex-col gap-2 text-sm font-medium">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className={`min-h-11 ${linkClass(isActive(l.href))}`}
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </>
  );
}
