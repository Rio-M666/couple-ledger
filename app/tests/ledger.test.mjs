import assert from 'node:assert/strict';
import { test } from 'node:test';

import { expenseStatus, halfShare, yenInputError } from '../src/data/expense.ts';
import { businessDate, formatDateHeading } from '../src/data/format.ts';
import { groupHistory } from '../src/data/history.ts';
import {
  acceptInvitation,
  createExpense,
  createSettlement,
  getInitialLedgerSnapshot,
  getLedgerSnapshot,
  loadHome,
  previewExpenseEdit,
  previewSettlement,
  resetOnboarding,
  saveDisplayName,
  setRecordCanceled,
  signInLocally,
  subscribeToLedger,
  updateExpense,
} from '../src/data/home.ts';
import { invitationCodeError, sampleInvitation } from '../src/data/onboarding.ts';

const draft = {
  title: '',
  occurredOn: '2026-11-18',
  payerSlot: 'A',
  amountYen: 1_001,
  expenseType: 'split',
  counterpartyShareYen: halfShare(1_001),
};

function currentVersion(id) {
  const { audit, balance } = getLedgerSnapshot();
  return { version: audit.get(id).length, ledgerRevision: balance.ledgerRevision };
}

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

test('settling ¥200 clears the ¥200 balance, while ¥500 leaves a ¥300 prepayment', () => {
  const input = { senderSlot: 'B', occurredOn: draft.occurredOn, settlementTargets: [] };
  assert.equal(getLedgerSnapshot().balance.netAYen, 200);
  const exact = createSettlement({ ...input, amountYen: 200, settlementTargets: ['expense-3'] });
  assert.deepEqual(exact.settlementTargets, ['expense-3']);
  assert.equal(getLedgerSnapshot().balance.netAYen, 0);
  assert.ok(getLedgerSnapshot().allocations.settlements.some(allocation =>
    allocation.settlementId === exact.id && allocation.expenseId === 'expense-3' && allocation.amountYen === 200));
  assert.equal(getLedgerSnapshot().timeline.find(item => item.id === 'expense-3').remainingYen, 0);
  setRecordCanceled(exact.id, true, currentVersion(exact.id));
  assert.equal(getLedgerSnapshot().balance.netAYen, 200);

  const overpayment = { ...input, amountYen: 500 };
  assert.deepEqual(previewSettlement(overpayment), { netAfter: -300, prepaymentYen: 300 });
  const transfer = createSettlement(overpayment);
  assert.equal(getLedgerSnapshot().balance.netAYen, -300);
  assert.equal(getLedgerSnapshot().allocations.prepayments.get(transfer.id), 300);
  setRecordCanceled(transfer.id, true, currentVersion(transfer.id));
  setRecordCanceled(transfer.id, false, currentVersion(transfer.id));
  assert.equal(getLedgerSnapshot().balance.netAYen, -300);
  setRecordCanceled(transfer.id, true, currentVersion(transfer.id));
});

test('the §5.3 fixture explains offsets, direct allocations, and the use of a prepayment', () => {
  const { allocations } = getInitialLedgerSnapshot();
  assert.ok(allocations.offsets.some(offset =>
    offset.expenseAId === 'expense-1' && offset.expenseBId === 'expense-2' && offset.amountYen === 600));
  assert.deepEqual(allocations.settlements, [
    { settlementId: 'settlement-1', expenseId: 'expense-1', amountYen: 400, fromPrepayment: false },
    { settlementId: 'settlement-1', expenseId: 'expense-3', amountYen: 300, fromPrepayment: true },
  ]);
  assert.equal(allocations.prepayments.size, 0);
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

test('canceling a split removes its balance contribution and restoring it adds the contribution back', () => {
  const startingBalance = getLedgerSnapshot().balance.netAYen;
  const split = createExpense(draft);
  setRecordCanceled(split.id, true, currentVersion(split.id));
  assert.equal(getLedgerSnapshot().balance.netAYen, startingBalance);
  setRecordCanceled(split.id, false, currentVersion(split.id));
  assert.equal(getLedgerSnapshot().balance.netAYen, startingBalance + draft.counterpartyShareYen);
  assert.deepEqual(getLedgerSnapshot().audit.get(split.id).map(entry => entry.action), ['created', 'canceled', 'restored']);
});

test('canceling a gift cancels its promise in the same update, and restoring the gift leaves the promise canceled', () => {
  const expense = createExpense({ ...draft, expenseType: 'gift_promise', promise: { body: '買い出し', dueOn: null } });
  const promise = getLedgerSnapshot().timeline.find(item => item.kind === 'promise' && item.expenseId === expense.id);
  const before = getLedgerSnapshot();
  setRecordCanceled(expense.id, true, currentVersion(expense.id));
  const canceled = getLedgerSnapshot();
  const canceledExpense = canceled.timeline.find(item => item.id === expense.id);
  assert.ok(canceledExpense.canceledAt);
  assert.equal(canceled.balance.ledgerRevision, before.balance.ledgerRevision + 1);
  assert.equal(canceled.balance.netAYen, before.balance.netAYen);
  assert.equal(canceled.timeline.find(item => item.id === promise.id).canceledAt, canceledExpense.canceledAt);

  setRecordCanceled(expense.id, false, currentVersion(expense.id));
  const restored = getLedgerSnapshot();
  assert.equal(restored.timeline.find(item => item.id === expense.id).canceledAt, null);
  assert.equal(restored.timeline.find(item => item.id === promise.id).canceledAt, canceledExpense.canceledAt);
  assert.deepEqual(restored.audit.get(promise.id).map(entry => entry.action), ['created', 'canceled']);
});

test('editing a share previews and applies only the difference, then records the change', () => {
  const created = createExpense(draft);
  const before = getLedgerSnapshot();
  const edited = { ...draft, counterpartyShareYen: draft.counterpartyShareYen + 150 };
  const expected = currentVersion(created.id);
  const preview = previewExpenseEdit(created.id, edited, expected);
  assert.equal(preview.netBefore, before.balance.netAYen);
  assert.equal(preview.netAfter, before.balance.netAYen + 150);
  assert.equal(getLedgerSnapshot(), before);
  updateExpense(created.id, edited, expected);
  const after = getLedgerSnapshot();
  assert.equal(after.balance.netAYen, preview.netAfter);
  const entry = after.audit.get(created.id).at(-1);
  assert.equal(entry.action, 'edited');
  assert.equal(entry.before.counterpartyShareYen, draft.counterpartyShareYen);
  assert.equal(entry.after.counterpartyShareYen, edited.counterpartyShareYen);
  assert.throws(() => updateExpense(created.id, edited, expected));
  assert.equal(getLedgerSnapshot(), after);
});

test('changing an expense to a kind without a promise previews and applies the automatic cancellation', () => {
  const expense = createExpense({ ...draft, expenseType: 'gift_promise', promise: { body: '買い出し', dueOn: null } });
  const expected = currentVersion(expense.id);
  const before = getLedgerSnapshot();
  const preview = previewExpenseEdit(expense.id, draft, expected);
  assert.equal(preview.cancelsPromise, true);
  assert.equal(preview.netAfter, before.balance.netAYen + draft.counterpartyShareYen);
  assert.equal(getLedgerSnapshot(), before);
  updateExpense(expense.id, draft, expected);
  const { timeline, balance } = getLedgerSnapshot();
  assert.ok(timeline.find(item => item.kind === 'promise' && item.expenseId === expense.id).canceledAt);
  assert.equal(balance.netAYen, preview.netAfter);
});

test('the local onboarding gate requires valid fields and explicit invite acceptance', () => {
  assert.equal(getInitialLedgerSnapshot().appState.status, 'paired');
  resetOnboarding();
  assert.throws(() => createExpense(draft));
  signInLocally('invalid', 'password');
  assert.equal(getLedgerSnapshot().appState.status, 'signed-out');
  signInLocally('local@example.test', 'password');
  assert.deepEqual(getLedgerSnapshot().appState, { status: 'needs-name' });
  saveDisplayName('   ');
  assert.equal(getLedgerSnapshot().appState.status, 'needs-name');
  saveDisplayName('  葵  ');
  assert.deepEqual(getLedgerSnapshot().appState, { status: 'unpaired', displayName: '葵' });
  const invitation = sampleInvitation(new Date('2026-11-18T15:00:00Z'));
  assert.equal(invitation.expiresOn, '2026-11-26');
  assert.equal(invitationCodeError(invitation.code), undefined);
  acceptInvitation('00000000');
  assert.equal(getLedgerSnapshot().appState.status, 'unpaired');
  acceptInvitation('k7m4-r9t2');
  assert.equal(getLedgerSnapshot().appState.status, 'paired');
  assert.equal(getLedgerSnapshot().timeline.find(item => item.id === 'settlement-1').title, 'パートナーから葵へ');
});
