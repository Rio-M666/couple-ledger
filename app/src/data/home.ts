import { projectAllocations } from './allocations.ts';
import {
  defaultExpenseTitle,
  expenseDateError,
  expenseTitleError,
  otherSlot,
  promiseBodyError,
  promiseDueDateError,
} from './expense.ts';
import { businessDate } from './format.ts';
import { displayNameError, emailError, invitationCodeError, passwordError } from './onboarding.ts';
import { pendingRevival, revivalCooldown, revivalPeriodMs, revivalStatus } from './pair-lifecycle.ts';
import type {
  AppState, ArchivedPair, AuditEntry, ExpenseRecord, HomeData, LedgerData, LedgerSnapshot, Member, MemberSlot,
  NewExpense, NewSettlement, PairLedger, PromiseRecord, RevivalRequest, SettlementRecord, TimelineItem,
} from './types.ts';

export type HomeScenario = 'sample' | 'zero' | 'empty' | 'error';

const viewer = { slot: 'A', displayName: '理央' } satisfies Member;
const partner = { slot: 'B', displayName: 'パートナー' } satisfies Member;
const fixturePartner = { ...partner, id: 'fixture-partner' };
const alternatePartner = { ...partner, id: 'alternate-partner', displayName: '葵' };

const latestExpense = {
  id: 'expense-3',
  kind: 'expense',
  expenseType: 'split',
  payerSlot: viewer.slot,
  title: 'ランチ',
  occurredOn: '2026-11-18',
  canceledAt: null,
  amountYen: 1_000,
  counterpartyShareYen: 500,
  remainingYen: 200,
} satisfies ExpenseRecord;

const exampleSettlement = {
  id: 'settlement-1',
  kind: 'settlement',
  senderSlot: partner.slot,
  receiverSlot: viewer.slot,
  title: '精算',
  occurredOn: '2026-11-17',
  canceledAt: null,
  amountYen: 700,
  settlementTargets: [],
} satisfies SettlementRecord;

const fixtureRecords: readonly TimelineItem[] = [
  {
    id: 'expense-8',
    kind: 'expense',
    expenseType: 'split',
    payerSlot: partner.slot,
    title: 'ベーカリー',
    occurredOn: '2026-11-06',
    canceledAt: '2026-11-06T05:00:00Z',
    amountYen: 900,
    counterpartyShareYen: 450,
    remainingYen: 0,
  },
  {
    id: 'promise-1',
    kind: 'promise',
    expenseId: 'expense-7',
    title: '来週スーパーで買い出し',
    occurredOn: '2026-11-07',
    canceledAt: null,
    assigneeSlot: partner.slot,
    dueOn: null,
    status: 'pending',
  },
  {
    id: 'expense-7',
    kind: 'expense',
    expenseType: 'gift_promise',
    payerSlot: viewer.slot,
    title: '書籍',
    occurredOn: '2026-11-07',
    canceledAt: null,
    amountYen: 1_500,
    counterpartyShareYen: 0,
    remainingYen: 0,
  },
  {
    id: 'expense-6',
    kind: 'expense',
    expenseType: 'gift',
    payerSlot: viewer.slot,
    title: 'コーヒーと焼き菓子',
    occurredOn: '2026-11-08',
    canceledAt: null,
    amountYen: 800,
    counterpartyShareYen: 0,
    remainingYen: 0,
  },
  {
    id: 'expense-5',
    kind: 'expense',
    expenseType: 'split',
    payerSlot: partner.slot,
    title: '水族館の入場券',
    occurredOn: '2026-11-09',
    canceledAt: null,
    amountYen: 3_000,
    counterpartyShareYen: 1_500,
    remainingYen: 0,
  },
  {
    id: 'expense-4',
    kind: 'expense',
    expenseType: 'split',
    payerSlot: viewer.slot,
    title: '夕食の食材',
    occurredOn: '2026-11-10',
    canceledAt: null,
    amountYen: 3_000,
    counterpartyShareYen: 1_500,
    remainingYen: 0,
  },
  {
    id: 'expense-1',
    kind: 'expense',
    expenseType: 'split',
    payerSlot: viewer.slot,
    title: 'スーパー',
    occurredOn: '2026-11-15',
    canceledAt: null,
    amountYen: 2_000,
    counterpartyShareYen: 1_000,
    remainingYen: 0,
  },
  {
    id: 'expense-2',
    kind: 'expense',
    expenseType: 'split',
    payerSlot: partner.slot,
    title: '電車賃',
    occurredOn: '2026-11-16',
    canceledAt: null,
    amountYen: 1_200,
    counterpartyShareYen: 600,
    remainingYen: 0,
  },
  exampleSettlement,
  latestExpense,
];

function balanceContribution(item: TimelineItem) {
  if (item.canceledAt) return 0;
  if (item.kind === 'expense' && item.expenseType === 'split') {
    return item.payerSlot === 'A' ? item.counterpartyShareYen : -item.counterpartyShareYen;
  }
  if (item.kind === 'settlement') {
    return item.senderSlot === 'A' ? item.amountYen : -item.amountYen;
  }
  return 0;
}

function projectHome(
  records: readonly TimelineItem[],
  ledgerRevision: number,
  currentPartner: Member,
  audit: LedgerData['audit'],
): LedgerData {
  const net = records.reduce((total, record) => total + BigInt(balanceContribution(record)), 0n);
  const netAYen = Number(net);
  if (!Number.isSafeInteger(netAYen)) throw new RangeError('残高を表示できる金額の上限を超えています。');

  // The fixture records are stored in registration order. The stable sort preserves it on the same business date.
  const ordered = [...records].sort((a, b) => a.occurredOn.localeCompare(b.occurredOn));
  const { allocations, expenses } = projectAllocations(ordered);
  const timeline = ordered.reverse().map(record => {
    if (record.kind === 'expense') {
      const remainingYen = expenses.get(record.id)?.remainingYen ?? 0;
      return remainingYen === record.remainingYen ? record : { ...record, remainingYen };
    }
    return record;
  });
  return { viewer, partner: currentPartner, balance: { netAYen, ledgerRevision }, timeline, audit, allocations };
}

function withDisplayName(data: LedgerData, displayName: string): LedgerData {
  const names = { A: displayName, B: data.partner.displayName };
  return {
    ...data,
    viewer: { ...data.viewer, displayName },
    timeline: data.timeline.map(record => record.kind === 'settlement'
      ? { ...record, title: `${names[record.senderSlot]}から${names[record.receiverSlot]}へ` }
      : record),
  };
}

function fixtureAudit(): LedgerData['audit'] {
  return new Map(fixtureRecords.map(record => {
    const createdAt = `${record.occurredOn}T00:00:00Z`;
    const original = { ...record, canceledAt: null };
    const entries: AuditEntry[] = [{ action: 'created', actorSlot: viewer.slot, at: createdAt, after: original }];
    if (record.id === 'expense-1') {
      entries[0] = { ...entries[0], after: { ...original, title: '買い物' } };
      entries.push({
        action: 'edited', actorSlot: viewer.slot, at: `${record.occurredOn}T02:00:00Z`,
        before: entries[0].after, after: record,
      });
    }
    if (record.canceledAt) {
      entries.push({ action: 'canceled', actorSlot: viewer.slot, at: record.canceledAt, before: original, after: record });
    }
    return [record.id, entries];
  }));
}

type StoredPair = Pick<PairLedger, 'id' | 'linkedOn' | 'revivalRequests'> & {
  partnerId: string;
  archivedAt: number | null;
  records: readonly TimelineItem[];
  ledger: LedgerData;
};

function createPair(id: string, member: Member & { id: string }, linkedOn: string, records: readonly TimelineItem[],
  revision: number, audit: LedgerData['audit']): StoredPair {
  const { id: partnerId, ...pairPartner } = member;
  return {
    id, partnerId, linkedOn, archivedAt: null, revivalRequests: [], records,
    ledger: projectHome(records, revision, pairPartner, audit),
  };
}

// Fixture adapter. Replace these reads/subscriptions and their record and lifecycle
// commands with Hono calls and consume the API's balance and allocation projections.
const fixtureAppState = { status: 'paired', displayName: viewer.displayName } satisfies AppState;
const fixturePair = createPair('pair-1', fixturePartner, '2026-11-06', fixtureRecords, 9, fixtureAudit());
const emptyLedger = projectHome([], 0, partner, new Map());
const pairs = new Map([[fixturePair.id, fixturePair]]);
const partnersPairedElsewhere = new Set<string>();
let profileName = viewer.displayName;
let replayOnboarding = false;
const initialSnapshot = projectSnapshot(fixtureAppState);
let snapshot = initialSnapshot;
const listeners = new Set<() => void>();
let revivalTimer: ReturnType<typeof setTimeout> | undefined;

function activeStoredPair() {
  return Array.from(pairs.values()).find(pair => pair.archivedAt === null);
}

function projectSnapshot(appState: AppState, now = Date.now()): LedgerSnapshot {
  const displayName = 'displayName' in appState ? appState.displayName : viewer.displayName;
  let ledger = withDisplayName(emptyLedger, displayName);
  let activePair: LedgerSnapshot['activePair'] = null;
  const pastPairs: ArchivedPair[] = [];
  if ('displayName' in appState) {
    for (const pair of pairs.values()) {
      if (pair.archivedAt === null && appState.status !== 'paired') continue;
      const data = withDisplayName(pair.ledger, displayName);
      const pairInfo = {
        ...data,
        id: pair.id,
        linkedOn: pair.linkedOn,
        revivalRequests: pair.revivalRequests.map(request => ({ ...request, status: revivalStatus(request, now) })),
      };
      if (pair.archivedAt === null) {
        ledger = data;
        activePair = { ...pairInfo, status: 'active', archivedAt: null };
      } else {
        pastPairs.push({
          ...pairInfo, status: 'archived', archivedAt: pair.archivedAt,
          partnerPairedElsewhere: partnersPairedElsewhere.has(pair.partnerId),
        });
      }
    }
  }
  pastPairs.sort((a, b) => b.archivedAt - a.archivedAt);
  return { ...ledger, appState, activePair, pastPairs };
}

export function getLedgerSnapshot() {
  return snapshot;
}

export function getInitialLedgerSnapshot() {
  return initialSnapshot;
}

export function subscribeToLedger(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) scheduleRevivalRefresh();
  return () => {
    listeners.delete(listener);
    if (!listeners.size) clearTimeout(revivalTimer);
  };
}

function scheduleRevivalRefresh(now = Date.now()) {
  clearTimeout(revivalTimer);
  if (!listeners.size) return;

  let next = Infinity;
  for (const pair of snapshot.pastPairs) {
    const request = pendingRevival(pair, now);
    const cooldown = revivalCooldown(pair, viewer.slot, now);
    next = Math.min(next, request?.expiresAt ?? Infinity, cooldown ?? Infinity);
  }
  if (Number.isFinite(next)) {
    revivalTimer = setTimeout(() => publish(snapshot.appState), next - now);
  }
}

function publish(appState = snapshot.appState) {
  const now = Date.now();
  snapshot = projectSnapshot(appState, now);
  scheduleRevivalRefresh(now);
  listeners.forEach(listener => listener());
}

export function resetOnboarding() {
  replayOnboarding = true;
  publish({ status: 'signed-out' });
}

export function logOutLocally() {
  replayOnboarding = false;
  publish({ status: 'signed-out' });
}

export function signInLocally(email: string, password: string) {
  if (!emailError(email) && !passwordError(password)) resumeLocalSession();
}

export function resumeLocalSession() {
  if (snapshot.appState.status === 'signed-out') {
    publish(replayOnboarding ? { status: 'needs-name' } : {
      status: activeStoredPair() ? 'paired' : 'unpaired', displayName: profileName,
    });
  }
}

export function saveDisplayName(displayName: string) {
  const { status } = snapshot.appState;
  if (status === 'signed-out' || displayNameError(displayName)) return;
  profileName = displayName.trim();
  publish({ status: status === 'needs-name' ? 'unpaired' : status, displayName: profileName });
}

function invitationPartner(code: string) {
  // The second fixture code exercises invitations from a different partner.
  return code.trim().toUpperCase().replaceAll('-', '') === 'B7C4D9F2' ? alternatePartner : fixturePartner;
}

export function reviewInvitation(code: string) {
  const invitedBy = invitationPartner(code);
  const past = snapshot.pastPairs.find(pair => pairs.get(pair.id)?.partnerId === invitedBy.id);
  return { partnerName: invitedBy.displayName, archivedPairId: past?.id };
}

export function acceptInvitation(code: string) {
  if (snapshot.appState.status !== 'unpaired' || invitationCodeError(code)) return;
  const invitedBy = invitationPartner(code);
  const active = activeStoredPair();
  if (active?.partnerId !== invitedBy.id) {
    requireUnpaired(invitedBy.id);
    if (reviewInvitation(code).archivedPairId) throw new Error('過去のペアから復活を申請してください。');
    const now = Date.now();
    const pair = createPair(`pair-${pairs.size + 1}`, invitedBy, businessDate(new Date(now)), [], 0, new Map());
    pairs.set(pair.id, pair);
    invalidateOtherRevivals(pair.id, now);
  }
  replayOnboarding = false;
  publish({ status: 'paired', displayName: profileName });
}

function requirePair() {
  const pair = snapshot.activePair && pairs.get(snapshot.activePair.id);
  if (!pair || pair.archivedAt !== null) {
    throw new Error('記録するにはパートナーとの連携が必要です。解散済みの記録は変更できません。');
  }
  return pair;
}

function requireArchivedPair(pairId: string) {
  const pair = pairs.get(pairId);
  if (!snapshot.pastPairs.some(candidate => candidate.id === pairId) || !pair || pair.archivedAt === null) {
    throw new Error('過去のペアが見つかりませんでした。');
  }
  return pair;
}

function requireUnpaired(partnerId: string) {
  if (activeStoredPair()) throw new Error('現在のペアを解散してからお試しください。');
  if (partnersPairedElsewhere.has(partnerId)) throw new Error('相手は別のペアに連携しています。');
}

function addRevival(pair: StoredPair, requesterSlot: MemberSlot, now: number) {
  if (revivalCooldown(pair, requesterSlot, now)) {
    throw new Error('却下から7日間は復活を再申請できません。');
  }
  const request: RevivalRequest = {
    id: `${pair.id}-revival-${pair.revivalRequests.length + 1}`, requesterSlot, status: 'pending',
    requestedAt: now, expiresAt: now + revivalPeriodMs,
  };
  const previous = pair.revivalRequests.map(item => ({ ...item, status: revivalStatus(item, now) }));
  return { request, pair: { ...pair, revivalRequests: [...previous, request] } };
}

function archivePair(incoming: boolean) {
  const pair = requirePair();
  const now = Date.now();
  const archived = { ...pair, archivedAt: now };
  pairs.set(pair.id, incoming ? addRevival(archived, partner.slot, now).pair : archived);
  publish({ status: 'unpaired', displayName: profileName });
}

export function archiveActivePair() {
  archivePair(false);
}

export function simulateIncomingRevival() {
  archivePair(true);
}

export function requestRevival(pairId: string) {
  const pair = requireArchivedPair(pairId);
  requireUnpaired(pair.partnerId);
  const now = Date.now();
  const pending = pendingRevival(pair, now);
  if (pending) return pending;
  const next = addRevival(pair, viewer.slot, now);
  pairs.set(pair.id, next.pair);
  publish();
  return next.request;
}

function invalidatePairRevival(pair: StoredPair, now: number) {
  if (pendingRevival(pair, now)) {
    pairs.set(pair.id, { ...pair, revivalRequests: pair.revivalRequests.map(request =>
      revivalStatus(request, now) === 'pending' ? { ...request, status: 'invalidated', decidedAt: now } : request) });
  }
}

function invalidateOtherRevivals(activePairId: string, now: number) {
  for (const pair of pairs.values()) {
    if (pair.id !== activePairId) invalidatePairRevival(pair, now);
  }
}

export type RevivalDecision = 'approve' | 'reject' | 'cancel';

export function resolveRevival(pairId: string, requestId: string, decision: RevivalDecision) {
  const pair = requireArchivedPair(pairId);
  const now = Date.now();
  const request = pair.revivalRequests.find(item => item.id === requestId);
  if (!request || revivalStatus(request, now) !== 'pending') throw new Error('この復活申請は終了しています。');
  if ((decision === 'cancel') !== (request.requesterSlot === viewer.slot)) {
    throw new Error('この復活申請は操作できません。');
  }
  if (decision === 'approve') requireUnpaired(pair.partnerId);

  const status = { approve: 'approved', reject: 'rejected', cancel: 'canceled' } as const;
  const result = { ...request, status: status[decision], decidedAt: now };
  pairs.set(pair.id, {
    ...pair, archivedAt: decision === 'approve' ? null : pair.archivedAt,
    revivalRequests: pair.revivalRequests.map(item => item === request ? result : item),
  });
  if (decision === 'approve') {
    invalidateOtherRevivals(pair.id, now);
    publish({ status: 'paired', displayName: profileName });
  } else {
    publish();
  }
  return result;
}

// Local fixture for a former partner becoming linked to another account.
export function setFixturePartnerPairedElsewhere(pairId: string, paired: boolean) {
  const pair = requireArchivedPair(pairId);
  if (paired) {
    partnersPairedElsewhere.add(pair.partnerId);
    invalidatePairRevival(pair, Date.now());
  } else {
    partnersPairedElsewhere.delete(pair.partnerId);
  }
  publish();
}

type PendingChange = Pick<AuditEntry, 'action' | 'before' | 'after'>;

function newRecordId(kind: TimelineItem['kind'], pairId: string, revision: number) {
  return `${kind}-new-${pairId}-${revision}`;
}

function saveChanges(nextRecords: readonly TimelineItem[], changes: readonly PendingChange[], at: string) {
  const pair = requirePair();
  const audit = new Map(pair.ledger.audit);
  for (const change of changes) {
    audit.set(change.after.id, [
      ...(audit.get(change.after.id) ?? []),
      { ...change, at, actorSlot: snapshot.viewer.slot },
    ]);
  }
  const ledger = projectHome(nextRecords, pair.ledger.balance.ledgerRevision + 1, pair.ledger.partner, audit);
  pairs.set(pair.id, { ...pair, records: nextRecords, ledger });
  publish();
}

function buildExpense(input: NewExpense, id: string): ExpenseRecord {
  const title = input.title.trim() || defaultExpenseTitle;
  const share = input.expenseType === 'split' ? input.counterpartyShareYen : 0;
  if (!Number.isSafeInteger(input.amountYen) || input.amountYen < 1) {
    throw new Error('1円以上の整数を入力してください。');
  }
  if (!Number.isSafeInteger(share) || share < 0 || share > input.amountYen) {
    throw new Error('相手の負担額は0円から支払い金額までの整数で入力してください。');
  }
  const detailError = expenseDateError(input.occurredOn) ?? expenseTitleError(title);
  if (detailError) throw new Error(detailError);

  return {
    id, kind: 'expense', expenseType: input.expenseType, payerSlot: input.payerSlot,
    title, occurredOn: input.occurredOn, canceledAt: null, amountYen: input.amountYen,
    counterpartyShareYen: share, remainingYen: share,
  };
}

function buildPromise(input: Extract<NewExpense, { expenseType: 'gift_promise' }>, expense: ExpenseRecord, id: string) {
  const body = input.promise.body.trim();
  const promiseError = promiseBodyError(body) ?? promiseDueDateError(input.promise.dueOn ?? '');
  if (promiseError) throw new Error(promiseError);

  return {
    id, kind: 'promise', expenseId: expense.id, title: body, occurredOn: expense.occurredOn,
    canceledAt: null, assigneeSlot: otherSlot(expense.payerSlot), dueOn: input.promise.dueOn, status: 'pending',
  } satisfies PromiseRecord;
}

export function createExpense(input: NewExpense) {
  const { id: pairId, records } = requirePair();
  const revision = snapshot.balance.ledgerRevision + 1;
  const expense = buildExpense(input, newRecordId('expense', pairId, revision));
  const added: TimelineItem[] = [];
  if (input.expenseType === 'gift_promise') {
    added.push(buildPromise(input, expense, newRecordId('promise', pairId, revision)));
  }
  added.push(expense);
  saveChanges([...records, ...added], added.map(after => ({ action: 'created', after })), new Date().toISOString());
  return snapshot.timeline.find(item => item.kind === 'expense' && item.id === expense.id) as ExpenseRecord;
}

function buildSettlement(input: NewSettlement, pairId: string, current = snapshot): SettlementRecord {
  if (!Number.isSafeInteger(input.amountYen) || input.amountYen < 1) {
    throw new Error('1円以上の整数を入力してください。');
  }
  const dateError = expenseDateError(input.occurredOn);
  if (dateError) throw new Error(dateError);

  const receiverSlot = otherSlot(input.senderSlot);
  const targets = [...new Set(input.settlementTargets)];
  const eligible = new Set(settlementCandidates(current.timeline, input.senderSlot).map(item => item.id));
  if (targets.some(id => !eligible.has(id))) throw new Error('充当先を選び直してください。');
  return {
    ...input, id: newRecordId('settlement', pairId, current.balance.ledgerRevision + 1), kind: 'settlement',
    title: '精算', receiverSlot, canceledAt: null, settlementTargets: targets,
  };
}

export function settlementCandidates(timeline: readonly TimelineItem[], sender: NewSettlement['senderSlot']) {
  return timeline.filter((item): item is ExpenseRecord => item.kind === 'expense' && item.expenseType === 'split'
    && !item.canceledAt && item.payerSlot !== sender && item.remainingYen > 0);
}

export function previewSettlement(input: NewSettlement, current = snapshot) {
  const { id: pairId, records, ledger } = pairForPreview(current);
  const settlement = buildSettlement(input, pairId, current);
  const projected = projectHome([...records, settlement], ledger.balance.ledgerRevision, ledger.partner, ledger.audit);
  return {
    netAfter: projected.balance.netAYen,
    prepaymentYen: projected.allocations.prepayments.get(settlement.id) ?? 0,
  };
}

export function createSettlement(input: NewSettlement) {
  const { id: pairId, records } = requirePair();
  const settlement = buildSettlement(input, pairId);
  saveChanges([...records, settlement], [{ action: 'created', after: settlement }], new Date().toISOString());
  return snapshot.timeline.find(item => item.kind === 'settlement' && item.id === settlement.id) as SettlementRecord;
}

export type RecordVersion = { pairId?: string; version: number; ledgerRevision: number };

function pairForPreview(current: LedgerSnapshot) {
  if (current === snapshot) return requirePair();
  if (!current.activePair) throw new Error('記録するにはパートナーとの連携が必要です。');
  return { id: current.activePair.id, records: [...current.timeline].reverse(), ledger: current };
}

export function recordForChange(id: string, expected: RecordVersion, current = snapshot) {
  const pair = pairForPreview(current);
  if (expected.pairId !== undefined && expected.pairId !== pair.id) throw new Error('別のペアの記録は変更できません。');
  const record = pair.records.find(item => item.id === id);
  if (!record) throw new Error('記録が見つかりませんでした。');
  if (expected.version !== (record.version ?? current.audit.get(id)?.length)
    || expected.ledgerRevision !== current.balance.ledgerRevision) {
    throw new Error('記録が変わりました。もう一度変更内容を確認してください。');
  }
  return { record, pair };
}

export function linkedPromise(timeline: readonly TimelineItem[], expenseId: string) {
  const related = timeline.filter((item): item is PromiseRecord => item.kind === 'promise' && item.expenseId === expenseId);
  return related.find(item => !item.canceledAt) ?? related[0];
}

function prepareExpenseEdit(id: string, input: NewExpense, expected: RecordVersion, at: string, current = snapshot) {
  const { record: before, pair } = recordForChange(id, expected, current);
  if (before.kind !== 'expense' || before.canceledAt) throw new Error('この支払いは編集できません。');

  const after = buildExpense(input, id);
  const changes: PendingChange[] = [{ action: 'edited', before, after }];
  const promise = linkedPromise(pair.records, id);
  if (input.expenseType === 'gift_promise') {
    const existing = before.expenseType === 'gift_promise' ? promise : undefined;
    const next = buildPromise(input, after, existing?.id ?? newRecordId('promise', pair.id, expected.ledgerRevision + 1));
    if (!existing) {
      changes.push({ action: 'created', after: next });
    } else if (next.title !== existing.title || next.dueOn !== existing.dueOn
      || next.occurredOn !== existing.occurredOn || next.assigneeSlot !== existing.assigneeSlot) {
      changes.push({
        action: 'edited', before: existing,
        after: { ...next, canceledAt: existing.canceledAt, status: existing.status },
      });
    }
  } else if (promise && !promise.canceledAt) {
    changes.push({ action: 'canceled', before: promise, after: { ...promise, canceledAt: at } });
  }
  return { before, after, changes };
}

function applyChanges(changes: readonly PendingChange[], records = requirePair().records) {
  const replacements = new Map(changes.map(change => [change.after.id, change.after]));
  return [
    ...records.map(record => replacements.get(record.id) ?? record),
    ...changes.filter(change => !change.before).map(change => change.after),
  ];
}

function previewBalance(changes: readonly PendingChange[], current: LedgerSnapshot) {
  const { ledger, records } = pairForPreview(current);
  const projected = projectHome(applyChanges(changes, records), ledger.balance.ledgerRevision, ledger.partner, ledger.audit);
  return { netBefore: current.balance.netAYen, netAfter: projected.balance.netAYen };
}

export function previewExpenseEdit(id: string, input: NewExpense, expected: RecordVersion, current = snapshot) {
  const { before, after, changes } = prepareExpenseEdit(id, input, expected, new Date().toISOString(), current);
  return {
    before, after, ...previewBalance(changes, current),
    cancelsPromise: changes.some(change => change.action === 'canceled'),
  };
}

export function updateExpense(id: string, input: NewExpense, expected: RecordVersion) {
  const at = new Date().toISOString();
  const { changes } = prepareExpenseEdit(id, input, expected, at);
  saveChanges(applyChanges(changes), changes, at);
}

function prepareRecordStatus(id: string, cancel: boolean, expected: RecordVersion, at: string, current = snapshot) {
  const { record: before, pair } = recordForChange(id, expected, current);
  if (before.kind === 'promise' || Boolean(before.canceledAt) === cancel) {
    throw new Error('この記録の状態を変更できません。');
  }
  const changes: PendingChange[] = [{
    action: cancel ? 'canceled' : 'restored',
    before,
    after: { ...before, canceledAt: cancel ? at : null },
  }];
  if (cancel && before.kind === 'expense') {
    for (const item of pair.records) {
      if (item.kind === 'promise' && item.expenseId === id && !item.canceledAt) {
        changes.push({ action: 'canceled', before: item, after: { ...item, canceledAt: at } });
      }
    }
  }
  return changes;
}

export function previewRecordStatus(id: string, cancel: boolean, expected: RecordVersion, current = snapshot) {
  return previewBalance(prepareRecordStatus(id, cancel, expected, new Date().toISOString(), current), current);
}

export function setRecordCanceled(id: string, cancel: boolean, expected: RecordVersion) {
  const at = new Date().toISOString();
  const changes = prepareRecordStatus(id, cancel, expected, at);
  saveChanges(applyChanges(changes), changes, at);
}

export async function loadHome(scenario: HomeScenario = 'sample'): Promise<HomeData> {
  switch (scenario) {
    case 'sample':
      return getLedgerSnapshot();
    case 'zero':
      return withDisplayName(projectHome([
        ...fixtureRecords,
        { ...exampleSettlement, id: 'settlement-2', occurredOn: '2026-11-18', amountYen: 200 },
      ], 10, partner, initialSnapshot.audit), viewer.displayName);
    case 'empty':
      return emptyLedger;
    case 'error':
      throw new Error('通信できないため、記録を読み込めませんでした。');
  }
}
