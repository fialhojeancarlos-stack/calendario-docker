import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, useEffect } from 'react';
import { JiraIssue, FilterState, JiraProject } from '../types';
import { fetchJiraIssues, syncJiraIssues, fetchJiraProjects, fetchJiraConfig } from '../services/apiService';
import { REQUIRED_PROJECTS, normalizeProjectName } from '../data/mockJiraData';

export function useJiraIssues(rangeStart: string, rangeEnd: string, filters: FilterState) {
  const queryClient = useQueryClient();
  const [syncStatusMsg, setSyncStatusMsg] = useState<{ type: 'info' | 'warning' | 'error' | 'success'; text: string } | null>(null);

  // 1. Fetch Config
  const configQuery = useQuery({
    queryKey: ['jiraConfig'],
    queryFn: fetchJiraConfig,
    staleTime: 1000 * 60 * 5,
  });

  // 2. Fetch Projects list
  const projectsQuery = useQuery<JiraProject[]>({
    queryKey: ['jiraProjects'],
    queryFn: fetchJiraProjects,
    staleTime: 1000 * 60 * 5,
    refetchInterval: 1000 * 60 * 3, // Auto refetch projects list every 3 min
  });

  // 3. Fetch Issues for Date Range
  const issuesQuery = useQuery<JiraIssue[]>({
    queryKey: ['jiraIssues', rangeStart, rangeEnd, filters.projects],
    queryFn: () => fetchJiraIssues(rangeStart, rangeEnd, filters.projects),
    staleTime: 1000 * 60 * 2,
    refetchInterval: 1000 * 60, // Refetch from cache/server every 1 min
  });

  // 4. Sync Mutation (force refresh from Jira)
  const syncMutation = useMutation({
    mutationFn: () => syncJiraIssues(rangeStart, rangeEnd, filters.projects, true),
    onMutate: () => {
      setSyncStatusMsg({ type: 'info', text: 'Sincronizando chamados com o Jira...' });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['jiraIssues'] });
      queryClient.invalidateQueries({ queryKey: ['jiraProjects'] });
      queryClient.invalidateQueries({ queryKey: ['jiraConfig'] });

      if (data.status === 'partial') {
        setSyncStatusMsg({
          type: 'warning',
          text: data.warning || 'Sincronização parcial realizada.',
        });
      } else {
        setSyncStatusMsg({
          type: 'success',
          text: `Sincronização concluída (${data.issuesFetched} chamados atualizados).`,
        });
      }

      // Auto clear success msg after 5s
      setTimeout(() => setSyncStatusMsg(null), 5000);
    },
    onError: (err: Error) => {
      setSyncStatusMsg({
        type: 'error',
        text: err.message || 'Falha na comunicação com o servidor Proxy do Jira.',
      });
    },
  });

  // Automatic Background Synchronization every 5 minutes when Jira is configured
  useEffect(() => {
    if (!configQuery.data?.isConfigured) return;

    // Trigger initial auto sync if not synced recently
    const timer = setTimeout(() => {
      syncMutation.mutate();
    }, 2000);

    // Set up 5 minute auto sync interval
    const interval = setInterval(() => {
      syncMutation.mutate();
    }, 5 * 60 * 1000);

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [configQuery.data?.isConfigured, rangeStart, rangeEnd]);

  // Raw issues with preserved project_name from jira_issues
  const rawIssues = useMemo(() => {
    const list = issuesQuery.data || [];
    return list.map((issue) => ({
      ...issue,
      project_name: (issue.project_name || issue.project_key || 'Sem Projeto').trim(),
    }));
  }, [issuesQuery.data]);

  // Helper match functions for responsive/cascading filters
  const matchProject = (issue: JiraIssue, selectedProjects: string[]): boolean => {
    if (!selectedProjects || selectedProjects.length === 0) return true;
    const projName = (issue.project_name || '').trim();
    const projKey = (issue.project_key || '').trim();
    const issueKey = (issue.issue_key || '').trim();

    return selectedProjects.some((selected) => {
      const selClean = selected.trim();
      if (selClean === projName || selClean === projKey) return true;

      const selLower = selClean.toLowerCase();
      const nameLower = projName.toLowerCase();
      const keyLower = projKey.toLowerCase();
      const iKeyLower = issueKey.toLowerCase();

      if (nameLower === selLower || keyLower === selLower) return true;
      if (nameLower.includes(selLower) || selLower.includes(nameLower)) return true;
      if (keyLower.includes(selLower) || selLower.includes(keyLower)) return true;
      if (iKeyLower.startsWith(selLower)) return true;

      if (selLower.includes('novo contrato') || selLower.includes('novos contratos') || selLower.includes('contratos')) {
        if (keyLower === 'ncon' || iKeyLower.startsWith('ncon-') || nameLower.includes('contrato')) return true;
      }
      if (keyLower === 'ncon' && (selLower.includes('novo') || selLower.includes('contrato') || selLower.includes('ncon'))) {
        return true;
      }

      return false;
    });
  };

  const matchClient = (issue: JiraIssue, selectedClients: string[]): boolean => {
    if (!selectedClients || selectedClients.length === 0) return true;
    if (!issue.client) return false;
    const issueClients = issue.client
      .split(/[,/;|]/)
      .map((c) => c.trim())
      .filter(Boolean);
    return issueClients.some((ic) => selectedClients.includes(ic));
  };

  const matchSprint = (issue: JiraIssue, selectedSprints: string[]): boolean => {
    if (!selectedSprints || selectedSprints.length === 0) return true;
    return Boolean(issue.sprint_name && selectedSprints.includes(issue.sprint_name));
  };

  const matchSearch = (issue: JiraIssue, searchQuery: string): boolean => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase().trim();
    const matchKey = issue.issue_key.toLowerCase().includes(q);
    const matchSummary = issue.summary.toLowerCase().includes(q);
    const matchAssignee = (issue.assignee_name || '').toLowerCase().includes(q);
    return matchKey || matchSummary || matchAssignee;
  };

  // Derive responsive/cascading filter options based on cross-selected filters
  const filterOptions = useMemo(() => {
    // 1. Projects available: filter issues by selected clients, sprints & search query
    const projectsSet = new Set<string>();
    rawIssues.forEach((issue) => {
      if (matchClient(issue, filters.clients) && matchSprint(issue, filters.sprints) && matchSearch(issue, filters.searchQuery)) {
        if (issue.project_name) projectsSet.add(issue.project_name);
      }
    });
    filters.projects.forEach((p) => projectsSet.add(p));
    if (filters.clients.length === 0 && filters.sprints.length === 0 && projectsQuery.data && Array.isArray(projectsQuery.data)) {
      projectsQuery.data.forEach((p) => {
        if (p.name) projectsSet.add(p.name);
      });
    }

    // 2. Clients available: filter issues by selected projects, sprints & search query
    const clientsSet = new Set<string>();
    rawIssues.forEach((issue) => {
      if (matchProject(issue, filters.projects) && matchSprint(issue, filters.sprints) && matchSearch(issue, filters.searchQuery)) {
        if (issue.client) {
          issue.client
            .split(/[,/;|]/)
            .map((c) => c.trim())
            .filter(Boolean)
            .forEach((c) => clientsSet.add(c));
        }
      }
    });
    filters.clients.forEach((c) => clientsSet.add(c));

    // 3. Sprints available: filter issues by selected projects, clients & search query
    const sprintsSet = new Set<string>();
    rawIssues.forEach((issue) => {
      if (matchProject(issue, filters.projects) && matchClient(issue, filters.clients) && matchSearch(issue, filters.searchQuery)) {
        if (issue.sprint_name) sprintsSet.add(issue.sprint_name);
      }
    });
    filters.sprints.forEach((s) => sprintsSet.add(s));

    const projectOptions = Array.from(projectsSet)
      .map((name) => ({
        key: name,
        name: name,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

    const clientOptions = Array.from(clientsSet).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const sprintOptions = Array.from(sprintsSet).sort((a, b) => a.localeCompare(b, 'pt-BR'));

    return { projectOptions, clientOptions, sprintOptions };
  }, [rawIssues, projectsQuery.data, filters]);

  // Apply filters to issues
  const filteredIssues = useMemo(() => {
    return rawIssues.filter((issue) => {
      return (
        matchProject(issue, filters.projects) &&
        matchClient(issue, filters.clients) &&
        matchSprint(issue, filters.sprints) &&
        matchSearch(issue, filters.searchQuery)
      );
    });
  }, [rawIssues, filters]);

  // Group filtered issues by due_date (YYYY-MM-DD)
  const issuesByDateMap = useMemo(() => {
    const map = new Map<string, JiraIssue[]>();
    filteredIssues.forEach((issue) => {
      if (!issue.due_date) return;
      const key = issue.due_date;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(issue);
    });
    return map;
  }, [filteredIssues]);

  return {
    rawIssues,
    filteredIssues,
    issuesByDateMap,
    filterOptions,
    isLoading: issuesQuery.isLoading,
    isError: issuesQuery.isError,
    error: issuesQuery.error,
    refetch: issuesQuery.refetch,
    syncMutation,
    config: configQuery.data,
    syncStatusMsg,
    setSyncStatusMsg,
  };
}
