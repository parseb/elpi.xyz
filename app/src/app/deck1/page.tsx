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

export default function Deck1Page() {
  const router = useRouter();
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [copied, setCopied] = useState(false);

  const voiceover =
    "DeFi options have a structural flaw. Today, almost every options protocol pools user collateral into monolithic vaults. A single bad debt event, math bug, or oracle failure doesn't just hurt one trade—it drains the entire protocol. Worse, when oracles break or liquidity dries up, user funds get locked indefinitely behind governance votes and admin rescue keys. DeFi options need institutional security without institutional trust.";

  const cues = [
    { time: "0:00 – 0:08", instruction: "Open with a serious, high-conviction delivery" },
    { time: "0:08 – 0:15", instruction: "Point towards the red contagion attack vectors on the diagram" },
    { time: "0:15 – 0:20", instruction: "Vocal emphasis: 'drains the ENTIRE protocol'" },
    { time: "0:20 – 0:25", instruction: "Punch the closing thesis: 'institutional security without institutional trust'" },
  ];

  // Keyboard navigation for clean presentation
  const goToNext = useCallback(() => {
    router.push("/deck2");
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

  // Rehearsal timer (target 25s)
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

  const targetDuration = 25;
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
        <div className="pointer-events-none absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-red-600/10 blur-[140px]" />
        <div className="pointer-events-none absolute -bottom-40 -right-40 h-[500px] w-[500px] rounded-full bg-amber-600/10 blur-[140px]" />

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
            01 / 03
          </div>
        </div>

        {/* Main Slide Canvas */}
        <main className="relative z-10 my-auto py-4 grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch max-w-7xl mx-auto w-full">
          {/* Left Column: Huge Headline + Core Flaw Cards */}
          <div className="lg:col-span-6 flex flex-col justify-between space-y-6">
            <div>
              <div className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-red-400 font-bold mb-3">
                <span className="h-2 w-2 rounded-full bg-red-500" />
                Structural Architectural Flaw
              </div>
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-white leading-[1.12]">
                DeFi Options Have a <br className="hidden sm:inline" />
                <span className="bg-gradient-to-r from-red-400 via-rose-300 to-amber-300 bg-clip-text text-transparent">
                  Monolithic Vault
                </span>{" "}
                Problem.
              </h1>
              <p className="mt-4 text-base sm:text-lg text-[#94A3B8] leading-relaxed max-w-xl font-normal">
                When user collateral is pooled into a single monolithic vault, an oracle glitch, math
                rounding bug, or liquidation delay doesn&apos;t just hurt one trade—
                <span className="text-white font-semibold"> it cascades into total protocol insolvency.</span>
              </p>
            </div>

            {/* 3 Presentation Flaw Pillars */}
            <div className="space-y-3 pt-2">
              <div className="flex items-start gap-3.5 rounded-xl border border-[#252936] bg-[#101218]/90 p-4 transition-all hover:border-red-500/40">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-red-950/70 border border-red-500/30 text-red-400 font-mono font-bold text-xs">
                  01
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white">Unbounded Blast Radius</h2>
                  <p className="text-xs text-[#94A3B8] mt-0.5 leading-relaxed">
                    No counterparty isolation. An exploit or liquidation lag in Trade #42 drains
                    innocent LP capital parked in Trades #1 through #41.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3.5 rounded-xl border border-[#252936] bg-[#101218]/90 p-4 transition-all hover:border-amber-500/40">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-950/70 border border-amber-500/30 text-amber-400 font-mono font-bold text-xs">
                  02
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white">Custodial &amp; Oracle Traps</h2>
                  <p className="text-xs text-[#94A3B8] mt-0.5 leading-relaxed">
                    When oracles desync or venue pools dry up, contracts enter deadlocks. Users wait
                    days for emergency DAO governance votes to rescue funds.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3.5 rounded-xl border border-[#252936] bg-[#101218]/90 p-4 transition-all hover:border-slate-500/40">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-800/70 border border-slate-700 text-slate-300 font-mono font-bold text-xs">
                  03
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white">Admin Keys &amp; Upgradability Risks</h2>
                  <p className="text-xs text-[#94A3B8] mt-0.5 leading-relaxed">
                    Mutable proxies and privileged multisig keys create regulatory and counterparty
                    backdoors, abandoning true decentralization.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Large High-Impact Diagram */}
          <div className="lg:col-span-6 flex flex-col justify-center rounded-2xl border border-red-500/30 bg-gradient-to-b from-[#131016] to-[#0D0B10] p-6 sm:p-8 relative shadow-2xl overflow-hidden">
            {/* Subtle red warning grid overlay */}
            <div className="absolute inset-0 bg-[radial-gradient(#ef4444_1px,transparent_1px)] [background-size:16px_16px] opacity-10 pointer-events-none" />

            <div className="relative z-10 flex items-center justify-between border-b border-red-500/20 pb-3 mb-6">
              <span className="text-xs font-mono font-bold tracking-wider text-red-400 uppercase flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-red-500 animate-ping" />
                Legacy Pooled Architecture Failure
              </span>
              <span className="text-[11px] font-mono text-[#64748B]">`SharedVault.sol` ($50M TVL)</span>
            </div>

            {/* 4 Contagion Shock Vectors */}
            <div className="relative z-10 grid grid-cols-2 gap-3 mb-5">
              <div className="rounded-xl border border-red-500/40 bg-red-950/30 p-3 text-center">
                <div className="text-lg">⚡</div>
                <div className="text-xs font-bold text-red-200 mt-1">Oracle Deviation</div>
                <div className="text-[10px] text-[#94A3B8]">Stale / Front-run print</div>
              </div>
              <div className="rounded-xl border border-red-500/40 bg-red-950/30 p-3 text-center">
                <div className="text-lg">💥</div>
                <div className="text-xs font-bold text-red-200 mt-1">Math / Rounding Bug</div>
                <div className="text-[10px] text-[#94A3B8]">1-wei share manipulation</div>
              </div>
              <div className="rounded-xl border border-red-500/40 bg-red-950/30 p-3 text-center">
                <div className="text-lg">📉</div>
                <div className="text-xs font-bold text-red-200 mt-1">Bad Debt Cascade</div>
                <div className="text-[10px] text-[#94A3B8]">Undercollateralized pool</div>
              </div>
              <div className="rounded-xl border border-red-500/40 bg-red-950/30 p-3 text-center">
                <div className="text-lg">⏳</div>
                <div className="text-xs font-bold text-red-200 mt-1">Liquidation Halt</div>
                <div className="text-[10px] text-[#94A3B8]">L1 gas spike desync</div>
              </div>
            </div>

            {/* Inward Arrows */}
            <div className="relative z-10 text-center text-xs font-mono font-bold text-red-400 mb-3 flex items-center justify-center gap-2">
              <span>↓ Contagion Attacks Convergence ↓</span>
            </div>

            {/* Central Vulnerable Shared Pot */}
            <div className="relative z-10 rounded-2xl border-2 border-dashed border-red-500/60 bg-red-950/40 p-5 text-center shadow-inner">
              <div className="inline-block rounded-full bg-red-500/20 border border-red-500/50 px-3 py-1 text-xs font-mono font-bold text-red-200 mb-3">
                SHARED POOLED COLLATERAL (ZERO ISOLATION)
              </div>

              <div className="grid grid-cols-4 gap-2 font-mono text-[11px] text-center">
                <div className="rounded-lg bg-[#07080A] p-2 border border-red-500/30 text-red-300 line-through">
                  LP Alpha<br />$12.5M
                </div>
                <div className="rounded-lg bg-[#07080A] p-2 border border-red-500/30 text-red-300 line-through">
                  LP Beta<br />$18.0M
                </div>
                <div className="rounded-lg bg-[#07080A] p-2 border border-red-500/30 text-red-300 line-through">
                  LP Gamma<br />$9.5M
                </div>
                <div className="rounded-lg bg-[#07080A] p-2 border border-red-500/30 text-red-300 line-through">
                  Takers<br />$10.0M
                </div>
              </div>

              <div className="mt-4 rounded-lg bg-red-500/20 border border-red-500/40 p-2 text-xs font-bold text-red-200">
                Protocol Outcome: Total Capital Contagion &amp; Drained Balances
              </div>
            </div>

            {/* Bottom Shock Statistics */}
            <div className="relative z-10 grid grid-cols-3 gap-3 border-t border-red-500/20 pt-4 mt-5 text-center">
              <div>
                <div className="text-[10px] font-mono uppercase text-[#94A3B8]">Contagion Risk</div>
                <div className="text-xl font-mono font-black text-red-400">100%</div>
              </div>
              <div>
                <div className="text-[10px] font-mono uppercase text-[#94A3B8]">Blast Radius</div>
                <div className="text-xl font-mono font-black text-red-400">Unlimited</div>
              </div>
              <div>
                <div className="text-[10px] font-mono uppercase text-[#94A3B8]">Custodial Model</div>
                <div className="text-xl font-mono font-black text-red-400">Pooled</div>
              </div>
            </div>
          </div>
        </main>

        {/* Clean presentation footer info — NO buttons or bars */}
        <div className="relative z-10 flex items-center justify-between text-[11px] font-mono text-[#334155] pt-2">
          <span>OptionHood // Act I</span>
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
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#008FA8] text-white shadow-sm">
                  <span>Act I</span>
                  <span className="font-mono text-[11px] opacity-80">0:00 – 0:25 (25s)</span>
                </div>
                <Link
                  href="/deck2"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#94A3B8] hover:text-white hover:bg-[#1A1D26] transition-colors"
                >
                  <span>Act II</span>
                  <span className="font-mono text-[11px] opacity-60">0:25 – 0:55 (30s)</span>
                </Link>
                <Link
                  href="/deck3"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#94A3B8] hover:text-white hover:bg-[#1A1D26] transition-colors"
                >
                  <span>Act III</span>
                  <span className="font-mono text-[11px] opacity-60">0:55 – 1:35 (35s)</span>
                </Link>
              </div>

              <span className="font-mono text-xs text-[#64748B] hidden md:inline">
                Slide 01 of 03
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
                    ? "border-amber-500/50 bg-amber-950/40 text-amber-300"
                    : "border-[#252936] bg-[#12141A] text-[#94A3B8] hover:text-white"
                }`}
                title="Practice timing this 25s slide"
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    timerRunning ? "bg-amber-400 animate-ping" : "bg-slate-500"
                  }`}
                />
                <span>{timerRunning ? `${timerSeconds}s / 25s target` : "Rehearse Timing"}</span>
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

              {/* Next Act Navigation Button */}
              <Link
                href="/deck2"
                className="flex h-8 items-center gap-1.5 rounded-lg bg-[#008FA8] hover:bg-[#007D94] px-3.5 text-xs font-semibold text-white shadow-sm transition-all cursor-pointer"
              >
                <span>Act II Slide</span>
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
                <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
                <span className="text-xs font-mono font-bold uppercase tracking-widest text-red-400">
                  Presenter Teleprompter Script • Act I (0:00 – 0:25)
                </span>
              </div>
              <h2 className="mt-1 text-2xl font-bold text-white">
                The Monolithic Contagion Trap
              </h2>
              <p className="text-xs text-[#64748B] mt-0.5">
                Target pace: ~130 words per minute (25 seconds total).
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
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#008FA8] hover:bg-[#007D94] px-3.5 py-2 text-xs font-semibold text-white transition-colors"
              >
                <span>Act II Slide</span>
                <ArrowRightIcon size={13} />
              </Link>
            </div>
          </div>

          {/* Large Teleprompter Reading Card */}
          <div className="rounded-2xl border border-red-500/20 bg-[#07080A] p-6 sm:p-8 shadow-xl">
            <div className="text-xs font-mono uppercase text-[#64748B] font-semibold mb-3">
              Spoken Word-For-Word Voiceover:
            </div>
            <blockquote className="text-lg sm:text-xl md:text-2xl font-normal leading-relaxed text-white">
              &ldquo;DeFi options have a structural flaw. Today, almost every options protocol pools user collateral into{" "}
              <span className="text-red-400 font-bold underline decoration-red-500/40 underline-offset-4">
                monolithic vaults
              </span>
              . A single bad debt event, math bug, or oracle failure doesn&apos;t just hurt one trade—it{" "}
              <span className="text-red-300 font-bold">drains the entire protocol</span>.
              <br className="my-3 block" />
              Worse, when oracles break or liquidity dries up, user funds get locked indefinitely behind governance votes
              and admin rescue keys.{" "}
              <span className="text-amber-300 font-bold">
                DeFi options need institutional security without institutional trust.
              </span>
              &rdquo;
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
                    <span className="font-mono text-red-400 font-bold shrink-0 bg-red-950/50 border border-red-500/30 px-2 py-0.5 rounded">
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
                    <div className="text-base font-bold text-white">54</div>
                  </div>
                  <div className="rounded-lg bg-[#07080A] p-2 border border-[#252936]">
                    <div className="text-[10px] text-[#64748B]">TARGET</div>
                    <div className="text-base font-bold text-red-400">25s</div>
                  </div>
                  <div className="rounded-lg bg-[#07080A] p-2 border border-[#252936]">
                    <div className="text-[10px] text-[#64748B]">PACING</div>
                    <div className="text-base font-bold text-white">130 WPM</div>
                  </div>
                </div>
              </div>
              <div className="text-[11px] text-[#64748B] border-t border-[#252936] pt-2 font-mono">
                Keyboard control: Press [→] to advance to Act II slide.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
