import { businessDate } from './format';
import { revivalStatus } from './pair-lifecycle';
import type {
  ArchivedPair, AuditEntry, ExpenseRecord, LedgerSnapshot, Member, MemberSlot,
  PairLedger, PromiseRecord, RevivalRequest, SettlementRecord, TimelineItem,
} from './types';

type MemberRow = { id: string; slot: 'a' | 'b'; display_name: string | null };
type RecordRow = { id: string; version: number; created_at: string; updated_at: string };
type ExpenseRow = RecordRow & {
  payer_member_id: string; title: string; expense_type: ExpenseRecord['expenseType'];
  occurred_on: string; canceled_at: string | null; amount_yen: number; counterparty_share_yen: number;
};
type SettlementRow = RecordRow & {
  sender_member_id: string; receiver_member_id: string; settled_on: string;
  canceled_at: string | null; amount_yen: number; targets?: TargetRow[];
};
type PromiseRow = RecordRow & {
  expense_id: string; assignee_member_id: string; body: string; due_on: string | null;
  status: PromiseRecord['status'] | 'canceled';
};
type TargetRow = { settlement_id: string; expense_id: string };
export type RevivalRow = {
  id: string; requester_member_id: string; status: RevivalRequest['status'];
  created_at: string; expires_at: string; decided_at: string | null;
};
type AuditRow = {
  entity_id: string; actor_member_id: string; created_at: string;
  action: 'create' | 'update' | 'cancel' | 'restore';
} & (
  | { entity_type: 'expense'; old_data: ExpenseRow | null; new_data: ExpenseRow }
  | { entity_type: 'settlement'; old_data: SettlementRow | null; new_data: SettlementRow }
  | { entity_type: 'promise'; old_data: PromiseRow | null; new_data: PromiseRow }
);

export type PairRow = {
  id: string;
  status: 'pending' | PairLedger['status'];
  created_at: string;
  activated_at: string | null;
  archived_at: string | null;
  ledger_revision: number;
  net_a_yen: number;
  viewer_member_id: string;
  partner_paired_elsewhere: boolean;
  members: MemberRow[];
  expenses: ExpenseRow[];
  settlements: SettlementRow[];
  promises: PromiseRow[];
  targets: TargetRow[];
  settlement_allocations: { settlement_id: string; expense_id: string; amount_yen: number; source: 'manual' | 'automatic' }[];
  offset_allocations: { expense_a_id: string; expense_b_id: string; amount_yen: number }[];
  revivals: RevivalRow[];
  audit: AuditRow[];
};

export type LedgerResponse = { displayName: string | null; pairs: PairRow[] };

export const emptySnapshot: LedgerSnapshot = {
  appState: { status: 'signed-out' },
  activePair: null,
  pastPairs: [],
  viewer: { slot: 'A', displayName: '' },
  partner: { slot: 'B', displayName: 'パートナー' },
  balance: { netAYen: 0, ledgerRevision: 0 },
  timeline: [],
  audit: new Map(),
  allocations: { settlements: [], offsets: [], prepayments: new Map() },
};

function appMember(row: MemberRow): Member {
  return { slot: row.slot === 'a' ? 'A' : 'B', displayName: row.display_name ?? 'パートナー' };
}

export function mapRevival(row: RevivalRow, pair: PairRow): RevivalRequest {
  const requester = pair.members.find(member => member.id === row.requester_member_id);
  if (!requester) throw new Error('復活申請のメンバーが見つかりませんでした。');
  const request = {
    id: row.id, requesterSlot: appMember(requester).slot, status: row.status,
    requestedAt: Date.parse(row.created_at), expiresAt: Date.parse(row.expires_at),
    decidedAt: row.decided_at ? Date.parse(row.decided_at) : undefined,
  };
  return { ...request, status: revivalStatus(request) };
}

const auditActions = { create: 'created', update: 'edited', cancel: 'canceled', restore: 'restored' } as const;

function mapPair(pair: PairRow): PairLedger & { partnerPairedElsewhere: boolean } {
  const members = new Map(pair.members.map(row => [row.id, appMember(row)]));
  const viewer = members.get(pair.viewer_member_id);
  const partner = pair.members.find(member => member.id !== pair.viewer_member_id);
  if (!viewer || !partner) throw new Error('ペアのメンバーが見つかりませんでした。');

  function memberSlot(id: string): MemberSlot {
    const member = members.get(id);
    if (!member) throw new Error('記録のメンバーが見つかりませんでした。');
    return member.slot;
  }

  const expensesById = new Map(pair.expenses.map(row => [row.id, row]));
  const settlementsById = new Map(pair.settlements.map(row => [row.id, row]));
  const remaining = new Map(pair.expenses.map(row => [row.id, row.canceled_at ? 0 : row.counterparty_share_yen]));
  const prepayments = new Map(pair.settlements.filter(row => !row.canceled_at).map(row => [row.id, row.amount_yen]));
  const settlements = pair.settlement_allocations.map(row => {
    remaining.set(row.expense_id, (remaining.get(row.expense_id) ?? 0) - row.amount_yen);
    prepayments.set(row.settlement_id, (prepayments.get(row.settlement_id) ?? 0) - row.amount_yen);
    const expense = expensesById.get(row.expense_id);
    const settlement = settlementsById.get(row.settlement_id);
    const fromPrepayment = Boolean(row.source === 'automatic' && expense && settlement && (
      expense.occurred_on > settlement.settled_on ||
      (expense.occurred_on === settlement.settled_on && Date.parse(expense.created_at) > Date.parse(settlement.created_at))
    ));
    return { settlementId: row.settlement_id, expenseId: row.expense_id, amountYen: row.amount_yen, fromPrepayment };
  });
  const offsets = pair.offset_allocations.map(row => {
    remaining.set(row.expense_a_id, (remaining.get(row.expense_a_id) ?? 0) - row.amount_yen);
    remaining.set(row.expense_b_id, (remaining.get(row.expense_b_id) ?? 0) - row.amount_yen);
    return { expenseAId: row.expense_a_id, expenseBId: row.expense_b_id, amountYen: row.amount_yen };
  });

  const targets = new Map<string, string[]>();
  for (const row of pair.targets) {
    const ids = targets.get(row.settlement_id) ?? [];
    ids.push(row.expense_id);
    targets.set(row.settlement_id, ids);
  }

  function expenseRecord(row: ExpenseRow, remainingYen = row.canceled_at ? 0 : row.counterparty_share_yen): ExpenseRecord {
    return {
      kind: 'expense', id: row.id, title: row.title, version: row.version, payerSlot: memberSlot(row.payer_member_id),
      expenseType: row.expense_type, occurredOn: row.occurred_on, amountYen: row.amount_yen,
      counterpartyShareYen: row.counterparty_share_yen, canceledAt: row.canceled_at, remainingYen,
    };
  }

  function settlementRecord(row: SettlementRow): SettlementRecord {
    return {
      kind: 'settlement', id: row.id, title: '精算', version: row.version, occurredOn: row.settled_on,
      amountYen: row.amount_yen, canceledAt: row.canceled_at, senderSlot: memberSlot(row.sender_member_id),
      receiverSlot: memberSlot(row.receiver_member_id),
      settlementTargets: row.targets?.map(target => target.expense_id) ?? targets.get(row.id) ?? [],
    };
  }

  function promiseRecord(row: PromiseRow): PromiseRecord {
    return {
      kind: 'promise', id: row.id, title: row.body, version: row.version, expenseId: row.expense_id,
      occurredOn: expensesById.get(row.expense_id)?.occurred_on ?? businessDate(new Date(row.created_at)),
      assigneeSlot: memberSlot(row.assignee_member_id), dueOn: row.due_on,
      status: row.status === 'completed' ? 'completed' : 'pending', canceledAt: row.status === 'canceled' ? row.updated_at : null,
    };
  }

  const records = [
    ...pair.expenses.map(row => ({ record: expenseRecord(row, remaining.get(row.id)), createdAt: row.created_at })),
    ...pair.settlements.map(row => ({ record: settlementRecord(row), createdAt: row.created_at })),
    ...pair.promises.map(row => ({ record: promiseRecord(row), createdAt: row.created_at })),
  ];
  const timeline = records.sort((a, b) => b.record.occurredOn.localeCompare(a.record.occurredOn)
    || Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.record.id.localeCompare(b.record.id)).map(row => row.record);

  const audit = new Map<string, AuditEntry[]>();
  for (const row of pair.audit) {
    let before: TimelineItem | undefined;
    let after: TimelineItem;
    switch (row.entity_type) {
      case 'expense':
        before = row.old_data ? expenseRecord(row.old_data) : undefined;
        after = expenseRecord(row.new_data);
        break;
      case 'settlement':
        before = row.old_data ? settlementRecord(row.old_data) : undefined;
        after = settlementRecord(row.new_data);
        break;
      case 'promise':
        before = row.old_data ? promiseRecord(row.old_data) : undefined;
        after = promiseRecord(row.new_data);
        break;
    }
    const entries = audit.get(row.entity_id) ?? [];
    entries.push({ after, before, action: auditActions[row.action], actorSlot: memberSlot(row.actor_member_id), at: row.created_at });
    audit.set(row.entity_id, entries);
  }

  const data = {
    id: pair.id, linkedOn: businessDate(new Date(pair.activated_at ?? pair.created_at)),
    viewer, partner: appMember(partner), timeline, audit,
    partnerPairedElsewhere: pair.partner_paired_elsewhere,
    balance: { netAYen: pair.net_a_yen, ledgerRevision: pair.ledger_revision },
    allocations: { settlements, offsets, prepayments: new Map([...prepayments].filter(([, amount]) => amount > 0)) },
    revivalRequests: pair.revivals.map(row => mapRevival(row, pair)),
  };
  return pair.archived_at
    ? { ...data, status: 'archived', archivedAt: Date.parse(pair.archived_at) }
    : { ...data, status: 'active', archivedAt: null };
}

export function mapLedger({ displayName, pairs }: LedgerResponse): LedgerSnapshot {
  if (!displayName) return { ...emptySnapshot, appState: { status: 'needs-name' } };
  let activePair: LedgerSnapshot['activePair'] = null;
  const pastPairs: ArchivedPair[] = [];
  for (const pair of pairs) {
    if (pair.status === 'pending') continue;
    const ledger = mapPair(pair);
    if (ledger.status === 'active') activePair = ledger;
    else pastPairs.push(ledger);
  }
  return {
    ...(activePair ?? emptySnapshot), viewer: activePair?.viewer ?? { ...emptySnapshot.viewer, displayName },
    appState: { status: activePair ? 'paired' : 'unpaired', displayName }, activePair, pastPairs,
  };
}
