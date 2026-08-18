import React, { useState, useEffect, useMemo } from 'react';
import { JiraIssue } from '../types';
import { fetchUnscheduledEpics, syncUnscheduledEpics } from '../services/apiService';
import { REQUIRED_PROJECTS, normalizeProjectName } from '../data/mockJiraData';
import { getStatusStyle } from './IssueCard';
import { exportToExcel, exportToPdf } from '../utils/exportUtils';
import { formatToDDMMAAAA } from '../utils/dateUtils';
import {
  RefreshCw,
  Search,
  Filter,
  FileSpreadsheet,
  FileType,
  ExternalLink,
  Layers,
  ArrowUpDown,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles,
  Tag,
  Building2,
  User,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';

interface EpicsUnscheduledViewProps {
  theme?: 'light' | 'dark';
  canSync?: boolean;
  isReadOnly?: boolean;
}

export const EpicsUnscheduledView: React.FC<EpicsUnscheduledViewProps> = ({
  theme = 'light',
  canSync = true,
  isReadOnly = false,
}) => {
  const isLight = theme === 'light';

  const [issues, setIssues] = useState<JiraIssue[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState<boolean>(false);

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedProject, setSelectedProject] = useState<string>('all');
  const [selectedClient, setSelectedClient] = useState<string>('all');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');

  // Sort State
  const [sortField, setSortField] = useState<'issue_key' | 'summary' | 'issue_type' | 'project_name' | 'status' | 'created_at_jira'>('issue_key');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Load initial data
  const loadData = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetchUnscheduledEpics();
      setIssues(res.data || []);
      setLastSync(res.lastSyncTimestamp);
      setIsDemo(res.isDemoMode);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao carregar Épicos & Melhorias.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Sync handler
  const handleSync = async () => {
    setIsSyncing(true);
    setErrorMsg(null);
    try {
      const res = await syncUnscheduledEpics();
      setIssues(res.data || []);
      setLastSync(res.lastSyncTimestamp);
      setIsDemo(res.isDemoMode);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao sincronizar com o Jira.');
    } finally {
      setIsSyncing(false);
    }
  };

  // Sort handler
  const handleSort = (field: 'issue_key' | 'summary' | 'issue_type' | 'project_name' | 'status' | 'created_at_jira') => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  // Extract Filter Options - Responsive to cross-selections
  const projectOptions = useMemo(() => {
    const set = new Set<string>();
    issues.forEach((issue) => {
      const matchT = selectedType === 'all' || issue.issue_type === selectedType;
      const matchS = selectedStatus === 'all' || issue.status === selectedStatus;
      let matchQ = true;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        matchQ = (
          issue.issue_key.toLowerCase().includes(q) ||
          issue.summary.toLowerCase().includes(q) ||
          (issue.assignee_name || '').toLowerCase().includes(q) ||
          (issue.project_name || issue.project_key || '').toLowerCase().includes(q) ||
          (issue.client || '').toLowerCase().includes(q)
        );
      }
      if (matchT && matchS && matchQ) {
        const name = (issue.project_name || issue.project_key || '').trim();
        if (name) set.add(name);
      }
    });
    if (selectedProject !== 'all') set.add(selectedProject);
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [issues, selectedType, selectedStatus, searchQuery, selectedProject]);

  const typeOptions = useMemo(() => {
    const set = new Set<string>();
    issues.forEach((issue) => {
      const projName = (issue.project_name || '').trim();
      const projKey = (issue.project_key || '').trim();
      const matchP = selectedProject === 'all' || projName === selectedProject || projKey === selectedProject;
      const matchS = selectedStatus === 'all' || issue.status === selectedStatus;
      let matchQ = true;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        matchQ = (
          issue.issue_key.toLowerCase().includes(q) ||
          issue.summary.toLowerCase().includes(q) ||
          (issue.assignee_name || '').toLowerCase().includes(q) ||
          (issue.project_name || issue.project_key || '').toLowerCase().includes(q) ||
          (issue.client || '').toLowerCase().includes(q)
        );
      }
      if (matchP && matchS && matchQ) {
        if (issue.issue_type) set.add(issue.issue_type);
      }
    });
    if (selectedType !== 'all') set.add(selectedType);
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [issues, selectedProject, selectedStatus, searchQuery, selectedType]);

  const clientOptions = useMemo(() => {
    const set = new Set<string>();
    issues.forEach((issue) => {
      const projName = (issue.project_name || '').trim();
      const projKey = (issue.project_key || '').trim();
      const matchP = selectedProject === 'all' || projName === selectedProject || projKey === selectedProject;
      const matchT = selectedType === 'all' || issue.issue_type === selectedType;
      const matchS = selectedStatus === 'all' || issue.status === selectedStatus;
      let matchQ = true;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        matchQ = (
          issue.issue_key.toLowerCase().includes(q) ||
          issue.summary.toLowerCase().includes(q) ||
          (issue.assignee_name || '').toLowerCase().includes(q) ||
          (issue.project_name || issue.project_key || '').toLowerCase().includes(q) ||
          (issue.client || '').toLowerCase().includes(q)
        );
      }
      if (matchP && matchT && matchS && matchQ) {
        if (issue.client) {
          issue.client
            .split(/[,/;|]/)
            .map((c) => c.trim())
            .filter(Boolean)
            .forEach((c) => set.add(c));
        }
      }
    });
    if (selectedClient !== 'all') set.add(selectedClient);
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [issues, selectedProject, selectedType, selectedStatus, searchQuery, selectedClient]);

  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    issues.forEach((issue) => {
      const projName = (issue.project_name || '').trim();
      const projKey = (issue.project_key || '').trim();
      const matchP = selectedProject === 'all' || projName === selectedProject || projKey === selectedProject;
      const matchT = selectedType === 'all' || issue.issue_type === selectedType;
      let matchQ = true;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        matchQ = (
          issue.issue_key.toLowerCase().includes(q) ||
          issue.summary.toLowerCase().includes(q) ||
          (issue.assignee_name || '').toLowerCase().includes(q) ||
          (issue.project_name || issue.project_key || '').toLowerCase().includes(q) ||
          (issue.client || '').toLowerCase().includes(q)
        );
      }
      if (matchP && matchT && matchQ) {
        if (issue.status) set.add(issue.status);
      }
    });
    if (selectedStatus !== 'all') set.add(selectedStatus);
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [issues, selectedProject, selectedType, searchQuery, selectedStatus]);

  // Filter & Search Logic
  const filteredIssues = issues.filter((issue) => {
    // Search Query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchKey = issue.issue_key.toLowerCase().includes(q);
      const matchSummary = issue.summary.toLowerCase().includes(q);
      const matchAssignee = (issue.assignee_name || '').toLowerCase().includes(q);
      const matchProject = (issue.project_name || issue.project_key || '').toLowerCase().includes(q);
      const matchClient = (issue.client || '').toLowerCase().includes(q);

      if (!matchKey && !matchSummary && !matchAssignee && !matchProject && !matchClient) {
        return false;
      }
    }

    // Project Filter
    if (selectedProject !== 'all') {
      const projName = (issue.project_name || '').trim();
      const projKey = (issue.project_key || '').trim();
      if (
        projName !== selectedProject &&
        projKey !== selectedProject
      ) {
        return false;
      }
    }

    // Client Filter
    if (selectedClient !== 'all') {
      if (!issue.client) return false;
      const issueClients = issue.client
        .split(/[,/;|]/)
        .map((c) => c.trim())
        .filter(Boolean);
      if (!issueClients.includes(selectedClient)) return false;
    }

    // Type Filter
    if (selectedType !== 'all') {
      if (issue.issue_type !== selectedType) return false;
    }

    // Status Filter
    if (selectedStatus !== 'all') {
      if (issue.status !== selectedStatus) return false;
    }

    return true;
  });

  // Sorted Issues
  const sortedIssues = [...filteredIssues].sort((a, b) => {
    const valA = (a[sortField] || '') as string;
    const valB = (b[sortField] || '') as string;
    if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
    if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
    return 0;
  });

  // Calculate Metrics
  const totalEpics = issues.filter((i) => (i.issue_type || '').toLowerCase().includes('épico') || (i.issue_type || '').toLowerCase().includes('epic')).length;
  const totalImprovements = issues.filter((i) => (i.issue_type || '').toLowerCase().includes('melhoria') || (i.issue_type || '').toLowerCase().includes('improvement')).length;
  const uniqueProjectsCount = new Set(issues.map((i) => i.project_key)).size;

  const formattedLastSync = lastSync
    ? format(parseISO(lastSync), 'dd/MM/yyyy HH:mm')
    : 'Pendente';

  return (
    <div className="flex-1 flex flex-col min-h-0 w-full overflow-hidden space-y-4">
      {/* Screen Title & Header */}
      <div
        className={`p-4 md:p-5 rounded-xl border flex flex-wrap items-center justify-between gap-4 shadow-xs ${
          isLight ? 'bg-white border-slate-200' : 'bg-[#0d1117] border-[#1e293b]'
        }`}
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-purple-600 text-white font-bold">
              <Layers className="h-5 w-5" />
            </div>
            <h1 className={`text-xl font-black tracking-tight ${isLight ? 'text-slate-900' : 'text-white'}`}>
              Épicos & Melhorias sem data prevista
            </h1>
          </div>
          <p className={`text-xs max-w-2xl ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
            Exibindo os chamados do tipo <strong>Épico</strong> e <strong>Solicitação de Melhoria</strong> dos projetos do tipo <strong>Jira Software</strong> ativos, pendentes de conclusão, onde a data prevista de entrega está em branco.
          </p>
        </div>

        {/* Sync & Export Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleSync}
            disabled={isSyncing || isLoading || isReadOnly || !canSync}
            title={
              isReadOnly || !canSync
                ? 'Perfil Visualizador (Somente Leitura)'
                : 'Sincronizar Épicos com o Jira'
            }
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>
              {isSyncing
                ? 'Sincronizando...'
                : isReadOnly || !canSync
                ? 'Atualizar (Leitura)'
                : 'Atualizar / Sincronizar'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => exportToExcel(sortedIssues, 'epicos_melhorias_sem_data_prevista.xlsx')}
            disabled={sortedIssues.length === 0}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-all cursor-pointer disabled:opacity-50"
          >
            <FileSpreadsheet className="h-4 w-4" />
            <span>Excel</span>
          </button>

          <button
            type="button"
            onClick={() => exportToPdf(sortedIssues, 'epicos_melhorias_sem_data_prevista.pdf', 'Épicos & Melhorias Sem Data Prevista')}
            disabled={sortedIssues.length === 0}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-xs transition-all cursor-pointer disabled:opacity-50"
          >
            <FileType className="h-4 w-4" />
            <span>PDF</span>
          </button>
        </div>
      </div>

      {/* KPI Cards & Sync Information */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Card 1: Total Sem Data */}
        <div
          className={`p-3.5 rounded-xl border flex items-center gap-3.5 ${
            isLight ? 'bg-purple-50/60 border-purple-200' : 'bg-purple-950/20 border-purple-900/40'
          }`}
        >
          <div className="p-2.5 rounded-lg bg-purple-600/10 text-purple-600 dark:text-purple-400 font-bold">
            <Layers className="h-5 w-5" />
          </div>
          <div>
            <div className="text-[11px] font-bold text-purple-700 dark:text-purple-300 uppercase tracking-wider">
              Total Sem Data Prevista
            </div>
            <div className="text-2xl font-black mt-0.5 text-purple-950 dark:text-purple-100">
              {issues.length}
            </div>
          </div>
        </div>

        {/* Card 2: Subtotal Épicos */}
        <div
          className={`p-3.5 rounded-xl border flex items-center gap-3.5 ${
            isLight ? 'bg-indigo-50/60 border-indigo-200' : 'bg-indigo-950/20 border-indigo-900/40'
          }`}
        >
          <div className="p-2.5 rounded-lg bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 font-bold">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <div className="text-[11px] font-bold text-indigo-700 dark:text-indigo-300 uppercase tracking-wider">
              Épicos sem Prazo
            </div>
            <div className="text-2xl font-black mt-0.5 text-indigo-950 dark:text-indigo-100">
              {totalEpics}
            </div>
          </div>
        </div>

        {/* Card 3: Subtotal Melhorias */}
        <div
          className={`p-3.5 rounded-xl border flex items-center gap-3.5 ${
            isLight ? 'bg-blue-50/60 border-blue-200' : 'bg-blue-950/20 border-blue-900/40'
          }`}
        >
          <div className="p-2.5 rounded-lg bg-blue-600/10 text-blue-600 dark:text-blue-400 font-bold">
            <Tag className="h-5 w-5" />
          </div>
          <div>
            <div className="text-[11px] font-bold text-blue-700 dark:text-blue-300 uppercase tracking-wider">
              Melhorias sem Prazo
            </div>
            <div className="text-2xl font-black mt-0.5 text-blue-950 dark:text-blue-100">
              {totalImprovements}
            </div>
          </div>
        </div>

        {/* Card 4: Status Sincronização & Projetos */}
        <div
          className={`p-3.5 rounded-xl border flex items-center justify-between gap-2 ${
            isLight ? 'bg-slate-50 border-slate-200' : 'bg-[#161b22] border-[#30363d]'
          }`}
        >
          <div className="space-y-0.5">
            <div className="flex items-center gap-1 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              <Clock className="h-3.5 w-3.5 text-emerald-500" />
              <span>Sincronização 1x/dia</span>
            </div>
            <div className={`text-xs font-semibold ${isLight ? 'text-slate-800' : 'text-slate-200'}`}>
              {formattedLastSync}
            </div>
            <div className="text-[10px] text-slate-500">
              {isDemo ? 'Modo Demonstração' : `${uniqueProjectsCount} Projetos Software`}
            </div>
          </div>

          <button
            type="button"
            onClick={handleSync}
            title="Sincronizar agora com o Jira"
            disabled={isSyncing}
            className="p-2 rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
          >
            <RefreshCw className={`h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div
        className={`p-3 rounded-xl border flex flex-wrap items-center justify-between gap-3 ${
          isLight ? 'bg-white border-slate-200' : 'bg-[#0d1117] border-[#1e293b]'
        }`}
      >
        {/* Search Input */}
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Pesquisar por chave, resumo, responsável ou cliente..."
            className={`w-full pl-9 pr-3 py-1.5 rounded-lg border text-xs outline-none transition-all ${
              isLight
                ? 'bg-slate-50 border-slate-200 focus:bg-white focus:border-blue-500 text-slate-800'
                : 'bg-[#161b22] border-[#30363d] focus:border-blue-500 text-slate-200'
            }`}
          />
        </div>

        {/* Dropdown Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Project Filter */}
          <select
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium outline-none transition-all ${
              isLight ? 'bg-slate-50 border-slate-200 text-slate-700' : 'bg-[#161b22] border-[#30363d] text-slate-200'
            }`}
          >
            <option value="all">Todos os Projetos ({projectOptions.length})</option>
            {projectOptions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          {/* Client Filter */}
          <select
            value={selectedClient}
            onChange={(e) => setSelectedClient(e.target.value)}
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium outline-none transition-all ${
              isLight ? 'bg-slate-50 border-slate-200 text-slate-700' : 'bg-[#161b22] border-[#30363d] text-slate-200'
            }`}
          >
            <option value="all">Todos os Clientes ({clientOptions.length})</option>
            {clientOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          {/* Type Filter */}
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium outline-none transition-all ${
              isLight ? 'bg-slate-50 border-slate-200 text-slate-700' : 'bg-[#161b22] border-[#30363d] text-slate-200'
            }`}
          >
            <option value="all">Todos os Tipos ({typeOptions.length})</option>
            {typeOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium outline-none transition-all ${
              isLight ? 'bg-slate-50 border-slate-200 text-slate-700' : 'bg-[#161b22] border-[#30363d] text-slate-200'
            }`}
          >
            <option value="all">Todos os Status ({statusOptions.length})</option>
            {statusOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          {/* Clear Filters Button */}
          {(searchQuery || selectedProject !== 'all' || selectedType !== 'all' || selectedStatus !== 'all') && (
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedProject('all');
                setSelectedType('all');
                setSelectedStatus('all');
              }}
              className="px-2.5 py-1.5 rounded-lg text-xs font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 transition-colors cursor-pointer"
            >
              Limpar Filtros
            </button>
          )}
        </div>
      </div>

      {/* Error Banner */}
      {errorMsg && (
        <div className="p-3.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-xs flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Main Table Content */}
      <div
        className={`flex-1 min-h-0 border rounded-xl overflow-hidden flex flex-col ${
          isLight ? 'bg-white border-slate-200' : 'bg-[#0d1117] border-[#1e293b]'
        }`}
      >
        {isLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center p-12 space-y-3">
            <RefreshCw className="h-8 w-8 animate-spin text-purple-600" />
            <span className={`text-xs font-bold ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>
              Carregando Épicos & Melhorias sem data prevista do Jira...
            </span>
          </div>
        ) : sortedIssues.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center space-y-3">
            <div className="p-3 rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
              <CheckCircle2 className="h-8 w-8" />
            </div>
            <h3 className={`text-base font-bold ${isLight ? 'text-slate-800' : 'text-slate-200'}`}>
              Nenhum Épico ou Melhoria pendente sem data prevista!
            </h3>
            <p className={`text-xs max-w-md ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
              Todos os chamados de projetos Jira Software estão devidamente agendados com data prevista de entrega ou não correspondem aos filtros aplicados.
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-auto">
            <table className="w-full text-left border-collapse">
              <thead
                className={`sticky top-0 z-10 text-[11px] font-bold uppercase tracking-wider border-b ${
                  isLight
                    ? 'bg-slate-100 text-slate-600 border-slate-200'
                    : 'bg-[#161b22] text-slate-400 border-[#1e293b]'
                }`}
              >
                <tr>
                  <th
                    onClick={() => handleSort('issue_key')}
                    className="px-4 py-3 cursor-pointer hover:text-blue-600 select-none whitespace-nowrap"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Chave</span>
                      <ArrowUpDown className="h-3 w-3 opacity-60" />
                    </div>
                  </th>

                  <th
                    onClick={() => handleSort('summary')}
                    className="px-4 py-3 cursor-pointer hover:text-blue-600 select-none"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Resumo / Descrição</span>
                      <ArrowUpDown className="h-3 w-3 opacity-60" />
                    </div>
                  </th>

                  <th
                    onClick={() => handleSort('issue_type')}
                    className="px-4 py-3 cursor-pointer hover:text-blue-600 select-none whitespace-nowrap"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Tipo</span>
                      <ArrowUpDown className="h-3 w-3 opacity-60" />
                    </div>
                  </th>

                  <th
                    onClick={() => handleSort('project_name')}
                    className="px-4 py-3 cursor-pointer hover:text-blue-600 select-none whitespace-nowrap"
                  >
                    <div className="flex items-center gap-1.5">
                      <Building2 className="h-3.5 w-3.5 text-slate-400" />
                      <span>Projeto / Cliente</span>
                      <ArrowUpDown className="h-3 w-3 opacity-60" />
                    </div>
                  </th>

                  <th
                    onClick={() => handleSort('status')}
                    className="px-4 py-3 cursor-pointer hover:text-blue-600 select-none whitespace-nowrap"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Status</span>
                      <ArrowUpDown className="h-3 w-3 opacity-60" />
                    </div>
                  </th>

                  <th
                    onClick={() => handleSort('created_at_jira')}
                    className="px-4 py-3 cursor-pointer hover:text-blue-600 select-none whitespace-nowrap"
                  >
                    <div className="flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5 text-slate-400" />
                      <span>Data de Criação</span>
                      <ArrowUpDown className="h-3 w-3 opacity-60" />
                    </div>
                  </th>

                  <th className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <User className="h-3.5 w-3.5 text-slate-400" />
                      <span>Responsável</span>
                    </div>
                  </th>

                  <th className="px-4 py-3 text-right whitespace-nowrap">Ação</th>
                </tr>
              </thead>

              <tbody className={`divide-y text-xs ${isLight ? 'divide-slate-200 bg-white' : 'divide-[#1e293b] bg-[#0d1117]'}`}>
                {sortedIssues.map((issue) => {
                  const style = getStatusStyle(issue.status_category, issue.status, isLight ? 'light' : 'dark');
                  const isEpic = (issue.issue_type || '').toLowerCase().includes('épico') || (issue.issue_type || '').toLowerCase().includes('epic');

                  return (
                    <tr
                      key={issue.issue_key}
                      className={`transition-colors ${
                        isLight ? 'hover:bg-slate-50' : 'hover:bg-[#161b22]'
                      }`}
                    >
                      {/* Issue Key */}
                      <td className="px-4 py-3 font-mono font-bold whitespace-nowrap">
                        <span className="inline-flex items-center px-2 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-950/80 dark:text-blue-300 border border-blue-200/60 dark:border-blue-800/40">
                          {issue.issue_key}
                        </span>
                      </td>

                      {/* Summary */}
                      <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100 max-w-md">
                        <div className="line-clamp-2" title={issue.summary}>
                          {issue.summary}
                        </div>
                      </td>

                      {/* Issue Type */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${
                            isEpic
                              ? 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 border border-purple-200 dark:border-purple-800'
                              : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                          }`}
                        >
                          {isEpic ? <Sparkles className="h-3 w-3" /> : <Tag className="h-3 w-3" />}
                          {issue.issue_type}
                        </span>
                      </td>

                      {/* Project / Client */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="font-semibold text-slate-800 dark:text-slate-200">
                          {issue.project_name || issue.project_key}
                        </div>
                        {issue.client && (
                          <div className="text-[10px] font-medium text-slate-500">
                            Cliente: {issue.client}
                          </div>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${style.badge}`}
                        >
                          {issue.status}
                        </span>
                      </td>

                      {/* Data de Criação */}
                      <td className="px-4 py-3 whitespace-nowrap font-medium text-slate-700 dark:text-slate-300">
                        {issue.created_at_jira ? formatToDDMMAAAA(issue.created_at_jira) : '-'}
                      </td>

                      {/* Assignee */}
                      <td className="px-4 py-3 whitespace-nowrap text-slate-700 dark:text-slate-300">
                        <div className="flex items-center gap-2">
                          {issue.assignee_avatar ? (
                            <img
                              src={issue.assignee_avatar}
                              alt={issue.assignee_name || 'Responsável'}
                              className="h-5 w-5 rounded-full object-cover"
                            />
                          ) : (
                            <div className="h-5 w-5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center font-bold text-[9px]">
                              {(issue.assignee_name || 'U').charAt(0)}
                            </div>
                          )}
                          <span className="truncate max-w-[140px]" title={issue.assignee_name || 'Não atribuído'}>
                            {issue.assignee_name || 'Não atribuído'}
                          </span>
                        </div>
                      </td>

                      {/* External Link Action */}
                      <td className="px-4 py-3 whitespace-nowrap text-right">
                        <a
                          href={issue.url}
                          target="_blank"
                          rel="noreferrer"
                          title="Abrir chamado no Jira Cloud"
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-100 hover:bg-blue-600 hover:text-white dark:bg-slate-800 dark:hover:bg-blue-600 text-slate-700 dark:text-slate-300 text-xs font-semibold transition-colors"
                        >
                          <span>Abrir Jira</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
