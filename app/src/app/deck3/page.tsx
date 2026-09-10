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

export default function Deck3Page() {
  const router = useRouter();
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [copied, setCopied] = useState(false);
  const [activeStep, setActiveStep] = useState<number | null>(null);

  const voiceover =
    "Here is how simple OptionHood actually is: For Liquidity Providers, there are no complex vaults and no Greeks to manage. You simply sign an off-chain commitment with your acceptable rate and duration. It costs zero gas, and your capital never leaves your wallet. For Takers, you don't calculate complicated volatility math. You just pay the hourly interest for the exact time you need protection. And here's the magic: funds are transferred only when a position is minted. Capital sits safely in the LP's wallet until the very millisecond a taker executes—moving directly into an isolated smart account. Maximum capital efficiency, zero idle lockup, zero protocol custody.";

  const cues = [
    { time: "0:00 – 0:10", instruction: "Confident, engaging hook: 'Here is how simple OptionHood actually is'" },
    { time: "0:10 – 0:20", instruction: "Emphasize LP freedom: 'Zero gas, funds never leave your wallet'" },
    { time: "0:20 – 0:28", instruction: "Highlight taker clarity: 'Just pay the hourly interest for the exact time'" },
    { time: "0:28 – 0:40", instruction: "Hit the punchline: 'Funds transferred ONLY when a position is minted'" },
  ];

  // Keyboard navigation for clean presentation
  const goToPrev = useCallback(() => {
    router.push("/deck2");
  }, [router]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        goToPrev();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goToPrev]);

  // Rehearsal timer (target 35s)
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

  const targetDuration = 35;
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
        <div className="pointer-events-none absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-emerald-600/10 blur-[140px]" />
        <div className="pointer-events-none absolute -bottom-40 -right-40 h-[500px] w-[500px] rounded-full bg-[#00F0FF]/15 blur-[140px]" />

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
            03 / 03
          </div>
        </div>

        {/* Main Slide Canvas */}
        <main className="relative z-10 my-auto py-4 flex flex-col justify-center space-y-7 max-w-7xl mx-auto w-full">
          {/* Top Slide Headline */}
          <div className="text-center max-w-4xl mx-auto">
            <div className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-emerald-400 font-bold mb-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Maximum Capital Efficiency
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-white leading-tight">
              Radical Simplicity.{" "}
              <span className="bg-gradient-to-r from-emerald-300 via-[#00F0FF] to-cyan-300 bg-clip-text text-transparent">
                Just-In-Time Liquidity.
              </span>
            </h1>
            <p className="mt-3 text-base sm:text-lg text-[#94A3B8] leading-relaxed max-w-2xl mx-auto font-normal">
              No idle vault lockups. No volatile Greeks.{" "}
              <span className="text-white font-semibold">Funds move only at the exact instant of trade execution.</span>
            </p>
          </div>

          {/* 3 Step Visual Flow */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-1">
            {/* Step 1: LPs Sign Commitments */}
            <div
              onMouseEnter={() => setActiveStep(1)}
              onMouseLeave={() => setActiveStep(null)}
              className={`flex flex-col justify-between rounded-2xl border bg-[#101218]/90 p-6 backdrop-blur-md transition-all shadow-xl ${
                activeStep === 1
                  ? "border-[#00F0FF] bg-[#121520] scale-[1.02] shadow-cyan-950/50"
                  : "border-[#252936] hover:border-[#00F0FF]/50"
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-[#00F0FF]/15 border border-[#00F0FF]/30 px-2.5 py-0.5 text-[10px] font-mono font-bold text-[#00F0FF]">
                    STEP 01 • LP MAKER
                  </span>
                  <span className="text-xs font-mono text-[#64748B]">$0.00 Gas</span>
                </div>

                <h2 className="mt-4 text-lg font-bold text-white">
                  LPs Just Sign Commitments
                </h2>
                <p className="mt-1.5 text-xs text-[#94A3B8] leading-relaxed">
                  LPs define their acceptable duration, rate, and capacity off-chain. No capital is locked in advance.
                </p>

                {/* Graphic Diagram */}
                <div className="my-5 rounded-xl border border-[#252936] bg-[#07080A] p-4 space-y-2.5 font-mono text-xs">
                  <div className="flex items-center justify-between text-[#94A3B8] text-[11px]">
                    <span>LP Wallet</span>
                    <span className="text-emerald-400 font-bold">100% In Custody</span>
                  </div>
                  <div className="rounded-lg border border-[#00F0FF]/30 bg-[#00F0FF]/10 p-2 text-center text-[#00F0FF] font-bold text-[11px]">
                    ✍️ EIP-712 Typed Signature
                  </div>
                  <div className="text-[10px] text-center text-[#64748B]">
                    Duration: 24h–168h • Rate: $0.05/hr
                  </div>
                </div>
              </div>

              <div className="border-t border-[#1E222D] pt-3.5 flex items-center justify-between text-xs">
                <span className="text-[#64748B] font-mono">Idle Capital Lock:</span>
                <span className="font-mono font-bold text-emerald-400">Zero Lockup</span>
              </div>
            </div>

            {/* Step 2: Takers Just Pay Interest */}
            <div
              onMouseEnter={() => setActiveStep(2)}
              onMouseLeave={() => setActiveStep(null)}
              className={`flex flex-col justify-between rounded-2xl border bg-[#101218]/90 p-6 backdrop-blur-md transition-all shadow-xl ${
                activeStep === 2
                  ? "border-emerald-500 bg-[#10161a] scale-[1.02] shadow-emerald-950/50"
                  : "border-[#252936] hover:border-emerald-500/50"
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-emerald-950/50 border border-emerald-500/30 px-2.5 py-0.5 text-[10px] font-mono font-bold text-emerald-300">
                    STEP 02 • TAKER
                  </span>
                  <span className="text-xs font-mono text-[#64748B]">Pure Borrow Math</span>
                </div>

                <h2 className="mt-4 text-lg font-bold text-white">
                  Takers Just Pay Interest
                </h2>
                <p className="mt-1.5 text-xs text-[#94A3B8] leading-relaxed">
                  No Black-Scholes headache or hidden spreads. Takers rent protection for the exact duration they select.
                </p>

                {/* Graphic Diagram */}
                <div className="my-5 rounded-xl border border-[#252936] bg-[#07080A] p-4 space-y-2.5 font-mono text-xs">
                  <div className="flex items-center justify-between text-[#94A3B8] text-[11px]">
                    <span>Interactive 2D Chart</span>
                    <span className="text-[#60A5FA]">Drag &amp; Select</span>
                  </div>
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-2 text-center text-emerald-300 font-bold text-[11px]">
                    Premium = Units × Rate × Hours
                  </div>
                  <div className="text-[10px] text-center text-[#64748B]">
                    Example: 10 Units × 24h = $12.00
                  </div>
                </div>
              </div>

              <div className="border-t border-[#1E222D] pt-3.5 flex items-center justify-between text-xs">
                <span className="text-[#64748B] font-mono">Pricing Model:</span>
                <span className="font-mono font-bold text-emerald-400">Fixed Transparent Rate</span>
              </div>
            </div>

            {/* Step 3: Just-In-Time Transfer */}
            <div
              onMouseEnter={() => setActiveStep(3)}
              onMouseLeave={() => setActiveStep(null)}
              className={`flex flex-col justify-between rounded-2xl border bg-[#101218]/90 p-6 backdrop-blur-md transition-all shadow-xl ${
                activeStep === 3
                  ? "border-[#00F0FF] bg-[#121520] scale-[1.02] shadow-cyan-950/50"
                  : "border-[#252936] hover:border-[#00F0FF]/50"
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-[#00F0FF]/15 border border-[#00F0FF]/30 px-2.5 py-0.5 text-[10px] font-mono font-bold text-[#00F0FF]">
                    STEP 03 • SETTLEMENT
                  </span>
                  <span className="text-xs font-mono text-[#64748B]">1 Atomic Tx</span>
                </div>

                <h2 className="mt-4 text-lg font-bold text-white">
                  Funds Move Only At Mint
                </h2>
                <p className="mt-1.5 text-xs text-[#94A3B8] leading-relaxed">
                  Collateral transfers directly from the LP wallet into the isolated `PositionAccount` at the instant of mint.
                </p>

                {/* Graphic Diagram */}
                <div className="my-5 rounded-xl border border-[#252936] bg-[#07080A] p-4 space-y-2.5 font-mono text-xs">
                  <div className="flex items-center justify-between text-[#94A3B8] text-[11px]">
                    <span>LP Wallet</span>
                    <span className="text-[#00F0FF]">→ Atomic Pull →</span>
                    <span>TBA</span>
                  </div>
                  <div className="rounded-lg border border-[#00F0FF]/30 bg-[#00F0FF]/10 p-2 text-center text-white font-bold text-[11px]">
                    Isolated ERC-6551 Account
                  </div>
                  <div className="text-[10px] text-center text-emerald-400 font-semibold">
                    Protocol Never Touches Custody
                  </div>
                </div>
              </div>

              <div className="border-t border-[#1E222D] pt-3.5 flex items-center justify-between text-xs">
                <span className="text-[#64748B] font-mono">Custody Risk:</span>
                <span className="font-mono font-bold text-emerald-400">Zero Pooled Custody</span>
              </div>
            </div>
          </div>

          {/* Bottom Summary Strip */}
          <div className="rounded-2xl border border-[#252936] bg-[#0E1015] p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3 font-mono text-xs">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-bold text-white">THE OPTIONHOOD ADVANTAGE</span>
              <span className="text-[#64748B]">•</span>
              <span className="text-[#94A3B8]">Passive yield for makers, transparent leverage for takers</span>
            </div>

            <div className="flex items-center gap-4 font-mono text-xs">
              <div className="flex items-center gap-1.5 text-emerald-400 font-bold">
                <CheckIcon size={14} />
                <span>Zero-Gas Quoting</span>
              </div>
              <div className="flex items-center gap-1.5 text-emerald-400 font-bold">
                <CheckIcon size={14} />
                <span>Just-In-Time Collateral</span>
              </div>
              <div className="flex items-center gap-1.5 text-emerald-400 font-bold">
                <CheckIcon size={14} />
                <span>Non-Custodial Settlement</span>
              </div>
            </div>
          </div>
        </main>

        {/* Clean presentation footer info — NO buttons or bars */}
        <div className="relative z-10 flex items-center justify-between text-[11px] font-mono text-[#334155] pt-2">
          <span>OptionHood // Act III</span>
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
                <Link
                  href="/deck2"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#94A3B8] hover:text-white hover:bg-[#1A1D26] transition-colors"
                >
                  <span>Act II</span>
                  <span className="font-mono text-[11px] opacity-60">0:25 – 0:55 (30s)</span>
                </Link>
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#008FA8] text-white shadow-sm">
                  <span>Act III</span>
                  <span className="font-mono text-[11px] opacity-80">0:55 – 1:35 (35s)</span>
                </div>
              </div>

              <span className="font-mono text-xs text-[#64748B] hidden md:inline">
                Slide 03 of 03
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
                    ? "border-emerald-500/50 bg-emerald-950/40 text-emerald-300"
                    : "border-[#252936] bg-[#12141A] text-[#94A3B8] hover:text-white"
                }`}
                title="Practice timing this 35s slide"
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    timerRunning ? "bg-emerald-400 animate-ping" : "bg-slate-500"
                  }`}
                />
                <span>{timerRunning ? `${timerSeconds}s / 35s target` : "Rehearse Timing"}</span>
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
                href="/deck2"
                className="flex h-8 items-center gap-1.5 rounded-lg border border-[#252936] bg-[#12141A] hover:bg-[#1A1D26] px-3 text-xs font-semibold text-[#94A3B8] hover:text-white transition-all cursor-pointer"
              >
                <span>Act II Slide</span>
              </Link>

              {/* Launch App Link */}
              <Link
                href="/"
                className="flex h-8 items-center gap-1 rounded-lg bg-[#008FA8] hover:bg-[#007D94] px-3 text-xs font-semibold text-white shadow-sm transition-all cursor-pointer"
              >
                <span>Live App</span>
                <ArrowRightIcon size={12} />
              </Link>
            </div>
          </div>

          {/* Timer Progress Bar */}
          {timerRunning && (
            <div className="w-full bg-[#12141A] rounded-full h-1 overflow-hidden mt-3 max-w-7xl mx-auto">
              <div
                className={`h-full transition-all duration-300 ${
                  isOvertime ? "bg-red-500" : "bg-emerald-500"
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
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                <span className="text-xs font-mono font-bold uppercase tracking-widest text-emerald-400">
                  Presenter Teleprompter Script • Act III (0:55 – 1:35)
                </span>
              </div>
              <h2 className="mt-1 text-2xl font-bold text-white">
                The Simplicity Pitch: Just-In-Time Execution
              </h2>
              <p className="text-xs text-[#64748B] mt-0.5">
                Target pace: ~140 words per minute (35 seconds total). Positioned below slide for clean browser recording.
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
                href="/deck2"
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#252936] bg-[#12141A] hover:bg-[#1A1D26] px-3.5 py-2 text-xs font-semibold text-[#94A3B8] hover:text-white transition-colors"
              >
                <span>← Act II Script</span>
              </Link>
            </div>
          </div>

          {/* Large Teleprompter Reading Card */}
          <div className="rounded-2xl border border-emerald-500/20 bg-[#07080A] p-6 sm:p-8 shadow-xl">
            <div className="text-xs font-mono uppercase text-[#64748B] font-semibold mb-3">
              Spoken Word-For-Word Voiceover:
            </div>
            <blockquote className="text-lg sm:text-xl md:text-2xl font-normal leading-relaxed text-white">
              &ldquo;Here is how simple OptionHood actually is:
              <br className="my-2 block" />
              For <span className="text-[#00F0FF] font-bold">Liquidity Providers</span>, there are no complex vaults and no Greeks to manage.
              You simply <span className="text-white font-bold underline decoration-[#00F0FF] underline-offset-4">sign an off-chain commitment</span> with
              your acceptable rate and duration. It costs <span className="text-emerald-400 font-bold">zero gas</span>, and your capital never leaves your wallet.
              <br className="my-2 block" />
              For <span className="text-emerald-300 font-bold">Takers</span>, you don&apos;t calculate complicated volatility math. You{" "}
              <span className="text-white font-bold underline decoration-emerald-500/40 underline-offset-4">just pay the hourly interest</span> for the exact
              time you need protection.
              <br className="my-2 block" />
              And here&apos;s the magic: <span className="text-amber-300 font-bold">funds are transferred only when a position is minted</span>. Capital sits safely
              in the LP&apos;s wallet until the very millisecond a taker executes—moving directly into an isolated smart account. Maximum capital efficiency,
              zero idle lockup, zero protocol custody.&rdquo;
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
                    <span className="font-mono text-emerald-400 font-bold shrink-0 bg-emerald-950/50 border border-emerald-500/30 px-2 py-0.5 rounded">
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
                    <div className="text-base font-bold text-white">98</div>
                  </div>
                  <div className="rounded-lg bg-[#07080A] p-2 border border-[#252936]">
                    <div className="text-[10px] text-[#64748B]">TARGET</div>
                    <div className="text-base font-bold text-emerald-400">35s</div>
                  </div>
                  <div className="rounded-lg bg-[#07080A] p-2 border border-[#252936]">
                    <div className="text-[10px] text-[#64748B]">PACING</div>
                    <div className="text-base font-bold text-white">140 WPM</div>
                  </div>
                </div>
              </div>
              <div className="text-[11px] text-[#64748B] border-t border-[#252936] pt-2 font-mono">
                Transition to App Demo: Switch browser tab to / to demonstrate live Market Depth Chart and Execution Cockpit.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
