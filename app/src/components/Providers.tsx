// SPDX-License-Identifier: MIT
'use client';

import React from 'react';
import { WalletProvider } from '@/context/WalletContext';

export const Providers: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return <WalletProvider>{children}</WalletProvider>;
};
export default Providers;
