"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useConnection, useConnect, useDisconnect } from "wagmi";
import { isDev, targetChain } from "@/config/chain";
import { DEVNET_TEST_ACCOUNTS } from "@/config/devWalletConnector";
import { FlaskIcon, CloseIcon, CheckIcon } from "@/components/icons";

export function PartnerSandbox() {
  const { address, isConnected } = useConnection();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();

  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);

  const [customPrice, setCustomPrice] = useState("");
  const [status, setStatus] = useState<{
    blockNumber: number;
    timestamp: number;
    isoDate: string;
    wethPrice: string;
  } | null>(null);

  // Fetch status on mount or when toggled
  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/dev/status");
      if (!res.ok) return;
      const data = await res.json();
      if (data.ok) {
        setStatus({
          blockNumber: data.blockNumber,
          timestamp: data.timestamp,
          isoDate: data.isoDate,
          wethPrice: data.weth?.priceUsd || "3000.00",
        });
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (!isDev) return;
    fetchStatus();
    const interval = setInterval(fetchStatus, 15000);
    return () => clearInterval(interval);
  }, []);

  if (!isDev) return null;

  const handleTimeTravel = async (preset: "+1h" | "+24h" | "+7d") => {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/dev/time", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preset }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Time travel failed");
      }
      setMsg({
        text: `⏩ Fast-forwarded chain clock ${preset}. Timestamp: ${new Date(data.timestamp * 1000).toLocaleString()}`,
        type: "success",
      });
      fetchStatus();
    } catch (err) {
      setMsg({
        text: err instanceof Error ? err.message : String(err),
        type: "error",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSetPrice = async (priceUsd: number) => {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/dev/price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asset: "WETH", priceUsd }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Price steer failed");
      }
      setMsg({
        text: `⚖ Steered WETH oracle to $${priceUsd.toLocaleString()} & synced Uniswap v4 venue swap rate!`,
        type: "success",
      });
      fetchStatus();
    } catch (err) {
      setMsg({
        text: err instanceof Error ? err.message : String(err),
        type: "error",
      });
    } finally {
      setLoading(false);
    }
  };

  const switchPersona = (id: string) => {
    const connector = connectors.find((c) => c.id === `devnet-${id}`);
    if (connector) {
      connect({ connector, chainId: targetChain.id });
    }
  };

  return (
    <aside aria-label="Partner Testing Sandbox" className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2">
      {/* Floating Panel */}
      {isOpen && (
        <div
          role="region"
          aria-labelledby="partner-sandbox-heading"
          className="w-80 sm:w-96 rounded-2xl border border-[var(--base-blue-muted)] bg-[var(--surface-raised)]/95 backdrop-blur-md p-4 shadow-2xl text-[var(--foreground)] text-xs animate-in slide-in-from-bottom-3 duration-200"
        >
          <div className="flex items-center justify-between border-b border-[var(--border)] pb-2.5 mb-3">
            <div className="flex items-center gap-2">
              <span className="p-1 rounded-md bg-[var(--base-blue-faint)] text-[var(--base-blue-light)]">
                <FlaskIcon size={14} />
              </span>
              <div>
                <h3 id="partner-sandbox-heading" className="font-bold text-xs">Partner Testing Sandbox</h3>
                <p className="text-[10px] text-[var(--text-muted)]">Anvil Devnet · Chain {targetChain.id}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="Close partner sandbox"
              className="p-1 rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-overlay)] hover:text-[var(--foreground)] transition-colors"
            >
              <CloseIcon size={14} />
            </button>
          </div>

          {/* Status readout */}
          {status && (
            <div className="mb-3 rounded-lg bg-[var(--surface-overlay)] p-2 flex items-center justify-between text-[11px] font-mono">
              <div>
                <span className="text-[var(--text-muted)]">WETH: </span>
                <span className="font-bold text-[var(--foreground)]">${status.wethPrice}</span>
              </div>
              <div>
                <span className="text-[var(--text-muted)]">Clock: </span>
                <span className="text-[var(--foreground)]">
                  {new Date(status.timestamp * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            </div>
          )}

          {/* Feedback banner */}
          {msg && (
            <div
              className={`mb-3 p-2 rounded-lg text-[11px] leading-snug border ${
                msg.type === "success"
                  ? "bg-[var(--emerald-bg)] text-[var(--emerald-text)] border-[var(--emerald-border)]"
                  : "bg-[var(--red-bg)] text-[var(--red-text)] border-[var(--red-border)]"
              }`}
            >
              {msg.text}
            </div>
          )}

          {/* 1. Settlement Scenarios (Price Steer) */}
          <div className="space-y-1.5 mb-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              1. Settlement Scenario (Oracle Steer)
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                disabled={loading}
                onClick={() => handleSetPrice(3400)}
                className="py-1.5 px-2 rounded-lg bg-[var(--emerald-bg)] hover:bg-[var(--emerald-bg)]/80 text-[var(--emerald-text)] border border-[var(--emerald-border)] font-bold transition-all text-center cursor-pointer disabled:opacity-50"
                title="Pump spot price above $3,000 strike to make Call options In-The-Money"
              >
                Call ITM ($3.4k)
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => handleSetPrice(2200)}
                className="py-1.5 px-2 rounded-lg bg-[var(--red-bg)] hover:bg-[var(--red-bg)]/80 text-[var(--red-text)] border border-[var(--red-border)] font-bold transition-all text-center cursor-pointer disabled:opacity-50"
                title="Dump spot price below $3,000 strike to make Put options In-The-Money"
              >
                Put ITM ($2.2k)
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => handleSetPrice(3000)}
                className="py-1.5 px-2 rounded-lg bg-[var(--surface-overlay)] hover:bg-[var(--surface)] text-[var(--foreground)] border border-[var(--border)] font-medium transition-all text-center cursor-pointer disabled:opacity-50"
                title="Reset spot price to baseline $3,000 strike"
              >
                Reset ($3.0k)
              </button>
            </div>
            {/* Custom price */}
            <div className="flex gap-1.5 pt-1">
              <input
                type="number"
                placeholder="Custom USD (e.g. 3500)"
                value={customPrice}
                onChange={(e) => setCustomPrice(e.target.value)}
                className="w-full rounded-lg bg-[var(--surface-overlay)] border border-[var(--border)] px-2 py-1 text-xs text-[var(--foreground)] outline-none focus:border-[var(--base-blue)]"
              />
              <button
                type="button"
                disabled={loading || !customPrice}
                onClick={() => {
                  const p = parseFloat(customPrice);
                  if (p > 0) handleSetPrice(p);
                }}
                className="px-2.5 py-1 rounded-lg bg-[var(--base-blue)] hover:bg-[var(--base-blue-hover)] text-white font-semibold cursor-pointer disabled:opacity-50 text-[11px]"
              >
                Set
              </button>
            </div>
          </div>

          {/* 2. Time Travel (Expiry) */}
          <div className="space-y-1.5 mb-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              2. Fast-Forward Time (Test Expiry)
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                disabled={loading}
                onClick={() => handleTimeTravel("+1h")}
                className="py-1.5 px-2 rounded-lg bg-[var(--surface-overlay)] hover:bg-[var(--surface)] text-[var(--foreground)] border border-[var(--border)] font-semibold transition-all text-center cursor-pointer disabled:opacity-50"
              >
                +1 Hour
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => handleTimeTravel("+24h")}
                className="py-1.5 px-2 rounded-lg bg-[var(--amber-bg)] hover:bg-[var(--amber-bg)]/80 text-[var(--amber-text)] border border-[var(--amber-border)] font-bold transition-all text-center cursor-pointer disabled:opacity-50"
                title="Expires 24h positions so you can test Settle to LP / vault restaking"
              >
                +24h (Expire)
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => handleTimeTravel("+7d")}
                className="py-1.5 px-2 rounded-lg bg-[var(--amber-bg)] hover:bg-[var(--amber-bg)]/80 text-[var(--amber-text)] border border-[var(--amber-border)] font-bold transition-all text-center cursor-pointer disabled:opacity-50"
              >
                +7 Days
              </button>
            </div>
          </div>

          {/* 3. Quick Persona Switcher */}
          <div className="space-y-1.5 mb-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                3. Switch Test Persona
              </span>
              {isConnected && (
                <button
                  type="button"
                  onClick={() => disconnect()}
                  className="text-[10px] text-[var(--red-text)] hover:underline"
                >
                  Disconnect
                </button>
              )}
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {[
                { id: "elpi2", name: "Bob", role: "Taker / Buyer" },
                { id: "elpi1", name: "Alice", role: "LP Vault Owner" },
                { id: "elpi3", name: "Charlie", role: "Settlement Taker" },
              ].map((p) => {
                const isSelected =
                  isConnected &&
                  DEVNET_TEST_ACCOUNTS.find((a) => a.id === p.id)?.address.toLowerCase() ===
                    address?.toLowerCase();

                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => switchPersona(p.id)}
                    className={`py-1.5 px-1.5 rounded-lg border text-center transition-all cursor-pointer ${
                      isSelected
                        ? "border-[var(--emerald-border)] bg-[var(--emerald-bg)] text-[var(--emerald-text)] font-bold"
                        : "border-[var(--border)] bg-[var(--surface-overlay)] hover:bg-[var(--surface)] text-[var(--foreground)]"
                    }`}
                  >
                    <div className="font-semibold text-xs flex items-center justify-center gap-1">
                      {isSelected && <CheckIcon size={12} />}
                      {p.name}
                    </div>
                    <div className="text-[9px] text-[var(--text-muted)] truncate">{p.role}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Navigation Links */}
          <div className="border-t border-[var(--border)] pt-2.5 flex items-center justify-between text-[11px]">
            <Link
              href="/positions"
              className="text-[var(--base-blue-light)] hover:underline font-semibold flex items-center gap-1"
            >
              <span>Go to Positions & Settlement</span>
              <span>→</span>
            </Link>
            <Link href="/" className="text-[var(--text-muted)] hover:text-[var(--foreground)]">
              Trade View
            </Link>
          </div>
        </div>
      )}

      {/* Floating Launcher Pill */}
      <button
        type="button"
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen) fetchStatus();
        }}
        aria-expanded={isOpen}
        aria-label="Toggle Partner Sandbox Controls"
        className="flex items-center gap-2 rounded-full border border-[var(--base-blue-muted)] bg-[var(--surface-raised)]/90 backdrop-blur-md px-3.5 py-2 text-xs font-semibold text-[var(--foreground)] shadow-lg hover:border-[var(--base-blue)] hover:bg-[var(--surface-overlay)] transition-all cursor-pointer group"
      >
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--emerald-text)] opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--emerald-text)]" />
        </span>
        <FlaskIcon size={14} className="text-[var(--base-blue-light)] group-hover:rotate-12 transition-transform" />
        <span>Partner Sandbox</span>
        {status && <span className="font-mono text-[11px] text-[var(--text-muted)]">${status.wethPrice}</span>}
      </button>
    </aside>
  );
}
