-- Jobbmejl i kundportalen.
-- Personlig adress (t.ex. jessica@starenborg.se) syns bara för ägaren.
-- info@starenborg.se syns för alla administratörer.

create table if not exists public.work_mailboxes (
  id uuid primary key default gen_random_uuid(),
  address text not null unique,
  display_name text not null,
  kind text not null check (kind in ('personal', 'shared')),
  owner_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.work_messages (
  id uuid primary key default gen_random_uuid(),
  mailbox_id uuid not null references public.work_mailboxes(id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  from_address text not null,
  to_address text not null,
  subject text not null,
  body text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists work_messages_mailbox_created_idx
  on public.work_messages (mailbox_id, created_at desc);

create or replace function public.is_work_admin()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin';
$$;

alter table public.work_mailboxes enable row level security;
alter table public.work_messages enable row level security;

drop policy if exists work_mailboxes_select on public.work_mailboxes;
drop policy if exists work_mailboxes_insert on public.work_mailboxes;
drop policy if exists work_mailboxes_update on public.work_mailboxes;
drop policy if exists work_messages_select on public.work_messages;
drop policy if exists work_messages_insert on public.work_messages;
drop policy if exists work_messages_update on public.work_messages;

create policy work_mailboxes_select on public.work_mailboxes
  for select to authenticated
  using (public.is_work_admin());

create policy work_mailboxes_insert on public.work_mailboxes
  for insert to authenticated
  with check (public.is_work_admin() and (kind = 'shared' or owner_id = auth.uid()));

create policy work_mailboxes_update on public.work_mailboxes
  for update to authenticated
  using (public.is_work_admin() and (kind = 'shared' or owner_id = auth.uid()))
  with check (public.is_work_admin() and (kind = 'shared' or owner_id = auth.uid()));

create policy work_messages_select on public.work_messages
  for select to authenticated
  using (
    public.is_work_admin() and exists (
      select 1 from public.work_mailboxes b
      where b.id = mailbox_id
        and (b.kind = 'shared' or b.owner_id = auth.uid())
    )
  );

create policy work_messages_insert on public.work_messages
  for insert to authenticated
  with check (public.is_work_admin());

create policy work_messages_update on public.work_messages
  for update to authenticated
  using (
    public.is_work_admin() and exists (
      select 1 from public.work_mailboxes b
      where b.id = mailbox_id
        and (b.kind = 'shared' or b.owner_id = auth.uid())
    )
  );

grant select, insert, update on public.work_mailboxes to authenticated;
grant select, insert, update on public.work_messages to authenticated;
