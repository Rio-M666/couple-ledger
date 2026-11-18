import type { HomeData, Member, TimelineItem } from './types';

type HomeScenario = 'sample' | 'zero' | 'empty' | 'error';

const viewer = { slot: 'A', displayName: '理央' } satisfies Member;
const partner = { slot: 'B', displayName: 'パートナー' } satisfies Member;

const latestExpense = {
  id: 'expense-3',
  kind: 'expense',
  payerSlot: viewer.slot,
  title: `${viewer.displayName}の支払い`,
  occurredOn: '2026-11-18',
  canceledAt: null,
  amountYen: 1_000,
  counterpartyShareYen: 500,
  remainingYen: 200,
} satisfies TimelineItem;

const earlierRecords = [
  {
    id: 'settlement-1',
    kind: 'settlement',
    senderSlot: partner.slot,
    receiverSlot: viewer.slot,
    title: `${partner.displayName}から${viewer.displayName}へ`,
    occurredOn: '2026-11-17',
    canceledAt: null,
    amountYen: 700,
  },
  {
    id: 'expense-2',
    kind: 'expense',
    payerSlot: partner.slot,
    title: `${partner.displayName}の支払い`,
    occurredOn: '2026-11-16',
    canceledAt: null,
    amountYen: 1_200,
    counterpartyShareYen: 600,
    remainingYen: 0,
  },
  {
    id: 'expense-1',
    kind: 'expense',
    payerSlot: viewer.slot,
    title: `${viewer.displayName}の支払い`,
    occurredOn: '2026-11-15',
    canceledAt: null,
    amountYen: 2_000,
    counterpartyShareYen: 1_000,
    remainingYen: 0,
  },
] satisfies TimelineItem[];

// Replace the fixtures here with the Hono read API and map its responses to
// HomeData. Balance and remaining yen come from the server's settlement engine.
export async function loadHome(scenario: HomeScenario = 'sample'): Promise<HomeData> {
  switch (scenario) {
    case 'sample':
      return {
        viewer,
        partner,
        balance: { netAYen: 200, ledgerRevision: 4 },
        timeline: [latestExpense, ...earlierRecords],
      };
    case 'zero':
      return {
        viewer,
        partner,
        balance: { netAYen: 0, ledgerRevision: 5 },
        timeline: [
          { ...earlierRecords[0], id: 'settlement-2', occurredOn: '2026-11-18', amountYen: 200 },
          { ...latestExpense, remainingYen: 0 },
          ...earlierRecords,
        ],
      };
    case 'empty':
      return {
        viewer,
        partner,
        balance: { netAYen: 0, ledgerRevision: 0 },
        timeline: [],
      };
    case 'error':
      throw new Error('通信できないため、記録を読み込めませんでした。');
  }
}
