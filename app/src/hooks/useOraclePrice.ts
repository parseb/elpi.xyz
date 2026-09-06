// SPDX-License-Identifier: MIT
'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Address } from 'viem';
import {
  baseClient,
  CONTRACT_ADDRESSES,
  BASE_CHAIN_ID,
  MockPriceOracleAbi,
} from '@/lib/client';

export interface OraclePriceState {
  spotPrice: number;
  spotPriceRaw: bigint;
  decimals: number;
  updatedAt: number;
  ageSeconds: number;
  isStale: boolean;
  isWarning: boolean;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useOraclePrice(
  customOracleAddress?: Address,
  maxPriceAgeSeconds: number = 3600
): OraclePriceState {
  const oracleAddress =
    customOracleAddress || CONTRACT_ADDRESSES[BASE_CHAIN_ID].chainlinkEthUsd;

  const [spotPrice, setSpotPrice] = useState<number>(3000);
  const [spotPriceRaw, setSpotPriceRaw] = useState<bigint>(300000000000n); // $3,000 in 8-decimals
  const [decimals, setDecimals] = useState<number>(8);
  const [updatedAt, setUpdatedAt] = useState<number>(Math.floor(Date.now() / 1000));
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPrice = useCallback(async () => {
    if (!oracleAddress || oracleAddress === '0x0000000000000000000000000000000000000000') {
      setIsLoading(false);
      return;
    }

    try {
      // 1. Fetch decimals (or fallback to 8 for Chainlink USD feeds)
      let dec = 8;
      try {
        dec = (await baseClient.readContract({
          address: oracleAddress,
          abi: MockPriceOracleAbi,
          functionName: 'decimals',
        })) as number;
        setDecimals(dec);
      } catch {
        dec = 8;
      }

      // 2. Fetch latestRoundData
      const roundData = (await baseClient.readContract({
        address: oracleAddress,
        abi: MockPriceOracleAbi,
        functionName: 'latestRoundData',
      })) as [bigint, bigint, bigint, bigint, bigint];

      const rawAnswer = roundData[1];
      const updatedTimestamp = Number(roundData[3]);

      setSpotPriceRaw(rawAnswer);
      setUpdatedAt(updatedTimestamp > 0 ? updatedTimestamp : Math.floor(Date.now() / 1000));

      const numericPrice = Number(rawAnswer) / 10 ** dec;
      if (numericPrice > 0) {
        setSpotPrice(numericPrice);
      }
      setError(null);
    } catch (err: any) {
      // If contract read fails (e.g. Invariant I3 fallback testing or offline), log error
      console.warn('Oracle read failed:', err?.message || err);
      setError(err?.message || 'Failed to read oracle price');
    } finally {
      setIsLoading(false);
    }
  }, [oracleAddress]);

  useEffect(() => {
    fetchPrice();
    const interval = setInterval(fetchPrice, 3000);
    return () => clearInterval(interval);
  }, [fetchPrice]);

  const nowSeconds = Math.floor(Date.now() / 1000);
  const ageSeconds = Math.max(0, nowSeconds - updatedAt);
  const isStale = ageSeconds > maxPriceAgeSeconds;
  const isWarning = ageSeconds > maxPriceAgeSeconds * 0.9;

  return {
    spotPrice,
    spotPriceRaw,
    decimals,
    updatedAt,
    ageSeconds,
    isStale,
    isWarning,
    isLoading,
    error,
    refresh: fetchPrice,
  };
}
