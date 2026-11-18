type MemberSlot = 'A' | 'B';

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

export type TimelineItem = TimelineRecord & (
  | {
      kind: 'expense';
      payerSlot: MemberSlot;
      amountYen: number;
      counterpartyShareYen: number;
      remainingYen: number;
    }
  | {
      kind: 'settlement';
      senderSlot: MemberSlot;
      receiverSlot: MemberSlot;
      amountYen: number;
    }
  | { kind: 'promise' }
);

export type HomeData = {
  viewer: Member;
  partner: Member;
  balance: PairBalance;
  timeline: readonly TimelineItem[];
};
