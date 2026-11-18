export type MemberSlot = 'A' | 'B';

export type Member = {
  slot: MemberSlot;
  displayName: string;
};

export type PairBalance = {
  // Positive means B pays A, regardless of the viewer's slot.
  netAYen: number;
  ledgerRevision: number;
};

type TimelineRecord = {
  id: string;
  title: string;
  occurredOn: string; // YYYY-MM-DD business date
  canceledAt: string | null;
};

export type ExpenseType = 'split' | 'gift' | 'gift_promise';

export type ExpenseRecord = TimelineRecord & {
  kind: 'expense';
  expenseType: ExpenseType;
  payerSlot: MemberSlot;
  amountYen: number;
  counterpartyShareYen: number;
  remainingYen: number;
};

export type SettlementRecord = TimelineRecord & NewSettlement & {
  kind: 'settlement';
  receiverSlot: MemberSlot;
};

export type PromiseRecord = TimelineRecord & {
  kind: 'promise';
  expenseId: string;
  assigneeSlot: MemberSlot;
  dueOn: string | null;
  status: 'pending' | 'completed';
};

export type TimelineItem = ExpenseRecord | SettlementRecord | PromiseRecord;

export type NewSettlement = {
  senderSlot: MemberSlot;
  amountYen: number;
  occurredOn: string;
  settlementTargets: readonly string[];
};

export type SettlementAllocation = {
  settlementId: string;
  expenseId: string;
  amountYen: number;
  fromPrepayment: boolean;
};

export type OffsetAllocation = {
  expenseAId: string;
  expenseBId: string;
  amountYen: number;
};

export type AuditEntry = {
  action: 'created' | 'edited' | 'canceled' | 'restored';
  actorSlot: MemberSlot;
  at: string;
  before?: TimelineItem;
  after: TimelineItem;
};

export type HomeData = {
  viewer: Member;
  partner: Member;
  balance: PairBalance;
  timeline: readonly TimelineItem[];
};

export type AppState =
  | { status: 'signed-out' | 'needs-name' }
  | { status: 'unpaired' | 'paired'; displayName: string };

export type LedgerSnapshot = HomeData & {
  appState: AppState;
  audit: ReadonlyMap<string, readonly AuditEntry[]>;
  allocations: {
    settlements: readonly SettlementAllocation[];
    offsets: readonly OffsetAllocation[];
    prepayments: ReadonlyMap<string, number>;
  };
};

export type NewExpense = {
  title: string;
  occurredOn: string;
  payerSlot: MemberSlot;
  amountYen: number;
} & (
  | { expenseType: 'split'; counterpartyShareYen: number }
  | { expenseType: 'gift' }
  | { expenseType: 'gift_promise'; promise: { body: string; dueOn: string | null } }
);
