// =====================================================================
// Edge Function: enviar-lembretes
// Roda no servidor do Supabase (Deno). Tem dois modos:
//
//  1) AGENDADO (cron, a cada minuto) - header "x-cron-secret"
//     Procura remédios cujo horário previsto está a 10, 5 ou 0 minutos,
//     confere se ainda estão PENDENTES hoje e manda o push.
//
//  2) TESTE (botão "Enviar teste" do app) - header "Authorization" do usuário
//     Manda uma notificação de teste para os aparelhos do próprio usuário.
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

// ---------------- Configuração (secrets do Supabase) ----------------
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!; // ignora o RLS: só no servidor!
const CRON_SECRET = Deno.env.get("CRON_SECRET")!;

// Configura as chaves VAPID. Fica dentro de uma função (e não solta no arquivo)
// para que um secret faltando/errado vire uma mensagem de erro clara,
// em vez de derrubar a função antes de responder.
let vapidOk = false;
function configurarVapid() {
  if (vapidOk) return;
  for (const nome of ["VAPID_SUBJECT", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "CRON_SECRET"]) {
    if (!Deno.env.get(nome)) throw new Error(`Secret ${nome} não cadastrado`);
  }
  webpush.setVapidDetails(
    Deno.env.get("VAPID_SUBJECT")!.trim(), // ex.: mailto:seu@email.com
    Deno.env.get("VAPID_PUBLIC_KEY")!.trim(),
    Deno.env.get("VAPID_PRIVATE_KEY")!.trim(),
  );
  vapidOk = true;
}

const db = createClient(SUPABASE_URL, SERVICE_KEY);

// O app (GitHub Pages) chama esta função de outro domínio: precisa de CORS
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// ---------------- Datas no fuso de Curitiba ----------------
// O servidor roda em UTC; os horários dos remédios são locais.
// O Brasil não tem horário de verão desde 2019, então o fuso é fixo -03:00.
const FUSO = "-03:00";

function agoraLocal() {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const p = Object.fromEntries(partes.map((x) => [x.type, x.value]));
  return {
    data: `${p.year}-${p.month}-${p.day}`,             // "2026-10-07"
    minutos: Number(p.hour) * 60 + Number(p.minute),   // 22:00 -> 1320
  };
}

// ---------------- Envio de push ----------------
type Inscricao = { id: string; endpoint: string; p256dh: string; auth: string };

async function enviarPara(inscricoes: Inscricao[], mensagem: object) {
  let enviados = 0;
  for (const i of inscricoes) {
    try {
      await webpush.sendNotification(
        { endpoint: i.endpoint, keys: { p256dh: i.p256dh, auth: i.auth } },
        JSON.stringify(mensagem),
      );
      enviados++;
    } catch (erro) {
      // 404/410 = aparelho desinstalou o app ou cancelou: apaga a inscrição
      const status = (erro as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await db.from("push_inscricoes").delete().eq("id", i.id);
      } else {
        console.error("Falha no push", status, erro);
      }
    }
  }
  return enviados;
}

async function inscricoesDoUsuario(userId: string) {
  const { data, error } = await db.from("push_inscricoes").select("id, endpoint, p256dh, auth").eq("user_id", userId);
  if (error) throw error;
  return data as Inscricao[];
}

// ---------------- Modo TESTE ----------------
async function modoTeste(req: Request) {
  // Confere quem está chamando pelo token de login do app
  const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
  const { data: { user }, error } = await db.auth.getUser(token);
  if (error || !user) return resposta({ erro: "não autorizado" }, 401);

  const inscricoes = await inscricoesDoUsuario(user.id);
  const enviados = await enviarPara(inscricoes, {
    titulo: "Teste de lembrete ✔",
    corpo: "Se você está vendo isto, os lembretes estão funcionando.",
    tag: "teste",
  });
  return resposta({ enviados });
}

// ---------------- Modo AGENDADO ----------------
// Em qual "etapa" o remédio está agora? (dá 1 min de folga se o cron atrasar)
function etapaAtual(diferenca: number): 10 | 5 | 0 | null {
  if (diferenca <= 10 && diferenca > 5) return 10;
  if (diferenca <= 5 && diferenca > 0) return 5;
  if (diferenca <= 0 && diferenca > -2) return 0;
  return null;
}

async function modoAgendado() {
  const { data: hoje, minutos } = agoraLocal();

  // 1. Remédios ativos com horário previsto (de todos os usuários)
  const { data: remedios, error } = await db
    .from("remedios")
    .select("id, user_id, nome, dose, horario_previsto")
    .eq("ativo", true)
    .not("horario_previsto", "is", null);
  if (error) throw error;

  let enviados = 0;

  for (const r of remedios) {
    // 2. Quantos minutos faltam para o horário previsto?
    const [h, m] = r.horario_previsto.split(":").map(Number);
    const etapa = etapaAtual(h * 60 + m - minutos);
    if (etapa === null) continue;

    // 3. Ainda está PENDENTE hoje? (algum registro desde a meia-noite local)
    const { count } = await db
      .from("registros")
      .select("id", { count: "exact", head: true })
      .eq("remedio_id", r.id)
      .gte("tomado_em", `${hoje}T00:00:00${FUSO}`);
    if (count && count > 0) continue; // já tomou: não avisa

    // 4. Carimbo "já avisei": se a linha já existia, não manda de novo
    const { data: novo } = await db
      .from("lembretes_enviados")
      .upsert({ remedio_id: r.id, data: hoje, etapa }, { onConflict: "remedio_id,data,etapa", ignoreDuplicates: true })
      .select();
    if (!novo || novo.length === 0) continue;

    // 5. Monta e envia a notificação
    const previsto = r.horario_previsto.slice(0, 5);
    const titulo = etapa === 0 ? `Hora do ${r.nome}` : `${r.nome} em ${etapa} minutos`;
    const corpo = [r.dose, `previsto ${previsto}`].filter(Boolean).join(" · ");

    enviados += await enviarPara(await inscricoesDoUsuario(r.user_id), {
      titulo,
      corpo,
      tag: `${r.id}-${hoje}`, // mesma tag no dia = substitui o aviso anterior
    });
  }

  return resposta({ hoje, minutos, enviados });
}

// ---------------- Entrada da função ----------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    configurarVapid();

    // Chamado pelo agendador?
    if (req.headers.get("x-cron-secret")) {
      if (req.headers.get("x-cron-secret") !== CRON_SECRET) return resposta({ erro: "segredo inválido" }, 401);
      return await modoAgendado();
    }
    // Senão, é o botão "Enviar teste" do app
    return await modoTeste(req);
  } catch (erro) {
    console.error(erro);
    return resposta({ erro: String(erro) }, 500);
  }
});
