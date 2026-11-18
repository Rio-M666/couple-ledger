import { projectAllocations } from './allocations.ts';
import {
  defaultExpenseTitle,
  expenseDateError,
  expenseTitleError,
  otherSlot,
  promiseBodyError,
  promiseDueDateError,
} from './expense.ts';
import { displayNameError, emailError, invitationCodeError, passwordError } from './onboarding.ts';
import type {
  AppState, AuditEntry, ExpenseRecord, HomeData, LedgerSnapshot, Member, NewExpense, NewSettlement,
  PromiseRecord, SettlementRecord, TimelineItem,
} from './types.ts';

export type HomeScenario = 'sample' | 'zero' | 'empty' | 'error';

const viewer = { slot: 'A', displayName: '理央' } satisfies Member;
const partner = { slot: 'B', displayName: 'パートナー' } satisfies Member;

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
  appState: AppState,
  audit: LedgerSnapshot['audit'],
): LedgerSnapshot {
  const net = records.reduce((total, record) => total + BigInt(balanceContribution(record)), 0n);
  const netAYen = Number(net);
  if (!Number.isSafeInteger(netAYen)) throw new RangeError('残高を表示できる金額の上限を超えています。');

  const currentViewer = 'displayName' in appState ? { ...viewer, displayName: appState.displayName } : viewer;
  const names = { A: currentViewer.displayName, B: partner.displayName };
  // The fixture records are stored in registration order. The stable sort preserves it on the same business date.
  const ordered = [...records].sort((a, b) => a.occurredOn.localeCompare(b.occurredOn));
  const { allocations, expenses } = projectAllocations(ordered);
  const timeline = ordered.reverse().map(record => {
    if (record.kind === 'expense') {
      const remainingYen = expenses.get(record.id)?.remainingYen ?? 0;
      return remainingYen === record.remainingYen ? record : { ...record, remainingYen };
    }
    if (record.kind === 'settlement') {
      return { ...record, title: `${names[record.senderSlot]}から${names[record.receiverSlot]}へ` };
    }
    return record;
  });
  return { viewer: currentViewer, partner, balance: { netAYen, ledgerRevision }, timeline, appState, audit, allocations };
}

function fixtureAudit(): LedgerSnapshot['audit'] {
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

// Fixture adapter. When Hono is connected, replace reads/subscriptions and writes
// here with API calls and consume the engine's balance and allocation projections.
const fixtureAppState = { status: 'paired', displayName: viewer.displayName } satisfies AppState;
const initialSnapshot = projectHome(fixtureRecords, 9, fixtureAppState, fixtureAudit());
let records = fixtureRecords;
let snapshot = initialSnapshot;
const listeners = new Set<() => void>();

export function getLedgerSnapshot() {
  return snapshot;
}

export function getInitialLedgerSnapshot() {
  return initialSnapshot;
}

export function subscribeToLedger(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function publish(nextSnapshot: LedgerSnapshot, nextRecords = records) {
  records = nextRecords;
  snapshot = nextSnapshot;
  listeners.forEach(listener => listener());
}

function setAppState(appState: AppState) {
  publish(projectHome(records, snapshot.balance.ledgerRevision, appState, snapshot.audit));
}

export function resetOnboarding() {
  setAppState({ status: 'signed-out' });
}

export function signInLocally(email: string, password: string) {
  // Supabase Auth boundary. The local stub validates shape and never stores credentials.
  if (snapshot.appState.status === 'signed-out' && !emailError(email) && !passwordError(password)) {
    setAppState({ status: 'needs-name' });
  }
}

export function saveDisplayName(displayName: string) {
  if (snapshot.appState.status === 'needs-name' && !displayNameError(displayName)) {
    setAppState({ status: 'unpaired', displayName: displayName.trim() });
  }
}

export function acceptInvitation(code: string) {
  // Local stub: every well-formed code resolves to the fixture partner.
  if (snapshot.appState.status === 'unpaired' && !invitationCodeError(code)) {
    setAppState({ ...snapshot.appState, status: 'paired' });
  }
}

function requirePair() {
  if (snapshot.appState.status !== 'paired') throw new Error('記録するにはパートナーとの連携が必要です。');
}

type PendingChange = Pick<AuditEntry, 'action' | 'before' | 'after'>;

function saveChanges(nextRecords: readonly TimelineItem[], changes: readonly PendingChange[], at: string) {
  const audit = new Map(snapshot.audit);
  for (const change of changes) {
    audit.set(change.after.id, [
      ...(audit.get(change.after.id) ?? []),
      { ...change, at, actorSlot: snapshot.viewer.slot },
    ]);
  }
  publish(projectHome(nextRecords, snapshot.balance.ledgerRevision + 1, snapshot.appState, audit), nextRecords);
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
  requirePair();
  const revision = snapshot.balance.ledgerRevision + 1;
  const expense = buildExpense(input, `expense-new-${revision}`);
  const added: TimelineItem[] = [];
  if (input.expenseType === 'gift_promise') {
    added.push(buildPromise(input, expense, `promise-new-${revision}`));
  }
  added.push(expense);
  saveChanges([...records, ...added], added.map(after => ({ action: 'created', after })), new Date().toISOString());
  return snapshot.timeline.find(item => item.kind === 'expense' && item.id === expense.id) as ExpenseRecord;
}

function buildSettlement(input: NewSettlement): SettlementRecord {
  if (!Number.isSafeInteger(input.amountYen) || input.amountYen < 1) {
    throw new Error('1円以上の整数を入力してください。');
  }
  const dateError = expenseDateError(input.occurredOn);
  if (dateError) throw new Error(dateError);

  const receiverSlot = otherSlot(input.senderSlot);
  const targets = [...new Set(input.settlementTargets)];
  const eligible = new Set(settlementCandidates(snapshot.timeline, input.senderSlot).map(item => item.id));
  if (targets.some(id => !eligible.has(id))) throw new Error('充当先を選び直してください。');
  return {
    ...input, id: `settlement-new-${snapshot.balance.ledgerRevision + 1}`, kind: 'settlement',
    title: '精算', receiverSlot, canceledAt: null, settlementTargets: targets,
  };
}

export function settlementCandidates(timeline: readonly TimelineItem[], sender: NewSettlement['senderSlot']) {
  return timeline.filter((item): item is ExpenseRecord => item.kind === 'expense' && item.expenseType === 'split'
    && !item.canceledAt && item.payerSlot !== sender && item.remainingYen > 0);
}

export function previewSettlement(input: NewSettlement) {
  requirePair();
  const settlement = buildSettlement(input);
  const projected = projectHome([...records, settlement], snapshot.balance.ledgerRevision, snapshot.appState, snapshot.audit);
  return {
    netAfter: projected.balance.netAYen,
    prepaymentYen: projected.allocations.prepayments.get(settlement.id) ?? 0,
  };
}

export function createSettlement(input: NewSettlement) {
  requirePair();
  const settlement = buildSettlement(input);
  saveChanges([...records, settlement], [{ action: 'created', after: settlement }], new Date().toISOString());
  return snapshot.timeline.find(item => item.kind === 'settlement' && item.id === settlement.id) as SettlementRecord;
}

export type RecordVersion = { version: number; ledgerRevision: number };

function recordForChange(id: string, expected: RecordVersion) {
  requirePair();
  const record = records.find(item => item.id === id);
  if (!record) throw new Error('記録が見つかりませんでした。');
  // API boundary: the server will check both versions atomically on preview and commit.
  if (expected.version !== snapshot.audit.get(id)?.length || expected.ledgerRevision !== snapshot.balance.ledgerRevision) {
    throw new Error('記録が変わりました。もう一度変更内容を確認してください。');
  }
  return record;
}

export function linkedPromise(timeline: readonly TimelineItem[], expenseId: string) {
  const related = timeline.filter((item): item is PromiseRecord => item.kind === 'promise' && item.expenseId === expenseId);
  return related.find(item => !item.canceledAt) ?? related[0];
}

function prepareExpenseEdit(id: string, input: NewExpense, expected: RecordVersion, at: string) {
  const before = recordForChange(id, expected);
  if (before.kind !== 'expense' || before.canceledAt) throw new Error('この支払いは編集できません。');

  const after = buildExpense(input, id);
  const changes: PendingChange[] = [{ action: 'edited', before, after }];
  const promise = linkedPromise(records, id);
  if (input.expenseType === 'gift_promise') {
    const existing = before.expenseType === 'gift_promise' ? promise : undefined;
    const next = buildPromise(input, after, existing?.id ?? `promise-new-${expected.ledgerRevision + 1}`);
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

function applyChanges(changes: readonly PendingChange[]) {
  const replacements = new Map(changes.map(change => [change.after.id, change.after]));
  return [
    ...records.map(record => replacements.get(record.id) ?? record),
    ...changes.filter(change => !change.before).map(change => change.after),
  ];
}

function previewBalance(changes: readonly PendingChange[]) {
  const projected = projectHome(applyChanges(changes), snapshot.balance.ledgerRevision, snapshot.appState, snapshot.audit);
  return { netBefore: snapshot.balance.netAYen, netAfter: projected.balance.netAYen };
}

export function previewExpenseEdit(id: string, input: NewExpense, expected: RecordVersion) {
  const { before, after, changes } = prepareExpenseEdit(id, input, expected, new Date().toISOString());
  return {
    before, after, ...previewBalance(changes),
    cancelsPromise: changes.some(change => change.action === 'canceled'),
  };
}

export function updateExpense(id: string, input: NewExpense, expected: RecordVersion) {
  const at = new Date().toISOString();
  const { changes } = prepareExpenseEdit(id, input, expected, at);
  saveChanges(applyChanges(changes), changes, at);
}

function prepareRecordStatus(id: string, cancel: boolean, expected: RecordVersion, at: string) {
  const before = recordForChange(id, expected);
  if (before.kind === 'promise' || Boolean(before.canceledAt) === cancel) {
    throw new Error('この記録の状態を変更できません。');
  }
  const changes: PendingChange[] = [{
    action: cancel ? 'canceled' : 'restored',
    before,
    after: { ...before, canceledAt: cancel ? at : null },
  }];
  if (cancel && before.kind === 'expense') {
    for (const item of records) {
      if (item.kind === 'promise' && item.expenseId === id && !item.canceledAt) {
        changes.push({ action: 'canceled', before: item, after: { ...item, canceledAt: at } });
      }
    }
  }
  return changes;
}

export function previewRecordStatus(id: string, cancel: boolean, expected: RecordVersion) {
  return previewBalance(prepareRecordStatus(id, cancel, expected, new Date().toISOString()));
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
      return projectHome([
        ...fixtureRecords,
        { ...exampleSettlement, id: 'settlement-2', occurredOn: '2026-11-18', amountYen: 200 },
      ], 10, fixtureAppState, initialSnapshot.audit);
    case 'empty':
      return projectHome([], 0, fixtureAppState, new Map());
    case 'error':
      throw new Error('通信できないため、記録を読み込めませんでした。');
  }
}
