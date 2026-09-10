"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowRightIcon,
  CheckIcon,
  CopyIcon,
  OptionHoodBadgeLogo,
} from "@/components/icons";

export default function Deck2Page() {
  const router = useRouter();
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [copied, setCopied] = useState(false);
  const [activePillar, setActivePillar] = useState<number | null>(null);

  const voiceover =
    "Meet OptionHood—a hyper-efficient, non-custodial options protocol built natively on Base. Instead of shared pools, OptionHood introduces isolated per-position custody. Every option is minted into its own dedicated ERC-6551 Token Bound Account. Settle position A, and it is mathematically impossible to touch position B. Every economic term—the strike, expiry, oracle, and venue—is baked directly into the contract's CREATE2 address salt with zero on-chain storage overhead. There are no admin keys, no parameter tampering, and no governance delays.";

  const cues = [
    { time: "0:25 – 0:33", instruction: "Shift to an optimistic, high-energy, authoritative delivery" },
    { time: "0:33 – 0:42", instruction: "Point to the 3 architectural pillars on screen" },
    { time: "0:42 – 0:48", instruction: "Vocal emphasis: 'mathematically impossible to touch position B'" },
    { time: "0:48 – 0:55", instruction: "Highlight 'Zero-Storage Salt' & '147/147 tests verified on Base'" },
  ];

  // Keyboard navigation for clean presentation
  const goToPrev = useCallback(() => {
    router.push("/deck1");
  }, [router]);

  const goToNext = useCallback(() => {
    router.push("/deck3");
  }, [router]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        goToPrev();
      } else if (e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        goToNext();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goToPrev, goToNext]);

  // Rehearsal timer (target 30s)
  useEffect(() => {
    if (!timerRunning) return;
    const interval = setInterval(() => setTimerSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [timerRunning]);

  function copyScript() {
    navigator.clipboard.writeText(voiceover);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const targetDuration = 30;
  const progressPercent = Math.min(100, (timerSeconds / targetDuration) * 100);
  const isOvertime = timerSeconds > targetDuration;

  return (
    <div className="relative w-full bg-[#07080A] text-[#F3F4F6] select-none">
      {/* ========================================================================= */}
      {/* 1. THE PRESENTATION SLIDE (100vh / Full Viewport)                         */}
      {/* Pure presentation view for screen recording — ZERO navigation bar         */}
      {/* ========================================================================= */}
      <section className="relative flex min-h-screen w-full flex-col justify-between px-6 py-6 sm:px-10 sm:py-8 lg:px-12 overflow-hidden">
        {/* Background ambient lighting */}
        <div className="pointer-events-none absolute -top-40 -right-40 h-[500px] w-[500px] rounded-full bg-[#00F0FF]/15 blur-[140px]" />
        <div className="pointer-events-none absolute -bottom-40 -left-40 h-[500px] w-[500px] rounded-full bg-emerald-600/10 blur-[140px]" />

        {/* Slide Top: Clean Brand Header */}
        <div className="relative z-10 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <OptionHoodBadgeLogo size={46} className="shrink-0 shadow-xl drop-shadow-[0_4px_16px_rgba(0,240,255,0.3)]" />
            <div className="flex flex-col">
              <span className="text-xl font-black tracking-tight text-white leading-tight">
                Option<span className="text-[#00F0FF]">Hood</span>
              </span>
              <span className="text-[10px] font-mono tracking-widest text-[#64748B] uppercase mt-0.5">
                Base Options Protocol
              </span>
            </div>
          </div>

          <div className="font-mono text-xs text-[#475569] tracking-widest uppercase">
            02 / 03
          </div>
        </div>

        {/* Main Slide Canvas */}
        <main className="relative z-10 my-auto py-4 flex flex-col justify-center space-y-6 max-w-7xl mx-auto w-full">
          {/* Top Slide Header */}
          <div className="text-center max-w-4xl mx-auto">
            <div className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-[#00F0FF] font-bold mb-2">
              <span className="h-2 w-2 rounded-full bg-[#00F0FF]" />
              Non-Custodial Options Protocol on Base
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-white leading-tight">
              Isolated Custody &amp;{" "}
              <span className="bg-gradient-to-r from-[#00F0FF] via-cyan-300 to-emerald-300 bg-clip-text text-transparent">
                Deterministic Immutability.
              </span>
            </h1>
            <p className="mt-3 text-base sm:text-lg text-[#94A3B8] leading-relaxed max-w-2xl mx-auto font-normal">
              Zero pooled vaults. Zero terms storage. Zero keeper dependencies.
              <span className="text-white font-semibold"> Built on three uncompromising invariants.</span>
            </p>
          </div>

          {/* The 3 Core Invariant Pillars (Slide Style Cards) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
            {/* Pillar 1: Invariant I1 Strict Per-Position Custody */}
            <div
              onMouseEnter={() => setActivePillar(1)}
              onMouseLeave={() => setActivePillar(null)}
              className={`flex flex-col justify-between rounded-2xl border bg-[#101218]/90 p-6 backdrop-blur-md transition-all shadow-xl ${
                activePillar === 1
                  ? "border-[#00F0FF] bg-[#121520] scale-[1.02] shadow-cyan-950/50"
                  : "border-[#252936] hover:border-[#00F0FF]/50"
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-[#00F0FF]/15 border border-[#00F0FF]/30 px-2.5 py-0.5 text-[10px] font-mono font-bold text-[#00F0FF]">
                    INVARIANT I1
                  </span>
                  <span className="text-xs font-mono text-[#64748B]">ERC-6551 TBA</span>
                </div>

                <h2 className="mt-4 text-lg font-bold text-white">
                  Strict Per-Position Custody
                </h2>
                <p className="mt-1.5 text-xs text-[#94A3B8] leading-relaxed">
                  Collateral lives in an account bound 1:1 to one position. Settling position A
                  physically cannot touch position B.
                </p>

                {/* Graphic Diagram */}
                <div className="my-5 rounded-xl border border-[#252936] bg-[#07080A] p-3.5 space-y-2.5 font-mono text-xs">
                  <div className="flex items-center justify-between text-[#94A3B8] text-[11px]">
                    <span>Option NFT (ERC-721)</span>
                    <span className="text-[#60A5FA]">Token #108</span>
                  </div>
                  <div className="flex justify-center text-[#60A5FA] text-xs font-bold">
                    ↓ 1:1 Token Bound Account
                  </div>
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-2.5 text-center">
                    <div className="text-xs font-bold text-emerald-300">
                      `PositionAccount` (Isolated)
                    </div>
                    <div className="text-[10px] text-[#94A3B8] mt-0.5">
                      Collateral: 1.00 WETH ($3,000)
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-t border-[#1E222D] pt-3.5 flex items-center justify-between text-xs">
                <span className="text-[#64748B] font-mono">Blast Radius:</span>
                <span className="font-mono font-bold text-emerald-400">Exactly 1 Position</span>
              </div>
            </div>

            {/* Pillar 2: Invariant I2 Zero-Storage Salt Derivation */}
            <div
              onMouseEnter={() => setActivePillar(2)}
              onMouseLeave={() => setActivePillar(null)}
              className={`flex flex-col justify-between rounded-2xl border bg-[#101218]/90 p-6 backdrop-blur-md transition-all shadow-xl ${
                activePillar === 2
                  ? "border-[#00F0FF] bg-[#121520] scale-[1.02] shadow-cyan-950/50"
                  : "border-[#252936] hover:border-[#00F0FF]/50"
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-[#00F0FF]/15 border border-[#00F0FF]/30 px-2.5 py-0.5 text-[10px] font-mono font-bold text-[#00F0FF]">
                    INVARIANT I2
                  </span>
                  <span className="text-xs font-mono text-[#64748B]">CREATE2 Salt</span>
                </div>

                <h2 className="mt-4 text-lg font-bold text-white">
                  Zero-Storage Determinism
                </h2>
                <p className="mt-1.5 text-xs text-[#94A3B8] leading-relaxed">
                  Every economic term, oracle feed, and venue route is hashed into the CREATE2 salt.
                  Address proves terms on the fly.
                </p>

                {/* Graphic Diagram */}
                <div className="my-5 rounded-xl border border-[#252936] bg-[#07080A] p-3.5 space-y-2 font-mono text-[10px] text-[#94A3B8]">
                  <div className="text-[#00F0FF] font-bold text-[11px]">
                    keccak256(terms, pointers)
                  </div>
                  <div className="pl-2 border-l border-[#252936] space-y-0.5">
                    <div>strike, expiry, collateral</div>
                    <div>oracleFeed, venueAdapter, arbiter</div>
                  </div>
                  <div className="text-center font-bold text-emerald-400 pt-1 text-[11px]">
                    → Deterministic Account Salt
                  </div>
                </div>
              </div>

              <div className="border-t border-[#1E222D] pt-3.5 flex items-center justify-between text-xs">
                <span className="text-[#64748B] font-mono">Storage Overhead:</span>
                <span className="font-mono font-bold text-emerald-400">0 SSTOREs at Mint</span>
              </div>
            </div>

            {/* Pillar 3: Invariant I3 Threshold Auth & Automated Referee */}
            <div
              onMouseEnter={() => setActivePillar(3)}
              onMouseLeave={() => setActivePillar(null)}
              className={`flex flex-col justify-between rounded-2xl border bg-[#101218]/90 p-6 backdrop-blur-md transition-all shadow-xl ${
                activePillar === 3
                  ? "border-[#00F0FF] bg-[#121520] scale-[1.02] shadow-cyan-950/50"
                  : "border-[#252936] hover:border-[#00F0FF]/50"
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-[#00F0FF]/15 border border-[#00F0FF]/30 px-2.5 py-0.5 text-[10px] font-mono font-bold text-[#00F0FF]">
                    INVARIANT I3
                  </span>
                  <span className="text-xs font-mono text-[#64748B]">2-of-3 Authz</span>
                </div>

                <h2 className="mt-4 text-lg font-bold text-white">
                  Stateless Automated Referee
                </h2>
                <p className="mt-1.5 text-xs text-[#94A3B8] leading-relaxed">
                  Takers exercise profitable trades in 1-tx without keeper bots. Oracles broken?
                  Mutual Unwind exits cleanly.
                </p>

                {/* Graphic Diagram */}
                <div className="my-5 rounded-xl border border-[#252936] bg-[#07080A] p-3.5 space-y-2 font-mono text-[10px]">
                  <div className="grid grid-cols-3 gap-1.5 text-center">
                    <div className="rounded bg-[#12141A] p-1.5 border border-[#252936] text-[#94A3B8]">
                      Taker NFT
                    </div>
                    <div className="rounded bg-[#12141A] p-1.5 border border-[#252936] text-[#94A3B8]">
                      LP Maker
                    </div>
                    <div className="rounded bg-[#00F0FF]/20 p-1.5 border border-[#00F0FF]/40 text-[#00F0FF] font-bold">
                      Arbiter
                    </div>
                  </div>
                  <div className="text-center text-[10px] text-emerald-300 font-semibold pt-1">
                    ✓ Taker + Arbiter = 1-Click Exercise
                  </div>
                  <div className="text-center text-[10px] text-amber-300">
                    ✓ LP + Taker = Oracle-Free Unwind
                  </div>
                </div>
              </div>

              <div className="border-t border-[#1E222D] pt-3.5 flex items-center justify-between text-xs">
                <span className="text-[#64748B] font-mono">Keeper Dependency:</span>
                <span className="font-mono font-bold text-emerald-400">Zero Liquidator Bots</span>
              </div>
            </div>
          </div>

          {/* Bottom Proof of Rigor Banner */}
          <div className="rounded-2xl border border-[#252936] bg-[#0E1015] p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3 font-mono text-xs">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-bold text-white">FORK-VERIFIED ON BASE MAINNET</span>
              <span className="text-[#64748B]">•</span>
              <span className="text-[#94A3B8]">Uniswap V3 + Aerodrome Slipstream Adapters</span>
            </div>

            <div className="flex items-center gap-4 font-mono text-xs">
              <div className="flex items-center gap-1.5 text-emerald-400 font-bold">
                <CheckIcon size={14} />
                <span>147/147 Tests Passing</span>
              </div>
              <div className="flex items-center gap-1.5 text-emerald-400 font-bold">
                <CheckIcon size={14} />
                <span>Cancun EVM Pinned</span>
              </div>
              <div className="flex items-center gap-1.5 text-emerald-400 font-bold">
                <CheckIcon size={14} />
                <span>B20 Equities Multiplier Safe</span>
              </div>
            </div>
          </div>
        </main>

        {/* Clean presentation footer info — NO buttons or bars */}
        <div className="relative z-10 flex items-center justify-between text-[11px] font-mono text-[#334155] pt-2">
          <span>OptionHood // Act II</span>
          <span>Scroll down for navigation &amp; teleprompter ↓</span>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* 2. PRESENTER CONTROLS & SCRIPT SECTION (REQUIRES SCROLLING DOWN)          */}
      {/* 100% hidden when at the top of the page recording the slide               */}
      {/* ========================================================================= */}
      <div id="presenter-controls" className="relative z-20 border-t border-[#1E222D] bg-[#0A0B0E]">
        {/* Navigation & Delivery Bar */}
        <div className="border-b border-[#1E222D] bg-[#0D0F14] px-6 py-4 sm:px-10">
          <div className="flex flex-wrap items-center justify-between gap-4 max-w-7xl mx-auto w-full">
            {/* Left: Act Navigation Tabs with Timing Information */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 bg-[#12141A] p-1 rounded-xl border border-[#252936]">
                <Link
                  href="/deck1"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#94A3B8] hover:text-white hover:bg-[#1A1D26] transition-colors"
                >
                  <span>Act I</span>
                  <span className="font-mono text-[11px] opacity-60">0:00 – 0:25 (25s)</span>
                </Link>
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#008FA8] text-white shadow-sm">
                  <span>Act II</span>
                  <span className="font-mono text-[11px] opacity-80">0:25 – 0:55 (30s)</span>
                </div>
                <Link
                  href="/deck3"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#94A3B8] hover:text-white hover:bg-[#1A1D26] transition-colors"
                >
                  <span>Act III</span>
                  <span className="font-mono text-[11px] opacity-60">0:55 – 1:35 (35s)</span>
                </Link>
              </div>

              <span className="font-mono text-xs text-[#64748B] hidden md:inline">
                Slide 02 of 03
              </span>
            </div>

            {/* Right: Pitch Delivery Controls */}
            <div className="flex items-center gap-2 sm:gap-3">
              {/* Practice Timer */}
              <button
                type="button"
                onClick={() => setTimerRunning((v) => !v)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-mono font-medium transition-colors cursor-pointer ${
                  timerRunning
                    ? "border-cyan-500/50 bg-cyan-950/40 text-cyan-300"
                    : "border-[#252936] bg-[#12141A] text-[#94A3B8] hover:text-white"
                }`}
                title="Practice timing this 30s slide"
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    timerRunning ? "bg-cyan-400 animate-ping" : "bg-slate-500"
                  }`}
                />
                <span>{timerRunning ? `${timerSeconds}s / 30s target` : "Rehearse Timing"}</span>
              </button>

              {/* Copy Script Button */}
              <button
                type="button"
                onClick={copyScript}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#252936] bg-[#12141A] hover:bg-[#1A1D26] px-3 py-1.5 text-xs font-mono text-[#94A3B8] hover:text-white transition-colors cursor-pointer"
              >
                {copied ? <CheckIcon size={12} className="text-emerald-400" /> : <CopyIcon size={12} />}
                <span>{copied ? "Copied" : "Copy Script"}</span>
              </button>

              {/* Previous Act Navigation Button */}
              <Link
                href="/deck1"
                className="flex h-8 items-center gap-1.5 rounded-lg border border-[#252936] bg-[#12141A] hover:bg-[#1A1D26] px-3 text-xs font-semibold text-[#94A3B8] hover:text-white transition-all cursor-pointer"
              >
                <span>Act I Slide</span>
              </Link>

              {/* Next Act Navigation Button */}
              <Link
                href="/deck3"
                className="flex h-8 items-center gap-1.5 rounded-lg bg-[#008FA8] hover:bg-[#007D94] px-3.5 text-xs font-semibold text-white shadow-sm transition-all cursor-pointer"
              >
                <span>Act III Slide</span>
                <ArrowRightIcon size={12} />
              </Link>
            </div>
          </div>

          {/* Timer Progress Bar */}
          {timerRunning && (
            <div className="w-full bg-[#12141A] rounded-full h-1 overflow-hidden mt-3 max-w-7xl mx-auto">
              <div
                className={`h-full transition-all duration-300 ${
                  isOvertime ? "bg-red-500" : "bg-[#008FA8]"
                }`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          )}
        </div>

        {/* Presenter Teleprompter Script */}
        <div className="py-12 px-6 sm:px-12 lg:px-16 max-w-5xl mx-auto space-y-8">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#1E222D] pb-5">
            <div>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-[#00F0FF]" />
                <span className="text-xs font-mono font-bold uppercase tracking-widest text-[#00F0FF]">
                  Presenter Teleprompter Script • Act II (0:25 – 0:55)
                </span>
              </div>
              <h2 className="mt-1 text-2xl font-bold text-white">
                Isolated Custody &amp; Deterministic Immutability
              </h2>
              <p className="text-xs text-[#64748B] mt-0.5">
                Target pace: ~150 words per minute (30 seconds total).
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={copyScript}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#252936] bg-[#12141A] hover:bg-[#1A1D26] px-3.5 py-2 text-xs font-semibold text-white transition-colors cursor-pointer"
              >
                {copied ? <CheckIcon size={14} className="text-emerald-400" /> : <CopyIcon size={14} />}
                <span>{copied ? "Copied Script" : "Copy Voiceover"}</span>
              </button>

              <Link
                href="/deck1"
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#252936] bg-[#12141A] hover:bg-[#1A1D26] px-3.5 py-2 text-xs font-semibold text-[#94A3B8] hover:text-white transition-colors"
              >
                <span>← Act I Slide</span>
              </Link>
            </div>
          </div>

          {/* Large Teleprompter Reading Card */}
          <div className="rounded-2xl border border-cyan-500/20 bg-[#07080A] p-6 sm:p-8 shadow-xl">
            <div className="text-xs font-mono uppercase text-[#64748B] font-semibold mb-3">
              Spoken Word-For-Word Voiceover:
            </div>
            <blockquote className="text-lg sm:text-xl md:text-2xl font-normal leading-relaxed text-white">
              &ldquo;Meet <span className="text-[#00F0FF] font-bold">OptionHood</span>—a hyper-efficient, non-custodial
              options protocol built natively on Base. Instead of shared pools, OptionHood introduces{" "}
              <span className="text-emerald-300 font-bold underline decoration-emerald-500/40 underline-offset-4">
                isolated per-position custody
              </span>
              . Every option is minted into its own dedicated{" "}
              <span className="text-emerald-300 font-bold">ERC-6551 Token Bound Account</span>. Settle position A, and it
              is <span className="text-white font-bold underline decoration-[#00F0FF] underline-offset-4">mathematically impossible to touch position B</span>.
              <br className="my-3 block" />
              Every economic term—the strike, expiry, oracle, and venue—is baked directly into the contract&apos;s CREATE2
              address salt with{" "}
              <span className="text-emerald-400 font-bold">zero on-chain storage overhead</span>. There are no admin keys,
              no parameter tampering, and no governance delays.&rdquo;
            </blockquote>
          </div>

          {/* Delivery Cues & Stage Directions Table */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-[#1E222D] bg-[#101218] p-5">
              <h3 className="text-xs font-mono font-bold uppercase text-[#64748B] mb-3">
                Timing &amp; Stage Directions
              </h3>
              <div className="space-y-3">
                {cues.map((cue, idx) => (
                  <div key={idx} className="flex items-start gap-3 text-xs">
                    <span className="font-mono text-[#60A5FA] font-bold shrink-0 bg-blue-950/50 border border-blue-500/30 px-2 py-0.5 rounded">
                      {cue.time}
                    </span>
                    <span className="text-[#94A3B8]">{cue.instruction}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-[#1E222D] bg-[#101218] p-5 flex flex-col justify-between">
              <div>
                <h3 className="text-xs font-mono font-bold uppercase text-[#64748B] mb-3">
                  Pitch Mechanics
                </h3>
                <div className="grid grid-cols-3 gap-2 font-mono text-center mb-3">
                  <div className="rounded-lg bg-[#07080A] p-2 border border-[#252936]">
                    <div className="text-[10px] text-[#64748B]">WORDS</div>
                    <div className="text-base font-bold text-white">76</div>
                  </div>
                  <div className="rounded-lg bg-[#07080A] p-2 border border-[#252936]">
                    <div className="text-[10px] text-[#64748B]">TARGET</div>
                    <div className="text-base font-bold text-blue-400">30s</div>
                  </div>
                  <div className="rounded-lg bg-[#07080A] p-2 border border-[#252936]">
                    <div className="text-[10px] text-[#64748B]">PACING</div>
                    <div className="text-base font-bold text-white">150 WPM</div>
                  </div>
                </div>
              </div>
              <div className="text-[11px] text-[#64748B] border-t border-[#252936] pt-2 font-mono">
                Keyboard control: Press [←] to return to Act I slide.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
