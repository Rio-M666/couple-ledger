import type { MemberSlot, PairLedger, RevivalRequest } from './types.ts';

export const revivalPeriodMs = 7 * 24 * 60 * 60 * 1_000;

export function revivalStatus(request: RevivalRequest, now = Date.now()): RevivalRequest['status'] {
  return request.status === 'pending' && request.expiresAt <= now ? 'expired' : request.status;
}

export function pendingRevival({ revivalRequests }: Pick<PairLedger, 'revivalRequests'>, now = Date.now()) {
  return revivalRequests.find(request => revivalStatus(request, now) === 'pending');
}

export function revivalCooldown(
  { revivalRequests }: Pick<PairLedger, 'revivalRequests'>,
  requesterSlot: MemberSlot,
  now = Date.now(),
) {
  const lastRejection = revivalRequests.findLast(request =>
    request.requesterSlot === requesterSlot && request.status === 'rejected');
  const retryAt = (lastRejection?.decidedAt ?? -Infinity) + revivalPeriodMs;
  return retryAt > now ? retryAt : undefined;
}
