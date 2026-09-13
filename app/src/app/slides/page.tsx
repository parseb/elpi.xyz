"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  SlideStyles,
  SlideStage,
  Slide1Content,
  Slide2Content,
  Slide3Content,
  Slide4Content,
  PresenterScriptSection,
} from "@/components/slides/SlideComponents";

export default function SlidesDeckPage() {
  const [currentSlide, setCurrentSlide] = useState(1);
  const totalSlides = 4;

  const goToPrev = useCallback(() => {
    setCurrentSlide((prev) => (prev > 1 ? prev - 1 : prev));
  }, []);

  const goToNext = useCallback(() => {
    setCurrentSlide((prev) => (prev < totalSlides ? prev + 1 : prev));
  }, [totalSlides]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        goToPrev();
      } else if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
        e.preventDefault();
        goToNext();
      } else if (e.key === "1") {
        setCurrentSlide(1);
      } else if (e.key === "2") {
        setCurrentSlide(2);
      } else if (e.key === "3") {
        setCurrentSlide(3);
      } else if (e.key === "4") {
        setCurrentSlide(4);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goToPrev, goToNext]);

  return (
    <div className="relative w-full bg-[#07090E] text-[#F8FAFC]">
      <SlideStyles />

      {/* Screen Presentation Mode: shows only current slide in 100vh */}
      <div className="print:hidden w-full flex flex-col items-center">
        {/* ========================================================================= */}
        {/* 1. THE PRESENTATION SLIDE (100vh Viewport)                                */}
        {/* Clean presentation canvas for screen recording & full-screen viewing       */}
        {/* ========================================================================= */}
        <section className="relative min-h-screen w-full flex flex-col justify-between items-center px-3 py-4 sm:px-6 sm:py-5 overflow-hidden">
          {/* Subtle Brand Header */}
          <div className="w-full max-w-[1320px] flex items-center justify-between text-xs font-mono text-[#64748B]">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[#00F0FF]" />
              <span className="font-bold text-white tracking-tight">elpi.xyz</span>
              <span>// Continuous Options Deck</span>
            </div>
            <div className="tracking-widest uppercase text-[#94A3B8]">
              Slide 0{currentSlide} / 0{totalSlides} • Act {currentSlide}
            </div>
          </div>

          {/* 16:9 Slide Canvas */}
          <div className="my-auto flex items-center justify-center w-full">
            {currentSlide === 1 && (
              <SlideStage slideIndex={1} totalSlides={totalSlides} showRays={true}>
                <Slide1Content />
              </SlideStage>
            )}
            {currentSlide === 2 && (
              <SlideStage slideIndex={2} totalSlides={totalSlides}>
                <Slide2Content />
              </SlideStage>
            )}
            {currentSlide === 3 && (
              <SlideStage slideIndex={3} totalSlides={totalSlides} showRays={true}>
                <Slide3Content />
              </SlideStage>
            )}
            {currentSlide === 4 && (
              <SlideStage slideIndex={4} totalSlides={totalSlides}>
                <Slide4Content />
              </SlideStage>
            )}
          </div>

          {/* Deck Navigation Toolbar & Scroll Prompt */}
          <div className="w-full max-w-[1320px] flex flex-wrap items-center justify-between gap-3 text-[11px] font-mono text-[#475569] pt-1 pb-1">
            <nav aria-label="Deck controls" className="flex items-center gap-2 text-xs font-mono text-[#94A3B8]">
              <button
                onClick={goToPrev}
                disabled={currentSlide <= 1}
                className="rounded border border-[#1E2838] bg-[#0D121B] px-3 py-1.5 hover:border-[#00F0FF] hover:text-white transition-colors disabled:opacity-40 disabled:hover:border-[#1E2838] cursor-pointer disabled:cursor-not-allowed"
              >
                ← Prev
              </button>

              <div className="flex items-center gap-1.5 px-1">
                {Array.from({ length: totalSlides }, (_, i) => i + 1).map((num) => (
                  <button
                    key={num}
                    onClick={() => setCurrentSlide(num)}
                    className={`flex h-7 w-7 items-center justify-center rounded-full transition-all cursor-pointer ${
                      num === currentSlide
                        ? "bg-[#00F0FF] text-[#07090E] font-bold shadow-[0_0_10px_rgba(0,240,255,0.4)]"
                        : "border border-[#1E2838] bg-[#0D121B] text-[#94A3B8] hover:border-[#00F0FF] hover:text-white"
                    }`}
                  >
                    {num}
                  </button>
                ))}
              </div>

              <button
                onClick={goToNext}
                disabled={currentSlide >= totalSlides}
                className="rounded border border-[#1E2838] bg-[#0D121B] px-3 py-1.5 hover:border-[#00F0FF] hover:text-white transition-colors disabled:opacity-40 disabled:hover:border-[#1E2838] cursor-pointer disabled:cursor-not-allowed"
              >
                Next →
              </button>

              <div className="h-4 w-[1px] bg-[#1E2838] mx-1" />

              <Link
                href={`/slide${currentSlide}`}
                className="rounded border border-[#1E2838] bg-[#0D121B] px-3 py-1.5 hover:border-[#00F0FF] hover:text-white transition-colors"
              >
                Direct URL
              </Link>

              <button
                onClick={() => window.print()}
                className="rounded border border-[#1E2838] bg-[#0D121B] px-3 py-1.5 hover:border-[#00F0FF] hover:text-white transition-colors cursor-pointer"
                title="Print or Save All 4 Slides as 16:9 PDF"
              >
                Print Deck (PDF)
              </button>
            </nav>

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
        <PresenterScriptSection
          currentSlide={currentSlide}
          totalSlides={totalSlides}
          onSelectSlide={setCurrentSlide}
          className="w-full"
        />
      </div>

      {/* Print Mode: prints all 4 slides each on a dedicated 16:9 page */}
      <div className="hidden print:block w-full">
        <SlideStage slideIndex={1} totalSlides={totalSlides} showRays={true}>
          <Slide1Content />
        </SlideStage>
        <SlideStage slideIndex={2} totalSlides={totalSlides}>
          <Slide2Content />
        </SlideStage>
        <SlideStage slideIndex={3} totalSlides={totalSlides} showRays={true}>
          <Slide3Content />
        </SlideStage>
        <SlideStage slideIndex={4} totalSlides={totalSlides}>
          <Slide4Content />
        </SlideStage>
      </div>
    </div>
  );
}

