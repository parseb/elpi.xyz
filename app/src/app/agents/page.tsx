"use client";

import { useState } from "react";
import { Badge, Button, Card, InfoTooltip, PageHeader, Tooltip, inputClass } from "@/components/ui";

export default function AgentsPage() {
  const [testDuration, setTestDuration] = useState("24");
  const [testUnits, setTestUnits] = useState("10");
  const [testOptionType, setTestOptionType] = useState<"0" | "1">("0");
  const [allocResult, setAllocResult] = useState<Record<string, unknown> | null>(null);
  const [mintResult, setMintResult] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [simulatePaymentHeader, setSimulatePaymentHeader] = useState(false);

  const [activeCodeTab, setActiveCodeTab] = useState<"ts" | "py" | "curl" | "mcp">("ts");

  async function runAllocateTest() {
    setLoading(true);
    setAllocResult(null);
    try {
      const res = await fetch("/api/agents/allocate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          durationHours: Number(testDuration),
          desiredUnits: testUnits,
          optionType: Number(testOptionType),
        }),
      });
      const data = await res.json();
      setAllocResult(data);
    } catch (e) {
      setAllocResult({ error: String(e) });
    } finally {
      setLoading(false);
    }
  }

  async function runMintTest() {
    setLoading(true);
    setMintResult(null);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (simulatePaymentHeader) {
        headers["X-402-Payment"] = "X-402 payload=eip3009_usdc_authorization_signed_by_agent";
      }

      const res = await fetch("/api/agents/mint", {
        method: "POST",
        headers,
        body: JSON.stringify({
          durationHours: Number(testDuration),
          desiredUnits: testUnits,
          optionType: Number(testOptionType),
        }),
      });
      const data = await res.json();
      setMintResult({
        httpStatus: res.status,
        x402Header: res.headers.get("X-402-Payment-Required"),
        body: data,
      });
    } catch (e) {
      setMintResult({ error: String(e) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="Agent Protocol (x402)"
        tooltip="Machine-to-machine AI Agent interface allowing automated options hedging and HTTP 402 micro-payment execution."
        actions={
          <div className="flex items-center gap-2">
            <Badge tone="blue" tooltip="Native deployment on Base with standard ERC-721 positions.">
              Base Native
            </Badge>
            <Badge tone="emerald" tooltip="Supports standard HTTP 402 Payment Required for autonomous agents.">
              x402 Supported
            </Badge>
          </div>
        }
      />

      {/* Protocol Endpoints Summary */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-[var(--foreground)] flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--base-blue-faint)] text-xs text-[var(--base-blue-light)] font-bold">1</span>
              <span>Discovery &amp; Allocation</span>
            </h3>
            <InfoTooltip content="Autonomous agents call this REST endpoint to solve the optimal LP routing problem and compute premium costs." size={12} />
          </div>
          <div className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-2.5 font-mono text-xs text-[var(--text-muted)]">
            <div className="font-semibold text-[var(--foreground)]">POST /api/agents/allocate</div>
            <div className="text-[var(--base-blue-light)] text-[11px] mt-1">{"{ durationHours: 24, desiredUnits: '10', optionType: 0 }"}</div>
          </div>
        </Card>

        <Card className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-[var(--foreground)] flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--base-blue-faint)] text-xs text-[var(--base-blue-light)] font-bold">2</span>
              <span>x402 Payment Handshake</span>
            </h3>
            <InfoTooltip content="Server returns HTTP 402 with EIP-3009 payment requirements. Agent replies with signed authorization header." size={12} />
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-2.5 font-mono text-xs text-[var(--text-muted)]">
            <div className="font-semibold text-[var(--amber-text)]">HTTP 402 Payment Required</div>
            <div className="text-[var(--text-muted)] text-[11px] mt-1">Header: X-402-Payment (EIP-3009 / EIP-712)</div>
          </div>
        </Card>
      </div>

      {/* Interactive Agent Console */}
      <Card className="flex flex-col gap-5 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <h3 className="text-base font-bold text-[var(--foreground)]">Agent Testing Console</h3>
            <InfoTooltip content="Simulate agent API calls and x402 payment authorization handshakes." size={13} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)] font-bold">
            <span className="flex items-center gap-1">
              <span>Duration (Hours)</span>
              <InfoTooltip content="Requested option validity period in hours." size={11} />
            </span>
            <input
              type="number"
              className={inputClass}
              value={testDuration}
              onChange={(e) => setTestDuration(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)] font-bold">
            <span className="flex items-center gap-1">
              <span>Desired Units</span>
              <InfoTooltip content="Desired option contract size (100 units = 1.0 underlying)." size={11} />
            </span>
            <input
              type="number"
              className={inputClass}
              value={testUnits}
              onChange={(e) => setTestUnits(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)] font-bold">
            <span className="flex items-center gap-1">
              <span>Option Type</span>
              <InfoTooltip content="0 for Call (Bullish), 1 for Put (Bearish)." size={11} />
            </span>
            <select
              className={inputClass}
              value={testOptionType}
              onChange={(e) => setTestOptionType(e.target.value as "0" | "1")}
            >
              <option value="0">CALL (Bullish)</option>
              <option value="1">PUT (Bearish)</option>
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            onClick={runAllocateTest}
            disabled={loading}
            tooltip="Calculate optimal LP matching allocation and required premium."
          >
            {loading ? "Calculating..." : "Test Allocate"}
          </Button>
          <Button
            variant="secondary"
            onClick={runMintTest}
            disabled={loading}
            tooltip="Trigger HTTP 402 payment challenge or verify signed header."
          >
            {loading ? "Testing..." : "Test Mint (x402)"}
          </Button>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-muted)] cursor-pointer">
            <input
              type="checkbox"
              checked={simulatePaymentHeader}
              onChange={(e) => setSimulatePaymentHeader(e.target.checked)}
              className="rounded border-[var(--border)] text-[var(--base-blue)] focus:ring-0 cursor-pointer"
            />
            <span>Attach Simulated x402 Header</span>
          </label>
        </div>

        {allocResult && (
          <div className="flex flex-col gap-2">
            <div className="text-xs font-bold text-[var(--base-blue-light)]">Allocation Response:</div>
            <pre className="max-h-60 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-4 font-mono text-xs text-[var(--emerald-text)]">
              {JSON.stringify(allocResult, null, 2)}
            </pre>
          </div>
        )}

        {mintResult && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs font-bold">
              <span className="text-[var(--foreground)]">x402 Mint Handshake Response:</span>
              <span className={`font-mono ${mintResult.httpStatus === 402 ? "text-[var(--amber-text)]" : "text-[var(--emerald-text)]"}`}>
                HTTP Status: {String(mintResult.httpStatus)}
              </span>
            </div>
            <pre className="max-h-60 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-4 font-mono text-xs text-[var(--amber-text)]">
              {JSON.stringify(mintResult, null, 2)}
            </pre>
          </div>
        )}
      </Card>

      {/* Code Examples */}
      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-3">
          <h3 className="text-base font-bold text-[var(--foreground)]">Integration Code</h3>
          <div role="tablist" aria-label="Code example languages" className="flex gap-1 rounded-xl bg-[var(--surface-raised)] p-1 border border-[var(--border)]">
            {(["ts", "py", "curl", "mcp"] as const).map((tab) => (
              <button
                key={tab}
                role="tab"
                aria-selected={activeCodeTab === tab}
                type="button"
                onClick={() => setActiveCodeTab(tab)}
                className={`min-h-[32px] rounded-lg px-3 py-1 text-xs font-semibold transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--base-blue)] ${
                  activeCodeTab === tab
                    ? "bg-[var(--base-blue)] text-white shadow-xs"
                    : "text-[var(--text-muted)] hover:text-[var(--foreground)]"
                }`}
              >
                {tab === "ts" ? "TypeScript" : tab === "py" ? "Python" : tab === "curl" ? "cURL" : "MCP Spec"}
              </button>
            ))}
          </div>
        </div>

        {activeCodeTab === "ts" && (
          <pre className="overflow-x-auto rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-4 font-mono text-xs text-neutral-200">
{`import { createWalletClient, http } from "viem";
import { base } from "viem/chains";

// 1. Agent computes allocation and USDC premium via REST API
const allocRes = await fetch("https://your-domain.com/api/agents/allocate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ durationHours: 24, desiredUnits: "10", optionType: 0 })
});
const alloc = await allocRes.json();
console.log("Required USDC Premium:", alloc.allocation.totalPremiumUsdc);

// 2. Request x402 payment specs
const mintRes = await fetch("https://your-domain.com/api/agents/mint", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ durationHours: 24, desiredUnits: "10", optionType: 0 })
});

if (mintRes.status === 402) {
  const x402Spec = await mintRes.json();
  console.log("x402 Payment Terms:", x402Spec.x402);

  // 3. Agent executes payment authorization header & mint execution
  const payRes = await fetch("https://your-domain.com/api/agents/mint", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-402-Payment": JSON.stringify({ signedAuthorization: "..." })
    },
    body: JSON.stringify({ durationHours: 24, desiredUnits: "10", optionType: 0 })
  });
  const receipt = await payRes.json();
  console.log("Option Mint Confirmed:", receipt);
}`}
          </pre>
        )}

        {activeCodeTab === "py" && (
          <pre className="overflow-x-auto rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-4 font-mono text-xs text-neutral-200">
{`import requests

BASE_URL = "https://your-domain.com"

# 1. Query optimal liquidity allocation
res = requests.post(f"{BASE_URL}/api/agents/allocate", json={
    "durationHours": 24,
    "desiredUnits": "10",
    "optionType": 0
})
allocation = res.json()
print(f"Premium: {allocation['allocation']['totalPremiumUsdc']} USDC")

# 2. Trigger x402 payment challenge
mint_req = requests.post(f"{BASE_URL}/api/agents/mint", json={
    "durationHours": 24,
    "desiredUnits": "10",
    "optionType": 0
})

if mint_req.status_code == 402:
    payment_spec = mint_req.json()
    print("x402 Challenge Received:", payment_spec["x402"])
    
    # 3. Attach X-402-Payment authorization header
    headers = {"X-402-Payment": "SIGNED_EIP3009_PAYMENT_PROOF"}
    confirmed = requests.post(f"{BASE_URL}/api/agents/mint", json={
        "durationHours": 24,
        "desiredUnits": "10",
        "optionType": 0
    }, headers=headers)
    print("Mint Result:", confirmed.json())`}
          </pre>
        )}

        {activeCodeTab === "curl" && (
          <pre className="overflow-x-auto rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-4 font-mono text-xs text-neutral-200">
{`# 1. Allocate liquidity & get x402 payment quote
curl -X POST http://localhost:3000/api/agents/allocate \\
  -H "Content-Type: application/json" \\
  -d '{"durationHours": 24, "desiredUnits": "10", "optionType": 0}'

# 2. Request x402 payment specs (Returns HTTP 402)
curl -i -X POST http://localhost:3000/api/agents/mint \\
  -H "Content-Type: application/json" \\
  -d '{"durationHours": 24, "desiredUnits": "10", "optionType": 0}'

# 3. Send x402 Payment Header
curl -X POST http://localhost:3000/api/agents/mint \\
  -H "Content-Type: application/json" \\
  -H "X-402-Payment: X-402-AUTHORIZATION-TOKEN" \\
  -d '{"durationHours": 24, "desiredUnits": "10", "optionType": 0}'`}
          </pre>
        )}

        {activeCodeTab === "mcp" && (
          <pre className="overflow-x-auto rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-4 font-mono text-xs text-emerald-400">
{`{
  "name": "elpi_allocate_and_mint",
  "description": "Calculate optimal options liquidity allocation on Base / Uniswap v4 and execute option mint with x402 USDC premium payment.",
  "parameters": {
    "type": "object",
    "properties": {
      "durationHours": { "type": "number", "description": "Option duration in hours (e.g. 24)" },
      "desiredUnits": { "type": "string", "description": "Number of option units desired (e.g. '10')" },
      "optionType": { "type": "number", "description": "0 for CALL, 1 for PUT" },
      "collateralAsset": { "type": "string", "description": "Optional token contract address on Base" }
    },
    "required": ["durationHours", "desiredUnits", "optionType"]
  }
}`}
          </pre>
        )}
      </Card>
    </div>
  );
}
