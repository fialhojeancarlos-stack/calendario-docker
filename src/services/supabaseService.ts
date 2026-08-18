import { createClient, SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

// Polyfill global WebSocket for Node.js environments < 22 where @supabase/supabase-js realtime expects globalThis.WebSocket
if (typeof globalThis.WebSocket === 'undefined') {
  (globalThis as any).WebSocket = WebSocket;
}

// Helper to detect if a value is a placeholder string
function isPlaceholder(value: string): boolean {
  if (!value) return true;
  const lower = value.toLowerCase().trim();
  return (
    lower === '' ||
    lower.includes('seu-projeto') ||
    lower.includes('seu_projeto') ||
    lower.includes('your-project') ||
    lower.includes('xyz.supabase.co') ||
    lower.includes('example.supabase.co') ||
    lower.includes('sua_chave') ||
    lower.includes('sua-chave') ||
    lower.includes('your_key') ||
    lower.includes('my_supabase_key') ||
    lower.includes('placeholder')
  );
}

function parseJwtRole(token: string): string | null {
  try {
    const parts = token.split('.');
    if (parts.length === 3) {
      const payloadStr = Buffer.from(parts[1], 'base64').toString('utf8');
      const payload = JSON.parse(payloadStr);
      return payload.role || null;
    }
  } catch (e) {
    // ignore
  }
  return null;
}

// Get Supabase credentials strictly from process.env (or VITE_* equivalents), stripping quotes and placeholders
function getSupabaseCredentialsFromEnv() {
  let rawUrl = (
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.REACT_APP_SUPABASE_URL ||
    ''
  ).trim();

  // Clean URL
  rawUrl = rawUrl.replace(/^["'\s\r\n]+|["'\s\r\n]+$/g, '').replace(/\/+$/, '');
  const url = isPlaceholder(rawUrl) ? '' : rawUrl;

  // Collect all candidate keys from environment variables
  const candidates = [
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.SUPABASE_ANON_KEY,
    process.env.VITE_SUPABASE_ANON_KEY,
    process.env.SUPABASE_KEY,
    process.env.SUPABASE_API_KEY,
    process.env.VITE_SUPABASE_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    process.env.REACT_APP_SUPABASE_ANON_KEY,
  ]
    .filter(Boolean)
    .map((k) => (k || '').trim().replace(/^["'\s\r\n]+|["'\s\r\n]+$/g, ''))
    .filter((k) => k.length > 0 && !isPlaceholder(k));

  // Auto-detect and prefer key with role === 'service_role' (or fallback to first candidate)
  let bestKey = candidates.find((k) => parseJwtRole(k) === 'service_role') || candidates[0] || '';

  return { url, key: bestKey };
}

let supabaseClient: SupabaseClient | null = null;
export let lastSupabaseFetchError: string | null = null;

export function getSupabaseConfig() {
  const client = initSupabaseClient();
  const { url, key } = getSupabaseCredentialsFromEnv();
  return {
    url,
    hasKey: Boolean(key),
    isConnected: Boolean(client),
    lastError: lastSupabaseFetchError,
  };
}

export function getSupabaseServerClient(): SupabaseClient | null {
  return initSupabaseClient();
}

export function updateSupabaseConfig() {
  // Credentials must be consumed exclusively from process.env
  initSupabaseClient();
}

function initSupabaseClient(): SupabaseClient | null {
  const { url, key } = getSupabaseCredentialsFromEnv();

  if (url && key) {
    try {
      let formattedUrl = url;
      if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
        formattedUrl = `https://${formattedUrl}`;
      }
      supabaseClient = createClient(formattedUrl, key, {
        auth: { persistSession: false },
      });
      console.log('[Supabase] Cliente inicializado via .env para:', formattedUrl);
      // Successful (re)initialization invalidates any previously cached error
      lastSupabaseFetchError = null;
      return supabaseClient;
    } catch (err: any) {
      console.warn('[Supabase] Aviso ao inicializar cliente via .env:', err.message);
      lastSupabaseFetchError = `Falha ao criar cliente Supabase: ${err.message}`;
      supabaseClient = null;
      return null;
    }
  } else {
    supabaseClient = null;
    lastSupabaseFetchError = !url
      ? 'SUPABASE_URL não encontrada (ou vazia/placeholder) nas variáveis de ambiente do servidor.'
      : 'Nenhuma chave válida encontrada (SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY) nas variáveis de ambiente do servidor.';
    return null;
  }
}

// Initialize on load
initSupabaseClient();


export interface JiraIssueRecord {
  issue_key: string;
  issue_id?: string;
  summary: string;
  issue_type?: string;
  status: string;
  status_category?: string;
  assignee_name?: string;
  assignee_avatar?: string;
  project_key: string;
  project_name?: string;
  client?: string;
  sprint_id?: string;
  sprint_name?: string;
  due_date: string;
  url?: string;
  synced_at?: string;
}

const CUTOFF_DATE = '2026-07-01';

/**
 * Filter issues with due_date >= 2026-07-01 and persist them to Supabase
 */
export async function syncIssuesToSupabase(issues: JiraIssueRecord[]) {
  if (!supabaseClient) {
    return {
      savedCount: 0,
      status: 'disabled',
      message: 'Supabase não configurado. Adicione SUPABASE_URL e SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY no ambiente.',
    };
  }

  // Filter issues with due_date >= 01/07/2026
  const targetIssues = issues.filter(
    (issue) => issue.due_date && issue.due_date >= CUTOFF_DATE
  );

  if (targetIssues.length === 0) {
    return {
      savedCount: 0,
      status: 'skipped',
      message: 'Nenhum chamado encontrado com previsão de entrega a partir de 01/07/2026.',
    };
  }

  try {
    const formattedRecords = targetIssues.map((issue) => ({
      issue_key: issue.issue_key,
      issue_id: issue.issue_id || null,
      summary: issue.summary,
      issue_type: issue.issue_type || 'História',
      status: issue.status,
      status_category: issue.status_category || 'To Do',
      assignee_name: issue.assignee_name || null,
      assignee_avatar: issue.assignee_avatar || null,
      project_key: issue.project_key,
      project_name: issue.project_name || null,
      client: issue.client || null,
      sprint_id: issue.sprint_id || null,
      sprint_name: issue.sprint_name || null,
      due_date: issue.due_date,
      url: issue.url || null,
      synced_at: issue.synced_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    // Helper for formatting Supabase errors
    const formatSupabaseError = (errMessage: string) => {
      const currentUrl = getSupabaseCredentialsFromEnv().url;
      if (errMessage.includes('fetch failed') || errMessage.includes('TypeError') || errMessage.includes('ENOTFOUND')) {
        return `Falha de conexão HTTP/fetch com a URL do Supabase (${currentUrl || 'URL não informada no .env'}). Verifique se o endereço do projeto Supabase está correto e acessível sem bloqueios de rede.`;
      }
      if (errMessage.includes('relation "public.jira_issues" does not exist') || errMessage.includes('jira_issues')) {
        return `A tabela 'jira_issues' não existe no banco Supabase. Execute o script de criação SQL disponível na aba de configurações.`;
      }
      if (errMessage.includes('42501') || errMessage.includes('row-level security')) {
        return `Permissão negada (RLS) no Supabase. Certifique-se de usar a SUPABASE_SERVICE_ROLE_KEY ou criar políticas de INSERT/UPDATE para a ANON_KEY.`;
      }
      return `Erro no Supabase: ${errMessage}`;
    };

    // Upsert into `jira_issues` table
    let { error: upsertErr } = await supabaseClient
      .from('jira_issues')
      .upsert(formattedRecords, { onConflict: 'issue_key' });

    if (upsertErr && (upsertErr.message.includes('violates not-null constraint') || upsertErr.message.includes('column "id"') || upsertErr.message.includes('column "key"'))) {
      console.warn('[Supabase] Coluna id/key com constraint NOT NULL detectada em jira_issues. Inserindo id/key = issue_key...');
      const recordsWithKeys = formattedRecords.map((r) => ({ id: r.issue_key, key: r.issue_key, ...r }));
      const retryRes = await supabaseClient
        .from('jira_issues')
        .upsert(recordsWithKeys, { onConflict: 'issue_key' });
      
      if (!retryRes.error) {
        upsertErr = null;
      } else {
        const keys = recordsWithKeys.map((r) => r.issue_key).filter(Boolean);
        if (keys.length > 0) {
          await supabaseClient.from('jira_issues').delete().in('issue_key', keys);
        }
        const insertRes = await supabaseClient.from('jira_issues').insert(recordsWithKeys);
        if (!insertRes.error) {
          upsertErr = null;
        } else {
          if (insertRes.error.message.includes("Could not find the 'key' column")) {
            const recordsOnlyId = formattedRecords.map((r) => ({ id: r.issue_key, ...r }));
            await supabaseClient.from('jira_issues').delete().in('issue_key', keys);
            const retryOnlyId = await supabaseClient.from('jira_issues').insert(recordsOnlyId);
            upsertErr = retryOnlyId.error;
          } else if (insertRes.error.message.includes("Could not find the 'id' column")) {
            const recordsOnlyKey = formattedRecords.map((r) => ({ key: r.issue_key, ...r }));
            await supabaseClient.from('jira_issues').delete().in('issue_key', keys);
            const retryOnlyKey = await supabaseClient.from('jira_issues').insert(recordsOnlyKey);
            upsertErr = retryOnlyKey.error;
          } else {
            upsertErr = insertRes.error;
          }
        }
      }
    }

    if (upsertErr && (upsertErr.message.includes('ON CONFLICT') || upsertErr.message.includes('unique or exclusion constraint'))) {
      console.warn('[Supabase] Constraint única ausente em jira_issues. Executando fallback de sincronização...');
      const keys = formattedRecords.map((r) => r.issue_key).filter(Boolean);
      if (keys.length > 0) {
        await supabaseClient.from('jira_issues').delete().in('issue_key', keys);
      }
      const insertRes = await supabaseClient
        .from('jira_issues')
        .insert(formattedRecords);
      upsertErr = insertRes.error;
    }

    if (upsertErr) {
      const detailed = formatSupabaseError(upsertErr.message || String(upsertErr));
      console.warn('[Supabase] Não foi possível salvar na tabela jira_issues:', detailed);
      return {
        savedCount: 0,
        status: 'error',
        message: detailed,
      };
    }

    // Insert history snapshot into `jira_issue_history` table
    const historyRecords = targetIssues.map((issue) => ({
      issue_key: issue.issue_key,
      summary: issue.summary,
      status: issue.status,
      due_date: issue.due_date,
      assignee_name: issue.assignee_name || null,
      project_key: issue.project_key,
      client: issue.client || null,
      sprint_name: issue.sprint_name || null,
      synced_at: issue.synced_at || new Date().toISOString(),
    }));

    const { error: histErr } = await supabaseClient
      .from('jira_issue_history')
      .insert(historyRecords);

    if (histErr) {
      console.warn('[Supabase] Aviso ao gravar histórico (jira_issue_history):', histErr.message);
    }

    return {
      savedCount: targetIssues.length,
      status: 'success',
      message: `${targetIssues.length} chamados (de 01/07/2026 em diante) salvos no Supabase com sucesso!`,
    };
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    const currentUrl = getSupabaseCredentialsFromEnv().url;
    let detailed = `Exceção ao sincronizar no Supabase: ${errMsg}`;
    if (errMsg.includes('fetch failed') || errMsg.includes('TypeError') || errMsg.includes('ENOTFOUND')) {
      detailed = `Falha de conexão HTTP/fetch com a URL do Supabase (${currentUrl || 'URL não informada no .env'}). Verifique se o endereço do projeto Supabase está correto e acessível sem bloqueios de rede.`;
      console.warn('[Supabase] Conexão com Supabase indisponível:', errMsg);
    } else {
      console.error('[Supabase] Exceção ao sincronizar:', errMsg);
    }
    return {
      savedCount: 0,
      status: 'error',
      message: detailed,
    };
  }
}

/**
 * Fetch persisted issues from Supabase (from 01/07/2026 onwards)
 */
export async function fetchIssuesFromSupabase(): Promise<JiraIssueRecord[]> {
  if (!supabaseClient) return [];

  try {
    const { data, error } = await supabaseClient
      .from('jira_issues')
      .select('*')
      .gte('due_date', CUTOFF_DATE)
      .order('due_date', { ascending: true });

    if (error) {
      const msg = error.message || String(error);
      if (msg.includes('fetch failed') || msg.includes('TypeError') || msg.includes('ENOTFOUND')) {
        console.warn('[Supabase] Servidor Supabase indisponível via fetch (verifique a SUPABASE_URL no .env).');
      } else {
        console.warn('[Supabase] Aviso ao buscar chamados:', msg);
      }
      return [];
    }

    return (data || []).map((row: any) => ({
      issue_key: row.issue_key,
      issue_id: row.issue_id,
      summary: row.summary,
      issue_type: row.issue_type,
      status: row.status,
      status_category: row.status_category,
      assignee_name: row.assignee_name,
      assignee_avatar: row.assignee_avatar,
      project_key: row.project_key,
      project_name: row.project_name,
      client: row.client,
      sprint_id: row.sprint_id,
      sprint_name: row.sprint_name,
      due_date: row.due_date,
      url: row.url,
      synced_at: row.synced_at,
    }));
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (msg.includes('fetch failed') || msg.includes('TypeError') || msg.includes('ENOTFOUND')) {
      console.warn('[Supabase] Conexão com Supabase indisponível via fetch.');
    } else {
      console.warn('[Supabase] Falha ao carregar registros:', msg);
    }
    return [];
  }
}

/**
 * Fetch distinct project_name values from jira_issues table in Supabase
 */
export async function fetchProjectsFromSupabase(): Promise<string[]> {
  if (!supabaseClient) return [];

  try {
    const { data, error } = await supabaseClient
      .from('jira_issues')
      .select('project_name');

    if (error || !data) {
      if (error) console.warn('[Supabase] Erro ao buscar projetos:', error.message);
      return [];
    }

    const set = new Set<string>();
    data.forEach((row: any) => {
      if (row.project_name && typeof row.project_name === 'string') {
        const trimmed = row.project_name.trim();
        if (trimmed) set.add(trimmed);
      }
    });

    return Array.from(set);
  } catch (err: any) {
    console.warn('[Supabase] Falha ao carregar lista de projetos:', err?.message || err);
    return [];
  }
}

export interface JiraUnscheduledEpicRecord {
  issue_key: string;
  issue_id?: string;
  issue_type: string;
  summary: string;
  project_key?: string;
  project_name: string;
  client?: string;
  status: string;
  status_category?: string;
  assignee_name?: string;
  assignee_avatar?: string;
  created_at_jira?: string;
  url?: string;
  synced_at?: string;
}

/**
 * Persist unscheduled epics & improvements to Supabase (jira_epics_unscheduled table) using issue_key as unique key
 */
export async function syncUnscheduledEpicsToSupabase(issues: JiraUnscheduledEpicRecord[]) {
  if (!supabaseClient) {
    return {
      savedCount: 0,
      status: 'disabled',
      message: 'Supabase não configurado no .env.',
    };
  }

  if (issues.length === 0) {
    return {
      savedCount: 0,
      status: 'skipped',
      message: 'Nenhum Épico ou Melhoria informado para sincronizar.',
    };
  }

  try {
    const formattedRecords = issues.map((issue) => ({
      issue_key: issue.issue_key,
      issue_id: issue.issue_id || null,
      issue_type: issue.issue_type || 'Épico',
      summary: issue.summary,
      project_key: issue.project_key || null,
      project_name: issue.project_name || '',
      client: issue.client || null,
      status: issue.status,
      status_category: issue.status_category || null,
      assignee_name: issue.assignee_name || null,
      assignee_avatar: issue.assignee_avatar || null,
      created_at_jira: issue.created_at_jira || null,
      url: issue.url || null,
      synced_at: issue.synced_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    // Try standard upsert with issue_key
    let { error: upsertErr } = await supabaseClient
      .from('jira_epics_unscheduled')
      .upsert(formattedRecords, { onConflict: 'issue_key' });

    // Fallback 1: If "id" or "key" column in Supabase has a NOT NULL constraint without default value, supply id and key
    if (upsertErr && (upsertErr.message.includes('violates not-null constraint') || upsertErr.message.includes('column "id"') || upsertErr.message.includes('column "key"'))) {
      console.warn('[Supabase] Constraint NOT NULL detectada em id/key. Inserindo id/key = issue_key...');
      const recordsWithKeys = formattedRecords.map((r) => ({
        id: r.issue_key,
        key: r.issue_key,
        ...r,
      }));
      
      const retryRes = await supabaseClient
        .from('jira_epics_unscheduled')
        .upsert(recordsWithKeys, { onConflict: 'issue_key' });
      
      if (!retryRes.error) {
        upsertErr = null;
      } else {
        // Try delete-then-insert with id/key
        const keys = recordsWithKeys.map((r) => r.issue_key).filter(Boolean);
        if (keys.length > 0) {
          await supabaseClient.from('jira_epics_unscheduled').delete().in('issue_key', keys);
        }
        const insertRes = await supabaseClient.from('jira_epics_unscheduled').insert(recordsWithKeys);
        if (!insertRes.error) {
          upsertErr = null;
        } else {
          // If column 'key' or 'id' doesn't exist when we supplied both, try supplying only id or only key
          if (insertRes.error.message.includes("Could not find the 'key' column")) {
            const recordsOnlyId = formattedRecords.map((r) => ({ id: r.issue_key, ...r }));
            await supabaseClient.from('jira_epics_unscheduled').delete().in('issue_key', keys);
            const retryOnlyId = await supabaseClient.from('jira_epics_unscheduled').insert(recordsOnlyId);
            upsertErr = retryOnlyId.error;
          } else if (insertRes.error.message.includes("Could not find the 'id' column")) {
            const recordsOnlyKey = formattedRecords.map((r) => ({ key: r.issue_key, ...r }));
            await supabaseClient.from('jira_epics_unscheduled').delete().in('issue_key', keys);
            const retryOnlyKey = await supabaseClient.from('jira_epics_unscheduled').insert(recordsOnlyKey);
            upsertErr = retryOnlyKey.error;
          } else {
            upsertErr = insertRes.error;
          }
        }
      }
    }

    // Fallback 2: If issue_id column is missing in schema cache or causing error, retry without issue_id
    if (upsertErr && (upsertErr.message.includes('issue_id') || upsertErr.message.includes('schema cache'))) {
      console.warn('[Supabase] Tentando sincronizar jira_epics_unscheduled sem o campo issue_id (devido à falta da coluna no Supabase)...');
      const recordsWithoutIssueId = formattedRecords.map(({ issue_id, ...rest }) => rest);
      const retryRes = await supabaseClient
        .from('jira_epics_unscheduled')
        .upsert(recordsWithoutIssueId, { onConflict: 'issue_key' });
      
      if (!retryRes.error) {
        upsertErr = null;
      } else {
        upsertErr = retryRes.error;
      }
    }

    // Fallback 3: If ON CONFLICT constraint is missing on issue_key in Supabase, do delete-then-insert
    if (upsertErr && (upsertErr.message.includes('ON CONFLICT') || upsertErr.message.includes('unique or exclusion constraint'))) {
      console.warn('[Supabase] Constraint única ausente no Supabase para jira_epics_unscheduled. Executando fallback de sincronização...');
      const keys = formattedRecords.map((r) => r.issue_key).filter(Boolean);
      if (keys.length > 0) {
        await supabaseClient.from('jira_epics_unscheduled').delete().in('issue_key', keys);
      }
      const { error: insertErr } = await supabaseClient
        .from('jira_epics_unscheduled')
        .insert(formattedRecords);

      if (!insertErr) {
        upsertErr = null;
      } else {
        upsertErr = insertErr;
      }
    }

    if (upsertErr) {
      const errMsg = upsertErr.message || String(upsertErr);
      let userFriendlyMsg = `Aviso Supabase: ${errMsg}`;
      if (errMsg.includes('issue_key') || errMsg.includes('issue_id') || errMsg.includes('column')) {
        userFriendlyMsg = `A tabela 'jira_epics_unscheduled' no Supabase está sem colunas necessárias (${errMsg}). Execute o script SQL de atualização de esquema no painel de Configurações > Supabase DB.`;
      }
      console.warn('[Supabase] Erro ao sincronizar jira_epics_unscheduled:', userFriendlyMsg);
      return {
        savedCount: 0,
        status: 'error',
        message: userFriendlyMsg,
      };
    }

    // Optional purge of deleted unscheduled items
    try {
      const currentKeys = issues.map((i) => i.issue_key);
      if (currentKeys.length > 0) {
        const { data: dbRecords } = await supabaseClient
          .from('jira_epics_unscheduled')
          .select('issue_key');

        if (dbRecords && dbRecords.length > 0) {
          const keysToRemove = dbRecords
            .map((r: any) => r.issue_key)
            .filter((k: string) => Boolean(k) && !currentKeys.includes(k));

          if (keysToRemove.length > 0) {
            await supabaseClient
              .from('jira_epics_unscheduled')
              .delete()
              .in('issue_key', keysToRemove);
          }
        }
      }
    } catch (purgeErr) {
      // Non-critical purge failure
    }

    return {
      savedCount: issues.length,
      status: 'success',
      message: `${issues.length} Épicos & Melhorias sincronizados com sucesso no Supabase!`,
    };
  } catch (err: any) {
    console.warn('[Supabase] Falha ao gravar jira_epics_unscheduled:', err.message);
    return {
      savedCount: 0,
      status: 'error',
      message: err.message,
    };
  }
}

/**
 * Fetch unscheduled epics from Supabase
 */
export async function fetchUnscheduledEpicsFromSupabase(): Promise<JiraUnscheduledEpicRecord[]> {
  if (!supabaseClient) return [];

  try {
    // Attempt 1: Standard query ordered by issue_key
    let { data, error } = await supabaseClient
      .from('jira_epics_unscheduled')
      .select('*')
      .order('issue_key', { ascending: true });

    // Fallback 1: If order('issue_key') fails because issue_key column doesn't exist, try plain select
    if (error && (error.message.includes('issue_key') || error.message.includes('does not exist'))) {
      console.warn('[Supabase] Coluna issue_key ausente ao ordenar jira_epics_unscheduled. Tentando busca simplificada sem ordenação...');
      const fallbackRes = await supabaseClient
        .from('jira_epics_unscheduled')
        .select('*');
      
      if (!fallbackRes.error && fallbackRes.data) {
        data = fallbackRes.data;
        error = null;
      }
    }

    if (error) {
      console.warn('[Supabase] Erro ao buscar jira_epics_unscheduled:', error.message);
      return [];
    }

    return (data || []).map((row: any) => {
      const key = row.issue_key || row.issue_id || row.key || row.id || '';
      return {
        issue_key: key,
        issue_id: row.issue_id || key,
        issue_type: row.issue_type || 'Épico',
        summary: row.summary || '',
        project_key: row.project_key,
        project_name: row.project_name || '',
        client: row.client,
        status: row.status || 'A Fazer',
        status_category: row.status_category,
        assignee_name: row.assignee_name,
        assignee_avatar: row.assignee_avatar,
        created_at_jira: row.created_at_jira,
        url: row.url,
        synced_at: row.synced_at,
      };
    }).filter((r) => Boolean(r.issue_key));
  } catch (err: any) {
    console.warn('[Supabase] Falha ao carregar jira_epics_unscheduled:', err.message);
    return [];
  }
}

// SQL Schema for User Management and Scope Permissions
export const SUPABASE_USERS_PERMISSIONS_SQL = `-- 1. Script A: Criação do esquema/tabela de Perfis/Usuários estendida do auth.users
CREATE TABLE IF NOT EXISTS public."TB.CALENDARIO_USUARIOS" (
    id TEXT PRIMARY KEY,
    nome VARCHAR(255),
    email VARCHAR(255),
    perfil VARCHAR(50) NOT NULL CHECK (perfil IN ('ADMINISTRADOR', 'GESTOR', 'VISUALIZADOR')) DEFAULT 'VISUALIZADOR',
    status VARCHAR(20) DEFAULT 'ATIVO',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Garantir migração do tipo de ID de UUID para TEXT para aceitar IDs do Auth e IDs de sistema
DO $$ 
BEGIN 
  -- 1. Remove FKs que bloqueiam a alteração de tipo de coluna
  ALTER TABLE public."TB.CALENDARIO_USUARIOS" DROP CONSTRAINT IF EXISTS "TB.CALENDARIO_USUARIOS_id_fkey";
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'TB.CALENDARIO_PERMISSOES_USUARIO'
  ) THEN
    ALTER TABLE public."TB.CALENDARIO_PERMISSOES_USUARIO" DROP CONSTRAINT IF EXISTS "TB.CALENDARIO_PERMISSOES_USUARIO_usuario_id_fkey";
  END IF;

  -- 2. Converte a coluna id de TB.CALENDARIO_USUARIOS para TEXT se for UUID
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'TB.CALENDARIO_USUARIOS' AND data_type = 'uuid' AND column_name = 'id'
  ) THEN 
    ALTER TABLE public."TB.CALENDARIO_USUARIOS" ALTER COLUMN id TYPE TEXT USING id::text;
  END IF;

  -- 3. Converte a coluna usuario_id de TB.CALENDARIO_PERMISSOES_USUARIO para TEXT se for UUID
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'TB.CALENDARIO_PERMISSOES_USUARIO' AND data_type = 'uuid' AND column_name = 'usuario_id'
  ) THEN 
    ALTER TABLE public."TB.CALENDARIO_PERMISSOES_USUARIO" ALTER COLUMN usuario_id TYPE TEXT USING usuario_id::text;
  END IF;

  -- 4. Re-adiciona a Foreign Key se a tabela pivot de permissões existir
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'TB.CALENDARIO_PERMISSOES_USUARIO'
  ) THEN
    -- Remove permissões órfãs (usuario_id sem linha correspondente em TB.CALENDARIO_USUARIOS)
    -- que impediriam a criação da FK abaixo
    DELETE FROM public."TB.CALENDARIO_PERMISSOES_USUARIO" p
    WHERE NOT EXISTS (
      SELECT 1 FROM public."TB.CALENDARIO_USUARIOS" u WHERE u.id = p.usuario_id
    );

    ALTER TABLE public."TB.CALENDARIO_PERMISSOES_USUARIO"
      ADD CONSTRAINT "TB.CALENDARIO_PERMISSOES_USUARIO_usuario_id_fkey"
      FOREIGN KEY (usuario_id) REFERENCES public."TB.CALENDARIO_USUARIOS"(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Garantir que todas as colunas necessárias existam caso a tabela já tenha sido criada anteriormente
ALTER TABLE public."TB.CALENDARIO_USUARIOS" ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE public."TB.CALENDARIO_USUARIOS" ADD COLUMN IF NOT EXISTS nome VARCHAR(255);
ALTER TABLE public."TB.CALENDARIO_USUARIOS" ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'ATIVO';
ALTER TABLE public."TB.CALENDARIO_USUARIOS" ADD COLUMN IF NOT EXISTS perfil VARCHAR(50) DEFAULT 'VISUALIZADOR';
ALTER TABLE public."TB.CALENDARIO_USUARIOS" ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- 2. Criação da tabela de Cadastro de Escopos (Menus do Sistema)
CREATE TABLE IF NOT EXISTS public."TB.CALENDARIO_ESCOPOS" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome_escopo VARCHAR(100) NOT NULL UNIQUE, -- Ex: 'menu_dashboard', 'menu_eventos', 'menu_relatorios', 'menu_configuracoes'
    descricao VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Popula os escopos padrão dos Menus do Sistema
INSERT INTO public."TB.CALENDARIO_ESCOPOS" (nome_escopo, descricao) VALUES
('menu_dashboard', 'Calendário - Visualização do Dashboard de Entregas'),
('menu_eventos', 'Épicos & Melhorias - Gestão de Épicos Sem Data Prevista'),
('menu_relatorios', 'Relatórios - Entregas em Lista e Exportação'),
('menu_configuracoes', 'Configurações - Gestão do Sistema, Conexões e Usuários')
ON CONFLICT (nome_escopo) DO NOTHING;

-- 3. Tabela Pivot: Associação de Usuários com Escopos
CREATE TABLE IF NOT EXISTS public."TB.CALENDARIO_PERMISSOES_USUARIO" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id TEXT NOT NULL REFERENCES public."TB.CALENDARIO_USUARIOS"(id) ON DELETE CASCADE,
    escopo_id UUID NOT NULL REFERENCES public."TB.CALENDARIO_ESCOPOS"(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_usuario_escopo UNIQUE(usuario_id, escopo_id)
);

-- Habilitar Row Level Security (RLS) para segurança no Supabase
ALTER TABLE public."TB.CALENDARIO_USUARIOS" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TB.CALENDARIO_ESCOPOS" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TB.CALENDARIO_PERMISSOES_USUARIO" ENABLE ROW LEVEL SECURITY;

-- Politicas RLS permissivas para leitura e escrita do app
DROP POLICY IF EXISTS "Permite gestao total usuarios" ON public."TB.CALENDARIO_USUARIOS";
CREATE POLICY "Permite gestao total usuarios" ON public."TB.CALENDARIO_USUARIOS" FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permite gestao total escopos" ON public."TB.CALENDARIO_ESCOPOS";
CREATE POLICY "Permite gestao total escopos" ON public."TB.CALENDARIO_ESCOPOS" FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permite gestao total permissoes" ON public."TB.CALENDARIO_PERMISSOES_USUARIO";
CREATE POLICY "Permite gestao total permissoes" ON public."TB.CALENDARIO_PERMISSOES_USUARIO" FOR ALL USING (true) WITH CHECK (true);

-- Script B: Adequação e Migração dos Usuários Já Cadastrados (Consolidando IDs reais de auth.users)
INSERT INTO public."TB.CALENDARIO_USUARIOS" (id, nome, email, perfil)
SELECT 
    au.id::text, 
    COALESCE(au.raw_user_meta_data->>'full_name', SPLIT_PART(au.email, '@', 1)) AS nome,
    au.email,
    'VISUALIZADOR' AS perfil
FROM auth.users au
ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    nome = COALESCE(public."TB.CALENDARIO_USUARIOS".nome, EXCLUDED.nome);

-- Migra permissões de IDs fictícios para os IDs reais do auth.users e limpa registros fictícios duplicados
DO $$ 
DECLARE 
    r RECORD;
BEGIN 
    FOR r IN 
        SELECT au.id::text AS real_id, cu.id AS fake_id, au.email 
        FROM auth.users au 
        JOIN public."TB.CALENDARIO_USUARIOS" cu ON LOWER(cu.email) = LOWER(au.email) 
        WHERE cu.id <> au.id::text AND (cu.id LIKE 'usr-admin-%' OR cu.id LIKE 'usr-andre-%' OR cu.id = 'usr-fallback')
    LOOP 
        -- Reassocia escopos para o ID real
        UPDATE public."TB.CALENDARIO_PERMISSOES_USUARIO" 
        SET usuario_id = r.real_id 
        WHERE usuario_id = r.fake_id;

        -- Remove o usuário fictício obsoleto
        DELETE FROM public."TB.CALENDARIO_USUARIOS" WHERE id = r.fake_id;
    END LOOP;
END $$;

-- Define o administrador padrão
UPDATE public."TB.CALENDARIO_USUARIOS"
SET perfil = 'ADMINISTRADOR'
WHERE LOWER(email) LIKE '%jean.silva%';

-- Script C: Trigger Automático para Novos Usuários
CREATE OR REPLACE FUNCTION public.handle_new_calendar_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public."TB.CALENDARIO_USUARIOS" (id, nome, email, perfil)
  VALUES (
    NEW.id::text, 
    COALESCE(NEW.raw_user_meta_data->>'full_name', SPLIT_PART(NEW.email, '@', 1)),
    NEW.email,
    CASE WHEN LOWER(NEW.email) LIKE '%jean.silva%' THEN 'ADMINISTRADOR' ELSE 'VISUALIZADOR' END
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    nome = COALESCE(public."TB.CALENDARIO_USUARIOS".nome, EXCLUDED.nome);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created_calendar ON auth.users;
CREATE TRIGGER on_auth_user_created_calendar
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_calendar_user();

-- Notifica o PostgREST (Supabase API) para recarregar o cache de esquemas imediatamente
NOTIFY pgrst, 'reload schema';
`;

export async function fetchCalendarUsersFromSupabase() {
  if (!supabaseClient) {
    initSupabaseClient();
  }
  if (!supabaseClient) {
    // initSupabaseClient() already populated lastSupabaseFetchError with the specific cause
    return null;
  }
  lastSupabaseFetchError = null;

  try {
    const userMap = new Map<string, any>();

    // 1. Fetch registered users from Supabase Auth (auth.users)
    try {
      if (supabaseClient.auth && supabaseClient.auth.admin) {
        const { data: authData, error: authErr } = await supabaseClient.auth.admin.listUsers();
        if (!authErr && authData?.users && authData.users.length > 0) {
          authData.users.forEach((authUser: any) => {
            const email = (authUser.email || '').toLowerCase().trim();
            if (email) {
              const isJean = email.includes('jean.silva');
              userMap.set(email, {
                id: authUser.id,
                nome: authUser.user_metadata?.full_name || authUser.user_metadata?.nome || authUser.user_metadata?.name || (email ? email.split('@')[0].replace('.', ' ') : 'Usuário'),
                email: email,
                perfil: isJean ? 'ADMINISTRADOR' : 'VISUALIZADOR',
                status: 'ATIVO',
                created_at: authUser.created_at || new Date().toISOString(),
                updated_at: authUser.updated_at || authUser.created_at || new Date().toISOString(),
                escopos: isJean
                  ? ['menu_dashboard', 'menu_eventos', 'menu_relatorios', 'menu_configuracoes']
                  : ['menu_dashboard'],
              });
            }
          });
        } else if (authErr) {
          console.warn('[Supabase] Aviso ao buscar auth.users:', authErr.message);
        }
      }
    } catch (e: any) {
      console.warn('[Supabase] auth.admin.listUsers erro:', e.message);
    }

    // 2. Fetch users from TB.CALENDARIO_USUARIOS (trying multiple table variants)
    const possibleUserTables = [
      'TB.CALENDARIO_USUARIOS',
      'tb.calendario_usuarios',
      'tb_calendario_usuarios',
      'TB.CALENDARIO_USUARIO',
      'tb.calendario_usuario',
      'calendario_usuarios',
      'calendario_usuario',
    ];

    let dbUsers: any[] | null = null;
    let tableErrMessage = '';

    for (const tableName of possibleUserTables) {
      const { data, error } = await supabaseClient
        .from(tableName)
        .select('*')
        .order('created_at', { ascending: true });

      if (!error && data) {
        dbUsers = data;
        break;
      } else if (error) {
        tableErrMessage = error.message;
      }
    }

    // 3. Fetch scopes and permissions from DB if available
    const scopeMap = new Map<string, string>();
    const userScopeMap = new Map<string, string[]>();

    try {
      let scopesData = (await supabaseClient.from('TB.CALENDARIO_ESCOPOS').select('*')).data;
      if (!scopesData) {
        scopesData = (await supabaseClient.from('tb.calendario_escopos').select('*')).data;
      }
      if (scopesData) {
        scopesData.forEach((s: any) => scopeMap.set(s.id, s.nome_escopo));
      }

      let permissionsData = (await supabaseClient.from('TB.CALENDARIO_PERMISSOES_USUARIO').select('*')).data;
      if (!permissionsData) {
        permissionsData = (await supabaseClient.from('tb.calendario_permissoes_usuario').select('*')).data;
      }
      if (permissionsData) {
        permissionsData.forEach((p: any) => {
          const scopeName = scopeMap.get(p.escopo_id);
          if (scopeName) {
            const list = userScopeMap.get(p.usuario_id) || [];
            if (!list.includes(scopeName)) list.push(scopeName);
            userScopeMap.set(p.usuario_id, list);
          }
        });
      }
    } catch (e) {
      // Ignore scope query errors
    }

    // Merge DB users into userMap
    if (dbUsers && dbUsers.length > 0) {
      dbUsers.forEach((u: any) => {
        let rawEmail = u.email;
        if (!rawEmail && u.nome && u.nome.includes('@')) rawEmail = u.nome;
        const cleanEmail = (rawEmail || '').toLowerCase().trim();
        const userKey = cleanEmail || String(u.id);

        const dbScopes = userScopeMap.get(u.id) || u.escopos || (cleanEmail.includes('jean.silva') ? ['menu_dashboard', 'menu_eventos', 'menu_relatorios', 'menu_configuracoes'] : ['menu_dashboard']);

        const existing = userMap.get(userKey);
        if (existing) {
          userMap.set(userKey, {
            ...existing,
            id: u.id && u.id.length > 10 ? u.id : existing.id,
            nome: u.nome || existing.nome,
            perfil: cleanEmail.includes('jean.silva') ? 'ADMINISTRADOR' : (u.perfil || existing.perfil),
            status: u.status || existing.status || 'ATIVO',
            escopos: dbScopes.length > 0 ? dbScopes : existing.escopos,
          });
        } else {
          userMap.set(userKey, {
            id: String(u.id),
            nome: u.nome || (cleanEmail ? cleanEmail.split('@')[0].replace('.', ' ') : 'Usuário'),
            email: cleanEmail || String(u.id),
            perfil: cleanEmail.includes('jean.silva') ? 'ADMINISTRADOR' : (u.perfil || 'VISUALIZADOR'),
            status: u.status || 'ATIVO',
            created_at: u.created_at || new Date().toISOString(),
            updated_at: u.updated_at || new Date().toISOString(),
            escopos: dbScopes,
          });
        }
      });
    }

    // Return combined users array
    const combinedUsers = Array.from(userMap.values());
    if (combinedUsers.length > 0) {
      lastSupabaseFetchError = null;
      return combinedUsers;
    }

    // If query succeeded with 0 users and no connection failure, return empty array so server can auto-seed
    if (!tableErrMessage || tableErrMessage.includes('does not exist') || tableErrMessage.includes('não existe')) {
      lastSupabaseFetchError = null;
      return [];
    }

    lastSupabaseFetchError = tableErrMessage;
    return null;
  } catch (err: any) {
    console.warn('[Supabase] Erro ao carregar usuários:', err.message);
    lastSupabaseFetchError = err.message;
    return null;
  }
}

export async function createCalendarUserInSupabase(user: {
  id?: string;
  nome: string;
  email: string;
  perfil: 'ADMINISTRADOR' | 'GESTOR' | 'VISUALIZADOR';
  escopos?: string[];
}) {
  if (!supabaseClient) return false;

  try {
    const cleanEmail = user.email.toLowerCase().trim();

    // Check if user already exists by email
    const { data: existing } = await supabaseClient
      .from('TB.CALENDARIO_USUARIOS')
      .select('id')
      .eq('email', cleanEmail);

    let userId = user.id;
    if (existing && existing.length > 0) {
      // Use existing non-fictitious ID if possible
      const realRow = existing.find((r: any) => !r.id.startsWith('usr-admin-') && !r.id.startsWith('usr-andre-'));
      userId = realRow ? realRow.id : existing[0].id;
    }

    // Try to create in Supabase Auth if service role key is configured and no real ID exists
    if (!userId || userId.startsWith('usr-')) {
      try {
        if (supabaseClient.auth && supabaseClient.auth.admin) {
          const { data: authData, error: authErr } = await supabaseClient.auth.admin.createUser({
            email: cleanEmail,
            email_confirm: true,
            user_metadata: { full_name: user.nome },
          });
          if (!authErr && authData?.user) {
            userId = authData.user.id;
          }
        }
      } catch (e: any) {
        // Ignored if anon key or user already in auth.users
      }
    }

    if (!userId) {
      userId = `usr-${Date.now()}`;
    }

    const { error: upsertErr } = await supabaseClient
      .from('TB.CALENDARIO_USUARIOS')
      .upsert(
        {
          id: userId,
          nome: user.nome,
          email: cleanEmail,
          perfil: user.perfil,
          status: 'ATIVO',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      );

    if (upsertErr) {
      console.warn('[Supabase] Erro ao cadastrar/atualizar usuário em TB.CALENDARIO_USUARIOS:', upsertErr.message);
      return false;
    }

    if (user.escopos && user.escopos.length > 0 && user.perfil !== 'ADMINISTRADOR') {
      const { data: scopesData } = await supabaseClient
        .from('TB.CALENDARIO_ESCOPOS')
        .select('id, nome_escopo');

      if (scopesData) {
        const scopeToId = new Map<string, string>();
        scopesData.forEach((s: any) => scopeToId.set(s.nome_escopo, s.id));

        const rowsToInsert = user.escopos
          .map((e) => scopeToId.get(e))
          .filter(Boolean)
          .map((scope_id) => ({
            usuario_id: userId,
            escopo_id: scope_id,
          }));

        if (rowsToInsert.length > 0) {
          await supabaseClient
            .from('TB.CALENDARIO_PERMISSOES_USUARIO')
            .upsert(rowsToInsert, { onConflict: 'usuario_id,escopo_id' });
        }
      }
    }
    return true;
  } catch (err: any) {
    console.warn('[Supabase] Falha na gravação do usuário no Supabase:', err.message);
    return false;
  }
}

export async function updateCalendarUserPermissionsInSupabase(
  userId: string,
  perfil: 'ADMINISTRADOR' | 'GESTOR' | 'VISUALIZADOR',
  escopos: string[],
  email?: string
) {
  if (!supabaseClient) return false;

  try {
    const cleanEmail = email ? email.toLowerCase().trim() : '';

    // 1. Match existing record by Email or ID
    let targetId = userId;
    let existingRows: any[] = [];

    if (cleanEmail) {
      const { data } = await supabaseClient
        .from('TB.CALENDARIO_USUARIOS')
        .select('id, email')
        .eq('email', cleanEmail);
      if (data) existingRows = data;
    }

    if (existingRows.length === 0 && userId) {
      const { data } = await supabaseClient
        .from('TB.CALENDARIO_USUARIOS')
        .select('id, email')
        .eq('id', userId);
      if (data) existingRows = data;
    }

    if (existingRows.length > 0) {
      // Pick the real non-fictitious ID if available
      const realUser = existingRows.find((r) => !r.id.startsWith('usr-admin-') && !r.id.startsWith('usr-andre-'));
      targetId = realUser ? realUser.id : existingRows[0].id;

      // Delete obsolete fictitious rows for this email if a real ID exists
      if (realUser) {
        const fakeIds = existingRows.filter((r) => r.id !== targetId).map((r) => r.id);
        if (fakeIds.length > 0) {
          await supabaseClient
            .from('TB.CALENDARIO_USUARIOS')
            .delete()
            .in('id', fakeIds);
        }
      }
    }

    // 2. Upsert user role and email for targetId
    const { error: updateErr } = await supabaseClient
      .from('TB.CALENDARIO_USUARIOS')
      .upsert(
        {
          id: targetId,
          perfil,
          status: 'ATIVO',
          ...(cleanEmail ? { email: cleanEmail } : {}),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      );

    if (updateErr) {
      console.warn('[Supabase] Erro ao atualizar perfil em TB.CALENDARIO_USUARIOS:', updateErr.message);
    }

    // 3. Clear old permissions for this user and any associated IDs
    const allUserIdsToClear = [targetId, ...existingRows.map((r) => r.id)];
    await supabaseClient
      .from('TB.CALENDARIO_PERMISSOES_USUARIO')
      .delete()
      .in('usuario_id', allUserIdsToClear);

    // 4. Insert new scope permissions if not admin
    if (perfil !== 'ADMINISTRADOR' && escopos && escopos.length > 0) {
      const { data: scopesData } = await supabaseClient
        .from('TB.CALENDARIO_ESCOPOS')
        .select('id, nome_escopo');

      if (scopesData && scopesData.length > 0) {
        const scopeToId = new Map<string, string>();
        scopesData.forEach((s: any) => scopeToId.set(s.nome_escopo, s.id));

        const rowsToInsert = escopos
          .map((e) => scopeToId.get(e))
          .filter((id): id is string => Boolean(id))
          .map((scope_id) => ({
            usuario_id: targetId,
            escopo_id: scope_id,
          }));

        if (rowsToInsert.length > 0) {
          const { error: insErr } = await supabaseClient
            .from('TB.CALENDARIO_PERMISSOES_USUARIO')
            .upsert(rowsToInsert, { onConflict: 'usuario_id,escopo_id' });

          if (insErr) {
            console.warn('[Supabase] Erro ao inserir escopos:', insErr.message);
          }
        }
      }
    }

    return true;
  } catch (err: any) {
    console.warn('[Supabase] Erro ao atualizar permissões do usuário:', err.message);
    return false;
  }
}


/**
 * SQL Schema script helper for Supabase table initialization
 */
export const SUPABASE_SQL_SCHEMA = `-- Tabela principal de chamados do Jira
CREATE TABLE IF NOT EXISTS public.jira_issues (
    issue_key TEXT PRIMARY KEY,
    issue_id TEXT,
    summary TEXT NOT NULL,
    issue_type TEXT,
    status TEXT NOT NULL,
    status_category TEXT,
    assignee_name TEXT,
    assignee_avatar TEXT,
    project_key TEXT NOT NULL,
    project_name TEXT,
    client TEXT,
    sprint_id TEXT,
    sprint_name TEXT,
    due_date DATE NOT NULL,
    url TEXT,
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela de histórico de alterações / atualizações
CREATE TABLE IF NOT EXISTS public.jira_issue_history (
    id BIGSERIAL PRIMARY KEY,
    issue_key TEXT NOT NULL,
    summary TEXT,
    status TEXT,
    due_date DATE,
    assignee_name TEXT,
    project_key TEXT,
    client TEXT,
    sprint_name TEXT,
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela de Épicos e Melhorias Sem Data Prevista
CREATE TABLE IF NOT EXISTS public.jira_epics_unscheduled (
    issue_key TEXT PRIMARY KEY,
    issue_id TEXT,
    issue_type TEXT NOT NULL DEFAULT 'Épico',
    summary TEXT NOT NULL,
    project_key TEXT,
    project_name TEXT NOT NULL,
    client TEXT,
    status TEXT NOT NULL,
    status_category TEXT,
    assignee_name TEXT,
    assignee_avatar TEXT,
    created_at_jira DATE,
    url TEXT,
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Garantir que todas as colunas existam caso a tabela tenha sido criada anteriormente sem elas
ALTER TABLE public.jira_epics_unscheduled ADD COLUMN IF NOT EXISTS issue_key TEXT;
ALTER TABLE public.jira_epics_unscheduled ADD COLUMN IF NOT EXISTS issue_id TEXT;
ALTER TABLE public.jira_epics_unscheduled ADD COLUMN IF NOT EXISTS issue_type TEXT;
ALTER TABLE public.jira_epics_unscheduled ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE public.jira_epics_unscheduled ADD COLUMN IF NOT EXISTS project_key TEXT;
ALTER TABLE public.jira_epics_unscheduled ADD COLUMN IF NOT EXISTS project_name TEXT;
ALTER TABLE public.jira_epics_unscheduled ADD COLUMN IF NOT EXISTS client TEXT;
ALTER TABLE public.jira_epics_unscheduled ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE public.jira_epics_unscheduled ADD COLUMN IF NOT EXISTS status_category TEXT;
ALTER TABLE public.jira_epics_unscheduled ADD COLUMN IF NOT EXISTS assignee_name TEXT;
ALTER TABLE public.jira_epics_unscheduled ADD COLUMN IF NOT EXISTS assignee_avatar TEXT;
ALTER TABLE public.jira_epics_unscheduled ADD COLUMN IF NOT EXISTS created_at_jira DATE;
ALTER TABLE public.jira_epics_unscheduled ADD COLUMN IF NOT EXISTS url TEXT;
ALTER TABLE public.jira_epics_unscheduled ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.jira_epics_unscheduled ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Tabela de Histórias vinculadas aos Épicos e Melhorias
CREATE TABLE IF NOT EXISTS public.jira_issue_stories (
    issue_key TEXT PRIMARY KEY,
    epic_key TEXT NOT NULL,
    summary TEXT NOT NULL,
    issue_type TEXT DEFAULT 'História',
    status TEXT NOT NULL,
    status_category TEXT,
    assignee_name TEXT,
    sprint_name TEXT,
    url TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.jira_issue_stories ADD COLUMN IF NOT EXISTS issue_key TEXT;
ALTER TABLE public.jira_issue_stories ADD COLUMN IF NOT EXISTS epic_key TEXT;
ALTER TABLE public.jira_issue_stories ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE public.jira_issue_stories ADD COLUMN IF NOT EXISTS issue_type TEXT;
ALTER TABLE public.jira_issue_stories ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE public.jira_issue_stories ADD COLUMN IF NOT EXISTS status_category TEXT;
ALTER TABLE public.jira_issue_stories ADD COLUMN IF NOT EXISTS assignee_name TEXT;
ALTER TABLE public.jira_issue_stories ADD COLUMN IF NOT EXISTS sprint_name TEXT;
ALTER TABLE public.jira_issue_stories ADD COLUMN IF NOT EXISTS url TEXT;
ALTER TABLE public.jira_issue_stories ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Índices de performance para buscas rápidas
CREATE INDEX IF NOT EXISTS idx_jira_issues_due_date ON public.jira_issues(due_date);
CREATE INDEX IF NOT EXISTS idx_jira_issues_project_key ON public.jira_issues(project_key);
CREATE INDEX IF NOT EXISTS idx_jira_issue_history_issue_key ON public.jira_issue_history(issue_key);
CREATE INDEX IF NOT EXISTS idx_jira_epics_unscheduled_issue_type ON public.jira_epics_unscheduled(issue_type);
CREATE INDEX IF NOT EXISTS idx_jira_epics_unscheduled_project_name ON public.jira_epics_unscheduled(project_name);
CREATE INDEX IF NOT EXISTS idx_jira_issue_stories_epic_key ON public.jira_issue_stories(epic_key);
`;

