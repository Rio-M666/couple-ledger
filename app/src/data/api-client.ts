import { randomUUID } from 'expo-crypto';
import { AppState } from 'react-native';

import { supabase } from '../lib/supabase';
import { emptySnapshot, mapLedger, mapRevival, type LedgerResponse, type RevivalRow } from './api-ledger';
import { defaultExpenseTitle, otherSlot } from './expense';
import { businessDate } from './format';
import { linkedPromise, recordForChange, type RecordVersion, type RevivalDecision } from './home';
import type { ExpenseRecord, LedgerSnapshot, NewExpense, NewSettlement, SettlementRecord } from './types';

const apiUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, '');
export const initialSnapshot = { ...emptySnapshot, loading: true } satisfies LedgerSnapshot;
let snapshot: LedgerSnapshot = initialSnapshot;
let pairs: LedgerResponse['pairs'] = [];
let userId: string | undefined;
let refreshId = 0;
const listeners = new Set<() => void>();
let stopWatching: (() => void) | undefined;

class ApiError extends Error {
  constructor(message: string, readonly code?: string, readonly latest?: { pairId?: string }) {
    super(message);
  }
}

async function request<T>(path: string, method: 'GET' | 'POST' | 'PUT' = 'GET', body?: object): Promise<T> {
  if (!apiUrl || !supabase) throw new Error('APIとSupabaseの環境変数を設定してください。');
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error('ログインし直してください。');
  const headers = new Headers({ Authorization: `Bearer ${data.session.access_token}` });
  if (method !== 'GET') {
    headers.set('Content-Type', 'application/json');
    headers.set('Idempotency-Key', randomUUID());
  }
  const response = await fetch(`${apiUrl}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'omit', redirect: 'error',
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new ApiError(result?.error?.message ?? 'APIに接続できませんでした。', result?.error?.code, result?.latest);
  }
  return response.json();
}

function publish(next: LedgerSnapshot) {
  snapshot = next;
  listeners.forEach(listener => listener());
}

export function getLedgerSnapshot() {
  return snapshot;
}

export async function refreshLedger() {
  if (!supabase || !apiUrl) {
    publish({ ...emptySnapshot, loadError: 'APIとSupabaseの環境変数を設定してください。' });
    return;
  }
  if (!userId) return;
  const id = ++refreshId;
  try {
    const data = await request<LedgerResponse>('/ledger');
    if (id !== refreshId) return;
    const next = mapLedger(data);
    pairs = data.pairs;
    publish(next);
  } catch (error) {
    if (id !== refreshId) return;
    publish({ ...snapshot, loading: false, loadError: error instanceof Error ? error.message : '記録を読み込めませんでした。' });
  }
}

export function subscribeToLedger(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    if (supabase && apiUrl) {
      const { data } = supabase.auth.onAuthStateChange((event, session) => {
        const nextUser = session?.user.id;
        if (event !== 'INITIAL_SESSION' && nextUser === userId) return;
        userId = nextUser;
        refreshId++;
        pairs = [];
        publish(userId ? initialSnapshot : emptySnapshot);
        // Auth callbacks run under Supabase's session lock.
        if (userId) setTimeout(() => void refreshLedger(), 0);
      });
      const timer = setInterval(() => {
        if (AppState.currentState === 'active') void refreshLedger();
      }, 15_000);
      stopWatching = () => {
        data.subscription.unsubscribe();
        clearInterval(timer);
      };
    } else {
      void refreshLedger();
    }
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stopWatching?.();
  };
}

export async function loadHome() {
  await refreshLedger();
  if (snapshot.loadError) throw new Error(snapshot.loadError);
  return snapshot;
}

async function write<T>(path: string, body?: object, method: 'POST' | 'PUT' = 'POST') {
  try {
    const result = await request<T>(path, method, body);
    await refreshLedger();
    return result;
  } catch (error) {
    if (error instanceof ApiError && error.code === 'edit_conflict') await refreshLedger();
    throw error;
  }
}

export async function saveDisplayName(displayName: string) {
  await write('/profile', { displayName: displayName.trim() }, 'PUT');
}

export async function issueInvitation() {
  const existing = pairs.find(pair => pair.status === 'pending');
  const pairId = existing?.id ?? (await write<{ pair: { id: string } }>('/pairs')).pair.id;
  const { code, invite } = await request<{ code: string; invite: { expires_at: string } }>(`/pairs/${pairId}/invites`, 'POST');
  return { code, expiresOn: businessDate(new Date(invite.expires_at)) };
}

export async function reviewInvitation(code: string): Promise<{ partnerName: string; archivedPairId?: string }> {
  const { inviterDisplayName, archivedPairId } = await request<{ inviterDisplayName: string; archivedPairId?: string }>(
    `/invites/preview?code=${encodeURIComponent(code.trim())}`,
  );
  return { partnerName: inviterDisplayName, archivedPairId };
}

export async function acceptInvitation(code: string) {
  try {
    await write('/invites/accept', { code: code.trim() });
  } catch (error) {
    if (error instanceof ApiError && error.code === 'revival_required' && error.latest?.pairId) {
      await refreshLedger();
      return { archivedPairId: error.latest.pairId };
    }
    throw error;
  }
}

function activePair() {
  if (!snapshot.activePair) throw new Error('記録するにはパートナーとの連携が必要です。');
  return snapshot.activePair;
}

export async function archiveActivePair() {
  await write(`/pairs/${activePair().id}/archive`);
}

function pastPair(pairId: string) {
  const pair = pairs.find(candidate => candidate.id === pairId && candidate.status === 'archived');
  if (!pair) throw new Error('過去のペアが見つかりませんでした。');
  return pair;
}

export async function requestRevival(pairId: string) {
  const pair = pastPair(pairId);
  const { revivalRequest } = await write<{ revivalRequest: RevivalRow }>(`/pairs/${pair.id}/revival-requests`);
  return mapRevival(revivalRequest, pair);
}

export async function resolveRevival(pairId: string, requestId: string, decision: RevivalDecision) {
  const pair = pastPair(pairId);
  if (!pair.revivals.some(revival => revival.id === requestId)) throw new Error('復活申請が見つかりませんでした。');
  const path = `/revival-requests/${requestId}`;
  const { revivalRequest } = await (decision === 'cancel'
    ? write<{ revivalRequest: RevivalRow }>(`${path}/cancel`)
    : write<{ revivalRequest: RevivalRow }>(`${path}/decide`, { decision: decision === 'approve' ? 'accept' : 'reject' }));
  return mapRevival(revivalRequest, pair);
}

function expenseBody(input: NewExpense) {
  return {
    ...input,
    title: input.title.trim() || defaultExpenseTitle,
    payerSlot: input.payerSlot.toLowerCase(),
    ...(input.expenseType === 'split' && {
      splitMode: input.counterpartyShareYen === Math.floor(input.amountYen / 2) ? 'half' : 'custom',
    }),
  };
}

export async function createExpense(input: NewExpense): Promise<ExpenseRecord> {
  const body = expenseBody(input);
  const { expense } = await write<{ expense: { id: string; version: number } }>(`/pairs/${activePair().id}/expenses`, body);
  const saved = snapshot.timeline.find((item): item is ExpenseRecord => item.kind === 'expense' && item.id === expense.id);
  const share = input.expenseType === 'split' ? input.counterpartyShareYen : 0;
  return saved ?? { ...input, ...expense, kind: 'expense', title: body.title, canceledAt: null, counterpartyShareYen: share, remainingYen: share };
}

export async function updateExpense(id: string, input: NewExpense, expected: RecordVersion) {
  const { pair } = recordForChange(id, expected, snapshot);
  const { promise, ...body } = expenseBody(input) as ReturnType<typeof expenseBody> & { promise?: { body: string; dueOn: string | null } };
  const attached = linkedPromise(pair.records, id);
  const promiseChange = promise && (attached
    ? { promiseUpdate: promise.body.trim() !== attached.title || promise.dueOn !== attached.dueOn ? promise : undefined }
    : { promise });
  await write(`/pairs/${pair.id}/expenses/${id}/update`, {
    ...body, ...promiseChange, version: expected.version, ledgerRevision: expected.ledgerRevision,
  });
}

export async function createSettlement(input: NewSettlement): Promise<SettlementRecord> {
  const pair = activePair();
  let budget = input.amountYen;
  const targets = [...new Set(input.settlementTargets)].flatMap(expenseId => {
    const expense = pair.timeline.find(item => item.id === expenseId);
    if (expense?.kind !== 'expense' || expense.remainingYen <= 0 || expense.payerSlot === input.senderSlot) {
      throw new Error('充当先を選び直してください。');
    }
    const targetAmountYen = Math.min(budget, expense.counterpartyShareYen);
    budget -= targetAmountYen;
    return targetAmountYen > 0 ? [{ expenseId, targetAmountYen }] : [];
  });
  const { settlement } = await write<{ settlement: { id: string; version: number } }>(`/pairs/${pair.id}/settlements`, {
    amountYen: input.amountYen, settledOn: input.occurredOn, senderSlot: input.senderSlot.toLowerCase(),
    ...(targets.length && { targets }),
  });
  const saved = snapshot.timeline.find((item): item is SettlementRecord => item.kind === 'settlement' && item.id === settlement.id);
  return saved ?? { ...input, ...settlement, kind: 'settlement', title: '精算', receiverSlot: otherSlot(input.senderSlot), canceledAt: null };
}

export async function setRecordCanceled(id: string, cancel: boolean, expected: RecordVersion) {
  const { record, pair } = recordForChange(id, expected, snapshot);
  if (record.kind === 'promise') throw new Error('この記録の状態を変更できません。');
  await write(`/pairs/${pair.id}/${record.kind}s/${id}/${cancel ? 'cancel' : 'restore'}`, {
    version: expected.version, ledgerRevision: expected.ledgerRevision,
  });
}
