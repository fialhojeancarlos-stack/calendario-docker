import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { MOCK_PROJECTS, generateMockIssues } from './src/data/mockJiraData.js';
import {
  getSupabaseConfig,
  getSupabaseServerClient,
  updateSupabaseConfig,
  syncIssuesToSupabase,
  fetchIssuesFromSupabase,
  fetchProjectsFromSupabase,
  syncUnscheduledEpicsToSupabase,
  fetchUnscheduledEpicsFromSupabase,
  SUPABASE_SQL_SCHEMA,
  SUPABASE_USERS_PERMISSIONS_SQL,
  fetchCalendarUsersFromSupabase,
  createCalendarUserInSupabase,
  updateCalendarUserPermissionsInSupabase,
  lastSupabaseFetchError,
} from './src/services/supabaseService.js';
import { resolveEpicSprintsFromStories } from './src/services/epicSprintResolverService.js';


dotenv.config();
updateSupabaseConfig();

const app = express();
app.use(express.json());

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

// Healthcheck endpoints for EasyPanel / Docker container health checks
app.get('/health', (req, res) => res.status(200).json({ status: 'ok', uptime: process.uptime() }));
app.get('/api/health', (req, res) => res.status(200).json({ status: 'ok', uptime: process.uptime() }));

// Configuration State (Strictly loaded from .env)
let fieldOverrides = {
  dueDateFieldId: process.env.JIRA_DUE_DATE_FIELD_ID || 'customfield_10224',
  sprintFieldId: process.env.JIRA_SPRINT_FIELD_ID || 'customfield_10020',
  clientFieldId: process.env.JIRA_CLIENT_FIELD_ID || null as string | null,
};

function getJiraConfig() {
  return {
    baseUrl: (process.env.JIRA_BASE_URL || 'https://aztecnologia.atlassian.net').replace(/\/$/, ''),
    email: process.env.JIRA_EMAIL || '',
    apiToken: process.env.JIRA_API_TOKEN || '',
    dueDateFieldId: fieldOverrides.dueDateFieldId,
    sprintFieldId: fieldOverrides.sprintFieldId,
    clientFieldId: fieldOverrides.clientFieldId,
  };
}

// Helper: check if configured in .env
function isJiraConfigured() {
  const config = getJiraConfig();
  return Boolean(config.baseUrl && config.email && config.apiToken);
}

// Helper: parse single or multi-valued Jira Client field
function parseClientValue(cRaw: any): string {
  if (!cRaw) return '';
  if (typeof cRaw === 'string') return cRaw.trim();
  if (typeof cRaw === 'object' && !Array.isArray(cRaw)) {
    if (cRaw.value) return String(cRaw.value).trim();
    if (cRaw.name) return String(cRaw.name).trim();
    return '';
  }
  if (Array.isArray(cRaw)) {
    const names = cRaw
      .map((item) => {
        if (typeof item === 'string') return item.trim();
        if (typeof item === 'object' && item !== null) {
          return String(item.value || item.name || '').trim();
        }
        return '';
      })
      .filter(Boolean);
    const uniqueNames = Array.from(new Set(names));
    return uniqueNames.join(', ');
  }
  return '';
}

// In-Memory Issues & Projects Cache
// When Jira is configured, start clean without fictitious mock data
let cachedIssues: any[] = isJiraConfigured() ? [] : generateMockIssues(new Date());
let cachedProjects: any[] = isJiraConfigured() ? [] : [];
let lastSyncTimestamp: string | null = new Date().toISOString();
let lastSyncStatus: 'success' | 'partial' | 'error' = 'success';
let lastSyncMessage: string | null = null;

// Mock Generator for Unscheduled Epics & Improvements (Demo Mode)
function generateMockUnscheduledEpics(): any[] {
  return [
    {
      issue_key: 'PAT30-801',
      summary: 'Migração da Infraestrutura Cloud do Módulo de Tombamento e Baixa',
      issue_type: 'Épico',
      status: 'Em Andamento',
      status_category: 'In Progress',
      assignee_name: 'Ana Paula Silva',
      assignee_avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&auto=format&fit=crop&q=80',
      project_key: 'PAT30',
      project_name: 'Patrimônio Mobiliário',
      client: 'Prefeitura de Curitiba',
      created_at_jira: '2026-01-15',
      due_date: '',
      url: 'https://aztecnologia.atlassian.net/browse/PAT30-801',
      synced_at: new Date().toISOString(),
    },
    {
      issue_key: 'ADM-405',
      summary: 'Otimização de Performance da Busca Global com Indexação Elástica',
      issue_type: 'Solicitação de Melhoria',
      status: 'A Fazer',
      status_category: 'To Do',
      assignee_name: 'Carlos Eduardo Santos',
      project_key: 'ADM',
      project_name: 'Administração Geral',
      client: 'Governo do Estado',
      created_at_jira: '2026-02-01',
      due_date: '',
      url: 'https://aztecnologia.atlassian.net/browse/ADM-405',
      synced_at: new Date().toISOString(),
    },
    {
      issue_key: 'RH-210',
      summary: 'Implementação do Portal do Colaborador e Avaliação de Desempenho 2026',
      issue_type: 'Épico',
      status: 'Em Análise',
      status_category: 'In Progress',
      assignee_name: 'Mariana Oliveira',
      project_key: 'RH',
      project_name: 'Gestão de Pessoas',
      client: 'TJ-SP',
      created_at_jira: '2026-02-10',
      due_date: '',
      url: 'https://aztecnologia.atlassian.net/browse/RH-210',
      synced_at: new Date().toISOString(),
    },
    {
      issue_key: 'OBR-109',
      summary: 'Exportação em Lote e Assinatura Digital de Relatórios Fiscais',
      issue_type: 'Solicitação de Melhoria',
      status: 'Refinamento',
      status_category: 'To Do',
      assignee_name: 'Lucas Mendes',
      project_key: 'OBR',
      project_name: 'Obras & Contratos',
      client: 'Prefeitura de Joinville',
      created_at_jira: '2026-03-05',
      due_date: '',
      url: 'https://aztecnologia.atlassian.net/browse/OBR-109',
      synced_at: new Date().toISOString(),
    },
    {
      issue_key: 'PAT30-912',
      summary: 'Integração Nativa com Colectores de Dados RFID e Leitores de Código de Barras',
      issue_type: 'Épico',
      status: 'Em Andamento',
      status_category: 'In Progress',
      assignee_name: 'Fernanda Costa',
      project_key: 'PAT30',
      project_name: 'Patrimônio Mobiliário',
      client: 'Prefeitura de Curitiba',
      created_at_jira: '2026-03-12',
      due_date: '',
      url: 'https://aztecnologia.atlassian.net/browse/PAT30-912',
      synced_at: new Date().toISOString(),
    },
  ];
}

let cachedUnscheduledIssues: any[] = isJiraConfigured() ? [] : generateMockUnscheduledEpics();
let lastUnscheduledSyncTimestamp: string | null = isJiraConfigured() ? null : new Date().toISOString();

async function performUnscheduledEpicsSync(): Promise<{ issues: any[]; warning?: string }> {
  if (!isJiraConfigured()) {
    cachedUnscheduledIssues = generateMockUnscheduledEpics();
    lastUnscheduledSyncTimestamp = new Date().toISOString();
    await syncUnscheduledEpicsToSupabase(cachedUnscheduledIssues);
    return { issues: cachedUnscheduledIssues };
  }

  const jiraConfig = getJiraConfig();
  const authHeader = `Basic ${Buffer.from(`${jiraConfig.email}:${jiraConfig.apiToken}`).toString('base64')}`;

  const dueDateField = jiraConfig.dueDateFieldId || 'customfield_10224';
  const clientField = jiraConfig.clientFieldId;

  const dueJqlField = dueDateField.startsWith('customfield_')
    ? `cf[${dueDateField.replace('customfield_', '')}]`
    : dueDateField;

  const projectsList = `(eFornecedor,"Compras Preparação", "Patrimônio Imobiliário", "SIGA - Ata Registro de Preços", Almoxarifado, "Novo Contratos", Flowbee, "Catálogo de Materiais e Serviços", "Patrimônio Mobiliário", "Compra Direta", "SIGA - Execução de Licitações", "Plano de Compras", Credenciamento, Arquitetura, "Gerador de Relatório", "Patrimônio Intangível", Setup, SIGABI, Contratos, FlyEditor, "Intenção de registro de preços", "UX/UI Design", "Solicitação de Compras")`;

  const statusExclude = `status NOT IN (Finalizado, Cancelado, Cancelled, "Cancelar Chamado", Concluído, Encerrado)`;

  // Exact user JQL query
  const primaryJql = `projectType= software and project in ${projectsList} and "Previsão de Entrega[Date]" IS null and issuetype IN (Épico, "Solicitação de Melhoria") AND ${statusExclude}`;
  const fallbackJql = `projectType = software AND project in ${projectsList} AND ${dueJqlField} IS null AND issuetype IN (Épico, "Solicitação de Melhoria", Epic, Improvement) AND ${statusExclude}`;

  const fieldsToFetch = [
    'summary',
    'status',
    'assignee',
    'issuetype',
    'project',
    'created',
    dueDateField,
  ];
  if (clientField) fieldsToFetch.push(clientField);

  // Helper for backoff & retry
  const fetchWithRetry = async (url: string, options: any, attempt = 0): Promise<Response> => {
    const response = await fetch(url, options);
    if ((response.status === 429 || response.status === 503) && attempt < 5) {
      const retryAfter = response.headers.get('Retry-After');
      let delayMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : Math.pow(2, attempt) * 1000;
      if (isNaN(delayMs)) delayMs = 1000;
      delayMs += Math.random() * 500;
      await new Promise((r) => setTimeout(r, delayMs));
      return fetchWithRetry(url, options, attempt + 1);
    }
    return response;
  };

  // Determine which JQL string to use by testing first request
  let jqlToUse = primaryJql;
  try {
    const testRes = await fetchWithRetry(`${jiraConfig.baseUrl}/rest/api/3/search/jql`, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jql: primaryJql,
        maxResults: 10,
        fields: ['summary'],
      }),
    });

    if (!testRes.ok) {
      console.warn('[UnscheduledEpicsSync] Primary JQL returned status ' + testRes.status + ', using fallback JQL.');
      jqlToUse = fallbackJql;
    }
  } catch (e: any) {
    console.warn('[UnscheduledEpicsSync] Failed testing primary JQL, using fallback JQL:', e.message);
    jqlToUse = fallbackJql;
  }

  let pagesFetched = 0;
  let issuesFetched = 0;
  let isLast = false;
  let nextPageToken: string | null = null;
  const fetchedIssuesRaw: any[] = [];

  // Loop through ALL pages to fetch all issues matching the filter
  while (!isLast && pagesFetched < 300) {
    if (pagesFetched > 0) {
      await new Promise((r) => setTimeout(r, 150));
    }

    pagesFetched++;

    const postUrl = `${jiraConfig.baseUrl}/rest/api/3/search/jql`;
    const postBody: any = {
      jql: jqlToUse,
      maxResults: 100,
      fields: fieldsToFetch,
    };
    if (nextPageToken) postBody.nextPageToken = nextPageToken;

    let response = await fetchWithRetry(postUrl, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(postBody),
    });

    let pageIssues: any[] = [];

    // Fallback to GET /rest/api/3/search if POST endpoint returns 404 or 405
    if (!response.ok && (response.status === 404 || response.status === 405)) {
      const startAt = (pagesFetched - 1) * 100;
      const getUrl = `${jiraConfig.baseUrl}/rest/api/3/search?jql=${encodeURIComponent(
        jqlToUse
      )}&startAt=${startAt}&maxResults=100&fields=${fieldsToFetch.join(',')}`;

      response = await fetchWithRetry(getUrl, {
        method: 'GET',
        headers: { Authorization: authHeader, Accept: 'application/json' },
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Erro na busca do Jira (${response.status}): ${errText}`);
      }

      const data = await response.json();
      pageIssues = data.issues || [];
      issuesFetched += pageIssues.length;
      fetchedIssuesRaw.push(...pageIssues);

      if (startAt + pageIssues.length >= (data.total || 0) || pageIssues.length === 0) {
        isLast = true;
      }
    } else {
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Erro na busca do Jira (${response.status}): ${errText}`);
      }

      const data = await response.json();
      pageIssues = data.issues || [];
      issuesFetched += pageIssues.length;
      fetchedIssuesRaw.push(...pageIssues);

      nextPageToken = data.nextPageToken || null;
      isLast = data.isLast === true || !nextPageToken || pageIssues.length === 0;
    }
  }

  const formatted = fetchedIssuesRaw
    .map((item: any) => {
      const f = item.fields || {};
      const p = f.project || {};

      const clientVal = clientField && f[clientField] ? parseClientValue(f[clientField]) : '';

      const assignee = f.assignee;
      const createdAtRaw = f.created ? String(f.created).split('T')[0] : '';

      return {
        issue_key: item.key,
        issue_id: item.id,
        summary: f.summary || '',
        issue_type: f.issuetype?.name || 'Épico',
        status: f.status?.name || 'A Fazer',
        status_category: f.status?.statusCategory?.name || 'To Do',
        assignee_name: assignee ? assignee.displayName : undefined,
        assignee_avatar: assignee?.avatarUrls ? assignee.avatarUrls['32x32'] : undefined,
        project_key: p.key || '',
        project_name: p.name || '',
        client: clientVal || undefined,
        created_at_jira: createdAtRaw,
        due_date: '',
        url: `${jiraConfig.baseUrl}/browse/${item.key}`,
        synced_at: new Date().toISOString(),
      };
    })
    .filter(Boolean);

  cachedUnscheduledIssues = formatted;
  lastUnscheduledSyncTimestamp = new Date().toISOString();

  // Save/upsert directly to Supabase DB using issue_key
  await syncUnscheduledEpicsToSupabase(formatted);

  return { issues: cachedUnscheduledIssues };
}

// ---------------- API ENDPOINTS ----------------

// GET /api/jira/config
app.get('/api/jira/config', (req, res) => {
  const config = getJiraConfig();
  res.json({
    baseUrl: config.baseUrl,
    email: config.email ? `${config.email.substring(0, 3)}***@***` : '',
    hasToken: Boolean(config.apiToken),
    isConfigured: isJiraConfigured(),
    dueDateFieldId: config.dueDateFieldId,
    sprintFieldId: config.sprintFieldId,
    clientFieldId: config.clientFieldId,
    isDemoMode: !isJiraConfigured(),
    lastSyncTimestamp,
    lastSyncStatus,
    lastSyncMessage,
  });
});

// POST /api/jira/config
app.post('/api/jira/config', (req, res) => {
  return res.status(400).json({
    error: 'As credenciais são gerenciadas exclusivamente através do arquivo .env. Modifique o arquivo .env no servidor para alterar e-mail ou API Token.',
  });
});

// GET /api/supabase/status
app.get('/api/supabase/status', async (req, res) => {
  const config = getSupabaseConfig();
  let issueCount = 0;
  if (config.isConnected) {
    const persisted = await fetchIssuesFromSupabase();
    issueCount = persisted.length;
  }

  res.json({
    ...config,
    cutoffDate: '2026-07-01',
    persistedIssueCount: issueCount,
    sqlSchema: SUPABASE_SQL_SCHEMA,
  });
});

// POST /api/supabase/config
app.post('/api/supabase/config', (req, res) => {
  return res.status(400).json({
    error: 'As credenciais do Supabase são gerenciadas exclusivamente através do arquivo .env. Modifique SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.',
  });
});

// In-Memory User Permissions Storage (Fallback when Supabase DB tables aren't present yet)
let inMemoryUsers = [
  {
    id: 'usr-admin-01',
    nome: 'Jean Silva (Administrador)',
    email: 'jean.silva@azi.com.br',
    perfil: 'ADMINISTRADOR',
    status: 'ATIVO',
    created_at: '2026-01-10T08:00:00Z',
    updated_at: '2026-08-14T10:00:00Z',
    escopos: ['menu_dashboard', 'menu_eventos', 'menu_relatorios', 'menu_configuracoes'],
  },
  {
    id: 'usr-andre-05',
    nome: 'André Colombo',
    email: 'andre.colombo@azi.com.br',
    perfil: 'VISUALIZADOR',
    status: 'ATIVO',
    created_at: '2026-08-14T10:00:00Z',
    updated_at: '2026-08-14T10:00:00Z',
    escopos: ['menu_dashboard'],
  },
];

// GET /api/users - List all users and permissions
app.get('/api/users', async (req, res) => {
  try {
    const supabaseUsers = await fetchCalendarUsersFromSupabase();
    if (supabaseUsers !== null) {
      if (supabaseUsers.length === 0) {
        // Table exists in Supabase DB but is currently empty - auto populate initial admin
        const initialAdmin = {
          nome: 'Jean Silva (Administrador)',
          email: 'jean.silva@azi.com.br',
          perfil: 'ADMINISTRADOR' as const,
          escopos: ['menu_dashboard', 'menu_eventos', 'menu_relatorios', 'menu_configuracoes'],
        };
        await createCalendarUserInSupabase(initialAdmin);
        const reFetched = await fetchCalendarUsersFromSupabase();
        return res.json({ users: reFetched || [], source: 'supabase' });
      }
      return res.json({ users: supabaseUsers, source: 'supabase' });
    }
  } catch (err: any) {
    console.warn('[Server] Supabase users check failed, returning memory list:', err.message);
  }

  res.json({
    users: inMemoryUsers,
    source: 'local',
    warning: lastSupabaseFetchError
      ? `Supabase DB não conectado (${lastSupabaseFetchError}). Verifique SUPABASE_URL e SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY no EasyPanel.`
      : 'Supabase DB não conectado ou tabela TB.CALENDARIO_USUARIOS indisponível. Verifique se as variáveis SUPABASE_URL e SUPABASE_ANON_KEY (ou SUPABASE_SERVICE_ROLE_KEY) estão configuradas no EasyPanel.',
  });
});

// POST /api/users/sync-profile - Sync and register logged-in user profile
app.post('/api/users/sync-profile', async (req, res) => {
  const { id, email, nome } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'E-mail é obrigatório.' });
  }

  const cleanEmail = String(email).toLowerCase().trim();
  const isJeanSilva = cleanEmail.includes('jean.silva');

  // Check Supabase DB first
  try {
    const supabaseUsers = await fetchCalendarUsersFromSupabase();
    if (supabaseUsers && supabaseUsers.length > 0) {
      const found = supabaseUsers.find((u) => u.email.toLowerCase() === cleanEmail || (id && u.id === id));
      if (found) {
        // If frontend provided a real non-fictitious ID and found currently has a fictitious ID, migrate DB record
        if (id && (found.id.startsWith('usr-admin-') || found.id.startsWith('usr-andre-') || found.id.startsWith('usr-auto-'))) {
          found.id = String(id);
          createCalendarUserInSupabase(found).catch(() => {});
        }
        return res.json({ success: true, user: found, source: 'supabase' });
      }
    }
  } catch (e: any) {
    console.warn('[Server] Supabase user lookup skipped:', e.message);
  }

  // Check in-memory list
  const foundInMemory = inMemoryUsers.find((u) => u.email.toLowerCase() === cleanEmail || (id && u.id === id));
  if (foundInMemory) {
    if (id && (foundInMemory.id.startsWith('usr-admin-') || foundInMemory.id.startsWith('usr-andre-'))) {
      foundInMemory.id = String(id);
    }
    return res.json({ success: true, user: foundInMemory, source: 'memory' });
  }

  // Create auto-registered user if not exists
  const role: 'ADMINISTRADOR' | 'GESTOR' | 'VISUALIZADOR' = isJeanSilva ? 'ADMINISTRADOR' : 'VISUALIZADOR';
  const scopes = role === 'ADMINISTRADOR'
    ? ['menu_dashboard', 'menu_eventos', 'menu_relatorios', 'menu_configuracoes']
    : ['menu_dashboard'];

  const userName = nome || cleanEmail.split('@')[0].replace('.', ' ');
  const userId = id || `usr-${Date.now()}`;

  const newUser = {
    id: userId,
    nome: userName,
    email: cleanEmail,
    perfil: role,
    status: 'ATIVO',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    escopos: scopes,
  };

  inMemoryUsers.push(newUser);

  try {
    await createCalendarUserInSupabase(newUser);
  } catch (e: any) {
    console.warn('[Server] Auto create user in Supabase skipped:', e.message);
  }

  return res.json({ success: true, user: newUser, source: 'created' });
});

// GET /api/users/sql-scripts - Get SQL scripts for Supabase migration
app.get('/api/users/sql-scripts', (req, res) => {
  res.json({ sql: SUPABASE_USERS_PERMISSIONS_SQL });
});

// PUT /api/users/:id/permissions - Update user role & scopes
app.put('/api/users/:id/permissions', async (req, res) => {
  const { id } = req.params;
  const { perfil, escopos, email } = req.body;

  if (!perfil || !['ADMINISTRADOR', 'GESTOR', 'VISUALIZADOR'].includes(perfil)) {
    return res.status(400).json({ error: 'Perfil inválido. Use ADMINISTRADOR, GESTOR ou VISUALIZADOR.' });
  }

  const sanitizedScopes = perfil === 'ADMINISTRADOR'
    ? ['menu_dashboard', 'menu_eventos', 'menu_relatorios', 'menu_configuracoes']
    : (Array.isArray(escopos) ? escopos : []);

  // Try Supabase update first
  let updatedInSupabase = false;
  try {
    updatedInSupabase = await updateCalendarUserPermissionsInSupabase(id, perfil, sanitizedScopes, email);
  } catch (e: any) {
    console.warn('[Server] Supabase user permissions update skipped:', e.message);
  }

  // Always update in-memory cache as well
  const cleanEmail = email ? String(email).toLowerCase().trim() : '';
  const idx = inMemoryUsers.findIndex((u) => u.id === id || (cleanEmail && u.email.toLowerCase() === cleanEmail));
  if (idx !== -1) {
    inMemoryUsers[idx] = {
      ...inMemoryUsers[idx],
      perfil,
      escopos: sanitizedScopes,
      updated_at: new Date().toISOString(),
    };
  }

  return res.json({
    success: true,
    message: 'Permissões do usuário atualizadas com sucesso!',
    updatedInSupabase,
    user: idx !== -1 ? inMemoryUsers[idx] : { id, perfil, escopos: sanitizedScopes },
  });
});

// POST /api/users - Add or update a user
app.post('/api/users', async (req, res) => {
  const { id, nome, email, perfil, escopos } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'E-mail é obrigatório.' });
  }

  const cleanEmail = String(email).toLowerCase().trim();
  const isJeanSilva = cleanEmail.includes('jean.silva');

  const role = isJeanSilva
    ? 'ADMINISTRADOR'
    : (['ADMINISTRADOR', 'GESTOR', 'VISUALIZADOR'].includes(perfil) ? perfil : 'VISUALIZADOR');

  const initialScopes = role === 'ADMINISTRADOR'
    ? ['menu_dashboard', 'menu_eventos', 'menu_relatorios', 'menu_configuracoes']
    : (Array.isArray(escopos) ? escopos : ['menu_dashboard']);

  const userName = nome || cleanEmail.split('@')[0].replace('.', ' ');
  const userId = id || `usr-${Date.now()}`;

  const newUser = {
    id: userId,
    nome: userName,
    email: cleanEmail,
    perfil: role,
    status: 'ATIVO',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    escopos: initialScopes,
  };

  const existingIdx = inMemoryUsers.findIndex((u) => u.email.toLowerCase() === cleanEmail || u.id === userId);
  if (existingIdx !== -1) {
    inMemoryUsers[existingIdx] = { ...inMemoryUsers[existingIdx], ...newUser };
  } else {
    inMemoryUsers.push(newUser);
  }

  let createdInSupabase = false;
  try {
    createdInSupabase = await createCalendarUserInSupabase(newUser);
  } catch (e: any) {
    console.warn('[Server] Supabase user creation skipped:', e.message);
  }

  return res.status(201).json({
    success: true,
    message: 'Usuário cadastrado/atualizado com sucesso!',
    createdInSupabase,
    user: newUser,
  });
});


// GET /api/jira/projects
app.get('/api/jira/projects', async (req, res) => {
  const projectsSet = new Set<string>();

  // 1. Collect from memory cached issues
  cachedIssues.forEach((issue) => {
    if (issue.project_name && typeof issue.project_name === 'string') {
      const trimmed = issue.project_name.trim();
      if (trimmed) projectsSet.add(trimmed);
    }
  });

  // 2. Collect from Supabase DB jira_issues table
  try {
    const dbProjects = await fetchProjectsFromSupabase();
    dbProjects.forEach((p) => {
      if (p) projectsSet.add(p.trim());
    });
  } catch (e: any) {
    console.warn('[Server] Aviso ao buscar projetos do Supabase:', e.message);
  }

  // Fallback required list if DB/cache is completely empty
  if (projectsSet.size === 0) {
    const defaultRequired = [
      'eFornecedor',
      'Compras Preparação',
      'Patrimônio Imobiliário',
      'SIGA - Ata Registro de Preços',
      'Almoxarifado',
      'Novo Contratos',
      'Flowbee',
      'Catálogo de Materiais e Serviços',
      'Patrimônio Mobiliário',
      'Compra Direta',
      'SIGA - Execução de Licitações',
      'Plano de Compras',
      'Credenciamento',
      'Arquitetura',
      'Gerador de Relatório',
      'Patrimônio Intangível',
      'Setup',
      'SIGABI',
      'Contratos',
      'FlyEditor',
      'Intenção de registro de preços',
      'UX/UI Design',
      'Solicitação de Compras',
    ];
    defaultRequired.forEach((name) => projectsSet.add(name));
  }

  const projects = Array.from(projectsSet)
    .map((name) => ({ key: name, name, active: true }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  res.json({ projects });
});

// GET /api/jira/issues
app.get('/api/jira/issues', (req, res) => {
  const { start, end, projects } = req.query;

  let filtered = cachedIssues;
  if (start && end) {
    filtered = cachedIssues.filter((issue) => {
      if (!issue.due_date) return false;
      return issue.due_date >= String(start) && issue.due_date <= String(end);
    });
  }

  if (projects) {
    const selectedProjects = String(projects).split(',').map((s) => s.trim()).filter(Boolean);
    if (selectedProjects.length > 0) {
      filtered = filtered.filter((issue) => {
        const projName = (issue.project_name || '').trim();
        const projKey = (issue.project_key || '').trim();
        const issueKey = (issue.issue_key || '').trim();
        return selectedProjects.some((sel) => {
          const selClean = sel.trim();
          if (selClean === projName || selClean === projKey) return true;
          const selLower = selClean.toLowerCase();
          const nameLower = projName.toLowerCase();
          const keyLower = projKey.toLowerCase();
          if (nameLower === selLower || keyLower === selLower) return true;
          if (nameLower.includes(selLower) || selLower.includes(nameLower)) return true;
          if (keyLower.includes(selLower) || selLower.includes(keyLower)) return true;
          if (issueKey.toLowerCase().startsWith(selLower)) return true;
          if (selLower.includes('novo contrato') || selLower.includes('novos contratos')) {
            if (keyLower === 'ncon' || issueKey.toLowerCase().startsWith('ncon-')) return true;
          }
          return false;
        });
      });
    }
  }

  res.json({
    issues: filtered,
    lastSyncTimestamp,
    lastSyncStatus,
    isDemoMode: !isJiraConfigured(),
  });
});

// POST /api/jira/discover-fields
app.post('/api/jira/discover-fields', async (req, res) => {
  if (!isJiraConfigured()) {
    return res.status(400).json({ error: 'Configurar JIRA_EMAIL e JIRA_API_TOKEN no arquivo .env do servidor.' });
  }

  try {
    const jiraConfig = getJiraConfig();
    const authHeader = `Basic ${Buffer.from(`${jiraConfig.email}:${jiraConfig.apiToken}`).toString('base64')}`;
    const response = await fetch(`${jiraConfig.baseUrl}/rest/api/3/field`, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Erro Jira API (${response.status}): ${errText}`);
    }

    const fields = (await response.json()) as any[];
    let discoveredSprint = jiraConfig.sprintFieldId;
    let discoveredClient = jiraConfig.clientFieldId;
    let discoveredDueDate = jiraConfig.dueDateFieldId;

    if (Array.isArray(fields)) {
      for (const f of fields) {
        const nameLower = (f.name || '').toLowerCase();
        if (nameLower === 'sprint' || nameLower.includes('sprint')) {
          discoveredSprint = f.id;
        }
        if (nameLower === 'cliente' || nameLower.includes('cliente') || nameLower === 'client') {
          discoveredClient = f.id;
        }
        if (nameLower.includes('data prevista') || nameLower.includes('previsão de entrega')) {
          discoveredDueDate = f.id;
        }
      }
    }

    fieldOverrides.sprintFieldId = discoveredSprint;
    if (discoveredClient) fieldOverrides.clientFieldId = discoveredClient;
    fieldOverrides.dueDateFieldId = discoveredDueDate;

    res.json({
      success: true,
      mappings: {
        due_date: fieldOverrides.dueDateFieldId,
        sprint: fieldOverrides.sprintFieldId,
        client: fieldOverrides.clientFieldId,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Erro na descoberta de campos.' });
  }
});

// POST /api/jira/sync (Main sync proxy with Jira REST API v3)
app.post('/api/jira/sync', async (req, res) => {
  const { rangeStart, rangeEnd, projectKeys = [], forceRefresh } = req.body;

  if (!rangeStart || !rangeEnd) {
    return res.status(400).json({ error: 'Parâmetros rangeStart e rangeEnd são obrigatórios.' });
  }

  // If Jira is not configured with email + token, use mock generator or return cached mock
  if (!isJiraConfigured()) {
    // Generate/refresh mock issues for requested date range
    cachedIssues = generateMockIssues(new Date(rangeStart));
    lastSyncTimestamp = new Date().toISOString();
    lastSyncStatus = 'success';
    lastSyncMessage = 'Demonstração ativa (configure credenciais no arquivo .env).';

    return res.json({
      success: true,
      isDemoMode: true,
      issuesFetched: cachedIssues.length,
      pagesFetched: 1,
      status: 'success',
      warning: lastSyncMessage,
      data: cachedIssues,
    });
  }

  try {
    const jiraConfig = getJiraConfig();
    const authHeader = `Basic ${Buffer.from(`${jiraConfig.email}:${jiraConfig.apiToken}`).toString('base64')}`;

    // Build JQL query: issuetype in ("Épico", "Epic", "Solicitação de melhoria", "Solicitação de Melhoria", "Improvement")
    const dueDateField = jiraConfig.dueDateFieldId || 'customfield_10224';
    const sprintField = jiraConfig.sprintFieldId || 'customfield_10020';
    const clientField = jiraConfig.clientFieldId;

    let jql = `issuetype in ("Épico", "Epic", "Solicitação de melhoria", "Solicitação de Melhoria", "Improvement") AND cf[10224] >= "${rangeStart}" AND cf[10224] <= "${rangeEnd}"`;
    if (Array.isArray(projectKeys) && projectKeys.length > 0) {
      const formatted = projectKeys.map((p) => `"${p}"`).join(',');
      jql += ` AND project in (${formatted})`;
    }
    jql += ` ORDER BY cf[10224] ASC`;

    const fieldsToFetch = [
      'summary',
      'status',
      'assignee',
      'issuetype',
      'project',
      dueDateField,
      sprintField,
    ];
    if (clientField) fieldsToFetch.push(clientField);

    let pagesFetched = 0;
    let issuesFetched = 0;
    let isLast = false;
    let nextPageToken: string | null = null;
    const fetchedIssuesRaw: any[] = [];
    const projectsMap = new Map<string, string>();

    // Helper for backoff & retry
    const fetchWithRetry = async (url: string, options: any, attempt = 0): Promise<Response> => {
      const response = await fetch(url, options);
      if ((response.status === 429 || response.status === 503) && attempt < 5) {
        const retryAfter = response.headers.get('Retry-After');
        let delayMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : Math.pow(2, attempt) * 1000;
        if (isNaN(delayMs)) delayMs = 1000;
        delayMs += Math.random() * 500; // jitter
        await new Promise((r) => setTimeout(r, delayMs));
        return fetchWithRetry(url, options, attempt + 1);
      }
      return response;
    };

    // Pagination loop
    while (!isLast && pagesFetched < 200) {
      if (pagesFetched > 0) {
        // Minimum 150ms delay between pages
        await new Promise((r) => setTimeout(r, 150));
      }

      pagesFetched++;

      // Try POST /rest/api/3/search/jql
      const postUrl = `${jiraConfig.baseUrl}/rest/api/3/search/jql`;
      const postBody: any = {
        jql,
        maxResults: 100,
        fields: fieldsToFetch,
      };
      if (nextPageToken) postBody.nextPageToken = nextPageToken;

      let response = await fetchWithRetry(postUrl, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(postBody),
      });

      let pageIssues: any[] = [];

      // Fallback to GET /rest/api/3/search if POST endpoint returns 404 or 405
      if (!response.ok && (response.status === 404 || response.status === 405)) {
        const startAt = (pagesFetched - 1) * 100;
        const getUrl = `${jiraConfig.baseUrl}/rest/api/3/search?jql=${encodeURIComponent(
          jql
        )}&startAt=${startAt}&maxResults=100&fields=${fieldsToFetch.join(',')}`;

        response = await fetchWithRetry(getUrl, {
          method: 'GET',
          headers: { Authorization: authHeader, Accept: 'application/json' },
        });

        if (!response.ok) {
          const errBody = await response.text();
          throw new Error(`Falha na API do Jira (${response.status}): ${errBody}`);
        }

        const data = await response.json();
        pageIssues = data.issues || [];
        issuesFetched += pageIssues.length;
        fetchedIssuesRaw.push(...pageIssues);

        if (startAt + pageIssues.length >= (data.total || 0) || pageIssues.length === 0) {
          isLast = true;
        }
      } else {
        if (!response.ok) {
          const errBody = await response.text();
          throw new Error(`Falha na API do Jira (${response.status}): ${errBody}`);
        }

        const data = await response.json();
        pageIssues = data.issues || [];
        issuesFetched += pageIssues.length;
        fetchedIssuesRaw.push(...pageIssues);

        nextPageToken = data.nextPageToken || null;
        isLast = data.isLast === true || !nextPageToken || pageIssues.length === 0;
      }
    }

    let warningMsg: string | undefined = undefined;
    if (pagesFetched >= 200 && !isLast) {
      warningMsg = 'Sincronização interrompida ao atingir a trava de segurança de 200 páginas.';
      lastSyncStatus = 'partial';
    } else {
      lastSyncStatus = 'success';
    }

    // Format issues
    const formatted = fetchedIssuesRaw
      .map((item) => {
        const f = item.fields || {};
        const p = f.project || {};
        if (p.key && p.name) {
          projectsMap.set(p.key, p.name);
        }

        // Extract Sprint
        let sprintName = '';
        let sprintId = '';
        const sprintRaw = f[sprintField];
        if (Array.isArray(sprintRaw) && sprintRaw.length > 0) {
          const last = sprintRaw[sprintRaw.length - 1];
          if (typeof last === 'object' && last.name) {
            sprintName = last.name;
            sprintId = String(last.id || '');
          } else if (typeof last === 'string') {
            const m = last.match(/name=([^,\]]+)/);
            sprintName = m ? m[1] : last;
          }
        }

        // Extract Client
        const clientVal = clientField && f[clientField] ? parseClientValue(f[clientField]) : '';

        const assignee = f.assignee;
        const dueDateVal = f[dueDateField] || f.duedate || '';

        return {
          issue_key: item.key,
          issue_id: item.id,
          summary: f.summary || '',
          issue_type: f.issuetype?.name || 'História',
          status: f.status?.name || 'A Fazer',
          status_category: f.status?.statusCategory?.name || 'To Do',
          assignee_name: assignee ? assignee.displayName : undefined,
          assignee_avatar: assignee?.avatarUrls ? assignee.avatarUrls['32x32'] : undefined,
          project_key: p.key || 'PAT30',
          project_name: p.name || 'Projeto Jira',
          client: clientVal || undefined,
          sprint_id: sprintId || undefined,
          sprint_name: sprintName || undefined,
          due_date: dueDateVal,
          url: `${jiraConfig.baseUrl}/browse/${item.key}`,
          synced_at: new Date().toISOString(),
        };
      })
      .filter((i) => Boolean(i.due_date));

    // Update Projects
    if (projectsMap.size > 0) {
      const newProjects: { key: string; name: string; active: boolean }[] = [];
      projectsMap.forEach((name, key) => {
        newProjects.push({ key, name, active: true });
      });
      cachedProjects = newProjects;
    }

    // Replace cached issues in the date range with the exact response from Jira
    // Purge mock issues or tickets from projects not present in the Jira query response
    if (Array.isArray(projectKeys) && projectKeys.length > 0) {
      cachedIssues = cachedIssues.filter((i) => {
        const inRange = i.due_date >= rangeStart && i.due_date <= rangeEnd;
        const isTargetProject = projectKeys.includes(i.project_key);
        // Remove old entries for this range & selected projectKeys
        return !(inRange && isTargetProject);
      });
    } else {
      // Remove ALL old cached issues in this date range
      cachedIssues = cachedIssues.filter((i) => {
        return !(i.due_date >= rangeStart && i.due_date <= rangeEnd);
      });
    }

    // Merge only the fresh formatted items returned by Jira
    const mapByKey = new Map<string, any>();
    cachedIssues.forEach((i) => mapByKey.set(i.issue_key, i));
    formatted.forEach((i) => mapByKey.set(i.issue_key, i));
    cachedIssues = Array.from(mapByKey.values());

    // If any newly synced calendar issue was in unscheduled list, purge it from unscheduled list
    formatted.forEach((i) => {
      if (i.due_date) {
        cachedUnscheduledIssues = cachedUnscheduledIssues.filter((u) => u.issue_key !== i.issue_key);
      }
    });

    // Run Service: Validate & bind Sprint for Epics without Sprint from associated Stories
    try {
      const epicResolution = await resolveEpicSprintsFromStories(
        formatted,
        jiraConfig,
        getSupabaseServerClient(),
        cachedIssues
      );
      if (epicResolution.epicsUpdatedCount > 0) {
        console.log(`[Sync] Sprints vinculadas para ${epicResolution.epicsUpdatedCount} Épico(s) através de Histórias associadas.`);
      }
    } catch (resolutionErr: any) {
      console.warn('[Sync] Aviso ao validar Sprints dos Épicos via Histórias:', resolutionErr.message);
    }

    lastSyncTimestamp = new Date().toISOString();
    lastSyncMessage = warningMsg || null;

    // Persist issues with due_date >= 01/07/2026 into Supabase
    const supabaseSync = await syncIssuesToSupabase(formatted);

    res.json({
      success: true,
      isDemoMode: false,
      issuesFetched,
      pagesFetched,
      status: lastSyncStatus,
      warning: warningMsg,
      supabaseSync,
      data: formatted,
    });
  } catch (err: any) {
    lastSyncStatus = 'error';
    lastSyncMessage = err.message || 'Erro ao comunicar com o Jira';
    res.status(500).json({ error: lastSyncMessage });
  }
});

// GET /api/jira/unscheduled-epics
app.get('/api/jira/unscheduled-epics', async (req, res) => {
  if (!isJiraConfigured()) {
    if (cachedUnscheduledIssues.length === 0) {
      // Try loading from Supabase first
      const dbIssues = await fetchUnscheduledEpicsFromSupabase();
      if (dbIssues.length > 0) {
        cachedUnscheduledIssues = dbIssues;
      } else {
        cachedUnscheduledIssues = generateMockUnscheduledEpics();
      }
      lastUnscheduledSyncTimestamp = new Date().toISOString();
    }
    return res.json({
      success: true,
      isDemoMode: true,
      data: cachedUnscheduledIssues,
      lastSyncTimestamp: lastUnscheduledSyncTimestamp,
    });
  }

  // If cache is empty, try loading from Supabase first
  if (cachedUnscheduledIssues.length === 0) {
    const dbIssues = await fetchUnscheduledEpicsFromSupabase();
    if (dbIssues.length > 0) {
      cachedUnscheduledIssues = dbIssues;
    }
  }

  // If still empty or older than 24 hours, perform sync
  const now = Date.now();
  const lastSyncTime = lastUnscheduledSyncTimestamp ? new Date(lastUnscheduledSyncTimestamp).getTime() : 0;
  const isOlderThan24h = (now - lastSyncTime) > 24 * 60 * 60 * 1000;

  if (cachedUnscheduledIssues.length === 0 || isOlderThan24h) {
    try {
      await performUnscheduledEpicsSync();
    } catch (err: any) {
      console.warn('[UnscheduledEpics] Falha na sincronização inicial automática:', err.message);
    }
  }

  res.json({
    success: true,
    isDemoMode: false,
    data: cachedUnscheduledIssues,
    lastSyncTimestamp: lastUnscheduledSyncTimestamp,
  });
});

// POST /api/jira/sync-unscheduled-epics
app.post('/api/jira/sync-unscheduled-epics', async (req, res) => {
  if (!isJiraConfigured()) {
    cachedUnscheduledIssues = generateMockUnscheduledEpics();
    lastUnscheduledSyncTimestamp = new Date().toISOString();
    return res.json({
      success: true,
      isDemoMode: true,
      data: cachedUnscheduledIssues,
      lastSyncTimestamp: lastUnscheduledSyncTimestamp,
      warning: 'Demonstração ativa (configure credenciais no arquivo .env).',
    });
  }

  try {
    const result = await performUnscheduledEpicsSync();
    res.json({
      success: true,
      isDemoMode: false,
      data: result.issues,
      lastSyncTimestamp: lastUnscheduledSyncTimestamp,
      warning: result.warning,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Erro ao sincronizar Épicos & Melhorias.' });
  }
});

// ---------------- START VITE / EXPRESS SERVER ----------------

// Serve dynamic client runtime environment configuration
app.get('/env.js', (req, res) => {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const key = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  res.type('application/javascript');
  res.send(`window.__ENV = ${JSON.stringify({
    VITE_SUPABASE_URL: url,
    VITE_SUPABASE_ANON_KEY: key,
  })};`);
});

async function startServer() {
  // Serve public directory static files (favicons, assets)
  app.use(express.static(path.join(process.cwd(), 'public')));

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Calendário de Entregas Jira] Servidor rodando em http://0.0.0.0:${PORT}`);
  });

  server.on('error', (err: any) => {
    if ((err.code === 'EACCES' || err.code === 'EADDRINUSE') && PORT !== 3000) {
      console.warn(`[Porta ${PORT} falhou (${err.code})]. Tentando porta padrão 3000...`);
      app.listen(3000, '0.0.0.0', () => {
        console.log(`[Calendário de Entregas Jira] Servidor rodando na porta de fallback http://0.0.0.0:3000`);
      });
    }
  });

  // Background load persisted issues from Supabase
  fetchIssuesFromSupabase()
    .then((persisted) => {
      if (persisted && persisted.length > 0) {
        const mapByKey = new Map<string, any>();
        cachedIssues.forEach((i) => mapByKey.set(i.issue_key, i));
        persisted.forEach((i) => mapByKey.set(i.issue_key, i));
        cachedIssues = Array.from(mapByKey.values());
        console.log(`[Supabase] ${persisted.length} chamados históricos (>= 01/07/2026) carregados do Supabase.`);
      }
    })
    .catch((e: any) => {
      console.warn('[Supabase] Não foi possível carregar chamados iniciais do Supabase:', e?.message || e);
    });

  // Background Automatic Synchronization Job (Runs every 5 minutes)
  setInterval(async () => {
    if (!isJiraConfigured()) return;
    try {
      const jiraConfig = getJiraConfig();
      console.log('[AutoSync] Iniciando sincronização automática em segundo plano com o Jira...');
      const authHeader = `Basic ${Buffer.from(`${jiraConfig.email}:${jiraConfig.apiToken}`).toString('base64')}`;
      const now = new Date();
      // Sync range: 30 days back to 60 days ahead
      const startRange = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const endRange = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const dueDateField = jiraConfig.dueDateFieldId || 'customfield_10224';
      const sprintField = jiraConfig.sprintFieldId || 'customfield_10020';
      const clientField = jiraConfig.clientFieldId;

      let jql = `issuetype in ("Épico", "Epic", "Solicitação de melhoria", "Solicitação de Melhoria", "Improvement") AND cf[10224] >= "${startRange}" AND cf[10224] <= "${endRange}" ORDER BY cf[10224] ASC`;

      const fieldsToFetch = ['summary', 'status', 'assignee', 'issuetype', 'project', dueDateField, sprintField];
      if (clientField) fieldsToFetch.push(clientField);

      const postUrl = `${jiraConfig.baseUrl}/rest/api/3/search/jql`;
      const response = await fetch(postUrl, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ jql, maxResults: 100, fields: fieldsToFetch }),
      });

      if (response.ok) {
        const data = await response.json();
        const issues = data.issues || [];
        const formatted = issues
          .map((item: any) => {
            const f = item.fields || {};
            const p = f.project || {};
            const assignee = f.assignee;
            const dueDateVal = f[dueDateField] || f.duedate || '';

            return {
              issue_key: item.key,
              issue_id: item.id,
              summary: f.summary || '',
              issue_type: f.issuetype?.name || 'História',
              status: f.status?.name || 'A Fazer',
              status_category: f.status?.statusCategory?.name || 'To Do',
              assignee_name: assignee ? assignee.displayName : undefined,
              assignee_avatar: assignee?.avatarUrls ? assignee.avatarUrls['32x32'] : undefined,
              project_key: p.key || '',
              project_name: p.name || '',
              due_date: dueDateVal,
              url: `${jiraConfig.baseUrl}/browse/${item.key}`,
              synced_at: new Date().toISOString(),
            };
          })
          .filter((i: any) => Boolean(i.due_date));

        if (formatted.length > 0) {
          const mapByKey = new Map<string, any>();
          cachedIssues.forEach((i) => mapByKey.set(i.issue_key, i));
          formatted.forEach((i: any) => mapByKey.set(i.issue_key, i));
          cachedIssues = Array.from(mapByKey.values());

          await syncIssuesToSupabase(formatted);
          lastSyncTimestamp = new Date().toISOString();
          lastSyncStatus = 'success';
          console.log(`[AutoSync] Sincronização automática concluída com sucesso (${formatted.length} chamados).`);
        }
      }
    } catch (autoErr: any) {
      console.warn('[AutoSync] Erro durante sincronização automática em segundo plano:', autoErr.message);
    }
  }, 5 * 60 * 1000); // 5 minutes
}

// POST /api/jira/resolve-epic-sprints - Dedicated service to validate and bind Sprints for Epics from associated Stories
app.post('/api/jira/resolve-epic-sprints', async (req, res) => {
  try {
    const allEpicsToValidate = [...cachedIssues, ...cachedUnscheduledIssues];
    const resolution = await resolveEpicSprintsFromStories(
      allEpicsToValidate,
      getJiraConfig(),
      getSupabaseServerClient(),
      cachedIssues
    );

    return res.json({
      success: true,
      message: resolution.epicsUpdatedCount > 0
        ? `Validação concluída: ${resolution.epicsUpdatedCount} Épico(s) vinculado(s) às Sprints de suas Histórias com sucesso!`
        : 'Validação concluída: Nenhum Épico sem Sprint com História associada pendente.',
      data: resolution,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Erro ao executar o serviço de validação de Sprints para Épicos.' });
  }
});

// GET /api/jira/issue-stories/:issueKey - Endpoint to fetch all child stories associated with an epic or improvement
app.get('/api/jira/issue-stories/:issueKey', async (req, res) => {
  const { issueKey } = req.params;
  if (!issueKey) {
    return res.status(400).json({ error: 'Parâmetro issueKey é obrigatório.' });
  }

  try {
    const supabaseClient = getSupabaseServerClient();
    let stories: any[] = [];

    // 1. If Jira API is configured, search Jira for child stories
    if (isJiraConfigured()) {
      const jiraConfig = getJiraConfig();
      const authHeader = `Basic ${Buffer.from(`${jiraConfig.email}:${jiraConfig.apiToken}`).toString('base64')}`;
      const jql = `("Epic Link" = "${issueKey}" OR parent = "${issueKey}") AND issuetype in ("História", "Historia", "Story", "User Story") ORDER BY key ASC`;

      const searchUrl = `${jiraConfig.baseUrl}/rest/api/3/search/jql`;
      let jiraRes = await fetch(searchUrl, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jql,
          maxResults: 100,
          fields: ['summary', 'status', 'issuetype', 'assignee'],
        }),
      });

      if (!jiraRes.ok && (jiraRes.status === 404 || jiraRes.status === 405)) {
        const getUrl = `${jiraConfig.baseUrl}/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=100&fields=summary,status,issuetype,assignee`;
        jiraRes = await fetch(getUrl, {
          headers: { Authorization: authHeader, Accept: 'application/json' },
        });
      }

      if (jiraRes.ok) {
        const data = await jiraRes.json();
        const rawItems = data.issues || [];
        stories = rawItems.map((item: any) => {
          const f = item.fields || {};
          return {
            issue_key: item.key,
            epic_key: issueKey,
            summary: f.summary || '',
            issue_type: f.issuetype?.name || 'História',
            status: f.status?.name || 'A Fazer',
            status_category: f.status?.statusCategory?.name || 'To Do',
            assignee_name: f.assignee?.displayName || null,
            url: `${jiraConfig.baseUrl}/browse/${item.key}`,
          };
        });

        // Save/Upsert into Supabase public.jira_issue_stories table if connected
        if (supabaseClient && stories.length > 0) {
          try {
            let storiesRecords = stories.map((s) => ({
              issue_key: s.issue_key,
              epic_key: s.epic_key,
              summary: s.summary,
              issue_type: s.issue_type,
              status: s.status,
              status_category: s.status_category,
              assignee_name: s.assignee_name,
              url: s.url,
              updated_at: new Date().toISOString(),
            }));

            let { error: upsertErr } = await supabaseClient
              .from('jira_issue_stories')
              .upsert(storiesRecords, { onConflict: 'issue_key' });

            if (upsertErr && (upsertErr.message.includes('violates not-null constraint') || upsertErr.message.includes('column "id"') || upsertErr.message.includes('column "key"'))) {
              storiesRecords = storiesRecords.map((r) => ({ id: r.issue_key, key: r.issue_key, ...r })) as any;
              const retryRes = await supabaseClient
                .from('jira_issue_stories')
                .upsert(storiesRecords, { onConflict: 'issue_key' });
              
              if (!retryRes.error) {
                upsertErr = null;
              } else {
                const keys = storiesRecords.map((r: any) => r.issue_key).filter(Boolean);
                if (keys.length > 0) {
                  await supabaseClient.from('jira_issue_stories').delete().in('issue_key', keys);
                }
                const insertRes = await supabaseClient.from('jira_issue_stories').insert(storiesRecords);
                upsertErr = insertRes.error;
              }
            }

            if (upsertErr && (upsertErr.message.includes('ON CONFLICT') || upsertErr.message.includes('unique or exclusion constraint'))) {
              const keys = storiesRecords.map((r: any) => r.issue_key).filter(Boolean);
              if (keys.length > 0) {
                await supabaseClient.from('jira_issue_stories').delete().in('issue_key', keys);
              }
              await supabaseClient.from('jira_issue_stories').insert(storiesRecords);
            }
          } catch (dbErr: any) {
            console.warn(`[Stories] Aviso ao salvar histórias no Supabase para ${issueKey}:`, dbErr.message);
          }
        }
      }
    }

    // 2. Fallback to Supabase database if stories is empty or Jira unconfigured
    if (stories.length === 0 && supabaseClient) {
      try {
        const { data: dbStories, error } = await supabaseClient
          .from('jira_issue_stories')
          .select('*')
          .eq('epic_key', issueKey)
          .order('issue_key', { ascending: true });

        if (!error && dbStories && dbStories.length > 0) {
          stories = dbStories;
        }
      } catch (dbErr: any) {
        console.warn(`[Stories] Erro ao buscar histórias no Supabase para ${issueKey}:`, dbErr.message);
      }
    }

    // 3. Demo Mode Fallback / Mock stories if still empty and in demo mode
    if (stories.length === 0 && !isJiraConfigured()) {
      stories = [
        {
          issue_key: `${issueKey}-1`,
          epic_key: issueKey,
          summary: `História 1 - Implementação e parametrização associada ao ${issueKey}`,
          issue_type: 'História',
          status: 'Finalizado',
          status_category: 'Done',
          url: `https://aztecnologia.atlassian.net/browse/${issueKey}-1`,
        },
        {
          issue_key: `${issueKey}-2`,
          epic_key: issueKey,
          summary: `História 2 - Testes homologados e validações de regras de negócio`,
          issue_type: 'História',
          status: 'Em Desenvolvimento',
          status_category: 'In Progress',
          url: `https://aztecnologia.atlassian.net/browse/${issueKey}-2`,
        },
      ];
    }

    return res.json({
      success: true,
      epic_key: issueKey,
      storiesCount: stories.length,
      stories,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Erro ao buscar histórias vinculadas.' });
  }
});

startServer();
