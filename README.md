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

Three tables are required. Run this in the Supabase SQL editor:

```sql
create table rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  payer_name text,
  payer_venmo text,
  items jsonb,
  tax_rate numeric default 0.08875,
  tip_rate numeric default 0.20,
  created_at timestamptz default now()
);

create table participants (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references rooms(id) on delete cascade,
  name text not null,
  venmo text,
  done boolean default false,
  created_at timestamptz default now()
);

create table selections (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references rooms(id) on delete cascade,
  participant_id uuid references participants(id) on delete cascade,
  item_id text not null
);

-- RLS policies (allow anon access)
alter table rooms enable row level security;
create policy "allow all" on rooms for all using (true) with check (true);

alter table participants enable row level security;
create policy "allow all" on participants for all using (true) with check (true);

alter table selections enable row level security;
create policy "allow all" on selections for all using (true) with check (true);
```
