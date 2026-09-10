import path from "path";
import fs from "fs";

// High-performance, crash-proof persistent store for LP profiles & backer quotes.
// Replaces C++ native better-sqlite3 to guarantee zero SIGSEGV crashes across
// Next.js 16 App Router worker threads and cloud container volume mounts (Railway/Docker).

export interface ProfileRecord {
  id: number;
  profile_hash: string;
  lp: string;
  collateral: string;
  settlement: string;
  min_hours: number;
  max_hours: number;
  total_units: string;
  price_per_unit: string;
  option_type: number;
  signed_blob: string;
  created_at: number;
  invalidated: number;
}

export interface QuoteRecord {
  id: number;
  quote_hash: string;
  backer: string;
  collateral: string;
  settlement: string;
  min_hours: number;
  max_hours: number;
  max_units: string;
  price_per_unit: string;
  option_type: number;
  signed_blob: string;
  created_at: number;
  invalidated: number;
}

interface DatabaseState {
  profiles: ProfileRecord[];
  quotes: QuoteRecord[];
  nextProfileId: number;
  nextQuoteId: number;
}

class PersistentStore {
  private filePath: string;
  private state: DatabaseState = {
    profiles: [],
    quotes: [],
    nextProfileId: 1,
    nextQuoteId: 1,
  };
  private isLoaded = false;

  constructor() {
    this.filePath = this.resolveStorePath();
    this.load();
    this.ensureSeeded();
  }

  private resolveStorePath(): string {
    const customDir = process.env.DATABASE_PATH
      ? path.dirname(
          path.isAbsolute(process.env.DATABASE_PATH)
            ? process.env.DATABASE_PATH
            : path.join(/*turbopackIgnore: true*/ process.cwd(), process.env.DATABASE_PATH),
        )
      : path.join(/*turbopackIgnore: true*/ process.cwd(), "data");

    try {
      if (!fs.existsSync(customDir)) {
        fs.mkdirSync(customDir, { recursive: true });
      }
      fs.accessSync(customDir, fs.constants.W_OK);
      return path.join(customDir, "profiles-store.json");
    } catch {
      const tmpDir = "/tmp";
      return path.join(tmpDir, "optioncore-profiles-store.json");
    }
  }

  private lastMtimeMs = 0;

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const stats = fs.statSync(this.filePath);
        if (this.isLoaded && stats.mtimeMs <= this.lastMtimeMs) {
          return;
        }
        const raw = fs.readFileSync(this.filePath, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.profiles) && Array.isArray(parsed.quotes)) {
          this.state = parsed;
          this.lastMtimeMs = stats.mtimeMs;
          this.isLoaded = true;
          return;
        }
      }
    } catch (e) {
      console.warn("[Store] Error loading state, starting fresh:", e);
    }
    this.isLoaded = true;
    this.save();
  }

  private save(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmpPath = `${this.filePath}.tmp.${Date.now()}`;
      fs.writeFileSync(tmpPath, JSON.stringify(this.state, null, 2), "utf-8");
      fs.renameSync(tmpPath, this.filePath);
      try {
        this.lastMtimeMs = fs.statSync(this.filePath).mtimeMs;
      } catch {}
    } catch (e) {
      console.error("[Store] Error persisting state to disk:", e);
    }
  }

  private ensureSeeded(): void {
    if (this.state.profiles.length > 0) return;

    try {
      const candidatePaths = [
        path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "seed-liquidity.json"),
        path.join(/*turbopackIgnore: true*/ process.cwd(), "public", "seed-liquidity.json"),
      ];

      let seedContent: string | null = null;
      for (const p of candidatePaths) {
        if (fs.existsSync(p)) {
          seedContent = fs.readFileSync(p, "utf-8");
          break;
        }
      }

      if (!seedContent) return;

      const data = JSON.parse(seedContent) as {
        profiles?: Record<string, unknown>[];
        quotes?: Record<string, unknown>[];
      };

      const now = Math.floor(Date.now() / 1000);

      for (const p of data.profiles ?? []) {
        const hash = `${p.lp}-${p.nonce}-${p.timestamp}`;
        this.insertOrReplaceProfile(
          hash,
          String(p.lp),
          String(p.collateralAsset),
          String(p.settlementAsset),
          Number(p.minHours),
          Number(p.maxHours),
          String(p.totalUnits),
          String(p.pricePerUnitPerHour),
          Number(p.supportsOptionType),
          JSON.stringify(p),
          now,
        );
      }

      for (const q of data.quotes ?? []) {
        const hash = `${q.backer}-${q.nonce}`;
        this.insertOrReplaceQuote(
          hash,
          String(q.backer),
          String(q.collateralAsset),
          String(q.settlementAsset),
          Number(q.minHours),
          Number(q.maxHours),
          String(q.maxUnits),
          String(q.pricePerUnitPerHour),
          Number(q.supportsOptionType),
          JSON.stringify(q),
          now,
        );
      }

      console.log(`[Store] Seeded ${this.state.profiles.length} profiles and ${this.state.quotes.length} quotes.`);
    } catch (err) {
      console.warn("[Store] Skipping auto-seed:", err);
    }
  }

  public insertOrReplaceProfile(
    hash: string,
    lp: string,
    collateral: string,
    settlement: string,
    minHours: number,
    maxHours: number,
    totalUnits: string,
    pricePerUnit: string,
    optionType: number,
    signedBlob: string,
    createdAt = Math.floor(Date.now() / 1000),
  ): void {
    this.load();
    const existingIdx = this.state.profiles.findIndex((p) => p.profile_hash === hash);
    const record: ProfileRecord = {
      id: existingIdx >= 0 ? this.state.profiles[existingIdx].id : this.state.nextProfileId++,
      profile_hash: hash,
      lp,
      collateral,
      settlement,
      min_hours: minHours,
      max_hours: maxHours,
      total_units: totalUnits,
      price_per_unit: pricePerUnit,
      option_type: optionType,
      signed_blob: signedBlob,
      created_at: createdAt,
      invalidated: 0,
    };

    if (existingIdx >= 0) {
      this.state.profiles[existingIdx] = record;
    } else {
      this.state.profiles.push(record);
    }
    this.save();
  }

  public insertOrReplaceQuote(
    hash: string,
    backer: string,
    collateral: string,
    settlement: string,
    minHours: number,
    maxHours: number,
    maxUnits: string,
    pricePerUnit: string,
    optionType: number,
    signedBlob: string,
    createdAt = Math.floor(Date.now() / 1000),
  ): void {
    this.load();
    const existingIdx = this.state.quotes.findIndex((q) => q.quote_hash === hash);
    const record: QuoteRecord = {
      id: existingIdx >= 0 ? this.state.quotes[existingIdx].id : this.state.nextQuoteId++,
      quote_hash: hash,
      backer,
      collateral,
      settlement,
      min_hours: minHours,
      max_hours: maxHours,
      max_units: maxUnits,
      price_per_unit: pricePerUnit,
      option_type: optionType,
      signed_blob: signedBlob,
      created_at: createdAt,
      invalidated: 0,
    };

    if (existingIdx >= 0) {
      this.state.quotes[existingIdx] = record;
    } else {
      this.state.quotes.push(record);
    }
    this.save();
  }

  public invalidateProfile(hash: string): { changes: number } {
    this.load();
    const p = this.state.profiles.find((item) => item.profile_hash === hash);
    if (p) {
      p.invalidated = 1;
      this.save();
      return { changes: 1 };
    }
    return { changes: 0 };
  }

  public invalidateQuote(hash: string): { changes: number } {
    this.load();
    const q = this.state.quotes.find((item) => item.quote_hash === hash);
    if (q) {
      q.invalidated = 1;
      this.save();
      return { changes: 1 };
    }
    return { changes: 0 };
  }

  public setProfileStatus(hash: string, status: "active" | "historical"): { changes: number } {
    this.load();
    const p = this.state.profiles.find((item) => item.profile_hash === hash);
    if (p) {
      p.invalidated = status === "active" ? 0 : 1;
      this.save();
      return { changes: 1 };
    }
    return { changes: 0 };
  }

  public setQuoteStatus(hash: string, status: "active" | "historical"): { changes: number } {
    this.load();
    const q = this.state.quotes.find((item) => item.quote_hash === hash);
    if (q) {
      q.invalidated = status === "active" ? 0 : 1;
      this.save();
      return { changes: 1 };
    }
    return { changes: 0 };
  }

  public deleteProfile(hash: string): { changes: number } {
    this.load();
    const initLen = this.state.profiles.length;
    this.state.profiles = this.state.profiles.filter((item) => item.profile_hash !== hash);
    if (this.state.profiles.length !== initLen) {
      this.save();
      return { changes: 1 };
    }
    return { changes: 0 };
  }

  public deleteQuote(hash: string): { changes: number } {
    this.load();
    const initLen = this.state.quotes.length;
    this.state.quotes = this.state.quotes.filter((item) => item.quote_hash !== hash);
    if (this.state.quotes.length !== initLen) {
      this.save();
      return { changes: 1 };
    }
    return { changes: 0 };
  }

  public getProfiles(options: {
    status?: "active" | "historical" | "all";
    collateral?: string | null;
    lp?: string | null;
  } = {}): ProfileRecord[] {
    this.load();
    const { status = "active", collateral, lp } = options;
    return this.state.profiles.filter((p) => {
      if (status === "active" && p.invalidated !== 0) return false;
      if (status === "historical" && p.invalidated === 0) return false;
      if (collateral && p.collateral.toLowerCase() !== collateral.toLowerCase()) return false;
      if (lp && p.lp.toLowerCase() !== lp.toLowerCase()) return false;
      return true;
    });
  }

  public getQuotes(options: {
    status?: "active" | "historical" | "all";
    collateral?: string | null;
    backer?: string | null;
  } = {}): QuoteRecord[] {
    this.load();
    const { status = "active", collateral, backer } = options;
    return this.state.quotes.filter((q) => {
      if (status === "active" && q.invalidated !== 0) return false;
      if (status === "historical" && q.invalidated === 0) return false;
      if (collateral && q.collateral.toLowerCase() !== collateral.toLowerCase()) return false;
      if (backer && q.backer.toLowerCase() !== backer.toLowerCase()) return false;
      return true;
    });
  }

  public getActiveProfiles(collateral?: string | null): ProfileRecord[] {
    return this.getProfiles({ status: "active", collateral });
  }

  public getActiveQuotes(collateral?: string | null): QuoteRecord[] {
    return this.getQuotes({ status: "active", collateral });
  }

  public clear(): void {
    this.state = {
      profiles: [],
      quotes: [],
      nextProfileId: 1,
      nextQuoteId: 1,
    };
    this.save();
  }

  public getProfileCount(): number {
    this.load();
    return this.state.profiles.length;
  }

  public getQuoteCount(): number {
    this.load();
    return this.state.quotes.length;
  }
}

// Global singleton for Next.js
declare global {
  var _persistentStoreInstance: PersistentStore | undefined;
}

export function getStore(): PersistentStore {
  if (!globalThis._persistentStoreInstance) {
    globalThis._persistentStoreInstance = new PersistentStore();
  }
  return globalThis._persistentStoreInstance;
}

// SQL-compatible API adapter so existing route handlers and scripts run seamlessly
export interface MockStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): { changes: number };
}

export interface MockDatabase {
  prepare(query: string): MockStatement;
  exec(query: string): void;
  pragma(query?: string): void;
  transaction<T extends (...args: unknown[]) => unknown>(fn: T): T;
  store: PersistentStore;
}

export function getDb(): MockDatabase {
  const store = getStore();

  return {
    store,
    exec(query: string): void {
      const q = query.toUpperCase();
      if (q.includes("DELETE FROM PROFILES") && q.includes("DELETE FROM QUOTES")) {
        store.clear();
      } else if (q.includes("DELETE FROM PROFILES")) {
        store.clear();
      } else if (q.includes("DELETE FROM QUOTES")) {
        store.clear();
      }
    },
    pragma(): void {
      // In-memory / JSON store
    },
    transaction<T extends (...args: unknown[]) => unknown>(fn: T): T {
      return ((...args: unknown[]) => fn(...args)) as T;
    },
    prepare(sql: string): MockStatement {
      const normalized = sql.trim().toUpperCase();

      // DELETE profiles WHERE profile_hash = ?
      if (normalized.includes("DELETE FROM PROFILES WHERE")) {
        return {
          run: (...params: unknown[]) => store.deleteProfile(String(params[0])),
          all: () => [],
          get: () => undefined,
        };
      }

      // DELETE quotes WHERE quote_hash = ?
      if (normalized.includes("DELETE FROM QUOTES WHERE")) {
        return {
          run: (...params: unknown[]) => store.deleteQuote(String(params[0])),
          all: () => [],
          get: () => undefined,
        };
      }

      // SELECT profiles
      if (normalized.includes("SELECT") && normalized.includes("PROFILES")) {
        if (normalized.includes("COUNT(*)")) {
          return {
            get: () => ({ count: store.getProfileCount() }),
            all: () => [{ count: store.getProfileCount() }],
            run: () => ({ changes: 0 }),
          };
        }

        return {
          all: (...params: unknown[]) => {
            const collateral = (params[0] as string | undefined) || null;
            const status = normalized.includes("INVALIDATED = 1")
              ? "historical"
              : normalized.includes("INVALIDATED = 0")
              ? "active"
              : "all";
            return store.getProfiles({ status, collateral }).map((p) => ({
              profile_hash: p.profile_hash,
              lp: p.lp,
              collateral: p.collateral,
              settlement: p.settlement,
              signed_blob: p.signed_blob,
              created_at: p.created_at,
              invalidated: p.invalidated,
            }));
          },
          get: (...params: unknown[]) => {
            const collateral = (params[0] as string | undefined) || null;
            const item = store.getActiveProfiles(collateral)[0];
            return item ? { profile_hash: item.profile_hash, signed_blob: item.signed_blob } : undefined;
          },
          run: () => ({ changes: 0 }),
        };
      }

      // SELECT quotes
      if (normalized.includes("SELECT") && normalized.includes("QUOTES")) {
        if (normalized.includes("COUNT(*)")) {
          return {
            get: () => ({ count: store.getQuoteCount() }),
            all: () => [{ count: store.getQuoteCount() }],
            run: () => ({ changes: 0 }),
          };
        }

        return {
          all: (...params: unknown[]) => {
            const collateral = (params[0] as string | undefined) || null;
            const status = normalized.includes("INVALIDATED = 1")
              ? "historical"
              : normalized.includes("INVALIDATED = 0")
              ? "active"
              : "all";
            return store.getQuotes({ status, collateral }).map((q) => ({
              quote_hash: q.quote_hash,
              backer: q.backer,
              collateral: q.collateral,
              settlement: q.settlement,
              signed_blob: q.signed_blob,
              created_at: q.created_at,
              invalidated: q.invalidated,
            }));
          },
          get: (...params: unknown[]) => {
            const collateral = (params[0] as string | undefined) || null;
            const item = store.getActiveQuotes(collateral)[0];
            return item ? { quote_hash: item.quote_hash, signed_blob: item.signed_blob } : undefined;
          },
          run: () => ({ changes: 0 }),
        };
      }

      // UPDATE profiles SET invalidated = ?
      if (normalized.includes("UPDATE") && normalized.includes("PROFILES")) {
        return {
          run: (...params: unknown[]) => {
            if (params.length === 1) {
              return store.invalidateProfile(String(params[0]));
            }
            const statusVal = Number(params[0]);
            const hash = String(params[1]);
            return store.setProfileStatus(hash, statusVal === 0 ? "active" : "historical");
          },
          all: () => [],
          get: () => undefined,
        };
      }

      // UPDATE quotes SET invalidated = ?
      if (normalized.includes("UPDATE") && normalized.includes("QUOTES")) {
        return {
          run: (...params: unknown[]) => {
            if (params.length === 1) {
              return store.invalidateQuote(String(params[0]));
            }
            const statusVal = Number(params[0]);
            const hash = String(params[1]);
            return store.setQuoteStatus(hash, statusVal === 0 ? "active" : "historical");
          },
          all: () => [],
          get: () => undefined,
        };
      }

      // INSERT INTO profiles
      if (normalized.includes("INSERT") && normalized.includes("PROFILES")) {
        return {
          run: (...params: unknown[]) => {
            store.insertOrReplaceProfile(
              String(params[0]),
              String(params[1]),
              String(params[2]),
              String(params[3]),
              Number(params[4]),
              Number(params[5]),
              String(params[6]),
              String(params[7]),
              Number(params[8]),
              String(params[9]),
            );
            return { changes: 1 };
          },
          all: () => [],
          get: () => undefined,
        };
      }

      // INSERT INTO quotes
      if (normalized.includes("INSERT") && normalized.includes("QUOTES")) {
        return {
          run: (...params: unknown[]) => {
            store.insertOrReplaceQuote(
              String(params[0]),
              String(params[1]),
              String(params[2]),
              String(params[3]),
              Number(params[4]),
              Number(params[5]),
              String(params[6]),
              String(params[7]),
              Number(params[8]),
              String(params[9]),
            );
            return { changes: 1 };
          },
          all: () => [],
          get: () => undefined,
        };
      }

      // Fallback
      return {
        all: () => [],
        get: () => undefined,
        run: () => ({ changes: 0 }),
      };
    },
  };
}

export default getDb;
