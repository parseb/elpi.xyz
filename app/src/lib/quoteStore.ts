import {
  type SerializedSignedBackerQuote,
  type SignedBackerQuote,
  deserializeQuote,
  serializeQuote,
} from "./backerQuote";

// Backer quote storage backed by the local SQLite database via API routes.
// Same refactor as profileStore: localStorage → server-persisted SQLite.

export interface ListQuotesOptions {
  status?: "active" | "historical" | "all";
  collateral?: string;
  backer?: string;
}

export async function listQuotes(options: ListQuotesOptions = {}): Promise<SignedBackerQuote[]> {
  try {
    const params = new URLSearchParams();
    if (options.status) params.set("status", options.status);
    if (options.collateral) params.set("collateral", options.collateral);
    if (options.backer) params.set("backer", options.backer);

    const query = params.toString() ? `?${params.toString()}` : "";
    const res = await fetch(`/api/quotes${query}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { quotes: SerializedSignedBackerQuote[] };
    return (data.quotes ?? []).map(deserializeQuote);
  } catch {
    return [];
  }
}

export async function saveQuote(quote: SignedBackerQuote): Promise<void> {
  await fetch("/api/quotes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(serializeQuote(quote)),
  });
}

export async function removeQuote(hash: string, hard = false): Promise<void> {
  await fetch(`/api/quotes/${encodeURIComponent(hash)}${hard ? "?hard=true" : ""}`, { method: "DELETE" });
}

export async function markQuoteHistorical(hash: string): Promise<void> {
  await fetch(`/api/quotes/${encodeURIComponent(hash)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "historical" }),
  });
}

export function exportQuoteJson(quote: SignedBackerQuote): string {
  return JSON.stringify(serializeQuote(quote), null, 2);
}

export function importQuoteJson(json: string): SignedBackerQuote {
  return deserializeQuote(JSON.parse(json) as SerializedSignedBackerQuote);
}
