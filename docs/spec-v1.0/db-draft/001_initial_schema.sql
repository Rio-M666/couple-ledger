-- Couple Ledger / Initial PostgreSQL schema v0.1
-- Target: Supabase PostgreSQL 15+ (for security_invoker views).
-- Run in a NEW Supabase project with a privileged migration role.
-- This is a foundational schema, NOT a complete application/backend implementation.
-- All business writes must go through a trusted, authenticated Hono API and
-- ONE database transaction per command. Authenticated clients have SELECT only.
-- Supabase Auth manages auth.users, password changes, and email verification.

begin;

create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- --------------------------------------------------------------------------
-- Enumerated domains
-- --------------------------------------------------------------------------
create type public.pair_status as enum ('pending', 'active', 'archived');
create type public.member_slot as enum ('a', 'b');
create type public.invite_status as enum ('pending', 'used', 'revoked', 'expired');
create type public.revival_status as enum
  ('pending', 'approved', 'rejected', 'canceled', 'expired', 'invalidated');
create type public.expense_type as enum ('split', 'gift', 'gift_promise');
create type public.split_mode as enum ('half', 'custom');
create type public.promise_status as enum ('pending', 'completed', 'canceled');
create type public.allocation_source as enum ('manual', 'automatic');
create type public.audit_entity_type as enum ('expense', 'settlement', 'promise', 'pair');
create type public.audit_action as enum ('create', 'update', 'cancel', 'restore', 'archive', 'revive');
create type public.idempotency_status as enum ('processing', 'completed');

-- --------------------------------------------------------------------------
-- Identity and pair membership
-- --------------------------------------------------------------------------
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null
    check (length(btrim(display_name)) between 1 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.pairs (
  id uuid primary key default gen_random_uuid(),
  status public.pair_status not null default 'pending',
  ledger_revision bigint not null default 0 check (ledger_revision >= 0),
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  archived_at timestamptz,
  check (status <> 'active' or activated_at is not null),
  check (status <> 'archived' or archived_at is not null)
);

create table public.pair_members (
  id uuid primary key default gen_random_uuid(),
  pair_id uuid not null references public.pairs(id) on delete cascade,
  -- NULL after account deletion; historical membership remains for the partner.
  user_id uuid references auth.users(id) on delete set null,
  slot public.member_slot not null,
  joined_at timestamptz not null default now(),
  unique (pair_id, id),
  unique (pair_id, slot),
  unique (pair_id, user_id)
);
create index pair_members_user_id_idx on public.pair_members(user_id)
  where user_id is not null;

-- Active membership is represented explicitly, making one active pair per
-- account enforceable by the primary key. The trusted backend must maintain
-- this projection atomically with pairs.status and pair_members changes.
create table public.active_pair_memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pair_id uuid not null,
  member_id uuid not null unique,
  foreign key (pair_id, member_id)
    references public.pair_members(pair_id, id) on delete cascade
);
create index active_pair_memberships_pair_idx
  on public.active_pair_memberships(pair_id);

-- --------------------------------------------------------------------------
-- Invitations and archived-pair revival
-- --------------------------------------------------------------------------
create table public.pair_invites (
  id uuid primary key default gen_random_uuid(),
  pair_id uuid not null references public.pairs(id) on delete cascade,
  inviter_member_id uuid not null,
  -- Store HMAC-SHA256 digests generated with an application secret held ONLY
  -- by the Hono backend. Never store raw 8-character codes or invite tokens.
  code_digest bytea not null unique check (octet_length(code_digest) = 32),
  token_digest bytea not null unique check (octet_length(token_digest) = 32),
  status public.invite_status not null default 'pending',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  foreign key (pair_id, inviter_member_id)
    references public.pair_members(pair_id, id) deferrable initially deferred,
  check (expires_at > created_at)
);
create unique index pair_invites_one_pending_per_pair
  on public.pair_invites(pair_id) where status = 'pending';
create index pair_invites_pair_created_idx
  on public.pair_invites(pair_id, created_at desc);

create table public.pair_revival_requests (
  id uuid primary key default gen_random_uuid(),
  pair_id uuid not null references public.pairs(id) on delete cascade,
  requester_member_id uuid not null,
  recipient_member_id uuid not null,
  status public.revival_status not null default 'pending',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  decided_at timestamptz,
  foreign key (pair_id, requester_member_id)
    references public.pair_members(pair_id, id) deferrable initially deferred,
  foreign key (pair_id, recipient_member_id)
    references public.pair_members(pair_id, id) deferrable initially deferred,
  check (requester_member_id <> recipient_member_id),
  check (expires_at > created_at)
);
create unique index pair_revival_requests_one_pending
  on public.pair_revival_requests(pair_id) where status = 'pending';
create index pair_revival_requests_pair_created_idx
  on public.pair_revival_requests(pair_id, created_at desc);

-- --------------------------------------------------------------------------
-- Source-of-truth: expenses, money transfers, promises
-- --------------------------------------------------------------------------
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  pair_id uuid not null references public.pairs(id) on delete cascade,
  payer_member_id uuid not null,
  title text not null default '支払い'
    check (length(btrim(title)) between 1 and 200),
  amount_yen bigint not null check (amount_yen > 0),
  -- Billed to the OTHER member, not necessarily half the total cost.
  counterparty_share_yen bigint not null default 0,
  expense_type public.expense_type not null default 'split',
  split_mode public.split_mode default 'half',
  occurred_on date not null default current_date,
  canceled_at timestamptz,
  version bigint not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pair_id, id),
  foreign key (pair_id, payer_member_id)
    references public.pair_members(pair_id, id) deferrable initially deferred,
  check (counterparty_share_yen between 0 and amount_yen),
  check (
    (expense_type = 'split' and split_mode is not null) or
    (expense_type <> 'split' and split_mode is null and counterparty_share_yen = 0)
  ),
  check (
    split_mode is distinct from 'half' or
    counterparty_share_yen = (amount_yen / 2)
  )
);
create index expenses_pair_date_idx
  on public.expenses(pair_id, occurred_on desc, created_at desc, id);
create index expenses_pair_payer_idx
  on public.expenses(pair_id, payer_member_id) where canceled_at is null;

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  pair_id uuid not null references public.pairs(id) on delete cascade,
  sender_member_id uuid not null,
  receiver_member_id uuid not null,
  amount_yen bigint not null check (amount_yen > 0),
  settled_on date not null default current_date,
  canceled_at timestamptz,
  version bigint not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pair_id, id),
  foreign key (pair_id, sender_member_id)
    references public.pair_members(pair_id, id) deferrable initially deferred,
  foreign key (pair_id, receiver_member_id)
    references public.pair_members(pair_id, id) deferrable initially deferred,
  check (sender_member_id <> receiver_member_id)
);
create index settlements_pair_date_idx
  on public.settlements(pair_id, settled_on desc, created_at desc, id);

create table public.promises (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null unique,
  pair_id uuid not null,
  assignee_member_id uuid not null,
  body text not null check (length(btrim(body)) between 1 and 4000),
  due_on date,
  status public.promise_status not null default 'pending',
  version bigint not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pair_id, id),
  foreign key (pair_id, expense_id)
    references public.expenses(pair_id, id) on delete cascade deferrable initially deferred,
  foreign key (pair_id, assignee_member_id)
    references public.pair_members(pair_id, id) deferrable initially deferred
);
create index promises_pair_status_idx on public.promises(pair_id, status, created_at desc);

-- Default half-split must work when the API supplies only the amount (FR-037).
-- For gifts, the counterparty never has a monetary share.
create function private.normalize_expense_amounts()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.expense_type = 'split' then
    if new.split_mode is null then
      new.split_mode := 'half';
    end if;
    if new.split_mode = 'half' then
      new.counterparty_share_yen := new.amount_yen / 2;
    end if;
  else
    new.split_mode := null;
    new.counterparty_share_yen := 0;
  end if;
  return new;
end;
$$;
create trigger expenses_normalize_amounts
  before insert or update of amount_yen, expense_type, split_mode
  on public.expenses
  for each row execute function private.normalize_expense_amounts();

-- Enforce the attachment/state relationship at COMMIT so that an expense and
-- its promise can be inserted/canceled together in one transaction.
-- A canceled promise is allowed to remain attached after expense restoration.
create function private.assert_promise_relation_valid()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  checked_expense_id uuid;
  parent public.expenses%rowtype;
  attached public.promises%rowtype;
begin
  if tg_table_name = 'expenses' then
    checked_expense_id := case when tg_op = 'DELETE' then old.id else new.id end;
  else
    checked_expense_id := case when tg_op = 'DELETE' then old.expense_id
                               else new.expense_id end;
  end if;

  select * into parent from public.expenses where id = checked_expense_id;
  if not found then
    return null; -- The parent expense and promise are being deleted.
  end if;
  select * into attached from public.promises where expense_id = parent.id;

  if parent.expense_type = 'gift_promise' and attached.id is null then
    raise exception 'gift_promise expense % requires a promise', parent.id
      using errcode = '23514';
  end if;
  if attached.id is not null and attached.status <> 'canceled' and
     (parent.expense_type <> 'gift_promise' or parent.canceled_at is not null) then
    raise exception 'Promise for expense % must be canceled', parent.id
      using errcode = '23514';
  end if;
  return null;
end;
$$;
create constraint trigger expense_promise_relation_invariant
  after insert or update or delete on public.expenses
  deferrable initially deferred
  for each row execute function private.assert_promise_relation_valid();
create constraint trigger promise_expense_relation_invariant
  after insert or update or delete on public.promises
  deferrable initially deferred
  for each row execute function private.assert_promise_relation_valid();

-- Every source-record UPDATE automatically bumps its optimistic-lock version.
-- The API still must use WHERE version = expected_version to detect a conflict.
create function private.bump_record_version()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.version := old.version + 1;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
create trigger expenses_bump_version before update on public.expenses
  for each row execute function private.bump_record_version();
create trigger settlements_bump_version before update on public.settlements
  for each row execute function private.bump_record_version();
create trigger promises_bump_version before update on public.promises
  for each row execute function private.bump_record_version();

create function private.touch_profile_timestamp()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
create trigger profiles_touch_timestamp before update on public.profiles
  for each row execute function private.touch_profile_timestamp();

-- --------------------------------------------------------------------------
-- User instructions vs computed allocation: KEEP THESE SEPARATE.
-- --------------------------------------------------------------------------
-- Persist users' chosen targets/priorities across recomputations.
create table public.settlement_targets (
  id uuid primary key default gen_random_uuid(),
  pair_id uuid not null,
  settlement_id uuid not null,
  expense_id uuid not null,
  target_amount_yen bigint not null check (target_amount_yen > 0),
  priority integer not null default 0,
  created_at timestamptz not null default now(),
  unique (settlement_id, expense_id),
  foreign key (pair_id, settlement_id)
    references public.settlements(pair_id, id) on delete cascade deferrable initially deferred,
  foreign key (pair_id, expense_id)
    references public.expenses(pair_id, id) on delete cascade deferrable initially deferred
);
create index settlement_targets_pair_idx on public.settlement_targets(pair_id, settlement_id);

-- DERIVED, replaceable settlement-to-expense allocations.
create table public.settlement_allocations (
  id uuid primary key default gen_random_uuid(),
  pair_id uuid not null,
  settlement_id uuid not null,
  expense_id uuid not null,
  amount_yen bigint not null check (amount_yen > 0),
  source public.allocation_source not null,
  unique (settlement_id, expense_id, source),
  foreign key (pair_id, settlement_id)
    references public.settlements(pair_id, id) on delete cascade deferrable initially deferred,
  foreign key (pair_id, expense_id)
    references public.expenses(pair_id, id) on delete cascade deferrable initially deferred
);
create index settlement_allocations_expense_idx
  on public.settlement_allocations(pair_id, expense_id);

-- DERIVED, replaceable pairwise opposite-debt offsets. Each row consumes
-- equal amounts from one A-paid and one B-paid split expense.
create table public.offset_allocations (
  id uuid primary key default gen_random_uuid(),
  pair_id uuid not null,
  expense_a_id uuid not null,
  expense_b_id uuid not null,
  amount_yen bigint not null check (amount_yen > 0),
  unique (pair_id, expense_a_id, expense_b_id),
  foreign key (pair_id, expense_a_id)
    references public.expenses(pair_id, id) on delete cascade deferrable initially deferred,
  foreign key (pair_id, expense_b_id)
    references public.expenses(pair_id, id) on delete cascade deferrable initially deferred,
  check (expense_a_id <> expense_b_id)
);
create index offset_allocations_b_idx on public.offset_allocations(pair_id, expense_b_id);

-- --------------------------------------------------------------------------
-- Immutable audit history & server-side idempotency
-- --------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  pair_id uuid not null references public.pairs(id) on delete cascade,
  actor_member_id uuid,
  entity_type public.audit_entity_type not null,
  entity_id uuid not null,
  action public.audit_action not null,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now(),
  foreign key (pair_id, actor_member_id)
    references public.pair_members(pair_id, id) deferrable initially deferred,
  check (old_data is not null or new_data is not null)
);
create index audit_logs_pair_date_idx
  on public.audit_logs(pair_id, created_at desc, id desc);
create index audit_logs_entity_idx
  on public.audit_logs(pair_id, entity_type, entity_id, created_at desc);

create table public.idempotency_keys (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  pair_id uuid references public.pairs(id) on delete set null,
  request_key uuid not null,
  endpoint text not null check (length(endpoint) between 1 and 160),
  request_digest bytea not null check (octet_length(request_digest) = 32),
  status public.idempotency_status not null default 'processing',
  response_status integer,
  response_body jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, request_key),
  check (
    (status = 'processing' and completed_at is null) or
    (status = 'completed' and completed_at is not null and response_status is not null)
  )
);
create index idempotency_keys_user_created_idx
  on public.idempotency_keys(user_id, created_at desc);

-- --------------------------------------------------------------------------
-- Deferred invariant: an active pair MUST have exactly two live members and
-- exactly two matching active membership rows; other pair statuses have none.
-- This is checked at COMMIT, allowing the backend to transition states inside
-- one transaction without exposing an inconsistent intermediate state.
-- --------------------------------------------------------------------------
create function private.assert_pair_memberships_valid()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  checked_pair_id uuid;
  checked_status public.pair_status;
  live_member_count integer;
  active_member_count integer;
begin
  if tg_op = 'DELETE' then
    checked_pair_id := old.pair_id;
  elsif tg_table_name = 'pairs' then
    checked_pair_id := new.id;
  else
    checked_pair_id := new.pair_id;
  end if;

  select p.status into checked_status
    from public.pairs p where p.id = checked_pair_id;
  if not found then
    return null; -- Parent pair is being deleted; its rows cascade too.
  end if;

  select count(*) into live_member_count
    from public.pair_members pm
    where pm.pair_id = checked_pair_id and pm.user_id is not null;
  select count(*) into active_member_count
    from public.active_pair_memberships am
    where am.pair_id = checked_pair_id;

  if checked_status = 'active' then
    if live_member_count <> 2 or active_member_count <> 2
       or exists (
         select 1 from public.active_pair_memberships am
         left join public.pair_members pm
           on pm.id = am.member_id and pm.pair_id = am.pair_id
         where am.pair_id = checked_pair_id
           and (pm.user_id is null or pm.user_id <> am.user_id)
       ) then
      raise exception 'Active pair % must contain two matching live members', checked_pair_id
        using errcode = '23514';
    end if;
  elsif active_member_count <> 0 then
    raise exception 'Non-active pair % cannot have active memberships', checked_pair_id
      using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger pairs_membership_invariant
  after insert or update on public.pairs
  deferrable initially deferred
  for each row execute function private.assert_pair_memberships_valid();
create constraint trigger members_membership_invariant
  after insert or update or delete on public.pair_members
  deferrable initially deferred
  for each row execute function private.assert_pair_memberships_valid();
create constraint trigger active_membership_invariant
  after insert or update or delete on public.active_pair_memberships
  deferrable initially deferred
  for each row execute function private.assert_pair_memberships_valid();

-- --------------------------------------------------------------------------
-- RLS helpers. Bypass table RLS internally but NEVER bypass identity checks.
-- Keep security definer functions in a non-exposed schema.
-- --------------------------------------------------------------------------
create function private.can_read_pair(requested_pair_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null
     and exists (
       select 1 from public.pair_members pm
       where pm.pair_id = requested_pair_id
         and pm.user_id = (select auth.uid())
     );
$$;

create function private.can_read_profile(requested_user_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null
     and (
       requested_user_id = (select auth.uid())
       or exists (
         select 1
         from public.pair_members mine
         join public.pair_members theirs on theirs.pair_id = mine.pair_id
         where mine.user_id = (select auth.uid())
           and theirs.user_id = requested_user_id
       )
     );
$$;

revoke all on function private.can_read_pair(uuid) from public, anon;
revoke all on function private.can_read_profile(uuid) from public, anon;
grant execute on function private.can_read_pair(uuid) to authenticated;
grant execute on function private.can_read_profile(uuid) to authenticated;

-- Only SELECT is delegated to clients. All writes are backend controlled.
alter table public.profiles enable row level security;
alter table public.pairs enable row level security;
alter table public.pair_members enable row level security;
alter table public.active_pair_memberships enable row level security;
alter table public.pair_invites enable row level security;
alter table public.pair_revival_requests enable row level security;
alter table public.expenses enable row level security;
alter table public.settlements enable row level security;
alter table public.promises enable row level security;
alter table public.settlement_targets enable row level security;
alter table public.settlement_allocations enable row level security;
alter table public.offset_allocations enable row level security;
alter table public.audit_logs enable row level security;
alter table public.idempotency_keys enable row level security;

-- Don't alter privileges of unrelated public tables. Apply explicit privileges
-- only to this migration's tables.
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','pairs','pair_members','active_pair_memberships',
    'pair_invites','pair_revival_requests','expenses','settlements',
    'promises','settlement_targets','settlement_allocations',
    'offset_allocations','audit_logs','idempotency_keys'
  ] loop
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end;
$$;

grant select on public.profiles, public.pairs, public.pair_members,
  public.active_pair_memberships, public.pair_revival_requests,
  public.expenses, public.settlements, public.promises,
  public.settlement_targets, public.settlement_allocations,
  public.offset_allocations, public.audit_logs
  to authenticated;

-- No SELECT grant for pair_invites or idempotency_keys: code/token digests,
-- request hashes and cached responses are server-internal.
create policy profiles_read on public.profiles for select to authenticated
  using ((select private.can_read_profile(user_id)));
create policy pairs_read on public.pairs for select to authenticated
  using ((select private.can_read_pair(id)));
create policy pair_members_read on public.pair_members for select to authenticated
  using (private.can_read_pair(pair_id));
create policy active_memberships_read on public.active_pair_memberships
  for select to authenticated using (user_id = (select auth.uid()));
create policy revival_requests_read on public.pair_revival_requests
  for select to authenticated using (private.can_read_pair(pair_id));
create policy expenses_read on public.expenses for select to authenticated
  using (private.can_read_pair(pair_id));
create policy settlements_read on public.settlements for select to authenticated
  using (private.can_read_pair(pair_id));
create policy promises_read on public.promises for select to authenticated
  using (private.can_read_pair(pair_id));
create policy settlement_targets_read on public.settlement_targets
  for select to authenticated using (private.can_read_pair(pair_id));
create policy settlement_allocations_read on public.settlement_allocations
  for select to authenticated using (private.can_read_pair(pair_id));
create policy offset_allocations_read on public.offset_allocations
  for select to authenticated using (private.can_read_pair(pair_id));
create policy audit_logs_read on public.audit_logs for select to authenticated
  using (private.can_read_pair(pair_id));

-- Stable, read-only balance computed from source facts. Derived allocations are
-- NOT included, so they can never accidentally double-count the balance.
create view public.pair_balances with (security_invoker = true) as
select
  p.id as pair_id,
  coalesce((
    select sum(case when payer.slot = 'a' then e.counterparty_share_yen
                    else -e.counterparty_share_yen end)
    from public.expenses e
    join public.pair_members payer on payer.id = e.payer_member_id
    where e.pair_id = p.id
      and e.canceled_at is null
      and e.expense_type = 'split'
  ), 0)::bigint
  + coalesce((
    select sum(case when sender.slot = 'a' then s.amount_yen
                    else -s.amount_yen end)
    from public.settlements s
    join public.pair_members sender on sender.id = s.sender_member_id
    where s.pair_id = p.id
      and s.canceled_at is null
  ), 0)::bigint as net_a_yen
from public.pairs p;
revoke all on public.pair_balances from public, anon;
grant select on public.pair_balances to authenticated;

commit;
