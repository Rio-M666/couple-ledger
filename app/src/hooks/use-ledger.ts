import { useSyncExternalStore } from 'react';

import { getInitialLedgerSnapshot, getLedgerSnapshot, subscribeToLedger } from '@/data/ledger';

export function useLedger() {
  return useSyncExternalStore(subscribeToLedger, getLedgerSnapshot, getInitialLedgerSnapshot);
}
