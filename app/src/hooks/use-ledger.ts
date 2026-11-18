import { useSyncExternalStore } from 'react';

import { getInitialLedgerSnapshot, getLedgerSnapshot, subscribeToLedger } from '@/data/home';

export function useLedger() {
  return useSyncExternalStore(subscribeToLedger, getLedgerSnapshot, getInitialLedgerSnapshot);
}
