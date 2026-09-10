"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatUnits } from "viem";
import { useBalance, useConnect, useConnection, useDisconnect, useSwitchChain } from "wagmi";
import { environmentName, isDev, isSepolia, targetChain } from "@/config/chain";
import { ArrowRightIcon, CloseIcon, CopyIcon, FlaskIcon, LogOutIcon, WalletIcon } from "@/components/icons";

function short(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// Brand Icons
function CoinbaseBrandIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect width="24" height="24" rx="5.4" fill="var(--base-blue)" />
      <path
        d="M12 3.6A8.4 8.4 0 1 0 12 20.4 8.4 8.4 0 0 0 12 3.6Zm-2.4 5.1h4.8a1.5 1.5 0 0 1 1.5 1.5v3.6a1.5 1.5 0 0 1-1.5 1.5H9.6a1.5 1.5 0 0 1-1.5-1.5v-3.6a1.5 1.5 0 0 1 1.5-1.5Z"
        fill="var(--text-on-action)"
      />
    </svg>
  );
}

/* ds-allow-hardcode:start */
function MetaMaskBrandIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path
        d="M30.1 1.7L18.4 10.3l2.2-5.3L30.1 1.7zM1.9 1.7l11.6 8.7-2.1-5.4L1.9 1.7zM25.7 22.8l3.1-4.8 2.2-8.8-10.4 4.7 5.1 8.9zm-19.4 0l-5.1-8.9L.8 9.2l2.2 8.8 3.3 4.8z"
        fill="#E17726"
      />
      <path
        d="M11.6 13.9l-2.4 3.7 8.7.4-2.5-3.8-3.8-.3zm8.8 0l-3.8.3-2.5 3.8 8.7-.4-2.4-3.7z"
        fill="#E2761B"
      />
      <path
        d="M6.3 22.8l4.4 3.5v-3.2l-4.4-.3zm15.1 0l-4.4.3v3.2l4.4-3.5z"
        fill="#E4761B"
      />
      <path
        d="M10.7 26.3l4.8 2.4.4-3.6-4.5-3.3-.7 4.5zm10.6 0l-.7-4.5-4.5 3.3.4 3.6 4.8-2.4z"
        fill="#D7C1B3"
      />
      <path
        d="M15.5 28.7l.5.3.5-.3v-3.6h-1v3.6z"
        fill="#233238"
      />
      <path
        d="M20.6 22.8l-4.7 3.5h.1v.4l4.6-2.3 4.4-3.5-4.4 1.9zm-13.8 0l-4.4-1.9 4.4 3.5 4.6 2.3v-.4h.1l-4.7-3.5z"
        fill="#D7C1B3"
      />
      <path
        d="M27.5 9.2L17.1 13.9l.9-4.9L30.1 1.7 27.5 9.2zM4.5 9.2L14 9l.9 4.9L4.5 9.2z"
        fill="#233238"
      />
      <path
        d="M10.7 17.6l-4.4-4.7L1.9 9.2l1.3 6.9 3.1 6.7 4.4-5.2zm10.6 0l4.4 5.2 3.1-6.7 1.3-6.9-4.4 3.7-4.4 4.7z"
        fill="#CD6116"
      />
      <path
        d="M16 23.2l-3.8-.4-2.4 3.5.7-4.5 4.5 3.3h1l4.5-3.3.7 4.5-2.4-3.5-3.8.4z"
        fill="#E4751F"
      />
    </svg>
  );
}
/* ds-allow-hardcode:end */
import { DEVNET_TEST_ACCOUNTS } from "@/config/devWalletConnector";

export function ConnectButton() {
  const { address, isConnected, chainId } = useConnection();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const { disconnect } = useDisconnect();
  const { data: balance } = useBalance({ address, chainId: targetChain.id });

  const [modalOpen, setModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const isWrongChain = isConnected && chainId !== targetChain.id;

  // Auto-prompt network switch if connected to different chain
  useEffect(() => {
    if (isConnected && chainId && chainId !== targetChain.id) {
      try {
        switchChain({ chainId: targetChain.id });
      } catch {
        // User may reject or wallet may not support silent switch
      }
    }
  }, [isConnected, chainId, switchChain]);

  const copyAddress = () => {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyPk = (pk: string, name: string) => {
    navigator.clipboard.writeText(pk);
    setCopiedKey(name);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  if (isConnected && address) {
    return (
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2 text-sm">
        <div role="status" aria-live="polite" className="sr-only">
          {copied ? "Address copied to clipboard" : copiedKey ? `Private key for ${copiedKey} copied to clipboard` : ""}
        </div>

        {isWrongChain ? (
          <button
            type="button"
            onClick={() => switchChain({ chainId: targetChain.id })}
            disabled={isSwitching}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--amber-border)] bg-[var(--amber-bg)] px-2.5 sm:px-3 text-xs font-bold text-[var(--amber-text)] hover:opacity-90 transition-opacity focus-visible:ring-2 focus-visible:ring-[var(--amber-border)] cursor-pointer"
            title={`Connected to chain ${chainId}. Click to switch to ${targetChain.name}`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--amber-text)] animate-ping" />
            <span>{isSwitching ? "Switching..." : <><span className="hidden sm:inline">Switch to </span>{targetChain.name}</>}</span>
          </button>
        ) : (
          <>
            <span className="hidden md:inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--base-blue-faint)] px-2.5 py-1 text-xs font-semibold text-[var(--base-blue-light)] border border-[var(--base-blue-muted)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--base-blue)] animate-pulse" />
              {targetChain.name}
            </span>
            {balance && (
              <span className="hidden lg:inline-flex h-9 items-center font-mono text-xs font-bold text-[var(--foreground)] bg-[var(--surface-raised)] border border-[var(--border)] px-2.5 py-1 rounded-lg tabular-nums">
                {Number(formatUnits(balance.value, balance.decimals)).toLocaleString(undefined, { maximumFractionDigits: 2 })} {balance.symbol}
              </span>
            )}
          </>
        )}

        <button
          type="button"
          onClick={copyAddress}
          aria-label={copied ? "Address copied" : `Copy address ${short(address)}`}
          title="Click to copy address"
          className="inline-flex h-9 items-center gap-1.5 font-mono text-xs text-[var(--foreground)] hover:text-[var(--base-blue-light)] transition-colors rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] px-2.5 sm:px-3 focus-visible:ring-2 focus-visible:ring-[var(--base-blue)] cursor-pointer"
        >
          <CopyIcon size={12} className="text-[var(--text-muted)]" />
          <span>{copied ? "Copied" : short(address)}</span>
        </button>

        <button
          type="button"
          onClick={() => setModalOpen(true)}
          aria-label="Switch wallet account"
          title="Switch Wallet Account"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-2.5 sm:px-3 text-xs font-semibold text-[var(--text-muted)] hover:bg-[var(--surface-overlay)] hover:text-[var(--foreground)] transition-colors focus-visible:ring-2 focus-visible:ring-[var(--base-blue)] cursor-pointer"
        >
          <FlaskIcon size={14} className="sm:hidden" aria-hidden="true" />
          <span className="hidden sm:inline">Switch Wallet</span>
        </button>

        <button
          type="button"
          onClick={() => disconnect()}
          aria-label="Disconnect wallet"
          title="Disconnect wallet"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--red-border)] bg-[var(--red-bg)] px-2.5 sm:px-3 text-xs font-semibold text-[var(--red-text)] hover:opacity-80 transition-opacity focus-visible:ring-2 focus-visible:ring-[var(--red-border)] cursor-pointer"
        >
          <LogOutIcon size={14} className="sm:hidden" aria-hidden="true" />
          <span className="hidden sm:inline">Disconnect</span>
        </button>

        {modalOpen && (
          <WalletModal
            onClose={() => setModalOpen(false)}
            copyPk={copyPk}
            copiedKey={copiedKey}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
      <span
        className={`hidden sm:inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold border ${
          isDev
            ? "bg-[var(--emerald-bg)] text-[var(--emerald-text)] border-[var(--emerald-border)]"
            : isSepolia
            ? "bg-[var(--amber-bg)] text-[var(--amber-text)] border-[var(--amber-border)]"
            : "bg-[var(--base-blue-faint)] text-[var(--base-blue-light)] border-[var(--base-blue-muted)]"
        }`}
        title={`Active Environment: ${environmentName} (Chain ID: ${targetChain.id})`}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            isDev
              ? "bg-[var(--emerald-text)] animate-pulse"
              : isSepolia
              ? "bg-[var(--amber-text)] animate-pulse"
              : "bg-[var(--base-blue)] animate-pulse"
          }`}
        />
        {targetChain.name}
      </span>

      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--base-blue)] px-3.5 py-2 text-xs sm:text-sm font-semibold text-white transition-colors hover:bg-[var(--base-blue-hover)] focus-visible:ring-2 focus-visible:ring-[var(--base-blue)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] cursor-pointer shadow-sm"
      >
        <WalletIcon size={16} />
        <span>Connect Wallet</span>
      </button>

      {modalOpen && (
        <WalletModal
          onClose={() => setModalOpen(false)}
          copyPk={copyPk}
          copiedKey={copiedKey}
        />
      )}
    </div>
  );
}

function WalletModal({
  onClose,
  copyPk,
  copiedKey,
}: {
  onClose: () => void;
  copyPk: (pk: string, name: string) => void;
  copiedKey: string | null;
}) {
  const { address, isConnected, chainId } = useConnection();
  const { connect, connectors, isPending, error } = useConnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const isWrongChain = isConnected && chainId !== targetChain.id;

  const [activeTab, setActiveTab] = useState<"external" | "devnet">("external");
  const dialogRef = useRef<HTMLDivElement>(null);

  // Close modal when Escape key is pressed
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="wallet-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="relative w-full max-w-md my-auto max-h-[90vh] overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl text-[var(--foreground)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] pb-4 mb-4">
          <div className="flex items-center gap-2.5">
            <WalletIcon size={20} className="text-[var(--base-blue-light)]" />
            <h2 id="wallet-modal-title" className="text-base font-bold">
              Connect Wallet
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close connect wallet modal"
            className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--foreground)] transition-colors focus-visible:ring-2 focus-visible:ring-[var(--base-blue)] cursor-pointer"
          >
            <CloseIcon size={18} />
          </button>
        </div>

        {/* Target Network Banner */}
        <div className="mb-4 flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-3 text-xs">
          <div>
            <div className="font-medium text-[var(--text-muted)]">Target Network</div>
            <div className="font-bold text-[var(--foreground)]">{targetChain.name} (Chain {targetChain.id})</div>
          </div>
          {isWrongChain && switchChain ? (
            <button
              type="button"
              onClick={() => switchChain({ chainId: targetChain.id })}
              disabled={isSwitching}
              className="rounded-lg bg-[var(--base-blue)] px-3 py-1.5 text-xs font-bold text-white hover:bg-[var(--base-blue-hover)] transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--base-blue)]"
            >
              {isSwitching ? "Switching..." : `Switch to ${targetChain.name}`}
            </button>
          ) : (
            <span
              className={`rounded-md px-2 py-0.5 text-xs font-bold border ${
                isDev
                  ? "bg-[var(--emerald-bg)] text-[var(--emerald-text)] border-[var(--emerald-border)]"
                  : isSepolia
                  ? "bg-[var(--amber-bg)] text-[var(--amber-text)] border-[var(--amber-border)]"
                  : "bg-[var(--base-blue-faint)] text-[var(--base-blue-light)] border-[var(--base-blue-muted)]"
              }`}
            >
              {isDev ? "Local Anvil Devnet" : isSepolia ? "Base Sepolia" : "Base Mainnet"}
            </span>
          )}
        </div>

        {/* Local Devnet Helper Notice */}
        {isDev && (
          <div className="mb-4 rounded-xl bg-[var(--base-blue-faint)] border border-[var(--base-blue-muted)] p-3 text-xs text-[var(--base-blue-light)] space-y-1.5">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-bold text-[var(--foreground)]">Local Devnet Mode</span>
                <span className="text-[var(--text-muted)] ml-1.5 font-mono">Chain ID {targetChain.id}</span>
              </div>
              <span className="font-mono text-[11px] text-[var(--text-muted)]">127.0.0.1:8545</span>
            </div>
            {targetChain.id === 8453 ? (
              <p className="text-[11px] text-[var(--amber-text)] bg-[var(--amber-bg)] border border-[var(--amber-border)] rounded-lg p-2 font-medium">
                ⚠️ <strong>Rabby / External Wallets:</strong> Chain ID 8453 is recognized as <em>Base Mainnet</em>. To route transactions to Anvil, either set Rabby Custom RPC for Base to <code>http://127.0.0.1:8545</code>, or restart devnet with default Chain ID <code>31337</code> (which prompts Rabby to switch to Anvil automatically).
              </p>
            ) : (
              <p className="text-[11px] text-[var(--text-muted)]">
                External wallets (Rabby, MetaMask) will prompt to switch to <strong>{targetChain.name}</strong> (RPC: <code>http://127.0.0.1:8545</code>). Approve the prompt to submit transactions to Anvil.
              </p>
            )}
          </div>
        )}

        {/* Tab Selection (Devnet only) */}
        {isDev && (
          <div
            role="tablist"
            aria-label="Wallet connector options"
            className="grid grid-cols-2 gap-2 mb-4 rounded-xl bg-[var(--surface-raised)] p-1.5 border border-[var(--border)] text-xs font-semibold"
          >
            <button
              role="tab"
              aria-selected={activeTab === "external"}
              aria-controls="panel-external"
              id="tab-external"
              type="button"
              onClick={() => setActiveTab("external")}
              className={`flex min-h-9 items-center justify-center gap-2 py-2 rounded-lg transition-all cursor-pointer ${
                activeTab === "external"
                  ? "bg-[var(--base-blue)] text-white shadow-xs"
                  : "text-[var(--text-muted)] hover:text-[var(--foreground)]"
              }`}
            >
              <MetaMaskBrandIcon size={16} />
              External Wallet
            </button>
            <button
              role="tab"
              aria-selected={activeTab === "devnet"}
              aria-controls="panel-devnet"
              id="tab-devnet"
              type="button"
              onClick={() => setActiveTab("devnet")}
              className={`flex min-h-9 items-center justify-center gap-2 py-2 rounded-lg transition-all cursor-pointer ${
                activeTab === "devnet"
                  ? "bg-[var(--base-blue)] text-white shadow-xs"
                  : "text-[var(--text-muted)] hover:text-[var(--foreground)]"
              }`}
            >
              <FlaskIcon size={16} />
              Devnet Test Accounts
            </button>
          </div>
        )}

        {/* External Wallets Tab */}
        {(!isDev || activeTab === "external") && (
          <div id="panel-external" role="tabpanel" aria-labelledby="tab-external" className="flex flex-col gap-2.5">
            <p className="text-xs text-[var(--text-muted)] mb-1">
              Select your browser wallet (MetaMask, Rabby, Coinbase Wallet, etc.):
            </p>

            {connectors.map((connector) => {
              const isMetaMask = connector.name.toLowerCase().includes("metamask") || connector.id === "injected";
              const isCoinbase = connector.id === "coinbaseWalletSDK" || connector.name.toLowerCase().includes("coinbase");

              return (
                <button
                  key={connector.uid}
                  type="button"
                  disabled={isPending}
                  onClick={() => {
                    connect({ connector, chainId: targetChain.id });
                    onClose();
                  }}
                  className="flex min-h-[48px] items-center justify-between w-full rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-3 text-sm font-medium hover:border-[var(--base-blue)] hover:bg-[var(--surface-overlay)] transition-all group disabled:opacity-50 cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--base-blue)]"
                >
                  <div className="flex items-center gap-3">
                    {isCoinbase ? (
                      <CoinbaseBrandIcon size={24} />
                    ) : (
                      <MetaMaskBrandIcon size={24} />
                    )}
                    <div className="text-left">
                      <div className="font-semibold text-xs text-[var(--foreground)]">{connector.name}</div>
                      <div className="text-xs text-[var(--text-muted)]">
                        {isMetaMask ? "Browser Extension (MetaMask, Rabby, Brave)" : "Ecosystem Wallet"}
                      </div>
                    </div>
                  </div>
                  <ArrowRightIcon size={14} className="text-[var(--text-muted)] group-hover:text-[var(--foreground)] group-hover:translate-x-0.5 transition-all" />
                </button>
              );
            })}

            {error && (
              <div className="mt-2 rounded-lg bg-[var(--red-bg)] p-3 text-xs text-[var(--red-text)] border border-[var(--red-border)]">
                <p className="font-semibold mb-1">Connection Error:</p>
                <p>{error.message}</p>
                {isDev && (
                  <p className="mt-1.5 opacity-90">
                    Tip: Ensure Rabby or MetaMask approves the network switch to <strong>{targetChain.name}</strong> (Chain ID {targetChain.id}, RPC: <code>http://127.0.0.1:8545</code>), or use the <strong>Devnet Test Accounts</strong> tab to import a key.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Devnet Test Accounts Tab (Devnet only) */}
        {isDev && activeTab === "devnet" && (
          <div id="panel-devnet" role="tabpanel" aria-labelledby="tab-devnet" className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between rounded-xl bg-[var(--base-blue-faint)] border border-[var(--base-blue-muted)] p-3 text-xs text-[var(--base-blue-light)]">
              <div>
                <p className="font-bold mb-0.5">Instant Synthetic Dev Wallets</p>
                <p className="text-xs text-[var(--text-muted)]">Connect directly with 1-click & zero manual popups, or copy private key.</p>
              </div>
              {switchChain && isWrongChain && (
                <button
                  type="button"
                  onClick={() => switchChain({ chainId: targetChain.id })}
                  className="rounded-lg bg-[var(--base-blue)] px-2.5 py-1 text-xs font-bold text-white hover:bg-[var(--base-blue-hover)] transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--base-blue)]"
                >
                  Switch Network
                </button>
              )}
            </div>

            <div className="flex flex-col gap-2 max-h-72 overflow-y-auto pr-1">
              {DEVNET_TEST_ACCOUNTS.map((acc) => {
                const isCurrentActive = isConnected && address?.toLowerCase() === acc.address.toLowerCase();
                const devConnector = connectors.find((c) => c.id === `devnet-${acc.id}`);

                return (
                  <div
                    key={acc.address}
                    className={`flex items-center justify-between rounded-xl border p-3 text-sm transition-all ${
                      isCurrentActive
                        ? "border-[var(--emerald-border)] bg-[var(--emerald-bg)]"
                        : "border-[var(--border)] bg-[var(--surface-raised)]"
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-[var(--foreground)]">{acc.name}</span>
                        <span className="rounded-md bg-[var(--surface-overlay)] px-1.5 py-0.5 text-xs font-semibold text-[var(--text-muted)]">
                          {acc.role}
                        </span>
                        {isCurrentActive && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-[var(--emerald-text)]/10 px-1.5 py-0.5 text-[10px] font-bold text-[var(--emerald-text)]">
                            <span className="h-1.5 w-1.5 rounded-full bg-[var(--emerald-text)] animate-pulse" />
                            Active
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-xs text-[var(--text-muted)] flex items-center gap-2">
                        <span>{short(acc.address)}</span>
                        <span className="text-[10px] text-[var(--text-muted)]/70" title={acc.pk}>
                          PK: {acc.pk.slice(0, 6)}...{acc.pk.slice(-4)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {devConnector && !isCurrentActive && (
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => {
                            connect({ connector: devConnector, chainId: targetChain.id });
                            onClose();
                          }}
                          className="inline-flex min-h-[32px] items-center gap-1 rounded-lg bg-[var(--base-blue)] hover:bg-[var(--base-blue-hover)] px-2.5 py-1 text-xs font-bold text-white transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--base-blue)]"
                        >
                          <span>Connect</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => copyPk(acc.pk, acc.name)}
                        className="inline-flex min-h-[32px] items-center gap-1 rounded-lg bg-[var(--surface-overlay)] hover:bg-[var(--surface-raised)] border border-[var(--border)] px-2 py-1 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--foreground)] transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--base-blue)]"
                        title={`Copy private key: ${acc.pk}`}
                      >
                        <CopyIcon size={12} />
                        <span>{copiedKey === acc.name ? "Copied PK!" : "Copy PK"}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-5 pt-3 border-t border-[var(--border)] text-center text-xs text-[var(--text-muted)]">
          elpi.xyz · Uniswap v4 · {environmentName} (Chain {targetChain.id})
        </div>
      </div>
    </div>,
    document.body
  );
}
