// SPDX-License-Identifier: MIT
'use client';

import React from 'react';

export interface ElpiLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showDomain?: boolean;
  showBadge?: boolean;
  badgeText?: string;
  className?: string;
}

export const ElpiLogo: React.FC<ElpiLogoProps> = ({
  size = 'md',
  showDomain = true,
  showBadge = true,
  badgeText = 'v4 Hook',
  className = '',
}) => {
  const sizeClasses = {
    sm: {
      text: 'text-lg',
      dot: 'w-1.5 h-1.5 -top-1',
      badge: 'text-[9px] px-1.5 py-0.2',
      domain: 'text-xs',
    },
    md: {
      text: 'text-2xl',
      dot: 'w-2 h-2 -top-1.5',
      badge: 'text-[10px] px-2 py-0.5',
      domain: 'text-sm',
    },
    lg: {
      text: 'text-4xl',
      dot: 'w-2.5 h-2.5 -top-2',
      badge: 'text-xs px-2.5 py-1',
      domain: 'text-base',
    },
  }[size];

  return (
    <div className={`inline-flex items-center gap-2 select-none group ${className}`}>
      {/* Dynamic Text Logo */}
      <div className="flex items-baseline font-black tracking-tight relative">
        <span
          className={`elpi-text-dynamic font-extrabold tracking-tighter ${sizeClasses.text} transition-transform duration-300 group-hover:scale-[1.02]`}
        >
          elp
          <span className="relative inline-block">
            ı
            <span
              className={`absolute left-1/2 -translate-x-1/2 rounded-full bg-uni-pink shadow-[0_0_8px_#FF007A] ${sizeClasses.dot} animate-elpi-dot`}
            />
          </span>
        </span>

        {showDomain && (
          <span
            className={`font-semibold tracking-tight text-uni-pink/90 ml-0.5 ${sizeClasses.domain} transition-colors group-hover:text-uni-pink`}
          >
            .xyz
          </span>
        )}
      </div>

      {/* Uniswap v4 Pill Badge */}
      {showBadge && (
        <span
          className={`hidden sm:inline-flex items-center gap-1 uppercase font-mono tracking-wider bg-uni-pink-subtle text-uni-pink rounded-full border border-uni-pink/30 font-semibold shadow-[0_0_10px_rgba(255,0,122,0.12)] ${sizeClasses.badge}`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-uni-pink animate-pulse" />
          {badgeText}
        </span>
      )}
    </div>
  );
};

export default ElpiLogo;
