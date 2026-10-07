-- =====================================================================
-- Meus Remédios - estrutura do banco (rodar no Supabase > SQL Editor)
-- =====================================================================

-- Tabela de remédios cadastrados
create table if not exists public.remedios (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nome             text not null,
  periodo          text not null check (periodo in ('manha', 'tarde', 'noite')),
  horario_previsto time,            -- opcional (ex.: 08:00)
  dose             text,            -- opcional (ex.: 1 comprimido)
  ativo            boolean not null default true,
  criado_em        timestamptz not null default now()
);

-- Tabela de registros (cada vez que um remédio foi tomado)
create table if not exists public.registros (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  remedio_id  uuid not null references public.remedios (id) on delete cascade,
  tomado_em   timestamptz not null,
  criado_em   timestamptz not null default now()
);

create index if not exists idx_registros_user_data on public.registros (user_id, tomado_em);

-- ---------------------------------------------------------------------
-- Segurança (RLS): cada usuário só enxerga e altera os próprios dados.
-- Sem isso, qualquer pessoa com a chave pública leria tudo.
-- ---------------------------------------------------------------------
alter table public.remedios  enable row level security;
alter table public.registros enable row level security;

create policy "remedios_do_dono" on public.remedios
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "registros_do_dono" on public.registros
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
