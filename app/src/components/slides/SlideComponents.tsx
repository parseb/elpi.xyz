"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ElpiLogo } from "@/components/ElpiLogo";
import { CheckIcon, CopyIcon, ArrowRightIcon } from "@/components/icons";


export interface SlideStageProps {
  children: React.ReactNode;
  slideIndex: number;
  totalSlides?: number;
  showRays?: boolean;
  className?: string;
}

export function SlideStyles() {
  return (
    <style dangerouslySetInnerHTML={{ __html: `
      html {
        scroll-behavior: smooth;
      }
      :root {
        --slide-ink: #07090E;
        --slide-panel: #0D121B;
        --slide-panel-2: #131A26;
        --slide-line: #1E2838;
        --slide-text: #F8FAFC;
        --slide-dim: #94A3B8;
        --slide-dim-2: #64748B;
        --slide-signal: #00F0FF;
        --slide-signal-dim: rgba(0, 240, 255, 0.16);
        --slide-uni-pink: #FF007A;
        --slide-uni-pink-dim: rgba(255, 0, 122, 0.16);
        --slide-hot: #F87171;
        --slide-emerald: #34D399;
      }
      .slide-stage {
        position: relative;
        width: min(96vw, 1320px);
        min-height: calc(min(96vw, 1320px) * 0.5625);
        container-type: inline-size;
        background: var(--slide-panel);
        border: 1px solid var(--slide-line);
        border-radius: 8px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        padding: clamp(26px, 3.4cqw, 54px) clamp(30px, 4cqw, 64px);
        box-shadow: 0 30px 80px -20px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(0, 240, 255, 0.05);
      }
      .slide-tick {
        position: absolute;
        width: clamp(14px, 1.4cqw, 20px);
        height: clamp(14px, 1.4cqw, 20px);
        opacity: 0.65;
      }
      .slide-tick.tl { top: 14px; left: 14px; border-top: 1px solid var(--slide-signal); border-left: 1px solid var(--slide-signal); }
      .slide-tick.tr { top: 14px; right: 14px; border-top: 1px solid var(--slide-signal); border-right: 1px solid var(--slide-signal); }
      .slide-tick.bl { bottom: 14px; left: 14px; border-bottom: 1px solid var(--slide-signal); border-left: 1px solid var(--slide-signal); }
      .slide-tick.br { bottom: 14px; right: 14px; border-bottom: 1px solid var(--slide-signal); border-right: 1px solid var(--slide-signal); }

      .slide-brandmark {
        position: absolute;
        top: clamp(26px, 3.4cqw, 54px);
        right: clamp(30px, 4cqw, 64px);
        z-index: 2;
      }

      .slide-rays {
        position: absolute;
        inset: 0;
        overflow: hidden;
        pointer-events: none;
      }
      .slide-ray {
        position: absolute;
        left: 50%;
        bottom: 28%;
        width: 2px;
        height: 66%;
        background: linear-gradient(to top, var(--slide-signal), transparent 72%);
        opacity: 0.14;
        transform-origin: bottom center;
      }
      .slide-raypoint {
        position: absolute;
        left: 50%;
        bottom: 28%;
        width: 12px;
        height: 12px;
        margin-left: -6px;
        margin-bottom: -6px;
        border-radius: 50%;
        background: var(--slide-signal);
        box-shadow: 0 0 35px 10px var(--slide-signal-dim), 0 0 10px 2px var(--slide-signal);
        opacity: 0.9;
      }

      .slide-content {
        position: relative;
        z-index: 1;
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
      }

      .slide-eyebrow {
        font-family: var(--font-coinbase-mono, monospace);
        font-size: clamp(0.85rem, 0.75rem + 0.6cqw, 1rem);
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--slide-signal);
        margin: 0 0 12px;
      }

      .slide-h1 {
        font-family: var(--font-coinbase-sans, sans-serif);
        font-size: clamp(3rem, 2rem + 4.5cqw, 5.4rem);
        font-weight: 800;
        letter-spacing: -0.02em;
        line-height: 0.98;
        color: var(--slide-text);
        margin: 0 0 20px;
      }

      .slide-h2 {
        font-family: var(--font-coinbase-sans, sans-serif);
        font-size: clamp(2rem, 1.4rem + 2.8cqw, 3.2rem);
        font-weight: 750;
        letter-spacing: -0.015em;
        line-height: 1.12;
        color: var(--slide-text);
        margin: 0 0 16px;
      }

      .slide-lede {
        font-size: clamp(1.25rem, 0.95rem + 1.2cqw, 1.55rem);
        line-height: 1.42;
        color: var(--slide-dim);
        max-width: 44ch;
        margin: 0 0 12px;
      }

      .slide-body {
        font-size: clamp(1.05rem, 0.88rem + 0.75cqw, 1.25rem);
        line-height: 1.52;
        color: var(--slide-dim);
        max-width: 48ch;
        margin: 0;
      }
      .slide-body strong, .slide-lede strong {
        color: var(--slide-text);
        font-weight: 600;
      }

      .slide-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-family: var(--font-coinbase-mono, monospace);
        font-size: clamp(0.76rem, 0.65rem + 0.35cqw, 0.88rem);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--slide-dim-2);
        padding-top: 16px;
        margin-top: auto;
        border-top: 1px solid var(--slide-line);
      }
      .slide-footer .idx {
        font-variant-numeric: tabular-nums;
        color: var(--slide-dim);
      }

      .slide-grid-2 {
        display: grid;
        grid-template-columns: 1.05fr 1fr;
        gap: clamp(28px, 3.6cqw, 56px);
        align-items: center;
        flex: 1;
        min-height: 0;
      }
      .slide-grid-2.top { align-items: start; }
      .slide-grid-2.wide-right { grid-template-columns: 0.85fr 1.15fr; }
      .slide-grid-2.clear-brand { margin-top: clamp(24px, 3cqw, 40px); }
      @media (max-width: 860px) {
        .slide-grid-2, .slide-grid-2.wide-right { grid-template-columns: 1fr; }
      }

      .slide-frag-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: clamp(14px, 1.8cqw, 20px);
        margin-top: 24px;
      }
      @media (max-width: 640px) {
        .slide-frag-grid { grid-template-columns: 1fr; }
      }
      .slide-frag {
        border: 1px solid var(--slide-line);
        background: var(--slide-panel-2);
        border-radius: 8px;
        padding: clamp(14px, 1.8cqw, 22px) clamp(16px, 2cqw, 24px);
        transition: border-color 0.2s;
      }
      .slide-frag:hover {
        border-color: rgba(0, 240, 255, 0.3);
      }
      .slide-frag .k {
        display: block;
        font-family: var(--font-coinbase-mono, monospace);
        font-size: clamp(0.78rem, 0.7rem + 0.3cqw, 0.88rem);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--slide-hot);
        margin-bottom: 8px;
      }
      .slide-frag p {
        margin: 0;
        color: var(--slide-dim);
        font-size: clamp(0.92rem, 0.84rem + 0.4cqw, 1.08rem);
        line-height: 1.45;
      }

      .slide-pills {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 24px;
      }
      .slide-pill {
        font-family: var(--font-coinbase-mono, monospace);
        font-size: clamp(0.85rem, 0.75rem + 0.4cqw, 0.96rem);
        letter-spacing: 0.03em;
        color: var(--slide-text);
        background: var(--slide-panel-2);
        border: 1px solid var(--slide-line);
        border-radius: 999px;
        padding: 0.45em 1.05em;
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .slide-pill.highlight {
        border-color: rgba(0, 240, 255, 0.4);
        background: rgba(0, 240, 255, 0.06);
        color: var(--slide-signal);
      }
      .slide-pill.uni {
        border-color: rgba(255, 0, 122, 0.4);
        background: rgba(255, 0, 122, 0.06);
        color: #FF70B8;
      }

      .slide-stats {
        display: flex;
        column-gap: clamp(20px, 2.4cqw, 32px);
        row-gap: 12px;
        margin-top: 16px;
        flex-wrap: wrap;
      }
      .slide-stat .n {
        font-family: var(--font-coinbase-mono, monospace);
        font-size: clamp(1.5rem, 1.1rem + 1.8cqw, 2.1rem);
        color: var(--slide-signal);
        font-variant-numeric: tabular-nums;
        line-height: 1.1;
      }
      .slide-stat .n.small {
        font-size: clamp(1.05rem, 0.85rem + 0.9cqw, 1.35rem);
      }
      .slide-stat .l {
        font-family: var(--font-coinbase-mono, monospace);
        font-size: clamp(0.72rem, 0.62rem + 0.3cqw, 0.82rem);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--slide-dim-2);
        margin-bottom: 6px;
      }

      .slide-device {
        border: 1px solid var(--slide-line);
        border-radius: 8px;
        overflow: hidden;
        background: #06090F;
        box-shadow: 0 24px 60px -20px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(0, 240, 255, 0.1);
      }
      .slide-device .bar {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 9px 14px;
        background: #0A0E17;
        border-bottom: 1px solid var(--slide-line);
      }
      .slide-device .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--slide-line); }
      .slide-device .dot.red { background: #F87171; }
      .slide-device .dot.amber { background: #FBBF24; }
      .slide-device .dot.green { background: #34D399; }
      .slide-device .url {
        margin-left: 10px;
        font-family: var(--font-coinbase-mono, monospace);
        font-size: clamp(0.72rem, 0.62rem + 0.25cqw, 0.82rem);
        color: var(--slide-dim-2);
        letter-spacing: 0.02em;
      }

      ul.slide-status {
        list-style: none;
        margin: 18px 0 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      ul.slide-status li {
        position: relative;
        padding-left: 22px;
        color: var(--slide-dim);
        font-size: clamp(0.98rem, 0.86rem + 0.5cqw, 1.16rem);
        line-height: 1.45;
      }
      ul.slide-status li::before {
        content: "";
        position: absolute;
        left: 0;
        top: 0.52em;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--slide-signal);
        box-shadow: 0 0 8px 1px var(--slide-signal-dim);
      }
      ul.slide-status li strong {
        color: var(--slide-text);
      }

      .slide-ask-box {
        border: 1px solid var(--slide-signal);
        background: linear-gradient(180deg, rgba(0, 240, 255, 0.08), rgba(0, 240, 255, 0.02));
        border-radius: 8px;
        padding: clamp(16px, 2cqw, 24px);
      }
      .slide-ask-box .slide-eyebrow { margin-bottom: 8px; }
      .slide-ask-box p {
        margin: 0;
        color: var(--slide-text);
        font-size: clamp(0.98rem, 0.86rem + 0.45cqw, 1.15rem);
        line-height: 1.45;
      }

      .slide-contact {
        margin-top: 18px;
      }
      .slide-contact-rule {
        height: 1px;
        background: var(--slide-line);
        margin-bottom: 16px;
      }
      .slide-contact-row {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        column-gap: 10px;
        row-gap: 4px;
        font-size: clamp(0.92rem, 0.8rem + 0.4cqw, 1.08rem);
      }
      .slide-contact-row .name { color: var(--slide-text); font-weight: 600; }
      .slide-contact-row .role { color: var(--slide-dim); }
      .slide-contact-row .email {
        font-family: var(--font-coinbase-mono, monospace);
        font-size: 0.92em;
        color: var(--slide-signal);
        text-decoration: none;
      }
      .slide-contact-row .email:hover { text-decoration: underline; }

      @media print {
        @page { size: 13.333in 7.5in; margin: 0; }
        html, body { width: 13.333in; height: 7.5in; }
        body { display: block; margin: 0; padding: 0; background: var(--slide-ink); }
        .slide-stage {
          width: 100%;
          height: 100%;
          min-height: 100%;
          max-width: none;
          border: none;
          border-radius: 0;
          box-shadow: none;
          page-break-after: always;
          break-after: page;
          page-break-inside: avoid;
          break-inside: avoid;
        }
        .slide-toolbar { display: none !important; }
      }
    `}} />
  );
}

export function SlideStage({
  children,
  slideIndex,
  totalSlides = 4,
  showRays = false,
  className = "",
}: SlideStageProps) {
  const indexStr = `${String(slideIndex).padStart(2, "0")} / ${String(totalSlides).padStart(2, "0")}`;

  return (
    <div className={`slide-stage ${className}`}>
      {/* Corner Ticks */}
      <i className="slide-tick tl" />
      <i className="slide-tick tr" />
      <i className="slide-tick bl" />
      <i className="slide-tick br" />

      {/* Decorative Cyan Rays */}
      {showRays && (
        <div className="slide-rays">
          <div className="slide-ray" style={{ transform: "rotate(-58deg)" }} />
          <div className="slide-ray" style={{ transform: "rotate(-40deg)" }} />
          <div className="slide-ray" style={{ transform: "rotate(-22deg)" }} />
          <div className="slide-ray" style={{ transform: "rotate(-6deg)" }} />
          <div className="slide-ray" style={{ transform: "rotate(10deg)" }} />
          <div className="slide-ray" style={{ transform: "rotate(26deg)" }} />
          <div className="slide-ray" style={{ transform: "rotate(44deg)" }} />
          <div className="slide-ray" style={{ transform: "rotate(60deg)" }} />
          <div className="slide-raypoint" />
        </div>
      )}

      {/* Brandmark Top-Right */}
      <div className="slide-brandmark">
        <Link href="/" className="inline-flex items-center gap-2 hover:opacity-90 transition-opacity">
          <ElpiLogo size="sm" showDomain={true} showBadge={false} />
        </Link>
      </div>

      {/* Main Slide Content */}
      <div className="slide-content">
        {children}
        <div className="slide-footer">
          <span className="text-[11px] font-mono tracking-widest text-[#64748B]">
            ELPI · UNISWAP V4 DECENTRALIZED OPTIONS ON EVM
          </span>
          <span className="idx">{indexStr}</span>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Slide 1 Content: Title / Hook
// -----------------------------------------------------------------------------
export function Slide1Content() {
  return (
    <div className="my-auto py-6">
      <div className="slide-eyebrow">EVM Ecosystem · Seed Presentation</div>
      <h1 className="slide-h1">
        elp<span className="text-[#00F0FF]">ı</span>.xyz
      </h1>
      <p className="slide-lede">
        The Schelling point for onchain options with continuous Uniswap v4 liquidity backing.
      </p>
      <p className="slide-body">
        One live market where every liquidity offer and buyer converge on the exact price —
        combining isolated ERC-6551 position accounts with 0-fee Uniswap v4 flash accounting settlement on EVM.
      </p>
      <div className="slide-pills">
        <span className="slide-pill highlight">
          <span className="h-1.5 w-1.5 rounded-full bg-[#00F0FF]" />
          Peer-to-Peer Order Book
        </span>
        <span className="slide-pill uni">
          <span className="h-1.5 w-1.5 rounded-full bg-[#FF007A]" />
          Uniswap v4 Backed
        </span>
        <span className="slide-pill">
          1:1 Isolated ERC-6551 Custody
        </span>
        <span className="slide-pill">
          0-Fee Settlement Hook
        </span>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Slide 2 Content: The Problem
// -----------------------------------------------------------------------------
export function Slide2Content() {
  return (
    <div className="my-auto py-4">
      <div className="slide-eyebrow">The Structural Flaw</div>
      <h2 className="slide-h2">
        Options liquidity doesn’t converge — it fragments into pooled toxic risk.
      </h2>
      <p className="slide-body">
        Today’s DeFi options protocols pool user collateral into monolithic vaults.
        When an oracle lags or a bad debt event hits, the entire protocol drains.
      </p>

      <div className="slide-frag-grid">
        <div className="slide-frag">
          <span className="k">Monolithic Pool Custody</span>
          <p>
            Shared vaults create systemic contagion. A single math exploit or oracle desync drains all deposits across every strike and asset.
          </p>
        </div>

        <div className="slide-frag">
          <span className="k">100% Idle Capital Drag</span>
          <p>
            LP collateral sits stagnant in contracts earning 0% yield while waiting for a taker to mint — zero AMM fees, zero capital velocity.
          </p>
        </div>

        <div className="slide-frag">
          <span className="k">Double Fee Stacking</span>
          <p>
            Takers pay protocol mint premiums plus punishing AMM swap fees upon exercise, destroying option profitability on volatile moves.
          </p>
        </div>

        <div className="slide-frag">
          <span className="k">Governance Stranding</span>
          <p>
            When oracles break or venues halt, user funds get locked indefinitely behind multi-sigs, emergency pause keys, and governance delays.
          </p>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Slide 3 Content: The Product & Uniswap v4 Architecture
// -----------------------------------------------------------------------------
export function Slide3Content() {
  return (
    <div className="slide-grid-2 top wide-right clear-brand my-auto">
      <div>
        <div className="slide-eyebrow">The Solution & Architecture</div>
        <h2 className="slide-h2">
          One market. Isolated custody. Continuous Uniswap v4 liquidity.
        </h2>
        <p className="slide-body">
          Every liquidity commitment — direct LP profile or syndicated router quote — lands on one live interactive chart.
          Collateral stages out-of-range in Uniswap v4 pools earning dynamic swap fees until mint.
          When a taker executes, funds move JIT into an isolated ERC-6551 smart account.
        </p>

        <div className="slide-stats">
          <div className="slide-stat">
            <div className="l">any duration</div>
            <div className="n">1hr – 30d</div>
          </div>
          <div className="slide-stat">
            <div className="l">Uniswap v4 Hook</div>
            <div className="n small">0-Fee Settlement (0xC8)</div>
          </div>
          <div className="slide-stat">
            <div className="l">Isolated Custody</div>
            <div className="n">1:1 ERC-6551</div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2 text-xs font-mono">
          <span className="rounded bg-[#131A26] border border-[#1E2838] px-2.5 py-1 text-[#34D399]">
            ✓ Invariant I1: Zero Pool Contagion
          </span>
          <span className="rounded bg-[#131A26] border border-[#1E2838] px-2.5 py-1 text-[#00F0FF]">
            ✓ Invariant I3: Oracle-Free LP Recovery
          </span>
          <span className="rounded bg-[#131A26] border border-[#1E2838] px-2.5 py-1 text-[#FF70B8]">
            ✓ Invariant I4: 0% Fee on Losing Trades
          </span>
        </div>
      </div>

      {/* Interactive Mockup Terminal */}
      <div>
        <div className="slide-device">
          <div className="bar">
            <span className="dot red" />
            <span className="dot amber" />
            <span className="dot green" />
            <span className="url">elpi.xyz — Uniswap v4 Execution Engine</span>
          </div>

          <div className="p-4 space-y-3 font-mono text-xs text-[#E2E8F0]">
            {/* Terminal Header */}
            <div className="flex items-center justify-between border-b border-[#1E2838] pb-2.5">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#00F0FF] animate-pulse" />
                <span className="font-bold text-white">WETH / USDC</span>
                <span className="text-[10px] text-[#64748B]">v4 Dynamic Pool</span>
              </div>
              <span className="text-[10px] rounded bg-[#00F0FF]/10 text-[#00F0FF] px-2 py-0.5 border border-[#00F0FF]/20">
                Hook: 0xC8 Netting
              </span>
            </div>

            {/* Architecture Flow Card */}
            <div className="grid grid-cols-3 gap-2 text-[10px] text-center pt-1">
              <div className="rounded bg-[#131A26] border border-[#1E2838] p-2">
                <div className="text-[#64748B]">STAGE 1: IDLE</div>
                <div className="text-white font-bold mt-0.5">V4LiquidityVault</div>
                <div className="text-[9px] text-[#34D399]">Earns AMM Fees</div>
              </div>
              <div className="rounded bg-[#131A26] border border-[#1E2838] p-2">
                <div className="text-[#64748B]">STAGE 2: MINT</div>
                <div className="text-[#00F0FF] font-bold mt-0.5">JIT Allocation</div>
                <div className="text-[9px] text-[#94A3B8]">1:1 ERC-6551 Account</div>
              </div>
              <div className="rounded bg-[#131A26] border border-[#1E2838] p-2">
                <div className="text-[#64748B]">STAGE 3: SETTLE</div>
                <div className="text-[#FF70B8] font-bold mt-0.5">Flash Netting</div>
                <div className="text-[9px] text-[#34D399]">overrideFee = 0</div>
              </div>
            </div>

            {/* Simulated Live Book */}
            <div className="space-y-1.5 rounded bg-[#0A0E17] p-2.5 border border-[#1E2838] text-[11px]">
              <div className="flex justify-between text-[#64748B] text-[10px]">
                <span>LP COMMITTED ORDERS</span>
                <span>RATE / HR</span>
                <span>AVAILABLE</span>
              </div>
              <div className="flex justify-between items-center text-white">
                <span className="text-[#34D399]">Direct Solo LP (0xf85B...7855)</span>
                <span className="text-[#00F0FF]">$0.0035 / hr</span>
                <span>$45,000</span>
              </div>
              <div className="flex justify-between items-center text-white">
                <span className="text-[#34D399]">Syndicated Router (LPRouter)</span>
                <span className="text-[#00F0FF]">$0.0042 / hr</span>
                <span>$120,000</span>
              </div>
              <div className="flex justify-between items-center text-[#94A3B8]">
                <span>Uniswap v4 Staged Vault</span>
                <span className="text-[#00F0FF]">$0.0050 / hr</span>
                <span>$250,000</span>
              </div>
            </div>

            {/* Execution Guarantee */}
            <div className="rounded bg-cyan-950/20 border border-cyan-500/20 p-2 text-[10px] text-cyan-300 flex items-center justify-between">
              <span>✓ Flash accounting swap executed inside unlock()</span>
              <span className="font-bold text-white">0 Persistent Balance</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Slide 4 Content: Status & Ask
// -----------------------------------------------------------------------------
export function Slide4Content() {
  return (
    <div className="my-auto py-3">
      <div className="slide-grid-2 top">
        <div>
          <div className="slide-eyebrow">Where We Are</div>
          <h2 className="slide-h2">
            A production-ready engine. Built for EVM & Uniswap v4.
          </h2>

          <ul className="slide-status">
            <li>
              <strong>147/147 Foundry tests passing</strong> across unit, invariant, and EVM Cancun fork suites.
            </li>
            <li>
              <strong>Uniswap v4 Hook mined (`0xC8`)</strong>: waiving AMM swap fees on option exercise with EIP-1153 netting.
            </li>
            <li>
              <strong>Idle capital staging (`V4LiquidityVault`)</strong>: collateral earns AMM yield while uncommitted, safely re-staking post-settlement.
            </li>
            <li>
              <strong>Gas gate verified</strong>: complete mint & settlement lifecycle overhead is &lt; 15% of representative option premium.
            </li>
          </ul>
        </div>

        <div>
          <div className="slide-eyebrow">Why EVM & Uniswap v4</div>
          <p className="slide-body">
            EVM sub-cent transactions combined with Uniswap v4 singleton flash accounting make micro-duration, hourly options economically viable for the first time in crypto.
          </p>

          <div className="h-[1px] bg-[#1E2838] my-4" />

          <div className="slide-ask-box">
            <div className="slide-eyebrow" style={{ marginBottom: "6px" }}>The Ask</div>
            <p>
              Seed partnership to take elpi to EVM Mainnet: security audit completion, initial Uniswap v4 LP vault seeding, and distribution.
            </p>
          </div>
        </div>
      </div>

      <div className="slide-contact">
        <div className="slide-contact-rule" />
        <div className="slide-eyebrow" style={{ marginBottom: "8px" }}>Founder & Protocol Developer</div>
        <div className="slide-contact-row">
          <span className="name">Bogdan Arsene</span>
          <span className="role">· 5 years of EVM & Options protocol development ·</span>
          <a className="email" href="mailto:petra306@protonmail.com">petra306@protonmail.com</a>
          <span className="role">· EVM / Ethereum Mainnet</span>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Toolbar for Slides (Navigation, Jump, Print)
// -----------------------------------------------------------------------------
export function SlideNavToolbar({ currentSlide, totalSlides = 4 }: { currentSlide: number; totalSlides?: number }) {
  const prevSlide = currentSlide > 1 ? currentSlide - 1 : null;
  const nextSlide = currentSlide < totalSlides ? currentSlide + 1 : null;

  return (
    <nav aria-label="Slide navigation" className="slide-toolbar flex flex-wrap items-center justify-center gap-2 sm:gap-3 text-xs font-mono text-[#94A3B8]">
      {prevSlide ? (
        <Link
          href={`/slide${prevSlide}`}
          className="rounded border border-[#1E2838] bg-[#0D121B] px-3 py-1.5 hover:border-[#00F0FF] hover:text-white transition-colors"
        >
          ← Slide {prevSlide}
        </Link>
      ) : (
        <span className="rounded border border-[#1E2838]/40 px-3 py-1.5 text-[#475569] cursor-not-allowed">
          ← Start
        </span>
      )}

      <div className="flex items-center gap-1.5 px-2">
        {Array.from({ length: totalSlides }, (_, i) => i + 1).map((num) => (
          <Link
            key={num}
            href={`/slide${num}`}
            className={`flex h-7 w-7 items-center justify-center rounded-full transition-all ${
              num === currentSlide
                ? "bg-[#00F0FF] text-[#07090E] font-bold shadow-[0_0_10px_rgba(0,240,255,0.4)]"
                : "border border-[#1E2838] bg-[#0D121B] text-[#94A3B8] hover:border-[#00F0FF] hover:text-white"
            }`}
          >
            {num}
          </Link>
        ))}
      </div>

      {nextSlide ? (
        <Link
          href={`/slide${nextSlide}`}
          className="rounded border border-[#1E2838] bg-[#0D121B] px-3 py-1.5 hover:border-[#00F0FF] hover:text-white transition-colors"
        >
          Slide {nextSlide} →
        </Link>
      ) : (
        <span className="rounded border border-[#1E2838]/40 px-3 py-1.5 text-[#475569] cursor-not-allowed">
          End →
        </span>
      )}

      <div className="h-4 w-[1px] bg-[#1E2838] mx-1" />

      <Link
        href="/slides"
        className="rounded border border-[#1E2838] bg-[#0D121B] px-3 py-1.5 hover:border-[#00F0FF] hover:text-white transition-colors"
      >
        All Slides (Deck)
      </Link>

      <button
        onClick={() => window.print()}
        className="rounded border border-[#1E2838] bg-[#0D121B] px-3 py-1.5 hover:border-[#00F0FF] hover:text-white transition-colors cursor-pointer"
        title="Print or Save as 16:9 PDF"
      >
        Print / PDF
      </button>
    </nav>
  );
}

// -----------------------------------------------------------------------------
// Presenter Teleprompter & Pitch Script System (Below-the-fold Presentation Suite)
// -----------------------------------------------------------------------------
export interface SlideScript {
  actNum: number;
  actLabel: string;
  actTitle: string;
  timeRange: string;
  targetSeconds: number;
  words: number;
  wpm: number;
  badgeBg: string;
  badgeBorder: string;
  badgeText: string;
  voiceoverPlain: string;
  voiceoverHtml: React.ReactNode;
  cues: Array<{ time: string; instruction: string }>;
  pitchMechanics: {
    words: number;
    targetSeconds: number;
    wpm: number;
    transitionText: string;
  };
}

export const SLIDE_SCRIPTS: Record<number, SlideScript> = {
  1: {
    actNum: 1,
    actLabel: "Act I • The Hook",
    actTitle: "Continuous Options on EVM, Backed by Uniswap v4 Liquidity",
    timeRange: "0:00 – 0:25",
    targetSeconds: 25,
    words: 78,
    wpm: 145,
    badgeBg: "rgba(0, 240, 255, 0.12)",
    badgeBorder: "rgba(0, 240, 255, 0.3)",
    badgeText: "#00F0FF",
    voiceoverPlain:
      "Welcome to elpi—the continuous options protocol built natively on EVM and powered by Uniswap v4. Today, on-chain options struggle with a fatal trilemma: monolithic vault contagion, massive idle capital drag, and punitive multi-layer fee stacking. elpi fundamentally eliminates this trilemma. By isolating each position into dedicated ERC-6551 smart accounts and embedding economic terms into deterministic CREATE2 salts, elpi delivers continuous, capital-efficient, non-custodial options with zero contagion risk.",
    voiceoverHtml: (
      <>
        &ldquo;Welcome to <span className="text-[#00F0FF] font-bold">elpi</span>—the continuous options protocol built natively on{" "}
        <span className="text-white font-bold underline decoration-[#00F0FF]/50 underline-offset-4">EVM</span> and powered by{" "}
        <span className="text-[#FF007A] font-bold">Uniswap v4</span>.
        <br className="my-3 block" />
        Today, on-chain options struggle with a fatal trilemma:{" "}
        <span className="text-red-400 font-semibold">monolithic vault contagion</span>,{" "}
        <span className="text-amber-400 font-semibold">massive idle capital drag</span>, and{" "}
        <span className="text-red-400 font-semibold">punitive multi-layer fee stacking</span>.
        <br className="my-3 block" />
        elpi fundamentally eliminates this trilemma. By isolating each position into dedicated{" "}
        <span className="text-[#00F0FF] font-bold underline decoration-[#00F0FF]/50 underline-offset-4">
          ERC-6551 smart accounts
        </span>{" "}
        and embedding economic terms into{" "}
        <span className="text-white font-bold">deterministic CREATE2 salts</span>, elpi delivers continuous, capital-efficient,
        non-custodial options with <span className="text-[#34D399] font-bold">zero contagion risk</span>.&rdquo;
      </>
    ),
    cues: [
      { time: "0:00 – 0:08", instruction: "Confident, energetic opening: 'Welcome to elpi—built natively on EVM, powered by Uniswap v4.'" },
      { time: "0:08 – 0:17", instruction: "State the core DeFi options trilemma: 'Vault contagion, capital drag, and multi-layer fees.'" },
      { time: "0:17 – 0:25", instruction: "Hit the architectural resolution: 'Isolated ERC-6551 accounts + deterministic CREATE2 salts.'" },
    ],
    pitchMechanics: {
      words: 78,
      targetSeconds: 25,
      wpm: 145,
      transitionText: "Advance to Slide 2 by pressing Right Arrow (→) or clicking Act II to address monolithic risks.",
    },
  },
  2: {
    actNum: 2,
    actLabel: "Act II • The Dilemma",
    actTitle: "Monolithic Vaults, Capital Drag & Fee Stacking",
    timeRange: "0:25 – 0:55",
    targetSeconds: 30,
    words: 86,
    wpm: 145,
    badgeBg: "rgba(248, 113, 113, 0.15)",
    badgeBorder: "rgba(248, 113, 113, 0.35)",
    badgeText: "#F87171",
    voiceoverPlain:
      "Here is why existing DeFi options have failed to scale. First: Monolithic Vault Contagion. Shared pool designs co-mingle all user funds. A single oracle latency glitch, rounding bug, or liquidation cascade wipes out the entire pool—affecting innocent traders who had nothing to do with that market. Second: Severe Capital Drag. LPs are forced to lock collateral upfront for days without earning fees until an option is bought. And third: Fee Stacking. Takers pay AMM swap fees, protocol cuts, and heavy slippage. DeFi options cannot compete under this model.",
    voiceoverHtml: (
      <>
        &ldquo;Here is why existing DeFi options have failed to scale:
        <br className="my-3 block" />
        First: <span className="text-red-400 font-bold underline decoration-red-500/50 underline-offset-4">Monolithic Vault Contagion</span>. Shared pool designs co-mingle all user funds. A single oracle latency glitch, rounding bug, or liquidation cascade wipes out the{" "}
        <span className="text-red-300 font-bold">entire pool</span>—affecting innocent traders who had nothing to do with that market.
        <br className="my-3 block" />
        Second: <span className="text-amber-300 font-bold">Severe Capital Drag</span>. LPs are forced to lock collateral upfront for days without earning fees until an option is bought.
        <br className="my-3 block" />
        And third: <span className="text-red-400 font-bold">Fee Stacking</span>. Takers pay AMM swap fees, protocol cuts, and heavy slippage. DeFi options cannot compete under this model.&rdquo;
      </>
    ),
    cues: [
      { time: "0:25 – 0:35", instruction: "Confront shared vault risks: 'A single oracle glitch or bad debt shock wipes out everyone's capital.'" },
      { time: "0:35 – 0:45", instruction: "Highlight capital drag: 'LPs lock funds for days with zero returns waiting for takers.'" },
      { time: "0:45 – 0:55", instruction: "Expose taker friction: 'Multi-layer fee stacking kills liquidity. DeFi needs a radical redesign.'" },
    ],
    pitchMechanics: {
      words: 86,
      targetSeconds: 30,
      wpm: 145,
      transitionText: "Advance to Slide 3 by pressing Right Arrow (→) to reveal elpi's Uniswap v4 solution.",
    },
  },
  3: {
    actNum: 3,
    actLabel: "Act III • The Breakthrough",
    actTitle: "Uniswap v4 Settlement Hook + JIT Token Bound Accounts",
    timeRange: "0:55 – 1:40",
    targetSeconds: 45,
    words: 122,
    wpm: 150,
    badgeBg: "rgba(0, 240, 255, 0.12)",
    badgeBorder: "rgba(0, 240, 255, 0.3)",
    badgeText: "#00F0FF",
    voiceoverPlain:
      "elpi replaces monolithic pools with two breakthrough innovations: First: 1:1 Isolated Smart Accounts. Every minted option is instantiated as an ERC-6551 Token Bound Account. Capital is isolated per position with zero co-mingling, zero protocol custody, and deterministic LP recovery guaranteed by CREATE2 salts—even if an oracle goes offline. Second: Direct Uniswap v4 Backing. Uncommitted LP collateral is staged inside our V4LiquidityVault, earning AMM trading fees inside Uniswap v4 until the exact instant of option minting. And when an in-the-money option settles, our custom OptionSettlementHook—configured with bitmap flag 0xC8—intercepts the swap, waives AMM swap fees to zero via EIP-1153 transient storage netting, and executes flash strike delivery with zero bad debt.",
    voiceoverHtml: (
      <>
        &ldquo;elpi replaces monolithic pools with two breakthrough innovations:
        <br className="my-3 block" />
        First: <span className="text-[#00F0FF] font-bold underline decoration-[#00F0FF]/50 underline-offset-4">1:1 Isolated Smart Accounts</span>. Every minted option is instantiated as an{" "}
        <span className="text-white font-bold">ERC-6551 Token Bound Account</span>. Capital is isolated per position with zero co-mingling, zero protocol custody, and{" "}
        <span className="text-[#34D399] font-semibold">deterministic LP recovery guaranteed by CREATE2 salts</span>—even if an oracle goes offline.
        <br className="my-3 block" />
        Second: <span className="text-[#FF007A] font-bold underline decoration-[#FF007A]/50 underline-offset-4">Direct Uniswap v4 Backing</span>. Uncommitted LP collateral is staged inside our{" "}
        <span className="text-white font-bold font-mono">V4LiquidityVault</span>, earning AMM trading fees inside Uniswap v4 until the exact instant of option minting.
        <br className="my-3 block" />
        And when an in-the-money option settles, our custom{" "}
        <span className="text-[#00F0FF] font-bold font-mono">OptionSettlementHook</span>—configured with bitmap flag{" "}
        <span className="text-amber-300 font-mono font-bold">0xC8</span>—intercepts the swap,{" "}
        <span className="text-[#34D399] font-bold">waives AMM swap fees to zero via EIP-1153 transient storage netting</span>, and executes flash strike delivery with mathematically guaranteed zero bad debt.&rdquo;
      </>
    ),
    cues: [
      { time: "0:55 – 1:08", instruction: "Contrast isolation with pooling: 'Every minted option lives in its own isolated ERC-6551 account—zero co-mingling.'" },
      { time: "1:08 – 1:22", instruction: "Explain V4LiquidityVault: 'Uncommitted collateral earns AMM trading fees inside Uniswap v4 until mint.'" },
      { time: "1:22 – 1:40", instruction: "Deliver technical punchline: 'OptionSettlementHook 0xC8 waives swap fees to zero via EIP-1153 netting.'" },
    ],
    pitchMechanics: {
      words: 122,
      targetSeconds: 45,
      wpm: 150,
      transitionText: "Advance to Slide 4 by pressing Right Arrow (→) for verification metrics and founder ask.",
    },
  },
  4: {
    actNum: 4,
    actLabel: "Act IV • Status & Ask",
    actTitle: "Production Verification, Gas Gates & The Ask",
    timeRange: "1:40 – 2:15",
    targetSeconds: 35,
    words: 96,
    wpm: 150,
    badgeBg: "rgba(52, 211, 153, 0.15)",
    badgeBorder: "rgba(52, 211, 153, 0.35)",
    badgeText: "#34D399",
    voiceoverPlain:
      "elpi is fully implemented and mathematically verified. All 147 smart contract tests pass in Foundry, audited against EVM Cancun gas gates. Settlement executes under 110,000 gas with zero on-chain storage overhead. We are currently bootstrapping initial LP vaults on EVM testnets and integrating with Uniswap v4. Our ask today is for strategic liquidity partners and market makers: join our private alpha program, test the gas-free EIP-712 quoting pipeline, and seed the initial concentrated liquidity vaults as we launch on EVM Mainnet. Thank you—let's bring continuous, contagion-free options to on-chain finance.",
    voiceoverHtml: (
      <>
        &ldquo;elpi is fully implemented and mathematically verified.
        <br className="my-3 block" />
        All <span className="text-[#34D399] font-bold font-mono">147 smart contract tests pass in Foundry</span>, audited against EVM Cancun gas gates. Settlement executes under{" "}
        <span className="text-white font-bold font-mono">110,000 gas</span> with{" "}
        <span className="text-[#34D399] font-bold">zero on-chain storage overhead</span>.
        <br className="my-3 block" />
        We are currently bootstrapping initial LP vaults on EVM testnets and integrating with Uniswap v4.
        <br className="my-3 block" />
        Our ask today is for <span className="text-[#00F0FF] font-bold">strategic liquidity partners and market makers</span>: join our private alpha program, test the gas-free EIP-712 quoting pipeline, and seed the initial concentrated liquidity vaults as we launch on EVM Mainnet.
        <br className="my-3 block" />
        Thank you—let&apos;s bring continuous, contagion-free options to on-chain finance.&rdquo;
      </>
    ),
    cues: [
      { time: "1:40 – 1:52", instruction: "Present hard engineering metrics: '147/147 passing tests, under 110k gas, zero on-chain storage overhead.'" },
      { time: "1:52 – 2:03", instruction: "State deployment roadmap: 'Bootstrapping vaults on EVM testnets, integrating with Uniswap v4.'" },
      { time: "2:03 – 2:15", instruction: "Clear, actionable ask: 'Looking for strategic liquidity partners and market makers for EVM Mainnet.'" },
    ],
    pitchMechanics: {
      words: 96,
      targetSeconds: 35,
      wpm: 150,
      transitionText: "Pitch completed! Click 'Live Cockpit' to launch the interactive trader interface.",
    },
  },
};

export interface PresenterScriptSectionProps {
  currentSlide: number;
  totalSlides?: number;
  onSelectSlide?: (slideNum: number) => void;
  className?: string;
}

export function PresenterScriptSection({
  currentSlide,
  totalSlides = 4,
  onSelectSlide,
  className = "",
}: PresenterScriptSectionProps) {
  const script = SLIDE_SCRIPTS[currentSlide] || SLIDE_SCRIPTS[1];
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [copied, setCopied] = useState(false);

  // Reset timer state when slide changes
  useEffect(() => {
    setTimerRunning(false);
    setTimerSeconds(0);
  }, [currentSlide]);

  // Rehearsal timer tick
  useEffect(() => {
    if (!timerRunning) return;
    const interval = setInterval(() => setTimerSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [timerRunning]);

  const copyScript = useCallback(() => {
    if (!navigator?.clipboard) return;
    navigator.clipboard.writeText(script.voiceoverPlain);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [script.voiceoverPlain]);

  const progressPercent = Math.min(100, (timerSeconds / script.targetSeconds) * 100);
  const isOvertime = timerSeconds > script.targetSeconds;
  const prevSlideNum = currentSlide > 1 ? currentSlide - 1 : null;
  const nextSlideNum = currentSlide < totalSlides ? currentSlide + 1 : null;

  return (
    <div
      id="presenter-controls"
      className={`print:hidden relative z-20 border-t border-[#1E2838] bg-[#07090E] text-[#F8FAFC] ${className}`}
    >
      {/* Navigation & Timing Action Bar */}
      <div className="border-b border-[#1E2838] bg-[#0D121B] px-4 py-3.5 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4 max-w-6xl mx-auto w-full">
          {/* Left: Act Navigation Tabs */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 bg-[#131A26] p-1 rounded-xl border border-[#1E2838]">
              {Array.from({ length: totalSlides }, (_, i) => i + 1).map((num) => {
                const s = SLIDE_SCRIPTS[num];
                const isActive = num === currentSlide;

                if (onSelectSlide) {
                  return (
                    <button
                      key={num}
                      type="button"
                      onClick={() => onSelectSlide(num)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                        isActive
                          ? "bg-[#00F0FF] text-[#07090E] font-bold shadow-sm"
                          : "text-[#94A3B8] hover:text-white hover:bg-[#1E2838]"
                      }`}
                    >
                      <span>Act {num}</span>
                      <span className={`font-mono text-[11px] ${isActive ? "text-[#07090E]/80 font-bold" : "opacity-60"}`}>
                        ({s?.targetSeconds}s)
                      </span>
                    </button>
                  );
                }

                return (
                  <Link
                    key={num}
                    href={`/slide${num}`}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      isActive
                        ? "bg-[#00F0FF] text-[#07090E] font-bold shadow-sm"
                        : "text-[#94A3B8] hover:text-white hover:bg-[#1E2838]"
                    }`}
                  >
                    <span>Act {num}</span>
                    <span className={`font-mono text-[11px] ${isActive ? "text-[#07090E]/80 font-bold" : "opacity-60"}`}>
                      ({s?.targetSeconds}s)
                    </span>
                  </Link>
                );
              })}
            </div>

            <span className="font-mono text-xs text-[#64748B] hidden md:inline">
              Slide 0{currentSlide} of 0{totalSlides}
            </span>
          </div>

          {/* Right: Pitch Delivery & Rehearsal Controls */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Practice Timer */}
            <button
              type="button"
              onClick={() => setTimerRunning((v) => !v)}
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-mono font-medium transition-colors cursor-pointer ${
                timerRunning
                  ? isOvertime
                    ? "border-red-500/60 bg-red-950/40 text-red-300"
                    : "border-emerald-500/60 bg-emerald-950/40 text-emerald-300"
                  : "border-[#1E2838] bg-[#131A26] text-[#94A3B8] hover:text-white hover:border-[#00F0FF]/40"
              }`}
              title="Practice pacing this slide voiceover"
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  timerRunning
                    ? isOvertime
                      ? "bg-red-400 animate-ping"
                      : "bg-emerald-400 animate-ping"
                    : "bg-[#64748B]"
                }`}
              />
              <span>
                {timerRunning
                  ? isOvertime
                    ? `OVERTIME +${timerSeconds - script.targetSeconds}s`
                    : `${timerSeconds}s / ${script.targetSeconds}s target`
                  : timerSeconds > 0
                  ? `${timerSeconds}s (Paused)`
                  : "Rehearse Timing"}
              </span>
            </button>

            {/* Reset Timer if elapsed */}
            {timerSeconds > 0 && (
              <button
                type="button"
                onClick={() => {
                  setTimerRunning(false);
                  setTimerSeconds(0);
                }}
                className="text-[11px] font-mono text-[#64748B] hover:text-white px-1.5 py-1 transition-colors cursor-pointer"
                title="Reset rehearsal timer"
              >
                Reset
              </button>
            )}

            {/* Copy Script Button */}
            <button
              type="button"
              onClick={copyScript}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#1E2838] bg-[#131A26] hover:bg-[#1E2838] px-3 py-1.5 text-xs font-mono text-[#94A3B8] hover:text-white transition-colors cursor-pointer"
            >
              {copied ? <CheckIcon size={12} className="text-emerald-400" /> : <CopyIcon size={12} />}
              <span>{copied ? "Copied" : "Copy Voiceover"}</span>
            </button>

            {/* Previous Slide Link/Button */}
            {prevSlideNum && (
              onSelectSlide ? (
                <button
                  type="button"
                  onClick={() => onSelectSlide(prevSlideNum)}
                  className="flex h-8 items-center gap-1.5 rounded-lg border border-[#1E2838] bg-[#131A26] hover:bg-[#1E2838] px-3 text-xs font-semibold text-[#94A3B8] hover:text-white transition-all cursor-pointer"
                >
                  <span>Act {prevSlideNum}</span>
                </button>
              ) : (
                <Link
                  href={`/slide${prevSlideNum}`}
                  className="flex h-8 items-center gap-1.5 rounded-lg border border-[#1E2838] bg-[#131A26] hover:bg-[#1E2838] px-3 text-xs font-semibold text-[#94A3B8] hover:text-white transition-all cursor-pointer"
                >
                  <span>Act {prevSlideNum}</span>
                </Link>
              )
            )}

            {/* Next Slide Link/Button */}
            {nextSlideNum && (
              onSelectSlide ? (
                <button
                  type="button"
                  onClick={() => onSelectSlide(nextSlideNum)}
                  className="flex h-8 items-center gap-1.5 rounded-lg bg-[#00F0FF] hover:bg-[#00D4E0] px-3.5 text-xs font-semibold text-[#07090E] font-bold shadow-sm transition-all cursor-pointer"
                >
                  <span>Act {nextSlideNum}</span>
                  <ArrowRightIcon size={12} />
                </button>
              ) : (
                <Link
                  href={`/slide${nextSlideNum}`}
                  className="flex h-8 items-center gap-1.5 rounded-lg bg-[#00F0FF] hover:bg-[#00D4E0] px-3.5 text-xs font-semibold text-[#07090E] font-bold shadow-sm transition-all cursor-pointer"
                >
                  <span>Act {nextSlideNum}</span>
                  <ArrowRightIcon size={12} />
                </Link>
              )
            )}

            {/* Live Cockpit Link */}
            <Link
              href="/"
              className="flex h-8 items-center gap-1.5 rounded-lg border border-[#1E2838] bg-[#131A26] hover:bg-[#1E2838] px-3 text-xs font-semibold text-[#00F0FF] transition-all cursor-pointer"
              title="Return to live Option Cockpit"
            >
              <span>Live App</span>
              <ArrowRightIcon size={12} />
            </Link>
          </div>
        </div>

        {/* Timer Progress Bar */}
        {timerRunning && (
          <div className="w-full bg-[#131A26] rounded-full h-1 overflow-hidden mt-2.5 max-w-6xl mx-auto">
            <div
              className={`h-full transition-all duration-300 ${
                isOvertime ? "bg-red-500" : "bg-[#00F0FF]"
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        )}
      </div>

      {/* Main Teleprompter & Stage Directions Content */}
      <div className="py-10 px-4 sm:px-8 lg:px-12 max-w-5xl mx-auto space-y-8">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#1E2838] pb-5">
          <div>
            <div className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-full animate-pulse"
                style={{ backgroundColor: script.badgeText }}
              />
              <span
                className="text-xs font-mono font-bold uppercase tracking-widest px-2.5 py-0.5 rounded border"
                style={{
                  backgroundColor: script.badgeBg,
                  borderColor: script.badgeBorder,
                  color: script.badgeText,
                }}
              >
                Presenter Teleprompter Script • {script.actLabel} ({script.timeRange})
              </span>
            </div>
            <h2 className="mt-2 text-2xl font-bold text-white tracking-tight">
              {script.actTitle}
            </h2>
            <p className="text-xs text-[#64748B] mt-1 font-mono">
              Target pace: ~{script.wpm} words per minute ({script.targetSeconds}s total). Hidden below slide for clean browser recording.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={copyScript}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[#1E2838] bg-[#0D121B] hover:bg-[#131A26] px-3.5 py-2 text-xs font-semibold text-white transition-colors cursor-pointer"
            >
              {copied ? <CheckIcon size={14} className="text-emerald-400" /> : <CopyIcon size={14} />}
              <span>{copied ? "Copied Script" : "Copy Voiceover"}</span>
            </button>

            {nextSlideNum && (
              onSelectSlide ? (
                <button
                  type="button"
                  onClick={() => onSelectSlide(nextSlideNum)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#00F0FF] hover:bg-[#00D4E0] px-3.5 py-2 text-xs font-bold text-[#07090E] transition-colors cursor-pointer"
                >
                  <span>Act {nextSlideNum} Script</span>
                  <ArrowRightIcon size={13} />
                </button>
              ) : (
                <Link
                  href={`/slide${nextSlideNum}`}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#00F0FF] hover:bg-[#00D4E0] px-3.5 py-2 text-xs font-bold text-[#07090E] transition-colors"
                >
                  <span>Act {nextSlideNum} Script</span>
                  <ArrowRightIcon size={13} />
                </Link>
              )
            )}
          </div>
        </div>

        {/* Large Teleprompter Reading Card */}
        <div
          className="rounded-2xl border bg-[#0D121B] p-6 sm:p-8 shadow-2xl relative"
          style={{ borderColor: script.badgeBorder }}
        >
          <div className="text-xs font-mono uppercase text-[#64748B] font-semibold mb-3 flex items-center justify-between">
            <span>Spoken Word-For-Word Voiceover:</span>
            <span className="text-[11px] font-mono text-[#475569]">Read naturally with pause at paragraphs</span>
          </div>
          <blockquote className="text-lg sm:text-xl md:text-2xl font-normal leading-relaxed text-[#F8FAFC]">
            {script.voiceoverHtml}
          </blockquote>
        </div>

        {/* Delivery Cues & Stage Directions Table */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="rounded-xl border border-[#1E2838] bg-[#0D121B] p-5">
            <h3 className="text-xs font-mono font-bold uppercase text-[#64748B] mb-3.5 flex items-center justify-between">
              <span>Timing &amp; Stage Directions</span>
              <span className="text-[#00F0FF] text-[10px] font-mono">CADENCE</span>
            </h3>
            <div className="space-y-3">
              {script.cues.map((cue, idx) => (
                <div key={idx} className="flex items-start gap-3 text-xs">
                  <span className="font-mono text-[#00F0FF] font-bold shrink-0 bg-[#00F0FF]/10 border border-[#00F0FF]/30 px-2 py-0.5 rounded">
                    {cue.time}
                  </span>
                  <span className="text-[#94A3B8] leading-relaxed">{cue.instruction}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-[#1E2838] bg-[#0D121B] p-5 flex flex-col justify-between">
            <div>
              <h3 className="text-xs font-mono font-bold uppercase text-[#64748B] mb-3.5 flex items-center justify-between">
                <span>Pitch Mechanics</span>
                <span className="text-[#34D399] text-[10px] font-mono">TARGET METRICS</span>
              </h3>
              <div className="grid grid-cols-3 gap-2.5 font-mono text-center mb-4">
                <div className="rounded-lg bg-[#07090E] p-2.5 border border-[#1E2838]">
                  <div className="text-[10px] text-[#64748B] uppercase">Words</div>
                  <div className="text-base font-bold text-white mt-0.5">{script.pitchMechanics.words}</div>
                </div>
                <div className="rounded-lg bg-[#07090E] p-2.5 border border-[#1E2838]">
                  <div className="text-[10px] text-[#64748B] uppercase">Target</div>
                  <div className="text-base font-bold text-[#34D399] mt-0.5">{script.pitchMechanics.targetSeconds}s</div>
                </div>
                <div className="rounded-lg bg-[#07090E] p-2.5 border border-[#1E2838]">
                  <div className="text-[10px] text-[#64748B] uppercase">Pacing</div>
                  <div className="text-base font-bold text-[#00F0FF] mt-0.5">{script.pitchMechanics.wpm} WPM</div>
                </div>
              </div>
            </div>
            <div className="text-[11px] text-[#94A3B8] border-t border-[#1E2838] pt-3 font-mono leading-relaxed">
              <span className="text-white font-bold">Stage Direction: </span>
              {script.pitchMechanics.transitionText}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

