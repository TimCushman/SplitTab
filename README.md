# SplitTab

Split a restaurant tab with friends. Drop a receipt, tap what you had, and shared dishes divide automatically as more people claim them.

## How it works

1. **Host** creates a room, enters the dinner name and the Venmo handle of whoever paid
2. A shareable link is generated — send it to everyone at the table
3. Each person taps the items they ordered or shared
4. Shared items automatically split equally among everyone who tapped them
5. Once everyone submits, the settle-up screen shows each person's total with a direct Venmo pay link

## Tech stack

- React + Vite
- Supabase (Postgres + Realtime)

## Local dev

```bash
npm install
npm run dev
```

## Supabase setup

Three tables are required. Run this in **Supabase > SQL Editor**:

```sql
-- 1. ROOMS
create table rooms (
  id          text primary key default gen_random_uuid()::text,
  name        text not null,
  payer_name  text not null,
  payer_venmo text not null,
  items       jsonb not null,
  tax_rate    numeric default 0.08875,
  tip_rate    numeric default 0.20,
  created_at  timestamptz default now()
);

-- 2. PARTICIPANTS
create table participants (
  id        text primary key default gen_random_uuid()::text,
  room_id   text references rooms(id) on delete cascade,
  name      text not null,
  venmo     text,
  done      boolean default false,
  created_at timestamptz default now()
);

-- 3. SELECTIONS
create table selections (
  id             text primary key default gen_random_uuid()::text,
  participant_id text references participants(id) on delete cascade,
  room_id        text references rooms(id) on delete cascade,
  item_id        text not null
);

-- Enable Realtime
alter publication supabase_realtime add table rooms;
alter publication supabase_realtime add table participants;
alter publication supabase_realtime add table selections;

-- RLS policies
alter table rooms        enable row level security;
alter table participants enable row level security;
alter table selections   enable row level security;

create policy "anyone can read rooms"           on rooms        for select using (true);
create policy "anyone can insert rooms"         on rooms        for insert with check (true);
create policy "anyone can update rooms"         on rooms        for update using (true);
create policy "anyone can read participants"    on participants for select using (true);
create policy "anyone can insert participants"  on participants for insert with check (true);
create policy "anyone can update participants"  on participants for update using (true);
create policy "anyone can read selections"      on selections   for select using (true);
create policy "anyone can insert selections"    on selections   for insert with check (true);
create policy "anyone can delete selections"    on selections   for delete using (true);
```
