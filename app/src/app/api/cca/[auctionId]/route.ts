// SPDX-License-Identifier: MIT
import { NextResponse } from 'next/server';
import type { Address } from 'viem';
import { CcaTracker } from '@/lib/cca';
import type { CcaAuctionStatus, PoolKey } from '@/lib/types';
import { computeRouteId, DYNAMIC_FEE_FLAG } from '@/lib/routeId';

export interface CcaApiResponse extends CcaAuctionStatus {
  currentPrice?: string;
  clearingPriceFormatted?: string;
  endsInSeconds?: number;
  orderVolume?: string;
  routeId?: string;
  isCuratedTarget: boolean;
}

/**
 * API Route: GET /api/cca/[auctionId]
 * Fetches Continuous Clearing Auction status for asset onboarding into elpi (elpi.xyz).
 * Connects to live Uniswap CCA endpoints if UNISWAP_CCA_API_URL is configured,
 * or serves deterministic auction lifecycle status for asset onboarding verification (§5.2).
 */
export async function GET(
  request: Request,
  { params }: { params: { auctionId: string } }
) {
  try {
    const { auctionId } = params;

    if (!auctionId || auctionId.trim() === '') {
      return NextResponse.json(
        { error: 'auctionId parameter is required' },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(request.url);
    const forceState = searchParams.get('state')?.toUpperCase();

    // Check for optional upstream Uniswap CCA API endpoint
    const upstreamApiUrl = process.env.UNISWAP_CCA_API_URL;
    if (upstreamApiUrl) {
      try {
        const upstreamRes = await fetch(`${upstreamApiUrl}/cca/${auctionId}/status`, {
          headers: {
            Accept: 'application/json',
            ...(process.env.UNISWAP_API_KEY ? { 'x-api-key': process.env.UNISWAP_API_KEY } : {}),
          },
        });

        if (upstreamRes.ok) {
          const liveData = await upstreamRes.json();
          return NextResponse.json(liveData);
        }
      } catch (upstreamErr) {
        console.warn('Upstream CCA API call failed, falling back to simulated state:', upstreamErr);
      }
    }

    // Default canonical Base token pair for demonstration / test onboarding
    const token0: Address = '0x4200000000000000000000000000000000000006'; // WETH
    const token1: Address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // USDC (Base)
    const hookAddress: Address = '0x00000000000000000000000000000000000000c8';

    const seededPool: PoolKey = {
      currency0: token0,
      currency1: token1,
      fee: DYNAMIC_FEE_FLAG,
      tickSpacing: 60,
      hooks: hookAddress,
    };

    const routeId = computeRouteId(seededPool);

    // Determine lifecycle state: support URL overrides or deterministic derivation from auctionId
    let status: 'PENDING' | 'ACTIVE' | 'CLOSED' | 'SEEDED' = 'CLOSED';
    if (forceState === 'PENDING' || forceState === 'ACTIVE' || forceState === 'CLOSED' || forceState === 'SEEDED') {
      status = forceState;
    } else if (auctionId.includes('pending')) {
      status = 'PENDING';
    } else if (auctionId.includes('active')) {
      status = 'ACTIVE';
    } else if (auctionId.includes('seeded')) {
      status = 'SEEDED';
    }

    const response: CcaApiResponse = {
      auctionId,
      tokenPair: [token0, token1],
      status,
      clearingPrice: 2048000000n, // $2,048.00 in USDC 6-decimal units
      clearingPriceFormatted: '2048.00 USDC',
      currentPrice: '2045.50 USDC',
      endsInSeconds: status === 'ACTIVE' ? 1840 : 0,
      totalOrders: status === 'PENDING' ? 0 : status === 'ACTIVE' ? 84 : 142,
      orderVolume: '1,420,000 USDC',
      seededPool: status === 'CLOSED' || status === 'SEEDED' ? seededPool : undefined,
      routeId: status === 'CLOSED' || status === 'SEEDED' ? routeId : undefined,
      isCuratedTarget: true,
    };

    return NextResponse.json(response, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to process CCA status request', details: error?.message || String(error) },
      { status: 500 }
    );
  }
}
