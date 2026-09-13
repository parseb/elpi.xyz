"use client";

import { useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  SlideStyles,
  SlideStage,
  Slide1Content,
  SlideNavToolbar,
  PresenterScriptSection,
} from "@/components/slides/SlideComponents";

export default function Slide1Page() {
  const router = useRouter();

  const goToNext = useCallback(() => {
    router.push("/slide2");
  }, [router]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
        e.preventDefault();
        goToNext();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goToNext]);

  return (
    <div className="relative w-full bg-[#07090E] text-[#F8FAFC]">
      <SlideStyles />

      {/* ========================================================================= */}
      {/* 1. THE PRESENTATION SLIDE (100vh Viewport)                                */}
      {/* Screen presentation view for recording — zero distracting presenter UI   */}
      {/* ========================================================================= */}
      <section className="relative min-h-screen w-full flex flex-col justify-between items-center px-3 py-4 sm:px-6 sm:py-5 overflow-hidden">
        {/* Subtle Brand Header */}
        <div className="w-full max-w-[1320px] flex items-center justify-between text-xs font-mono text-[#64748B]">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#00F0FF]" />
            <span className="font-bold text-white tracking-tight">elpi.xyz</span>
            <span>// EVM Continuous Options</span>
          </div>
          <div className="tracking-widest uppercase text-[#94A3B8]">
            Slide 01 / 04 • Act I
          </div>
        </div>

        {/* 16:9 Slide Canvas */}
        <div className="my-auto flex items-center justify-center w-full">
          <SlideStage slideIndex={1} showRays={true}>
            <Slide1Content />
          </SlideStage>
        </div>

          {/* Invisible spacer balancing header height for vertical centering during window capture */}
          <div className="w-full max-w-[1320px] h-4 invisible pointer-events-none" aria-hidden="true" />
        </section>

        {/* ========================================================================= */}
        {/* 2. PRESENTER CONTROLS & SCRIPT SECTION (HIDDEN SCROLL PART)               */}
        {/* Requires scrolling down — 100% invisible during slide recording           */}
        {/* ========================================================================= */}
        <PresenterScriptSection currentSlide={1} />

        {/* ========================================================================= */}
        {/* 3. DECK CONTROLS & NAVIGATION FOOTER (MOVED LAST — VISIBLE ON SCROLL)     */}
        {/* ========================================================================= */}
        <footer className="w-full border-t border-[#1E2838] bg-[#07090E] py-5 px-4 sm:px-6">
          <div className="w-full max-w-[1320px] mx-auto flex flex-wrap items-center justify-between gap-4 text-xs font-mono text-[#94A3B8] sm:pr-48">
            <SlideNavToolbar currentSlide={1} />

            <button
              type="button"
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              className="text-[#00F0FF]/80 hover:text-[#00F0FF] transition-colors flex items-center gap-1.5 font-medium cursor-pointer"
            >
              <span>↑ Back to slide top</span>
            </button>
          </div>
        </footer>
      </div>
  );
}

