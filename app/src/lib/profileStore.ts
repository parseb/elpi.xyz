import {
  type SerializedSignedLiquidityProfile,
  type SignedLiquidityProfile,
  deserializeProfile,
  serializeProfile,
} from "./liquidityProfile";

// Profile storage backed by the local SQLite database via API routes.
// Replaces the previous localStorage-based store — profiles are now
// server-persisted and shared across all clients (the order book is the
// product, not a per-browser artifact).

export interface ListProfilesOptions {
  status?: "active" | "historical" | "all";
  collateral?: string;
  lp?: string;
}

export async function listProfiles(options: ListProfilesOptions = {}): Promise<SignedLiquidityProfile[]> {
  try {
    const params = new URLSearchParams();
    if (options.status) params.set("status", options.status);
    if (options.collateral) params.set("collateral", options.collateral);
    if (options.lp) params.set("lp", options.lp);

    const query = params.toString() ? `?${params.toString()}` : "";
    const res = await fetch(`/api/profiles${query}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { profiles: SerializedSignedLiquidityProfile[] };
    return (data.profiles ?? []).map(deserializeProfile);
  } catch {
    return [];
  }
}

export async function saveProfile(profile: SignedLiquidityProfile): Promise<void> {
  await fetch("/api/profiles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(serializeProfile(profile)),
  });
}

export async function removeProfile(hash: string, hard = false): Promise<void> {
  await fetch(`/api/profiles/${encodeURIComponent(hash)}${hard ? "?hard=true" : ""}`, { method: "DELETE" });
}

export async function markProfileHistorical(hash: string): Promise<void> {
  await fetch(`/api/profiles/${encodeURIComponent(hash)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "historical" }),
  });
}

export function exportProfileJson(profile: SignedLiquidityProfile): string {
  return JSON.stringify(serializeProfile(profile), null, 2);
}

export function importProfileJson(json: string): SignedLiquidityProfile {
  const parsed = JSON.parse(json) as SerializedSignedLiquidityProfile;
  return deserializeProfile(parsed);
}
