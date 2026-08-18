# Calendário de Entregas Jira

Aplicação web completa para visualização e acompanhamento de chamados do Jira Software posicionados em uma grade de calendário interativa baseada na data prevista de entrega (`customfield_10224`).

---

## 🚀 Arquitetura e Tecnologias

- **Front-end**: React 18, TypeScript, Vite, TailwindCSS (v4)
- **Gerenciamento de Estado**: TanStack Query (`@tanstack/react-query`)
- **Manipulação de Datas**: `date-fns` com locale `pt-BR` (semana iniciando no domingo)
- **Proxy & Integração Jira**: Node.js + Express (rodando na porta 3000) e Supabase Edge Functions em Deno
- **Banco de Dados & Cache**: PostgreSQL (Supabase) com RLS (Row Level Security) e índices otimizados

---

## 🔒 Regra de Segurança Importante

O e-mail e o API token da Atlassian **nunca são enviados para o navegador do cliente**. Toda requisição à API REST v3 do Jira é interceptada pelo proxy backend em Node.js ou pelas Edge Functions do Supabase, garantindo segurança total e contornando restrições de CORS.

---

## 📋 Passo a Passo de Configuração

### 1. Gerar API Token no Jira / Atlassian
1. Acesse [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens).
2. Clique em **Criar token de API**.
3. Atribua um nome (ex.: `Calendario-Entregas-Proxy`) e clique em **Criar**.
4. Copie o token gerado.

---

### 2. Configurar Variáveis de Ambiente Localmente
Crie um arquivo `.env` na raiz do projeto baseado no `.env.example`:

```env
# URL da sua instância do Jira
JIRA_BASE_URL="https://aztecnologia.atlassian.net"

# Credenciais de acesso
JIRA_EMAIL="seu-email@aztecnologia.com.br"
JIRA_API_TOKEN="seu_api_token_copiado"

# IDs Mapeados (Opcionais - caso queira forçar IDs customizados)
JIRA_DUE_DATE_FIELD_ID="customfield_10224"
JIRA_SPRINT_FIELD_ID="customfield_10020"
JIRA_CLIENT_FIELD_ID="customfield_10030"

# Supabase (Opcional)
SUPABASE_URL="https://seu-projeto.supabase.co"
SUPABASE_ANON_KEY="sua_anon_key"
SUPABASE_SERVICE_ROLE_KEY="sua_service_role_key"
```

---

### 3. Criar e Configurar o Projeto no Supabase

1. Acesse [supabase.com](https://supabase.com) e crie um novo projeto.
2. No painel do Supabase, navegue até **SQL Editor**.
3. Execute o script contido em `supabase/migrations/20260813000000_init_jira_delivery_calendar.sql` para criar as tabelas `projects`, `issues_cache`, `field_mapping` e `sync_log`.

---

### 4. Publicar Edge Functions no Supabase

Com o CLI do Supabase instalado:

```bash
# Login no CLI
supabase login

# Vincular ao seu projeto
supabase link --project-ref seu-project-id

# Configurar secrets na nuvem
supabase secrets set JIRA_BASE_URL="https://aztecnologia.atlassian.net"
supabase secrets set JIRA_EMAIL="seu-email@aztecnologia.com.br"
supabase secrets set JIRA_API_TOKEN="seu_api_token"

# Implantar Edge Functions
supabase functions deploy jira-sync
supabase functions deploy jira-fields
```

---

### 5. Executar o Projeto Localmente

```bash
# Instalar dependências
npm install

# Rodar em ambiente de desenvolvimento (servidor Express + Vite na porta 3000)
npm run dev
```

Acesse no navegador: `http://localhost:3000`

---

### 6. Executar via Docker Compose (produção)

Este repositório é iniciado via **Docker Compose**, não via Nixpacks.

1. Crie o arquivo `.env` na raiz (baseado no `.env.example`) com as variáveis do Jira e do Supabase.
2. Suba o serviço:

```bash
docker compose up -d --build
```

O serviço `calendario` expõe a porta `3000` e lê as variáveis de ambiente do arquivo `.env` (via `env_file`). Para configurar no EasyPanel, escolha o modo de build **Docker Compose** apontando para o `docker-compose.yml` deste repositório em vez de Nixpacks.

---

## 🛠️ Funcionalidades e Critérios Atendidos

- **Visão Inicial**: Abre diretamente na visão de **Mês** no mês corrente.
- **Filtros Combináveis**: Projeto, Cliente, Sprint e Visão (com atualização automática na URL query params e `localStorage`).
- **Nomes de Projetos**: Exibição dos projetos pelo nome amigável (ex.: `PAT30` é exibido como *Patrimônio Mobiliário*).
- **Tratamento de Overflow Dinâmico**: Células do calendário calculam a capacidade por `ResizeObserver` exibindo `+ X mais chamados`.
- **Modal de Detalhes Acessível**: Modal completo ativado por clique no dia com suporte a `Esc`, clique no backdrop, `role="dialog"` e gerenciamento de foco.
- **Resiliência a Limite de API (Rate Limit / 429)**: Requisições de paginação sequenciais com intervalo de 150ms, limite de segurança de 200 páginas e backoff exponencial.
