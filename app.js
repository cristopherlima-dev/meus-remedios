// =====================================================================
// Meus Remédios - lógica do app
// =====================================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY, VAPID_PUBLIC_KEY } from './config.js';

// Conexão com o banco. A sessão de login fica salva no aparelho.
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

// Atalho para pegar elementos pelo id
const $ = (id) => document.getElementById(id);

const PERIODOS = { manha: 'Manhã', tarde: 'Tarde', noite: 'Noite' };
const ORDEM_PERIODO = { manha: 1, tarde: 2, noite: 3 };

// ---------------- Estado do app (dados em memória) ----------------
let remedios = [];              // todos os remédios do usuário (ativos e inativos)
let diaSelecionado = hojeZero(); // dia exibido na tela "Hoje"
let remedioDoModal = null;      // remédio sendo registrado no modal "Outro horário"
let remedioEditando = null;     // remédio sendo editado (null = novo)

// =====================================================================
// FUNÇÕES DE DATA
// =====================================================================

// Data de hoje à meia-noite (horário local)
function hojeZero() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function somarDias(data, qtd) {
  const d = new Date(data);
  d.setDate(d.getDate() + qtd);
  return d;
}

function mesmoDia(a, b) {
  return a.toDateString() === b.toDateString();
}

// Date -> "2026-10-05" (formato do <input type="date">)
function dataISO(d) {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

// Date -> "08:05"
function horaTexto(d) {
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// "Segunda-feira, 05/10/2026"
function diaTexto(d) {
  const txt = d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

// "Hoje", "Ontem" ou o nome do dia da semana
function tituloDoDia(d) {
  const hoje = hojeZero();
  if (mesmoDia(d, hoje)) return 'Hoje';
  if (mesmoDia(d, somarDias(hoje, -1))) return 'Ontem';
  const txt = d.toLocaleDateString('pt-BR', { weekday: 'long' });
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

// O banco devolve "08:00:00"; mostramos só "08:00"
function horarioCurto(h) {
  return h ? h.slice(0, 5) : '';
}

// =====================================================================
// SELETOR DE HORÁRIO (duas listas: hora e minuto)
// Substitui o <input type="time">, cujo relógio nativo varia de aparelho
// para aparelho e pode aparecer cortado.
// =====================================================================

// Preenche as listas: horas 00–23 e minutos de 5 em 5.
// comVazio = true adiciona a opção "--" (horário opcional)
function montarSeletorHora(prefixo, comVazio) {
  const opcoes = (qtd, passo) =>
    Array.from({ length: qtd / passo }, (_, i) => {
      const v = String(i * passo).padStart(2, '0');
      return `<option value="${v}">${v}</option>`;
    }).join('');
  const vazio = comVazio ? '<option value="">--</option>' : '';
  $(prefixo + '-h').innerHTML = vazio + opcoes(24, 1);
  $(prefixo + '-m').innerHTML = vazio + opcoes(60, 5);
}

// Coloca "08:13" nas listas (minuto arredondado para baixo: 08:10). '' limpa.
function definirHora(prefixo, hhmm) {
  if (!hhmm) { $(prefixo + '-h').value = ''; $(prefixo + '-m').value = ''; return; }
  const [h, m] = hhmm.split(':');
  $(prefixo + '-h').value = h;
  $(prefixo + '-m').value = String(Math.floor(m / 5) * 5).padStart(2, '0');
}

// Lê as listas e devolve "08:10", ou '' se a hora estiver em branco
function lerHora(prefixo) {
  const h = $(prefixo + '-h').value;
  if (!h) return '';
  return `${h}:${$(prefixo + '-m').value || '00'}`;
}

montarSeletorHora('registro', false);
montarSeletorHora('remedio', true);

// =====================================================================
// OUTRAS AJUDAS
// =====================================================================

// Evita que um nome digitado com "<" quebre o HTML
function esc(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}

function avisar(erro) {
  console.error(erro);
  alert('Ops: ' + (erro.message || erro));
}

// "Manhã · previsto 08:00 · 1 comprimido"
function descricao(r, comPrevisto = true) {
  const partes = [PERIODOS[r.periodo]];
  if (r.horario_previsto) partes.push((comPrevisto ? 'previsto ' : '') + horarioCurto(r.horario_previsto));
  if (r.dose) partes.push(r.dose);
  return esc(partes.join(' · '));
}

// Ordena por período (manhã, tarde, noite) e depois pelo horário previsto
function ordenar(lista) {
  return [...lista].sort((a, b) =>
    ORDEM_PERIODO[a.periodo] - ORDEM_PERIODO[b.periodo] ||
    (a.horario_previsto || '99').localeCompare(b.horario_previsto || '99') ||
    a.nome.localeCompare(b.nome)
  );
}

// =====================================================================
// LOGIN (e-mail + senha)
// =====================================================================

$('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-msg').textContent = 'Entrando...';
  const { error } = await db.auth.signInWithPassword({
    email: $('login-email').value.trim(),
    password: $('login-senha').value,
  });
  if (error) { $('login-msg').textContent = 'E-mail ou senha inválidos.'; return; }
  $('login-msg').textContent = '';
  $('login-senha').value = '';
  // A troca de tela acontece no onAuthStateChange, lá embaixo
});

$('btn-sair').addEventListener('click', async () => {
  if (!confirm('Sair deste aparelho?')) return;
  await desativarLembretes(true); // este aparelho para de receber avisos
  await db.auth.signOut();
});

// Mostra a tela de login ou o app, conforme exista sessão
let logado = null; // evita carregar duas vezes quando o Supabase avisa em dobro
function mostrarConforme(sessao) {
  if (logado === !!sessao) return;
  logado = !!sessao;
  $('tela-login').hidden = logado;
  $('app').hidden = !logado;
  if (logado) carregarTudo();
}

// Dispara ao entrar, sair ou quando o login é renovado
db.auth.onAuthStateChange((evento, sessao) => {
  // setTimeout evita chamar o banco de dentro deste evento (recomendação do Supabase)
  if (evento === 'SIGNED_IN' || evento === 'SIGNED_OUT' || evento === 'INITIAL_SESSION') {
    setTimeout(() => mostrarConforme(sessao), 0);
  }
});

// =====================================================================
// NAVEGAÇÃO ENTRE TELAS
// =====================================================================

document.querySelectorAll('nav button').forEach((botao) => {
  botao.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b === botao));
    document.querySelectorAll('#app .tela').forEach((t) => (t.hidden = t.id !== botao.dataset.tela));
    renderizarTelaAtual();
  });
});

function telaAtual() {
  return document.querySelector('nav button.on').dataset.tela;
}

function renderizarTelaAtual() {
  const tela = telaAtual();
  if (tela === 'tela-hoje') renderizarHoje();
  if (tela === 'tela-historico') renderizarHistorico();
  if (tela === 'tela-remedios') renderizarRemedios();
}

async function carregarTudo() {
  const { data, error } = await db.from('remedios').select('*');
  if (error) return avisar(error);
  remedios = ordenar(data);
  renderizarTelaAtual();
}

// Ao voltar para o app (ex.: desbloqueou o celular), recarrega:
// atualiza o "Atrasado" e traz o que foi marcado no outro aparelho.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$('app').hidden) carregarTudo();
});

// =====================================================================
// TELA HOJE
// =====================================================================

$('dia-anterior').addEventListener('click', () => { diaSelecionado = somarDias(diaSelecionado, -1); renderizarHoje(); });
$('dia-seguinte').addEventListener('click', () => { diaSelecionado = somarDias(diaSelecionado, 1); renderizarHoje(); });

// Busca os registros entre duas datas
async function buscarRegistros(inicio, fim) {
  const { data, error } = await db
    .from('registros')
    .select('*')
    .gte('tomado_em', inicio.toISOString())
    .lt('tomado_em', fim.toISOString())
    .order('tomado_em');
  if (error) { avisar(error); return []; }
  return data;
}

async function renderizarHoje() {
  const dia = diaSelecionado;
  const hoje = hojeZero();
  const ehHoje = mesmoDia(dia, hoje);

  $('dia-texto').textContent = diaTexto(dia);
  $('hoje-titulo').textContent = tituloDoDia(dia);
  $('dia-seguinte').disabled = ehHoje; // não navega para o futuro

  const registros = await buscarRegistros(dia, somarDias(dia, 1));

  // Mostra os ativos + qualquer inativo que tenha registro nesse dia
  const lista = remedios.filter((r) => r.ativo || registros.some((g) => g.remedio_id === r.id));

  if (lista.length === 0) {
    $('lista-hoje').innerHTML = '<p class="vazio">Nenhum remédio cadastrado.<br>Use a aba "Remédios".</p>';
    return;
  }

  $('lista-hoje').innerHTML = lista.map((r) => {
    const reg = registros.filter((g) => g.remedio_id === r.id).pop(); // último registro do dia

    // Já tomou
    if (reg) {
      return `
        <div class="card">
          <div class="row">
            <div><div class="nome">${esc(r.nome)}</div><div class="per">${descricao(r)}</div></div>
            <span class="tag ok">✔ ${horaTexto(new Date(reg.tomado_em))}</span>
          </div>
          <button class="link" data-acao="desfazer" data-id="${reg.id}">desfazer</button>
        </div>`;
    }

    // Ainda não tomou: Pendente ou Atrasado?
    let atrasado = dia < hoje; // dia que já passou
    if (ehHoje && r.horario_previsto) {
      atrasado = horaTexto(new Date()) > horarioCurto(r.horario_previsto);
    }
    const tag = atrasado
      ? `<span class="tag atr">${ehHoje ? 'Atrasado' : 'Não tomado'}</span>`
      : '<span class="tag pend">Pendente</span>';

    const botoes = ehHoje
      ? `<button class="btn p" data-acao="agora" data-id="${r.id}">Tomei agora</button>
         <button class="btn s" data-acao="outro" data-id="${r.id}">Outro horário</button>`
      : `<button class="btn s" data-acao="outro" data-id="${r.id}">Registrar</button>`;

    return `
      <div class="card ${atrasado ? 'late' : ''}">
        <div class="row">
          <div><div class="nome">${esc(r.nome)}</div><div class="per">${descricao(r)}</div></div>
          ${tag}
        </div>
        <div class="acoes">${botoes}</div>
      </div>`;
  }).join('');
}

// Um único "ouvinte" para todos os botões dos cards (delegação de eventos)
$('lista-hoje').addEventListener('click', async (e) => {
  const botao = e.target.closest('[data-acao]');
  if (!botao) return;
  const { acao, id } = botao.dataset;
  botao.disabled = true; // evita duplo clique

  if (acao === 'agora') {
    await salvarRegistro(id, new Date());
  } else if (acao === 'outro') {
    abrirModalRegistro(remedios.find((r) => r.id === id));
    botao.disabled = false;
  } else if (acao === 'desfazer') {
    if (confirm('Desfazer este registro?')) {
      const { error } = await db.from('registros').delete().eq('id', id);
      if (error) avisar(error);
    }
    renderizarHoje();
  }
});

async function salvarRegistro(remedioId, quando) {
  const { error } = await db.from('registros').insert({ remedio_id: remedioId, tomado_em: quando.toISOString() });
  if (error) avisar(error);
  renderizarTelaAtual();
}

// =====================================================================
// MODAL "OUTRO HORÁRIO"
// =====================================================================

function abrirModalRegistro(remedio) {
  remedioDoModal = remedio;
  $('registro-titulo').textContent = 'Registrar ' + remedio.nome;
  $('registro-data').value = dataISO(diaSelecionado);
  definirHora('registro', horarioCurto(remedio.horario_previsto) || horaTexto(new Date()));
  $('modal-registro').hidden = false;
}

$('form-registro').addEventListener('submit', async (e) => {
  e.preventDefault();
  // "2026-10-05" + "22:00" -> data/hora local
  const quando = new Date(`${$('registro-data').value}T${lerHora('registro')}`);
  $('modal-registro').hidden = true;
  await salvarRegistro(remedioDoModal.id, quando);
});

// Botões "Cancelar" e clique no fundo escuro fecham os modais
document.querySelectorAll('.modal').forEach((modal) => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal || e.target.hasAttribute('data-fechar')) modal.hidden = true;
  });
});

// =====================================================================
// TELA HISTÓRICO (últimos 30 dias)
// =====================================================================

async function renderizarHistorico() {
  const hoje = hojeZero();
  const inicio = somarDias(hoje, -29);
  const registros = await buscarRegistros(inicio, somarDias(hoje, 1));
  let html = '';

  for (let dia = hoje; dia >= inicio; dia = somarDias(dia, -1)) {
    const fimDia = somarDias(dia, 1);
    const doDia = registros.filter((g) => new Date(g.tomado_em) >= dia && new Date(g.tomado_em) < fimDia);

    // Remédios que "valiam" naquele dia: ativos já cadastrados + quem tem registro
    const lista = remedios.filter((r) =>
      (r.ativo && new Date(r.criado_em) < fimDia) || doDia.some((g) => g.remedio_id === r.id)
    );
    if (lista.length === 0) continue;

    const linhas = lista.map((r) => {
      const regs = doDia.filter((g) => g.remedio_id === r.id);
      const valor = regs.length
        ? `<b>${regs.map((g) => horaTexto(new Date(g.tomado_em))).join(', ')}</b>`
        : '<span class="falta">—</span>';
      return `<div><span>${esc(r.nome)}</span>${valor}</div>`;
    }).join('');

    const data = dia.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    html += `<div class="dia">${tituloDoDia(dia)} – ${data}</div><div class="hist">${linhas}</div>`;
  }

  $('lista-historico').innerHTML = html || '<p class="vazio">Nenhum registro ainda.</p>';
}

// =====================================================================
// TELA REMÉDIOS (cadastro)
// =====================================================================

function renderizarRemedios() {
  renderizarLembretes();

  const card = (r) => `
    <div class="card ${r.ativo ? '' : 'inativo'}">
      <div class="row">
        <div><div class="nome">${esc(r.nome)}</div><div class="per">${descricao(r, false)}</div></div>
        ${r.ativo
          ? `<button class="link" style="margin:0" data-id="${r.id}">editar</button>`
          : `<button class="tag off" style="border:0;cursor:pointer" data-id="${r.id}">Inativo</button>`}
      </div>
    </div>`;

  const ativos = remedios.filter((r) => r.ativo);
  const inativos = remedios.filter((r) => !r.ativo);

  $('lista-remedios').innerHTML =
    (ativos.map(card).join('') || '<p class="vazio">Nenhum remédio ativo.</p>') +
    (inativos.length ? '<h2 style="margin-top:18px">Inativos</h2>' + inativos.map(card).join('') : '');
}

$('lista-remedios').addEventListener('click', (e) => {
  const botao = e.target.closest('[data-id]');
  if (botao) abrirModalRemedio(remedios.find((r) => r.id === botao.dataset.id));
});

$('btn-novo-remedio').addEventListener('click', () => abrirModalRemedio(null));

function abrirModalRemedio(remedio) {
  remedioEditando = remedio;
  $('remedio-titulo').textContent = remedio ? 'Editar remédio' : 'Novo remédio';
  $('remedio-nome').value = remedio?.nome ?? '';
  $('remedio-periodo').value = remedio?.periodo ?? 'manha';
  definirHora('remedio', horarioCurto(remedio?.horario_previsto));
  $('remedio-dose').value = remedio?.dose ?? '';
  $('remedio-ativo').checked = remedio?.ativo ?? true;
  $('modal-remedio').hidden = false;
  $('remedio-nome').focus();
}

$('form-remedio').addEventListener('submit', async (e) => {
  e.preventDefault();
  const dados = {
    nome: $('remedio-nome').value.trim(),
    periodo: $('remedio-periodo').value,
    horario_previsto: lerHora('remedio') || null, // vazio vira null no banco
    dose: $('remedio-dose').value.trim() || null,
    ativo: $('remedio-ativo').checked,
  };

  const { error } = remedioEditando
    ? await db.from('remedios').update(dados).eq('id', remedioEditando.id)
    : await db.from('remedios').insert(dados);

  if (error) return avisar(error);
  $('modal-remedio').hidden = true;
  carregarTudo();
});

// =====================================================================
// LEMBRETES (notificações push)
// =====================================================================
// Como funciona:
// 1. "Ativar" pede permissão ao navegador e cria uma inscrição (subscription):
//    um endereço único deste aparelho no serviço de push do navegador.
// 2. A inscrição é salva na tabela push_inscricoes.
// 3. O servidor (Edge Function) usa esse endereço para mandar os avisos.

// O navegador tem tudo que é preciso para push?
const suportaPush = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

// A chave VAPID vem em texto (base64); o navegador precisa dela em bytes
function chaveEmBytes(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

// Inscrição atual deste aparelho (ou null)
async function inscricaoAtual() {
  if (!suportaPush) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

async function renderizarLembretes() {
  const status = $('lembretes-status');
  const acoes = $('lembretes-acoes');

  if (!suportaPush) {
    status.textContent = 'Este navegador não suporta notificações. No iPhone, instale o app na Tela de Início primeiro.';
    acoes.innerHTML = '';
    return;
  }
  if (Notification.permission === 'denied') {
    status.textContent = 'Notificações bloqueadas. Libere nas configurações do site/app e volte aqui.';
    acoes.innerHTML = '';
    return;
  }

  const inscricao = await inscricaoAtual();
  if (inscricao) {
    status.innerHTML = '<span class="ativo">✔ Ativos neste aparelho</span>';
    acoes.innerHTML = `
      <button class="btn s" id="btn-lembrete-teste">Enviar teste</button>
      <button class="btn s" id="btn-lembrete-desativar">Desativar</button>`;
    $('btn-lembrete-teste').onclick = enviarTeste;
    $('btn-lembrete-desativar').onclick = () => desativarLembretes(false);
  } else {
    status.textContent = '10 min antes, 5 min antes e no horário previsto, só se ainda estiver Pendente.';
    acoes.innerHTML = '<button class="btn p" id="btn-lembrete-ativar">Ativar neste aparelho</button>';
    $('btn-lembrete-ativar').onclick = ativarLembretes;
  }
}

async function ativarLembretes() {
  try {
    // 1. Permissão (o navegador mostra a pergunta "Permitir notificações?")
    const permissao = await Notification.requestPermission();
    if (permissao !== 'granted') return renderizarLembretes();

    // 2. Cria a inscrição deste aparelho no serviço de push
    const reg = await navigator.serviceWorker.ready;
    const inscricao = await reg.pushManager.subscribe({
      userVisibleOnly: true, // obrigatório: todo push precisa mostrar uma notificação
      applicationServerKey: chaveEmBytes(VAPID_PUBLIC_KEY),
    });

    // 3. Salva no banco. upsert = insere, ou atualiza se o endpoint já existir
    const { endpoint, keys } = inscricao.toJSON();
    const { error } = await db
      .from('push_inscricoes')
      .upsert({ endpoint, p256dh: keys.p256dh, auth: keys.auth }, { onConflict: 'endpoint' });
    if (error) throw error;
  } catch (erro) {
    avisar(erro);
  }
  renderizarLembretes();
}

// silencioso = true quando chamado pelo "Sair" (sem pergunta nem re-render)
async function desativarLembretes(silencioso) {
  try {
    const inscricao = await inscricaoAtual();
    if (!inscricao) return;
    if (!silencioso && !confirm('Parar de receber lembretes neste aparelho?')) return;
    await db.from('push_inscricoes').delete().eq('endpoint', inscricao.endpoint);
    await inscricao.unsubscribe();
  } catch (erro) {
    if (!silencioso) avisar(erro);
  }
  if (!silencioso) renderizarLembretes();
}

// Pede ao servidor para mandar uma notificação de teste agora
async function enviarTeste() {
  const { error } = await db.functions.invoke('enviar-lembretes', { body: { teste: true } });
  if (error) avisar('O teste falhou. A função do servidor já foi publicada? (' + error.message + ')');
}

// Ao tocar numa notificação com o app já aberto, o service worker avisa aqui:
// vamos para a tela Hoje, no dia de hoje, com dados atualizados.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.tipo !== 'abrir-hoje') return;
    diaSelecionado = hojeZero();
    document.querySelector('nav button[data-tela="tela-hoje"]').click();
    carregarTudo();
  });
}

// =====================================================================
// PWA: registra o service worker (permite instalar e abrir offline)
// =====================================================================
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}
