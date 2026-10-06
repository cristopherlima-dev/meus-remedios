-- =====================================================================
-- Meus Remédios - Lembretes (Web Push)
-- Rodar no Supabase > SQL Editor (depois do supabase.sql)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Aparelhos inscritos para receber notificações.
--    Cada celular/PC que clicar em "Ativar neste aparelho" vira uma linha.
--    endpoint = "endereço" do aparelho no serviço de push do navegador;
--    p256dh e auth = chaves para criptografar a mensagem só para ele.
-- ---------------------------------------------------------------------
create table if not exists public.push_inscricoes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  criado_em  timestamptz not null default now()
);

alter table public.push_inscricoes enable row level security;

-- O app (logado) só vê, cria e apaga as inscrições do próprio usuário
create policy "inscricoes_do_dono" on public.push_inscricoes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 2) Controle de avisos já enviados.
--    Evita mandar o mesmo aviso duas vezes (o agendador roda a cada minuto).
--    etapa: 10 = 10 min antes, 5 = 5 min antes, 0 = no horário.
-- ---------------------------------------------------------------------
create table if not exists public.lembretes_enviados (
  remedio_id  uuid not null references public.remedios (id) on delete cascade,
  data        date not null,
  etapa       smallint not null check (etapa in (10, 5, 0)),
  enviado_em  timestamptz not null default now(),
  primary key (remedio_id, data, etapa)
);

-- RLS ligado e SEM policy: o app não acessa esta tabela.
-- Só a função do servidor (Edge Function, com a chave secreta) lê e grava.
alter table public.lembretes_enviados enable row level security;
