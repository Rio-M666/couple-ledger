-- Couple Ledger post-mutation integrity diagnostics v0.1
-- Run using a privileged read-only SQL session after tests/seeds.
-- Each query should return ZERO rows. These checks complement (not replace)
-- PostgreSQL constraints and the future transactional allocation engine.

-- 1. Active membership materialization: one user per active pair and
-- exactly two members for every active pair.
select p.id as pair_id, p.status,
       (select count(*) from public.pair_members pm
         where pm.pair_id = p.id and pm.user_id is not null) as live_members,
       (select count(*) from public.active_pair_memberships am
         where am.pair_id = p.id) as active_members
from public.pairs p
where (p.status = 'active' and (
        (select count(*) from public.pair_members pm
         where pm.pair_id = p.id and pm.user_id is not null) <> 2
        or
        (select count(*) from public.active_pair_memberships am
         where am.pair_id = p.id) <> 2
      ))
   or (p.status <> 'active' and exists (
        select 1 from public.active_pair_memberships am where am.pair_id = p.id
      ));

-- 2. Every active mapping identifies the same account as its member row.
select am.*
from public.active_pair_memberships am
left join public.pair_members pm
  on pm.pair_id = am.pair_id and pm.id = am.member_id
where pm.user_id is distinct from am.user_id;

-- 3. An allocation cannot consume more than the real cash transfer amount.
select s.id as settlement_id, s.amount_yen,
       coalesce(sum(sa.amount_yen), 0) as allocated_yen
from public.settlements s
left join public.settlement_allocations sa on sa.settlement_id = s.id
group by s.id, s.amount_yen
having coalesce(sum(sa.amount_yen), 0) > s.amount_yen;

-- 4. A settlement allocation must point to a valid, non-canceled split debt
-- in the direction of the actual money transfer.
select sa.id as allocation_id, sa.settlement_id, sa.expense_id
from public.settlement_allocations sa
join public.settlements s on s.id = sa.settlement_id
join public.expenses e on e.id = sa.expense_id
where s.canceled_at is not null
   or e.canceled_at is not null
   or e.expense_type <> 'split'
   or s.receiver_member_id <> e.payer_member_id
   or s.sender_member_id = e.payer_member_id;

-- 5. Offset rows must pair opposite-party unpaid split expenses.
select oa.id as offset_id
from public.offset_allocations oa
join public.expenses ea on ea.id = oa.expense_a_id
join public.expenses eb on eb.id = oa.expense_b_id
join public.pair_members ma on ma.id = ea.payer_member_id
join public.pair_members mb on mb.id = eb.payer_member_id
where ea.canceled_at is not null or eb.canceled_at is not null
   or ea.expense_type <> 'split' or eb.expense_type <> 'split'
   or ma.slot <> 'a' or mb.slot <> 'b';

-- 6. No expense's counterparty debt can be consumed more than once.
with cash_used as (
  select expense_id, sum(amount_yen) as amount
  from public.settlement_allocations group by expense_id
), offset_used as (
  select expense_a_id as expense_id, sum(amount_yen) as amount
    from public.offset_allocations group by expense_a_id
  union all
  select expense_b_id as expense_id, sum(amount_yen) as amount
    from public.offset_allocations group by expense_b_id
), offset_totals as (
  select expense_id, sum(amount) as amount
  from offset_used group by expense_id
)
select e.id as expense_id, e.counterparty_share_yen as debt_yen,
       coalesce(c.amount, 0) as cash_yen,
       coalesce(o.amount, 0) as offset_yen
from public.expenses e
left join cash_used c on c.expense_id = e.id
left join offset_totals o on o.expense_id = e.id
where coalesce(c.amount, 0) + coalesce(o.amount, 0) >
      case when e.canceled_at is null and e.expense_type = 'split'
           then e.counterparty_share_yen else 0 end;

-- 7. Parent gift-with-promise requires exactly one promise. After conversion
-- to another type, any existing promise must be canceled.
select e.id as expense_id, e.expense_type, pr.id as promise_id, pr.status
from public.expenses e
left join public.promises pr on pr.expense_id = e.id
where (e.expense_type = 'gift_promise' and pr.id is null)
   or (e.expense_type <> 'gift_promise' and pr.id is not null
       and pr.status <> 'canceled')
   or (e.canceled_at is not null and pr.id is not null
       and pr.status <> 'canceled');

-- 8. Accounting identity: balance computed only from source records equals
-- remaining individual debts plus unapplied cash credit, after offsets.
with cash_used as (
  select expense_id, sum(amount_yen) as amount
  from public.settlement_allocations group by expense_id
), offset_used as (
  select expense_a_id as expense_id, amount_yen as amount
  from public.offset_allocations
  union all
  select expense_b_id as expense_id, amount_yen as amount
  from public.offset_allocations
), offset_totals as (
  select expense_id, sum(amount) as amount from offset_used group by expense_id
), debt_remaining as (
  select e.pair_id,
         sum(case when pm.slot = 'a' then 1 else -1 end *
           (e.counterparty_share_yen - coalesce(c.amount, 0) - coalesce(o.amount, 0)))
           as signed_debt
  from public.expenses e
  join public.pair_members pm on pm.id = e.payer_member_id
  left join cash_used c on c.expense_id = e.id
  left join offset_totals o on o.expense_id = e.id
  where e.canceled_at is null and e.expense_type = 'split'
  group by e.pair_id
), cash_used_per_settlement as (
  select settlement_id, sum(amount_yen) as amount
  from public.settlement_allocations group by settlement_id
), unused_cash as (
  select s.pair_id,
         sum(case when pm.slot = 'a' then 1 else -1 end *
           (s.amount_yen - coalesce(a.amount, 0))) as signed_credit
  from public.settlements s
  join public.pair_members pm on pm.id = s.sender_member_id
  left join cash_used_per_settlement a on a.settlement_id = s.id
  where s.canceled_at is null
  group by s.pair_id
)
select pb.pair_id, pb.net_a_yen as canonical_net_yen,
       (coalesce(d.signed_debt, 0) + coalesce(c.signed_credit, 0))
          as allocated_net_yen
from public.pair_balances pb
left join debt_remaining d on d.pair_id = pb.pair_id
left join unused_cash c on c.pair_id = pb.pair_id
where pb.net_a_yen is distinct from
      (coalesce(d.signed_debt, 0) + coalesce(c.signed_credit, 0));
