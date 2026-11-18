import { supabase } from '../lib/supabase';
import * as api from './api-client';
import * as fixtures from './home';
import { sampleInvitation } from './onboarding';
import type { LedgerSnapshot } from './types';

export { linkedPromise, settlementCandidates } from './home';
export type { HomeScenario, RecordVersion, RevivalDecision } from './home';

export const usesApi = process.env.EXPO_PUBLIC_DATA_SOURCE === 'api';
const source = usesApi ? api : fixtures;

let fixtureAuthInitial: LedgerSnapshot | undefined;
if (supabase && !usesApi) {
  fixtures.resetOnboarding();
  fixtureAuthInitial = fixtures.getLedgerSnapshot();
  supabase.auth.onAuthStateChange((_event, session) => {
    if (session) fixtures.resumeLocalSession();
    else if (fixtures.getLedgerSnapshot().appState.status !== 'signed-out') fixtures.logOutLocally();
  });
}

export const getLedgerSnapshot = source.getLedgerSnapshot;
export const subscribeToLedger = source.subscribeToLedger;
export const getInitialLedgerSnapshot = () => usesApi
  ? api.initialSnapshot : fixtureAuthInitial ?? fixtures.getInitialLedgerSnapshot();
export const loadHome = usesApi ? api.loadHome : fixtures.loadHome;
export const signInLocally = fixtures.signInLocally;
export const saveDisplayName = source.saveDisplayName;
export const issueInvitation = usesApi ? api.issueInvitation : sampleInvitation;
export const reviewInvitation = source.reviewInvitation;
export const acceptInvitation = source.acceptInvitation;
export const archiveActivePair = source.archiveActivePair;
export const simulateIncomingRevival = fixtures.simulateIncomingRevival;
export const requestRevival = source.requestRevival;
export const resolveRevival = source.resolveRevival;
export const createExpense = source.createExpense;
export const updateExpense = source.updateExpense;
export const createSettlement = source.createSettlement;
export const setRecordCanceled = source.setRecordCanceled;
export const refreshLedger = api.refreshLedger;

export async function logOut() {
  if (supabase) {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) throw error;
  } else {
    fixtures.logOutLocally();
  }
}

export async function resetOnboarding() {
  if (supabase) await logOut();
  fixtures.resetOnboarding();
}

export function previewExpenseEdit(id: string, input: Parameters<typeof fixtures.previewExpenseEdit>[1],
  expected: fixtures.RecordVersion) {
  return fixtures.previewExpenseEdit(id, input, expected, getLedgerSnapshot());
}

export function previewRecordStatus(id: string, cancel: boolean, expected: fixtures.RecordVersion) {
  return fixtures.previewRecordStatus(id, cancel, expected, getLedgerSnapshot());
}

export function previewSettlement(input: Parameters<typeof fixtures.previewSettlement>[0]) {
  return fixtures.previewSettlement(input, getLedgerSnapshot());
}
