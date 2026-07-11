create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  created_at timestamptz not null default now(),
  source text not null default 'huncho.tech'
);
alter table public.waitlist enable row level security;
-- No policies: only the service-role key (server) can read/write.
