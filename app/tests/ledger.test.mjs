import assert from 'node:assert/strict';
import { test } from 'node:test';

import { expenseStatus, halfShare, yenInputError } from '../src/data/expense.ts';
import { businessDate, formatDateHeading } from '../src/data/format.ts';
import { groupHistory } from '../src/data/history.ts';
import {
  createExpense,
  getInitialLedgerSnapshot,
  getLedgerSnapshot,
  loadHome,
  subscribeToLedger,
} from '../src/data/home.ts';

const draft = {
  title: '',
  occurredOn: '2026-11-18',
  payerSlot: 'A',
  amountYen: 1_001,
  expenseType: 'split',
  counterpartyShareYen: halfShare(1_001),
};

test('§5.3 fixtures and the older records leave a ¥200 balance', async () => {
  const { balance, timeline } = getInitialLedgerSnapshot();
  assert.equal(timeline.length, 10);
  assert.deepEqual(timeline.slice(0, 4).map(item => item.id), [
    'expense-3', 'settlement-1', 'expense-2', 'expense-1',
  ]);
  assert.equal(balance.netAYen, 1_000 - 600 - 700 + 500);
  for (const id of ['expense-4', 'expense-5']) {
    const item = timeline.find(record => record.id === id);
    assert.equal(item.counterpartyShareYen, 1_500);
    assert.equal(expenseStatus(item), 'settled');
  }
  assert.equal(timeline.find(item => item.id === 'expense-8').canceledAt !== null, true);
  assert.equal((await loadHome('zero')).balance.netAYen, 0);
});

test('saving A and B splits applies §5.1, including the odd yen and both custom-share endpoints', async () => {
  const startingBalance = getLedgerSnapshot().balance.netAYen;
  const updates = [];
  const unsubscribe = subscribeToLedger(() => updates.push(getLedgerSnapshot()));
  try {
    const split = createExpense(draft);
    const other = createExpense({ ...draft, payerSlot: 'B', amountYen: 800, counterpartyShareYen: 800 });
    createExpense({ ...draft, counterpartyShareYen: 0 });

    assert.equal(split.title, '支払い');
    assert.equal(split.counterpartyShareYen, 500);
    assert.equal(split.amountYen - split.counterpartyShareYen, 501);
    assert.deepEqual(updates.map(data => data.balance.netAYen), [
      startingBalance + 500,
      startingBalance + 500 - 800,
      startingBalance + 500 - 800,
    ]);
    assert.equal(updates[0].timeline[0], split);
    assert.equal(updates[1].timeline[0], other);
    assert.equal(await loadHome(), updates.at(-1));
    assert.equal(getInitialLedgerSnapshot().balance.netAYen, 200);
  } finally {
    unsubscribe();
  }
});

test('a gift with a promise publishes one linked pending promise and preserves the balance', () => {
  const before = getLedgerSnapshot();
  const gift = createExpense({ ...draft, expenseType: 'gift' });
  const expense = createExpense({
    ...draft,
    payerSlot: 'B',
    expenseType: 'gift_promise',
    promise: { body: '  次の週末に買い出し  ', dueOn: '2026-11-28' },
  });
  const after = getLedgerSnapshot();
  assert.equal(gift.counterpartyShareYen, 0);
  assert.equal(expense.counterpartyShareYen, 0);
  assert.equal(after.balance.netAYen, before.balance.netAYen);
  const related = after.timeline.filter(item => item.kind === 'promise' && item.expenseId === expense.id);
  assert.equal(related.length, 1);
  assert.deepEqual(related[0], {
    id: related[0].id,
    kind: 'promise',
    expenseId: expense.id,
    title: '次の週末に買い出し',
    occurredOn: expense.occurredOn,
    canceledAt: null,
    assigneeSlot: 'A',
    dueOn: '2026-11-28',
    status: 'pending',
  });
});

test('invalid input leaves the published ledger unchanged', () => {
  const before = getLedgerSnapshot();
  for (const amountYen of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.ok(yenInputError(String(amountYen), 1));
    assert.throws(() => createExpense({ ...draft, amountYen }));
  }
  for (const counterpartyShareYen of [-1, 0.5, draft.amountYen + 1]) {
    assert.ok(yenInputError(String(counterpartyShareYen), 0, draft.amountYen));
    assert.throws(() => createExpense({ ...draft, counterpartyShareYen }));
  }
  assert.throws(() => createExpense({ ...draft, occurredOn: '2026-02-30' }));
  assert.throws(() => createExpense({
    ...draft, expenseType: 'gift_promise', promise: { body: '   ', dueOn: null },
  }));
  assert.equal(getLedgerSnapshot(), before);
});

test('history preserves chronology and combines kind, title, payer, status, and inclusive dates', () => {
  const { timeline } = getInitialLedgerSnapshot();
  const defaults = { payer: 'all', status: 'all', from: '', through: '' };
  const all = groupHistory(timeline, 'all', '', defaults);
  assert.deepEqual(all.flatMap(group => group.items), timeline);
  assert.deepEqual(all.find(group => group.date === '2026-11-07').items.map(item => item.kind), [
    'expense', 'promise',
  ]);
  assert.deepEqual(groupHistory(timeline, 'all', 'スーパー', defaults)
    .flatMap(group => group.items.map(item => item.kind)), ['expense', 'promise']);
  assert.deepEqual(groupHistory(timeline, 'expense', 'ー', {
    payer: 'A', status: 'settled', from: '2026-11-10', through: '2026-11-15',
  }).flatMap(group => group.items.map(item => item.title)), ['スーパー']);
  assert.deepEqual(groupHistory(timeline, 'expense', '', { ...defaults, status: 'canceled' })
    .flatMap(group => group.items.map(item => item.title)), ['ベーカリー']);
});

test('date headings follow the Tokyo day boundary and show the actual weekday', () => {
  const now = new Date('2026-11-17T15:00:00Z');
  assert.equal(businessDate(new Date('2026-11-17T14:59:59Z')), '2026-11-17');
  assert.equal(businessDate(now), '2026-11-18');
  assert.equal(formatDateHeading('2026-11-18', now), '今日');
  assert.equal(formatDateHeading('2026-11-17', now), '昨日');
  assert.equal(formatDateHeading('2026-11-15', now), '11月15日（日）');
});
