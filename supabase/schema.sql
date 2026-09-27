-- À exécuter une fois dans Supabase : SQL Editor → New query → coller → Run.

-- Une ligne par élément synchronisé : document (docs), corps (bodies) ou dossier (folders).
-- `data` contient l'objet tel qu'il est stocké dans le navigateur.
create table if not exists public.items (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('docs', 'bodies', 'folders')),
  id text not null,
  data jsonb,
  -- Suppression "douce" : les autres appareils doivent apprendre la suppression.
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, id)
);

create index if not exists items_user_updated on public.items (user_id, updated_at);

-- Horodatage serveur : sert de curseur pour ne récupérer que les nouveautés.
create or replace function public.items_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists items_touch on public.items;
create trigger items_touch before insert or update on public.items
  for each row execute function public.items_touch();

-- Chacun ne voit et ne modifie que ses propres lignes.
alter table public.items enable row level security;

drop policy if exists "own items" on public.items;
create policy "own items" on public.items
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
