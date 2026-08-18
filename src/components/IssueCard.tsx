import React from 'react';
import { JiraIssue } from '../types';

interface IssueCardProps {
  issue: JiraIssue;
  compact?: boolean;
  theme?: 'light' | 'dark';
  onClick?: () => void;
}

export function getStatusStyle(category?: string, statusName?: string, theme: 'light' | 'dark' = 'light') {
  const cat = (category || '').toLowerCase();
  const name = (statusName || '').toLowerCase().trim();

  // 1 - FINALIZADO = VERDE
  const isFinalizado =
    cat === 'done' ||
    name.includes('finaliz') ||
    name.includes('conclu') ||
    name.includes('entreg') ||
    name.includes('pronto para publica') ||
    name.includes('resolv') ||
    name.includes('fechado') ||
    name === 'done';

  if (isFinalizado) {
    return theme === 'light'
      ? {
          cardBorderBg: 'border border-emerald-500 bg-emerald-50/90 hover:bg-emerald-100/90 text-slate-900',
          keyText: 'text-emerald-700 font-bold',
          badge: 'bg-emerald-600 text-white font-bold',
          summaryText: 'text-slate-800 font-medium',
        }
      : {
          cardBorderBg: 'border border-emerald-500 bg-emerald-950/50 hover:bg-emerald-900/60 text-emerald-100',
          keyText: 'text-emerald-400 font-bold',
          badge: 'bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 font-semibold',
          summaryText: 'text-slate-200 font-medium',
        };
  }

  // 2 - BACKLOG = CINZA
  const isBacklog =
    name.includes('backlog') ||
    name === 'to do' ||
    name === 'a fazer' ||
    name === 'aguardando' ||
    name === 'criado' ||
    cat === 'to do';

  if (isBacklog) {
    return theme === 'light'
      ? {
          cardBorderBg: 'border border-slate-300 bg-slate-100/90 hover:bg-slate-200/90 text-slate-900',
          keyText: 'text-slate-700 font-bold',
          badge: 'bg-slate-600 text-white font-bold',
          summaryText: 'text-slate-700 font-medium',
        }
      : {
          cardBorderBg: 'border border-slate-600 bg-slate-800/50 hover:bg-slate-800/80 text-slate-200',
          keyText: 'text-slate-300 font-bold',
          badge: 'bg-slate-700 text-slate-200 border border-slate-600 font-semibold',
          summaryText: 'text-slate-300 font-medium',
        };
  }

  // 3 - DEMAIS STATUS = AMARELO
  return theme === 'light'
    ? {
        cardBorderBg: 'border border-amber-500 bg-amber-50/90 hover:bg-amber-100/90 text-slate-900',
        keyText: 'text-amber-800 font-bold',
        badge: 'bg-amber-500 text-slate-950 font-bold',
        summaryText: 'text-amber-950 font-medium',
      }
    : {
        cardBorderBg: 'border border-amber-500 bg-amber-950/50 hover:bg-amber-900/60 text-amber-100',
        keyText: 'text-amber-400 font-bold',
        badge: 'bg-amber-500/30 text-amber-300 border border-amber-500/40 font-semibold',
        summaryText: 'text-amber-100 font-medium',
      };
}

export const IssueCard: React.FC<IssueCardProps> = ({ issue, compact = true, theme = 'light', onClick }) => {
  const style = getStatusStyle(issue.status_category, issue.status, (theme as 'light' | 'dark') || 'light');
  const hasSummary = Boolean(issue.summary && issue.summary.trim() !== '');

  return (
    <div
      id={`issue-card-${issue.issue_key}`}
      onClick={onClick}
      className={`group relative rounded-md transition-all cursor-pointer select-none shadow-xs shrink-0 ${style.cardBorderBg} ${
        compact ? 'px-1.5 py-0.5 space-y-0.5' : 'p-3 space-y-2'
      }`}
      title={`${issue.issue_key}${hasSummary ? `: ${issue.summary}` : ''} (${issue.status})`}
    >
      {/* Top Row: Issue Key & Status Tag */}
      <div className="flex items-center justify-between gap-1 leading-none">
        <span className={`font-mono text-[10px] font-bold tracking-tight ${style.keyText}`}>
          {issue.issue_key}
        </span>
        <span className={`text-[8.5px] px-1 py-0.5 rounded tracking-wide uppercase shrink-0 truncate max-w-[100px] ${style.badge}`}>
          {issue.status}
        </span>
      </div>

      {/* Summary Row */}
      {hasSummary && (
        <div className={`truncate text-[9.5px] leading-tight font-medium ${style.summaryText}`}>
          {issue.summary}
        </div>
      )}

      {/* Extended details for non-compact view */}
      {!compact && (
        <div className={`mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] pt-1.5 border-t ${
          theme === 'light' ? 'border-slate-200 text-slate-600' : 'border-slate-700 text-slate-400'
        }`}>
          <span className="font-semibold">{issue.project_name}</span>
          {issue.client && <span>• Cliente: {issue.client}</span>}
          {issue.sprint_name && <span>• {issue.sprint_name}</span>}
        </div>
      )}
    </div>
  );
};
