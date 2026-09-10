/**
 * Detects if an error was caused by a user cancelling or rejecting a transaction in their wallet.
 */
export function isUserRejection(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  return (
    lower.includes("user rejected") ||
    lower.includes("user denied") ||
    lower.includes("user cancelled") ||
    lower.includes("user canceled") ||
    lower.includes("action_rejected") ||
    lower.includes("rejected the request") ||
    lower.includes("denied transaction") ||
    lower.includes("rejected transaction") ||
    (typeof err === "object" &&
      err !== null &&
      "code" in err &&
      ((err as { code: unknown }).code === 4001 || (err as { code: unknown }).code === "ACTION_REJECTED")) ||
    (typeof err === "object" &&
      err !== null &&
      "cause" in err &&
      isUserRejection((err as { cause: unknown }).cause))
  );
}

/**
 * Parses any error into a clean short summary, a full technical string for copying,
 * and a boolean indicating if it was a user rejection.
 */
export function parseFriendlyError(err: unknown): {
  short: string;
  full: string;
  isRejection: boolean;
} {
  if (!err) return { short: "", full: "", isRejection: false };

  const full = err instanceof Error ? err.message : String(err);

  if (isUserRejection(err)) {
    return {
      short: "Request cancelled in wallet.",
      full,
      isRejection: true,
    };
  }

  // Viem error object inspection
  if (typeof err === "object" && err !== null) {
    const viemErr = err as {
      shortMessage?: string;
      details?: string;
      reason?: string;
      metaMessages?: string[];
    };

    if (viemErr.reason && typeof viemErr.reason === "string") {
      return {
        short: viemErr.reason,
        full,
        isRejection: false,
      };
    }

    if (viemErr.shortMessage && typeof viemErr.shortMessage === "string") {
      if (isUserRejection(viemErr.shortMessage)) {
        return {
          short: "Request cancelled in wallet.",
          full,
          isRejection: true,
        };
      }
      return {
        short: viemErr.shortMessage,
        full,
        isRejection: false,
      };
    }

    if (viemErr.details && typeof viemErr.details === "string") {
      if (isUserRejection(viemErr.details)) {
        return {
          short: "Request cancelled in wallet.",
          full,
          isRejection: true,
        };
      }
    }
  }

  // Parse string error
  const firstLine = full.split("\n")[0].trim();
  // Strip Viem noise like "Request Arguments: ... Docs: ... Version: ..."
  let cleaned = firstLine
    .replace(/Request Arguments:.*$/i, "")
    .replace(/Contract Call:.*$/i, "")
    .replace(/Docs: https:\/\/.*/i, "")
    .replace(/Version: viem@.*/i, "")
    .trim();

  if (!cleaned || cleaned === "Error:") {
    cleaned = "An unexpected error occurred.";
  }

  if (cleaned.length > 140) {
    cleaned = `${cleaned.slice(0, 137)}...`;
  }

  return {
    short: cleaned,
    full,
    isRejection: false,
  };
}
