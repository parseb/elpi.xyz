"use client";

import { useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  SlideStyles,
  SlideStage,
  Slide3Content,
  SlideNavToolbar,
  PresenterScriptSection,
} from "@/components/slides/SlideComponents";

export default function Slide3Page() {
  const router = useRouter();

  const goToPrev = useCallback(() => {
    router.push("/slide2");
  }, [router]);

  const goToNext = useCallback(() => {
    router.push("/slide4");
  }, [router]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        goToPrev();
      } else if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
        e.preventDefault();
        goToNext();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goToPrev, goToNext]);

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
            <span>// Uniswap v4 Settlement Hook</span>
          </div>
          <div className="tracking-widest uppercase text-[#94A3B8]">
            Slide 03 / 04 • Act III
          </div>
        </div>

        {/* 16:9 Slide Canvas */}
        <div className="my-auto flex items-center justify-center w-full">
          <SlideStage slideIndex={3} showRays={true}>
            <Slide3Content />
          </SlideStage>
        </div>

        {/* Presentation Footer & Scroll Prompt */}
        <div className="w-full max-w-[1320px] flex flex-wrap items-center justify-between gap-3 text-[11px] font-mono text-[#475569] pt-1 pb-1">
          <SlideNavToolbar currentSlide={3} />

          <a
            href="#presenter-controls"
            className="text-[#00F0FF]/80 hover:text-[#00F0FF] transition-colors flex items-center gap-1.5 font-medium cursor-pointer"
          >
            <span>Scroll down for teleprompter script &amp; rehearsal timing</span>
            <span className="text-sm">↓</span>
          </a>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* 2. PRESENTER CONTROLS & SCRIPT SECTION (HIDDEN SCROLL PART)               */}
      {/* Requires scrolling down — 100% invisible during slide recording           */}
      {/* ========================================================================= */}
      <PresenterScriptSection currentSlide={3} />
    </div>
  );
}

