import type { Queryable } from "./db";

export async function readLedger(db: Queryable, userId: string) {
  const { rows: [snapshot] } = await db.query<{ displayName: string | null; pairs: unknown[] }>(
    `select (select display_name from public.profiles where user_id = $1) as "displayName",
            coalesce(jsonb_agg(to_jsonb(ledger) order by ledger.archived_at desc nulls first, ledger.id), '[]') as pairs
       from (
         select p.id, p.status, p.created_at, p.activated_at, p.archived_at, p.ledger_revision, b.net_a_yen,
                mine.id as viewer_member_id,
                exists (
                  select 1 from public.pair_members other_member
                  join public.active_pair_memberships active on active.user_id = other_member.user_id
                  where other_member.pair_id = p.id and other_member.id <> mine.id and active.pair_id <> p.id
                ) as partner_paired_elsewhere,
                array(
                  select jsonb_build_object('id', m.id, 'slot', m.slot, 'display_name', profile.display_name)
                    from public.pair_members m
                    left join public.profiles profile on profile.user_id = m.user_id
                   where m.pair_id = p.id order by m.slot
                ) as members,
                array(select to_jsonb(e) from public.expenses e where e.pair_id = p.id) as expenses,
                array(select to_jsonb(s) from public.settlements s where s.pair_id = p.id) as settlements,
                array(select to_jsonb(r) from public.promises r where r.pair_id = p.id) as promises,
                array(select to_jsonb(t) from public.settlement_targets t where t.pair_id = p.id order by t.priority) as targets,
                array(select to_jsonb(a) from public.settlement_allocations a where a.pair_id = p.id) as settlement_allocations,
                array(select to_jsonb(o) from public.offset_allocations o where o.pair_id = p.id) as offset_allocations,
                array(select to_jsonb(r) from public.pair_revival_requests r where r.pair_id = p.id order by r.created_at) as revivals,
                array(
                  select to_jsonb(a) from public.audit_logs a
                   where a.pair_id = p.id and a.entity_type in ('expense', 'settlement', 'promise')
                   order by a.created_at, a.id
                ) as audit
           from public.pair_members mine
           join public.pairs p on p.id = mine.pair_id
           join public.pair_balances b on b.pair_id = p.id
          where mine.user_id = $1
       ) ledger`,
    [userId],
  );
  return snapshot;
}
