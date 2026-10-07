-- =====================================================================
-- Meus Remédios - Agendamentos (rodar no Supabase > SQL Editor)
-- Pré-requisito: Edge Function "enviar-lembretes" publicada (etapa 4)
-- e o segredo "cron_secret" criado no Vault (ver passo 0 do guia).
-- =====================================================================

-- pg_cron = agendador de tarefas dentro do banco (como o Agendador do Windows)
-- pg_net  = permite o banco fazer chamadas HTTP (para acionar a função)
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------------
-- 1) A cada minuto: aciona a função que envia os lembretes.
--    O segredo é lido do Vault (cofre do Supabase), então não fica
--    escrito neste arquivo nem no GitHub.
-- ---------------------------------------------------------------------
select cron.schedule(
  'enviar-lembretes',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://fnhodcaxsskjhjxpjybb.supabase.co/functions/v1/enviar-lembretes',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ---------------------------------------------------------------------
-- 2) Todo dia às 00:15 (Curitiba) = 03:15 UTC: limpa o controle de avisos.
--    Só serve para o dia atual; guarda 7 dias por segurança.
-- ---------------------------------------------------------------------
select cron.schedule(
  'limpar-lembretes',
  '15 3 * * *',
  $$ delete from public.lembretes_enviados where data < current_date - 7 $$
);

-- Para conferir os agendamentos:      select * from cron.job;
-- Para ver as últimas execuções:      select * from cron.job_run_details order by start_time desc limit 10;
-- Para pausar os lembretes:           select cron.unschedule('enviar-lembretes');
