import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pendingRevival, revivalCooldown, revivalPeriodMs, revivalStatus } from '../src/data/pair-lifecycle.ts';

const start = Date.parse('2026-11-18T12:00:00Z');
const expense = {
  title: '夕食', expenseType: 'split', occurredOn: '2026-11-18', payerSlot: 'A',
  amountYen: 1_000, counterpartyShareYen: 500,
};
const settlement = { senderSlot: 'B', amountYen: 100, occurredOn: '2026-11-18', settlementTargets: [] };
const firstInvitation = 'K7M4R9T2';
const otherInvitation = 'B7C4D9F2';

async function fixture(t) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: start });
  return import(`../src/data/home.ts?fixture=${encodeURIComponent(t.name)}`);
}

test('archiving preserves the pair ledger and rejects all record mutations', async t => {
  const store = await fixture(t);
  const created = store.createExpense(expense);
  const { activePair } = store.getLedgerSnapshot();
  const expected = { pairId: activePair.id, version: 1, ledgerRevision: activePair.balance.ledgerRevision };

  store.archiveActivePair();

  const archived = store.getLedgerSnapshot();
  const [pair] = archived.pastPairs;
  assert.equal(archived.appState.status, 'unpaired');
  assert.equal(archived.activePair, null);
  assert.equal(pair.id, activePair.id);
  assert.equal(pair.archivedAt, start);
  assert.deepEqual(pair.balance, activePair.balance);
  assert.deepEqual(pair.timeline, activePair.timeline);
  assert.deepEqual(pair.audit, activePair.audit);
  assert.deepEqual(pair.allocations, activePair.allocations);
  assert.throws(() => store.createExpense(expense), /解散済み/);
  assert.throws(() => store.createSettlement(settlement), /解散済み/);
  assert.throws(() => store.updateExpense(created.id, expense, expected), /解散済み/);
  assert.throws(() => store.setRecordCanceled(created.id, true, expected), /解散済み/);
  assert.throws(() => store.setRecordCanceled('expense-8', false, expected), /解散済み/);
  assert.equal(store.getLedgerSnapshot(), archived);
});

test('approving the incoming fixture reopens the same pair and its original ledger', async t => {
  const store = await fixture(t);
  const { activePair } = store.getLedgerSnapshot();
  store.simulateIncomingRevival();
  const [archived] = store.getLedgerSnapshot().pastPairs;
  const pending = pendingRevival(archived);

  assert.equal(pending.requesterSlot, archived.partner.slot);
  assert.equal(pending.requestedAt, start);
  assert.equal(pending.expiresAt, start + revivalPeriodMs);
  assert.equal(store.requestRevival(archived.id).id, pending.id);
  assert.throws(() => store.resolveRevival(archived.id, pending.id, 'cancel'), /操作できません/);

  store.resolveRevival(archived.id, pending.id, 'approve');
  const resumed = store.getLedgerSnapshot();
  assert.equal(resumed.appState.status, 'paired');
  assert.equal(resumed.pastPairs.length, 0);
  assert.equal(resumed.activePair.id, activePair.id);
  assert.equal(resumed.activePair.linkedOn, activePair.linkedOn);
  assert.equal(resumed.activePair.revivalRequests.at(-1).status, 'approved');
  assert.deepEqual(resumed.balance, activePair.balance);
  assert.deepEqual(resumed.timeline, activePair.timeline);
  store.createExpense(expense);
  assert.equal(store.getLedgerSnapshot().balance.netAYen, activePair.balance.netAYen + 500);
});

test('rejection starts an exact seven-day cooldown for the original requester only', async t => {
  const store = await fixture(t);
  store.simulateIncomingRevival();
  const [pair] = store.getLedgerSnapshot().pastPairs;
  const pending = pendingRevival(pair);
  const rejectedAt = start + 60_000;
  t.mock.timers.setTime(rejectedAt);
  store.resolveRevival(pair.id, pending.id, 'reject');

  const [after] = store.getLedgerSnapshot().pastPairs;
  assert.equal(after.revivalRequests.at(-1).status, 'rejected');
  assert.equal(after.revivalRequests.at(-1).decidedAt, rejectedAt);
  assert.equal(revivalCooldown(after, pair.partner.slot), rejectedAt + revivalPeriodMs);
  assert.equal(revivalCooldown(after, pair.viewer.slot), undefined);
  assert.equal(revivalCooldown(after, pair.partner.slot, rejectedAt + revivalPeriodMs - 1), rejectedAt + revivalPeriodMs);
  assert.equal(revivalCooldown(after, pair.partner.slot, rejectedAt + revivalPeriodMs), undefined);
  assert.equal(store.requestRevival(pair.id).requesterSlot, pair.viewer.slot);
});

test('outgoing requests cannot be self-approved and can be retried after cancellation or expiry', async t => {
  const store = await fixture(t);
  store.archiveActivePair();
  const [pair] = store.getLedgerSnapshot().pastPairs;
  const outgoing = store.requestRevival(pair.id);

  assert.equal(store.requestRevival(pair.id).id, outgoing.id);
  assert.throws(() => store.resolveRevival(pair.id, outgoing.id, 'approve'), /操作できません/);
  store.resolveRevival(pair.id, outgoing.id, 'cancel');
  assert.equal(store.getLedgerSnapshot().pastPairs[0].revivalRequests.at(-1).status, 'canceled');

  const retry = store.requestRevival(pair.id);
  assert.notEqual(retry.id, outgoing.id);
  const statuses = [];
  const unsubscribe = store.subscribeToLedger(() => {
    statuses.push(store.getLedgerSnapshot().pastPairs[0].revivalRequests.at(-1).status);
  });
  try {
    t.mock.timers.tick(revivalPeriodMs);
    assert.equal(revivalStatus(retry), 'expired');
    assert.deepEqual(statuses, ['expired']);
    assert.throws(() => store.resolveRevival(pair.id, retry.id, 'cancel'), /終了しています/);
    assert.notEqual(store.requestRevival(pair.id).id, retry.id);
    assert.equal(store.getLedgerSnapshot().pastPairs[0].revivalRequests.at(-2).status, 'expired');
  } finally {
    unsubscribe();
  }
});

test('another pairing invalidates a request and archived records stay isolated', async t => {
  const store = await fixture(t);
  const { activePair } = store.getLedgerSnapshot();
  store.archiveActivePair();
  assert.deepEqual(store.reviewInvitation(firstInvitation), {
    partnerName: activePair.partner.displayName, archivedPairId: activePair.id,
  });
  assert.throws(() => store.acceptInvitation(firstInvitation), /復活を申請/);
  store.requestRevival(activePair.id);
  store.setFixturePartnerPairedElsewhere(activePair.id, true);
  assert.equal(store.getLedgerSnapshot().pastPairs[0].revivalRequests.at(-1).status, 'invalidated');
  assert.throws(() => store.requestRevival(activePair.id), /相手は別のペア/);
  store.setFixturePartnerPairedElsewhere(activePair.id, false);
  store.requestRevival(activePair.id);

  store.acceptInvitation(otherInvitation);

  const next = store.getLedgerSnapshot();
  assert.notEqual(next.activePair.id, activePair.id);
  assert.deepEqual(next.timeline, []);
  assert.equal(next.balance.netAYen, 0);
  assert.equal(next.pastPairs[0].revivalRequests.at(-1).status, 'invalidated');
  assert.throws(() => store.requestRevival(activePair.id), /現在のペアを解散/);

  const created = store.createExpense(expense);
  const expected = { pairId: activePair.id, version: 1, ledgerRevision: store.getLedgerSnapshot().balance.ledgerRevision };
  assert.throws(() => store.updateExpense(created.id, expense, expected), /別のペアの記録/);
  assert.throws(() => store.updateExpense('expense-3', expense, {
    version: 1, ledgerRevision: expected.ledgerRevision,
  }), /記録が見つかりません/);
  store.archiveActivePair();
  assert.equal(store.getLedgerSnapshot().pastPairs.length, 2);
  assert.equal(store.requestRevival(activePair.id).status, 'pending');
});

test('display name updates the ledger views and local logout keeps the profile and archives', async t => {
  const store = await fixture(t);
  store.saveDisplayName('あ'.repeat(41));
  assert.equal(store.getLedgerSnapshot().viewer.displayName, '理央');
  store.archiveActivePair();
  store.saveDisplayName('  新しい名前  ');
  const [pair] = store.getLedgerSnapshot().pastPairs;
  assert.equal(pair.viewer.displayName, '新しい名前');
  assert.equal(pair.timeline.find(item => item.id === 'settlement-1').title, 'パートナーから新しい名前へ');

  store.logOutLocally();
  assert.equal(store.getLedgerSnapshot().appState.status, 'signed-out');
  assert.deepEqual(store.getLedgerSnapshot().pastPairs, []);
  store.signInLocally('local@example.test', 'password');
  assert.equal(store.getLedgerSnapshot().appState.status, 'unpaired');
  assert.equal(store.getLedgerSnapshot().viewer.displayName, '新しい名前');
  assert.equal(store.getLedgerSnapshot().pastPairs[0].id, pair.id);
});
