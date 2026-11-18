import {
  defaultExpenseTitle,
  expenseDateError,
  expenseTitleError,
  otherSlot,
  promiseBodyError,
  promiseDueDateError,
} from './expense.ts';
import type { ExpenseRecord, HomeData, Member, NewExpense, TimelineItem } from './types.ts';

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
  title: `${partner.displayName}から${viewer.displayName}へ`,
  occurredOn: '2026-11-17',
  canceledAt: null,
  amountYen: 700,
} satisfies TimelineItem;

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

function projectHome(records: readonly TimelineItem[], ledgerRevision: number): HomeData {
  const netAYen = records.reduce((net, record) => net + balanceContribution(record), 0);
  if (!Number.isSafeInteger(netAYen)) throw new RangeError('残高を表示できる金額の上限を超えています。');

  // Reverse registration order before the stable sort so newer same-day records come first.
  const timeline = [...records].reverse().sort((a, b) => b.occurredOn.localeCompare(a.occurredOn));
  return { viewer, partner, balance: { netAYen, ledgerRevision }, timeline };
}

// Fixture adapter. When Hono is connected, replace reads/subscriptions and writes
// here with API calls and use the engine's balance and allocation projections.
const initialSnapshot = projectHome(fixtureRecords, 9);
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

export function createExpense(input: NewExpense) {
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

  const revision = snapshot.balance.ledgerRevision + 1;
  const expense: ExpenseRecord = {
    id: `expense-new-${revision}`,
    kind: 'expense',
    expenseType: input.expenseType,
    payerSlot: input.payerSlot,
    title,
    occurredOn: input.occurredOn,
    canceledAt: null,
    amountYen: input.amountYen,
    counterpartyShareYen: share,
    // The fixture adapter keeps per-row allocations as fixture data.
    remainingYen: share,
  };

  const nextRecords = [...records];
  if (input.expenseType === 'gift_promise') {
    const body = input.promise.body.trim();
    const promiseError = promiseBodyError(body) ?? promiseDueDateError(input.promise.dueOn ?? '');
    if (promiseError) throw new Error(promiseError);
    nextRecords.push({
      id: `promise-new-${revision}`,
      kind: 'promise',
      expenseId: expense.id,
      title: body,
      occurredOn: expense.occurredOn,
      canceledAt: null,
      assigneeSlot: otherSlot(expense.payerSlot),
      dueOn: input.promise.dueOn,
      status: 'pending',
    });
  }
  nextRecords.push(expense);

  const nextSnapshot = projectHome(nextRecords, revision);
  records = nextRecords;
  snapshot = nextSnapshot;
  listeners.forEach(listener => listener());
  return expense;
}

export async function loadHome(scenario: HomeScenario = 'sample'): Promise<HomeData> {
  switch (scenario) {
    case 'sample':
      return getLedgerSnapshot();
    case 'zero':
      return projectHome([
        ...fixtureRecords.slice(0, -1),
        { ...latestExpense, remainingYen: 0 },
        { ...exampleSettlement, id: 'settlement-2', occurredOn: '2026-11-18', amountYen: 200 },
      ], 10);
    case 'empty':
      return projectHome([], 0);
    case 'error':
      throw new Error('通信できないため、記録を読み込めませんでした。');
  }
}
