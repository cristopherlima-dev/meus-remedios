# 💊 Meus Remédios

PWA simples para registrar os horários em que tomo meus remédios — substitui a anotação no papel. Funciona no computador e no celular, com os dados sincronizados entre os aparelhos.

**Acesso:** https://cristopherlima-dev.github.io/meus-remedios/

## Funcionalidades

- **Hoje** — um card por remédio com status *Tomado* (com horário), *Pendente* ou *Atrasado* (passou do horário previsto). Botões **Tomei agora**, **Outro horário** e **desfazer**. Setas para navegar entre os dias e lançar registros passados.
- **Histórico** — últimos 30 dias, agrupados por dia; o que faltou aparece como "—".
- **Remédios** — cadastro com nome, período (manhã/tarde/noite), horário previsto e dose. Remédios inativos saem da tela Hoje, mas o histórico é mantido.
- **Login** com e-mail e senha; a sessão fica salva no aparelho.
- **Instalável** (PWA) no Android, iPhone e PC; abre mesmo com internet ruim.

## Tecnologias

| Parte | Tecnologia |
|---|---|
| Interface | HTML, CSS e JavaScript puro (módulos ES) |
| Banco e login | [Supabase](https://supabase.com) — PostgreSQL + Auth (plano gratuito) |
| Hospedagem | GitHub Pages |
| PWA | `manifest.json` + service worker (`sw.js`) |

## Estrutura

```
meus-remedios/
├── index.html      # estrutura das telas e modais
├── style.css       # visual (cores em :root)
├── app.js          # lógica: login, registros, histórico, cadastro
├── config.js       # URL e chave pública do Supabase
├── supabase.sql    # criação das tabelas + segurança (RLS)
├── manifest.json   # dados do app instalável
├── sw.js           # service worker (cache offline)
└── icons/          # ícones 192 e 512 px
```

## Banco de dados

- `remedios` — id, user_id, nome, periodo, horario_previsto, dose, ativo, criado_em
- `registros` — id, user_id, remedio_id, tomado_em (data/hora com fuso)

O **RLS** (Row Level Security) garante que cada usuário só leia e altere as próprias linhas. Por isso a chave pública pode ficar no código.

## Configurar do zero

1. Criar um projeto no Supabase (região São Paulo).
2. **SQL Editor** → colar e rodar o `supabase.sql`.
3. **Authentication → Users → Add user** (marcar *Auto Confirm User*).
4. **Authentication → Sign In / Providers** → desligar *Allow new users to sign up*.
5. **Project Settings → API Keys** → copiar a *Project URL* e a *Publishable key* (ou *anon*) para o `config.js`.
   ⚠️ Nunca usar a chave *secret* / *service_role*.

## Rodar localmente

O app usa `import`, então não abre com duplo clique — precisa de um servidor local:

```bash
python -m http.server 8000
```

Abrir http://localhost:8000 (ou usar a extensão **Live Server** do VS Code).

## Publicar

```bash
git push
```

O GitHub Pages publica a branch `main` automaticamente em 1–2 minutos. O service worker busca sempre a versão mais nova (`cache: 'no-cache'`), então basta fechar e reabrir o app.

## Instalar

- **Android (Chrome):** menu ⋮ → *Instalar app*
- **iPhone (Safari):** Compartilhar → *Adicionar à Tela de Início*
- **PC (Chrome/Edge):** ícone *Instalar* na barra de endereço

## Backlog

- [ ] **Lembrete no horário previsto** — notificação no celular quando passar do horário previsto sem registro (ex.: Paxtrat às 22:00). Exige Web Push: permissão de notificação, chaves VAPID e um agendador no Supabase (Edge Function + cron) para disparar o aviso.
