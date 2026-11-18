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

export type TimelineItem = ExpenseRecord | (TimelineRecord & (
  | {
      kind: 'settlement';
      senderSlot: MemberSlot;
      receiverSlot: MemberSlot;
      amountYen: number;
    }
  | {
      kind: 'promise';
      expenseId: string;
      assigneeSlot: MemberSlot;
      dueOn: string | null;
      status: 'pending' | 'completed';
    }
));

export type HomeData = {
  viewer: Member;
  partner: Member;
  balance: PairBalance;
  timeline: readonly TimelineItem[];
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
