// SPDX-License-Identifier: MIT
'use client';

import React, { useState, useEffect } from 'react';

export interface FlashEvent {
  id: string;
  time: string;
  event: string;
  tag: string;
  type: 'waiver' | 'hook' | 'mint' | 'settle' | 'netting';
}

const INITIAL_EVENTS: FlashEvent[] = [
  {
    id: '1',
    time: '10:42:01',
    event: 'FlashSwap executed (Transient Netting)',
    tag: 'Waiver: 0 AMM Fee Applied',
    type: 'waiver',
  },
  {
    id: '2',
    time: '10:41:55',
    event: 'OptionSettlementHook (0xC8) beforeSwap',
    tag: 'Delta Netting Neutralized',
    type: 'hook',
  },
  {
    id: '3',
    time: '10:41:48',
    event: 'Mint Agreement #1247 (CALL 1.0 ETH)',
    tag: 'Collateral Committed (I1)',
    type: 'mint',
  },
  {
    id: '4',
    time: '10:41:30',
    event: 'EIP-1153 TLOAD/TSTORE Netting Delta: 0',
    tag: 'Transient Storage Cleared',
    type: 'netting',
  },
  {
    id: '5',
    time: '10:40:12',
    event: 'Direct LP Settle (2-of-2 Netting)',
    tag: 'Taker Net Payout 240 USDC',
    type: 'settle',
  },
];

export const FlashAccountingStream: React.FC = () => {
  const [events, setEvents] = useState<FlashEvent[]>(INITIAL_EVENTS);
  const [isLive, setIsLive] = useState<boolean>(true);

  useEffect(() => {
    if (!isLive) return;

    const streamInterval = setInterval(() => {
      const now = new Date();
      const timeStr = now.toTimeString().split(' ')[0];

      const poolOfEvents: Omit<FlashEvent, 'id' | 'time'>[] = [
        {
          event: 'FlashSwap executed (Transient Netting)',
          tag: 'Waiver: 0 AMM Fee Applied',
          type: 'waiver',
        },
        {
          event: 'OptionSettlementHook afterSwap verify',
          tag: 'Invariant I4 Fee Base Protected',
          type: 'hook',
        },
        {
          event: 'EIP-1153 Transient Netting tick: 60',
          tag: '0 Gas Overhead Netting',
          type: 'netting',
        },
        {
          event: 'V4LiquidityVault Auto-Restake check',
          tag: 'Profile Health: GREEN (847x)',
          type: 'mint',
        },
      ];

      const selected = poolOfEvents[Math.floor(Math.random() * poolOfEvents.length)];
      const newEvt: FlashEvent = {
        id: Math.random().toString(36).substring(2, 9),
        time: timeStr,
        event: selected.event,
        tag: selected.tag,
        type: selected.type,
      };

      setEvents((prev) => [newEvt, ...prev.slice(0, 14)]);
    }, 6000);

    return () => clearInterval(streamInterval);
  }, [isLive]);

  return (
    <div className="glass-panel rounded-2xl flex flex-col overflow-hidden border border-[#2D2F3F]/80 shadow-inner">
      {/* Module Header */}
      <div className="flex justify-between items-center px-4 py-2.5 border-b border-[#2D2F3F]/60 bg-[#13141E]/80">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-wider font-bold text-zinc-300">
            v4 Flash-Accounting Stream
          </span>
          <span className="text-[10px] bg-uni-pink-subtle text-uni-pink border border-uni-pink/30 px-2 py-0.5 rounded-full font-mono font-bold">
            EIP-1153 Transient
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsLive(!isLive)}
            title={isLive ? 'Pause Stream' : 'Resume Stream'}
            className="flex items-center gap-1 text-[10px] font-mono text-zinc-400 hover:text-white transition-colors"
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isLive ? 'bg-stitch-tertiary status-pulse' : 'bg-zinc-600'
              }`}
            />
            <span>{isLive ? 'LIVE' : 'PAUSED'}</span>
          </button>
        </div>
      </div>

      {/* Terminal Feed */}
      <div className="p-3 overflow-y-auto max-h-40 terminal-scroll font-mono text-[11px] space-y-1.5 bg-[#0D0E15]/50">
        {events.map((evt) => {
          const tagColor =
            evt.type === 'waiver'
              ? 'text-stitch-tertiary-bright font-bold'
              : evt.type === 'hook'
              ? 'text-uni-blue'
              : evt.type === 'mint'
              ? 'text-uni-pink'
              : evt.type === 'settle'
              ? 'text-uni-green'
              : 'text-zinc-400';

          return (
            <div
              key={evt.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between text-zinc-300 hover:text-white transition-colors py-0.5 border-b border-white/[0.02]"
            >
              <div className="flex items-center gap-2">
                <span className="text-zinc-500 text-[10px]">[{evt.time}]</span>
                <span className="truncate">{evt.event}</span>
              </div>
              <span className={`text-[10px] ${tagColor} shrink-0`}>{evt.tag}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
