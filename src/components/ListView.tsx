import React, { useState } from 'react';
import { JiraIssue } from '../types';
import { getStatusStyle } from './IssueCard';
import { Calendar, Folder, ExternalLink, ArrowUpDown, FileSpreadsheet, FileType, ChevronRight, ChevronDown, Layers, Loader2 } from 'lucide-react';
import { formatToDDMMAAAA } from '../utils/dateUtils';
import { exportToExcel, exportToPdf } from '../utils/exportUtils';
import { fetchIssueStoriesAPI } from '../services/apiService';

interface ListViewProps {
  issues: JiraIssue[];
  onSelectIssue: (issue: JiraIssue) => void;
  theme?: 'light' | 'dark';
}

interface ChildStoryItem {
  issue_key: string;
  epic_key: string;
  summary: string;
  issue_type: string;
  status: string;
  status_category?: string;
  assignee_name?: string;
  url?: string;
}

interface StoriesCacheState {
  [epicKey: string]: {
    loading: boolean;
    stories: ChildStoryItem[];
    error?: string;
  };
}

export const ListView: React.FC<ListViewProps> = ({
  issues,
  onSelectIssue,
  theme = 'light',
}) => {
  const isLight = theme === 'light';
  const [sortField, setSortField] = useState<'due_date' | 'issue_key' | 'issue_type' | 'project_name'>('due_date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [storiesCache, setStoriesCache] = useState<StoriesCacheState>({});

  const handleSort = (field: 'due_date' | 'issue_key' | 'issue_type' | 'project_name') => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const sortedIssues = [...issues].sort((a, b) => {
    let valA = (a[sortField] || (a as any).delivery_date || '') as string;
    let valB = (b[sortField] || (b as any).delivery_date || '') as string;
    if (sortField === 'due_date') {
      if (!valA && valB) return 1;
      if (valA && !valB) return -1;
    }
    if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
    if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
    return 0;
  });

  const toggleRowExpansion = async (issueKey: string, e: React.MouseEvent) => {
    e.stopPropagation();

    const nextSet = new Set(expandedKeys);
    const isExpanding = !nextSet.has(issueKey);

    if (isExpanding) {
      nextSet.add(issueKey);
      setExpandedKeys(nextSet);

      // Fetch stories if not already cached
      if (!storiesCache[issueKey]) {
        setStoriesCache((prev) => ({
          ...prev,
          [issueKey]: { loading: true, stories: [] },
        }));

        try {
          const res = await fetchIssueStoriesAPI(issueKey);
          setStoriesCache((prev) => ({
            ...prev,
            [issueKey]: { loading: false, stories: res.stories || [] },
          }));
        } catch (err: any) {
          setStoriesCache((prev) => ({
            ...prev,
            [issueKey]: { loading: false, stories: [], error: err.message || 'Erro ao carregar histórias' },
          }));
        }
      }
    } else {
      nextSet.delete(issueKey);
      setExpandedKeys(nextSet);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 w-full overflow-hidden">
      {/* Table Header Summary & Export Actions */}
      <div className={`px-4 py-2.5 border-b flex flex-wrap items-center justify-between gap-2 text-xs font-semibold ${
        isLight ? 'bg-slate-50 border-slate-200 text-slate-700' : 'bg-[#161b22] border-[#1e293b] text-slate-300'
      }`}>
        <div className="flex items-center gap-2">
          <span>Exibindo <strong className="text-blue-600 dark:text-blue-400">{sortedIssues.length}</strong> chamados em ordem cronológica de data prevista</span>
          <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400 hidden sm:inline">(clique na linha para ver as Histórias vinculadas)</span>
        </div>

        {/* Export Buttons */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => exportToExcel(sortedIssues, 'relacao_chamados_jira.xlsx')}
            title="Exportar relação para arquivo Excel (.xlsx)"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors cursor-pointer shrink-0"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            <span>Exportar Excel</span>
          </button>

          <button
            type="button"
            onClick={() => exportToPdf(sortedIssues, 'relacao_chamados_jira.pdf')}
            title="Exportar relação para documento PDF (.pdf)"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-xs transition-colors cursor-pointer shrink-0"
          >
            <FileType className="h-3.5 w-3.5" />
            <span>Exportar PDF</span>
          </button>
        </div>
      </div>

      {/* Main Table Area */}
      <div className="flex-1 overflow-auto">
        {sortedIssues.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center text-slate-500">
            <p className="text-sm font-medium">Nenhum chamado encontrado para os filtros selecionados.</p>
          </div>
        ) : (
          <table className="w-full text-left text-xs border-collapse table-fixed">
            <thead className={`sticky top-0 z-10 text-[11px] font-bold uppercase tracking-wider border-b ${
              isLight ? 'bg-slate-100 border-slate-200 text-slate-600' : 'bg-[#0d1117] border-[#1e293b] text-slate-400'
            }`}>
              <tr>
                <th className="w-7 px-1 py-2.5 text-center"></th>
                <th
                  onClick={() => handleSort('due_date')}
                  className="w-28 md:w-32 px-2.5 py-2.5 cursor-pointer hover:text-blue-600 select-none whitespace-nowrap"
                  title="Ordenar por Data Prevista"
                >
                  <div className="flex items-center justify-center gap-1">
                    <Calendar className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    <span>Data Prevista</span>
                    <ArrowUpDown className="h-3 w-3 opacity-60 shrink-0" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort('issue_key')}
                  className="w-28 px-2.5 py-2.5 cursor-pointer hover:text-blue-600 select-none whitespace-nowrap"
                  title="Ordenar por Chave"
                >
                  <div className="flex items-center justify-center gap-1">
                    <span>Chave</span>
                    <ArrowUpDown className="h-3 w-3 opacity-60 shrink-0" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort('issue_type')}
                  className="w-28 md:w-32 px-2.5 py-2.5 cursor-pointer hover:text-blue-600 select-none whitespace-nowrap"
                  title="Ordenar por Tipo"
                >
                  <div className="flex items-center justify-center gap-1">
                    <span>Tipo</span>
                    <ArrowUpDown className="h-3 w-3 opacity-60 shrink-0" />
                  </div>
                </th>
                <th className="px-2.5 py-2.5">Resumo / Descrição</th>
                <th
                  onClick={() => handleSort('project_name')}
                  className="w-36 md:w-40 px-2.5 py-2.5 cursor-pointer hover:text-blue-600 select-none whitespace-nowrap"
                  title="Ordenar por Projeto / Cliente"
                >
                  <div className="flex items-center justify-center gap-1">
                    <Folder className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    <span>Projeto / Cliente</span>
                    <ArrowUpDown className="h-3 w-3 opacity-60 shrink-0" />
                  </div>
                </th>
                <th className="w-36 md:w-44 px-2.5 py-2.5 text-center">Status</th>
                <th className="w-32 md:w-40 px-2.5 py-2.5 text-center">Sprint</th>
                <th className="w-20 md:w-24 px-2.5 py-2.5 text-center whitespace-nowrap">Ação</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isLight ? 'divide-slate-200 bg-white' : 'divide-[#1e293b] bg-[#0d1117]'}`}>
              {sortedIssues.map((issue) => {
                const style = getStatusStyle(issue.status_category, issue.status, isLight ? 'light' : 'dark');
                const formattedDate = formatToDDMMAAAA(issue.due_date || (issue as any).delivery_date);
                const issueUrl = issue.url || (issue as any).issue_url;
                const isExpanded = expandedKeys.has(issue.issue_key);
                const childState = storiesCache[issue.issue_key];

                return (
                  <React.Fragment key={issue.issue_key}>
                    <tr
                      onClick={(e) => toggleRowExpansion(issue.issue_key, e)}
                      className={`group transition-colors cursor-pointer select-none ${
                        isExpanded
                          ? isLight ? 'bg-blue-50/60' : 'bg-[#182232]'
                          : isLight ? 'hover:bg-slate-50' : 'hover:bg-[#161b22]'
                      }`}
                    >
                      <td className="px-1 py-2.5 text-center text-slate-400">
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-blue-600 dark:text-blue-400 inline" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-blue-600 inline" />
                        )}
                      </td>

                      <td className="px-2.5 py-2.5 font-medium whitespace-nowrap text-slate-700 dark:text-slate-300">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs font-semibold">{formattedDate}</span>
                        </div>
                      </td>

                      <td className="px-2.5 py-2.5 whitespace-nowrap font-mono font-bold text-blue-600 dark:text-blue-400">
                        {issue.issue_key}
                      </td>

                      <td className="px-2.5 py-2.5 whitespace-nowrap text-slate-700 dark:text-slate-300 font-medium">
                        <span
                          className={`inline-block max-w-[120px] truncate px-2 py-0.5 rounded text-[11px] font-semibold align-middle ${
                            isLight ? 'bg-slate-100 text-slate-700 border border-slate-200' : 'bg-slate-800 text-slate-300 border border-slate-700'
                          }`}
                          title={issue.issue_type || (issue as any).type || ''}
                        >
                          {issue.issue_type || (issue as any).type || '-'}
                        </span>
                      </td>

                      <td
                        className="px-2.5 py-2.5 font-medium text-slate-900 dark:text-slate-100 truncate"
                        title={issue.summary}
                      >
                        {issue.summary}
                      </td>

                      <td className="px-2.5 py-2.5 text-slate-600 dark:text-slate-400 truncate">
                        <div className="font-semibold truncate" title={issue.project_name}>{issue.project_name}</div>
                        {issue.client && (
                          <div className="text-[10px] text-slate-500 truncate" title={`Cliente: ${issue.client}`}>Cli: {issue.client}</div>
                        )}
                      </td>

                      <td className="px-2.5 py-2.5 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider break-words ${style.badge}`}>
                          {issue.status}
                        </span>
                      </td>

                      <td className="px-2.5 py-2.5 text-center text-slate-700 dark:text-slate-300 font-medium">
                        {issue.sprint_name ? (
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold align-middle break-words ${
                              isLight ? 'bg-blue-50 text-blue-700 border border-blue-200/80' : 'bg-blue-950/60 text-blue-300 border border-blue-800/60'
                            }`}
                            title={issue.sprint_name}
                          >
                            {issue.sprint_name}
                          </span>
                        ) : (
                          <span className="text-slate-400 text-[11px]">-</span>
                        )}
                      </td>

                      <td className="px-2.5 py-2.5 whitespace-nowrap text-center" onClick={(e) => e.stopPropagation()}>
                        {issueUrl && (
                          <a
                            href={issueUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center justify-center gap-0.5 text-[11px] font-semibold text-blue-600 hover:text-blue-700 hover:underline"
                          >
                            Jira
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </td>
                    </tr>

                    {/* Collapsed/Expanded Panel with Child Stories */}
                    {isExpanded && (
                      <tr className="animate-fadeIn">
                        <td colSpan={9} className={`p-0 border-b ${
                          isLight ? 'bg-slate-50/90 border-blue-200/60' : 'bg-[#121721] border-blue-900/60'
                        }`}>
                          <div className="p-4 pl-10">
                            <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-200 dark:border-slate-800">
                              <div className="flex items-center gap-2">
                                <Layers className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                                <span className="font-bold text-xs text-slate-800 dark:text-slate-200">
                                  Histórias Vinculadas ao Chamado <span className="font-mono text-blue-600 dark:text-blue-400">{issue.issue_key}</span>
                                </span>
                                {childState && !childState.loading && (
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                                    {childState.stories.length}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* State 1: Loading */}
                            {childState?.loading && (
                              <div className="flex items-center justify-center py-6 gap-2 text-xs text-slate-500 font-medium">
                                <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                                <span>Buscando histórias vinculadas...</span>
                              </div>
                            )}

                            {/* State 2: Error */}
                            {childState?.error && (
                              <div className="p-3 rounded bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 text-xs">
                                {childState.error}
                              </div>
                            )}

                            {/* State 3: Loaded and empty */}
                            {childState && !childState.loading && childState.stories.length === 0 && !childState.error && (
                              <div className="py-4 text-center text-xs text-slate-500 italic">
                                Nenhuma história vinculada encontrada para este chamado.
                              </div>
                            )}

                            {/* State 4: Loaded with Stories */}
                            {childState && !childState.loading && childState.stories.length > 0 && (
                              <div className="overflow-x-auto rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0d1117] shadow-xs">
                                <table className="w-full text-left text-xs border-collapse">
                                  <thead className={`text-[10px] uppercase font-bold tracking-wider border-b ${
                                    isLight ? 'bg-slate-100 text-slate-600 border-slate-200' : 'bg-slate-900 text-slate-400 border-slate-800'
                                  }`}>
                                    <tr>
                                      <th className="px-4 py-2.5 w-36 font-bold">Número do Chamado</th>
                                      <th className="px-4 py-2.5 font-bold">Summary (Resumo)</th>
                                      <th className="px-4 py-2.5 w-36 font-bold">Status</th>
                                    </tr>
                                  </thead>
                                  <tbody className={`divide-y ${isLight ? 'divide-slate-100' : 'divide-slate-800/80'}`}>
                                    {childState.stories.map((story) => {
                                      const storyStyle = getStatusStyle(story.status_category || '', story.status, isLight ? 'light' : 'dark');
                                      return (
                                        <tr
                                          key={story.issue_key}
                                          className={`transition-colors ${
                                            isLight ? 'hover:bg-slate-50' : 'hover:bg-slate-800/40'
                                          }`}
                                        >
                                          {/* 1. Número do Chamado */}
                                          <td className="px-4 py-2.5 whitespace-nowrap font-mono font-bold text-blue-600 dark:text-blue-400">
                                            {story.url ? (
                                              <a
                                                href={story.url}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="inline-flex items-center gap-1 hover:underline"
                                                title={`Ver ${story.issue_key} no Jira`}
                                              >
                                                <span>{story.issue_key}</span>
                                                <ExternalLink className="h-3 w-3 opacity-70" />
                                              </a>
                                            ) : (
                                              <span>{story.issue_key}</span>
                                            )}
                                          </td>

                                          {/* 2. Summary */}
                                          <td className="px-4 py-2.5 font-medium text-slate-800 dark:text-slate-200">
                                            {story.summary}
                                          </td>

                                          {/* 3. Status */}
                                          <td className="px-4 py-2.5 whitespace-nowrap">
                                            <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${storyStyle.badge}`}>
                                              {story.status}
                                            </span>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
