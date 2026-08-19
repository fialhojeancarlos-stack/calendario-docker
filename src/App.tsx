import React, { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { User as SupabaseUser } from '@supabase/supabase-js';
import { LoginScreen } from './components/LoginScreen';
import { getSupabase } from './services/supabaseClient';
import { useCalendarRange } from './hooks/useCalendarRange';

import { useFilters } from './hooks/useFilters';
import { useJiraIssues } from './hooks/useJiraIssues';
import { CalendarHeader } from './components/CalendarHeader';
import { FilterBar } from './components/FilterBar';
import { MonthView } from './components/MonthView';
import { WeekView } from './components/WeekView';
import { DayView } from './components/DayView';
import { DayModal } from './components/DayModal';
import { SyncStatus } from './components/SyncStatus';
import { AdminSettingsModal, SettingsTab } from './components/AdminSettingsModal';
import { MockDataBanner } from './components/MockDataBanner';
import { Sidebar, SidebarTab } from './components/Sidebar';
import { ListView } from './components/ListView';
import { EpicsUnscheduledView } from './components/EpicsUnscheduledView';
import { JiraIssue } from './types';
import { useUserProfile } from './hooks/useUserProfile';
import { Filter, AlertCircle, RefreshCw, Calendar as CalendarIcon, User, CheckCircle2, Lock, ShieldAlert } from 'lucide-react';
import { format } from 'date-fns';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function CalendarAppContent() {
  const appVersion = import.meta.env.VITE_APP_VERSION || import.meta.env.VITE_SYSTEM_VERSION || '1.0.0';
  const [authUser, setAuthUser] = useState<SupabaseUser | null>(null);
  const [checkingAuth, setCheckingAuth] = useState<boolean>(true);
  const [isGuest, setIsGuest] = useState<boolean>(false);

  useEffect(() => {
    const client = getSupabase();
    if (!client) {
      setCheckingAuth(false);
      return;
    }

    client.auth.getSession().then(({ data: { session } }) => {
      setAuthUser(session?.user ?? null);
      setCheckingAuth(false);
    });

    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      setAuthUser(session?.user ?? null);
      setCheckingAuth(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleLogout = async () => {
    const client = getSupabase();
    if (client) {
      await client.auth.signOut();
    }
    setAuthUser(null);
    setIsGuest(false);
  };

  const { filters, setViewMode, toggleProject, toggleClient, toggleSprint, setSearchQuery, clearAllFilters, hasActiveFilters } = useFilters();

  const { currentDate, range, periodTitle, goPrev, goNext, goToday } = useCalendarRange(filters.viewMode);

  // Theme State: 'light' | 'dark' (Default is LIGHT as requested)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('jira_calendar_theme');
    return saved === 'dark' ? 'dark' : 'light';
  });

  const handleToggleTheme = () => {
    setTheme((prev) => {
      const nextTheme = prev === 'light' ? 'dark' : 'light';
      localStorage.setItem('jira_calendar_theme', nextTheme);
      return nextTheme;
    });
  };

  // Mantém a classe .dark no <html> em sincronia com o tema escolhido no app,
  // para que as classes "dark:" do Tailwind sigam o toggle do app e não o
  // prefers-color-scheme do sistema operacional.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const isLight = theme === 'light';

  // Sync viewMode from filters into useCalendarRange or vice versa
  const activeViewMode = filters.viewMode || 'month';

  // Responsive check: on small screens < 768px, default to week view if currently month
  const [isMobileScreen, setIsMobileScreen] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      setIsMobileScreen(window.innerWidth < 768);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const effectiveViewMode = isMobileScreen && activeViewMode === 'month' ? 'week' : activeViewMode;

  // Jira Issues hook
  const {
    rawIssues,
    filteredIssues,
    issuesByDateMap,
    filterOptions,
    isLoading,
    isError,
    error,
    refetch,
    syncMutation,
    config,
    syncStatusMsg,
    setSyncStatusMsg,
  } = useJiraIssues(range.startStr, range.endStr, filters);

  // Sidebar state
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('calendar');
  const [isSidebarMobileOpen, setIsSidebarMobileOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // Selected Day Modal State
  const [modalState, setModalState] = useState<{ isOpen: boolean; dateStr: string | null; issues: JiraIssue[] }>({
    isOpen: false,
    dateStr: null,
    issues: [],
  });

  // Calculate today issues count
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const todayIssuesCount = filteredIssues.filter((i) => i.delivery_date === todayStr).length;

  // Admin Settings Modal State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab>('env_status');

  const handleOpenSettings = (tab: SettingsTab = 'env_status') => {
    setSettingsInitialTab(tab);
    setIsSettingsOpen(true);
  };

  const handleOpenDayModal = (dateStr: string, dayIssues: JiraIssue[]) => {
    setModalState({
      isOpen: true,
      dateStr,
      issues: dayIssues,
    });
  };

  const handleCloseDayModal = () => {
    setModalState((prev) => ({ ...prev, isOpen: false }));
  };

  // Active selected user for testing profiles
  const [selectedTestEmail, setSelectedTestEmail] = useState<string | null>(() => localStorage.getItem('jira_selected_user_email'));

  // User permissions profile hook (must be called unconditionally at top level)
  const currentUserEmail = selectedTestEmail || authUser?.email || (isGuest ? 'Modo Convidado' : null);
  const { userProfile, hasScope, isReadOnly, canSync, canAccessSettings, refetchProfile } = useUserProfile(currentUserEmail);

  // Auto-redirect if active tab is not permitted
  useEffect(() => {
    if (!userProfile) return;
    if (sidebarTab === 'calendar' && !hasScope('menu_dashboard')) {
      if (hasScope('menu_relatorios')) setSidebarTab('list');
      else if (hasScope('menu_eventos')) setSidebarTab('epics');
    } else if (sidebarTab === 'list' && !hasScope('menu_relatorios')) {
      if (hasScope('menu_dashboard')) setSidebarTab('calendar');
      else if (hasScope('menu_eventos')) setSidebarTab('epics');
    } else if (sidebarTab === 'epics' && !hasScope('menu_eventos')) {
      if (hasScope('menu_dashboard')) setSidebarTab('calendar');
      else if (hasScope('menu_relatorios')) setSidebarTab('list');
    }
  }, [userProfile, sidebarTab]);

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="flex flex-col items-center space-y-3 text-slate-300">
          <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-medium tracking-wide">Validando autenticação no Supabase...</p>
        </div>
      </div>
    );
  }

  if (!authUser && !isGuest) {
    return (
      <LoginScreen 
        onLoginSuccess={(u) => {
          setAuthUser(u);
          setIsGuest(false);
          setSelectedTestEmail(null);
          localStorage.removeItem('jira_selected_user_email');
        }}
        onBypass={() => {
          setIsGuest(true);
        }}
        onSelectTestUser={(email) => {
          setSelectedTestEmail(email);
          localStorage.setItem('jira_selected_user_email', email);
          setIsGuest(true);
        }}
      />
    );
  }

  return (
    <div
      id="calendar-app-root"
      className={`flex flex-row h-screen w-screen overflow-hidden font-sans transition-colors ${
        isLight ? 'bg-slate-100 text-slate-800' : 'bg-[#0a0c10] text-slate-200'
      }`}
    >
      {/* Navigation Sidebar / Slidebar */}
      <Sidebar
        isOpen={isSidebarMobileOpen}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        onCloseMobile={() => setIsSidebarMobileOpen(false)}
        activeTab={sidebarTab}
        onSelectTab={(tab) => {
          setSidebarTab(tab);
        }}
        totalIssuesCount={filteredIssues.length}
        todayIssuesCount={todayIssuesCount}
        onSync={() => syncMutation.mutate()}
        isSyncing={syncMutation.isPending || isLoading}
        onOpenSettings={(tab) => handleOpenSettings(tab)}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        isDemoMode={config?.isDemoMode}
        userEmail={currentUserEmail}
        userProfile={userProfile}
        hasScope={hasScope}
        isReadOnly={isReadOnly}
        onLogout={handleLogout}
      />

      {/* Main Content Workspace */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Top Demo Banner if credentials are not configured */}
        {config?.isDemoMode && (
          <MockDataBanner onOpenSettings={() => handleOpenSettings('env_status')} />
        )}

        {/* Main Header Navigation */}
        <CalendarHeader
          periodTitle={periodTitle}
          viewMode={effectiveViewMode}
          onChangeViewMode={(mode) => {
            setViewMode(mode);
            setSidebarTab('calendar');
          }}
          onPrev={goPrev}
          onNext={goNext}
          onToday={goToday}
          onSync={() => syncMutation.mutate()}
          isSyncing={syncMutation.isPending || isLoading}
          lastSyncTimestamp={config?.lastSyncTimestamp}
          onOpenSettings={() => setIsSettingsOpen(true)}
          isDemoMode={config?.isDemoMode}
          theme={theme}
          onToggleTheme={handleToggleTheme}
          onToggleSidebar={() => setIsSidebarMobileOpen(!isSidebarMobileOpen)}
          userEmail={currentUserEmail}
          userProfile={userProfile}
          canAccessSettings={canAccessSettings}
          canSync={canSync}
          isReadOnly={isReadOnly}
          onLogout={handleLogout}
        />


        {/* Multiselect Filter Bar */}
        {sidebarTab !== 'epics' && (
          <FilterBar
            filters={filters}
            filterOptions={filterOptions}
            onToggleProject={toggleProject}
            onToggleClient={toggleClient}
            onToggleSprint={toggleSprint}
            onChangeViewMode={(mode) => setViewMode(mode)}
            onSearchChange={setSearchQuery}
            onClearAll={clearAllFilters}
            hasActiveFilters={hasActiveFilters}
            theme={theme}
          />
        )}

        {/* Sync Status / Warning / Progress Notification Banner */}
        <SyncStatus
          statusMsg={syncStatusMsg}
          onClose={() => setSyncStatusMsg(null)}
          onRetry={() => syncMutation.mutate()}
        />

        {/* Main Stage based on active Sidebar Tab */}
        <main className="flex-1 overflow-auto p-2 sm:p-3 md:p-4 flex flex-col min-h-0">
          {isLoading ? (
            /* Loading Skeleton State */
            <div
              className={`flex-1 flex flex-col items-center justify-center rounded-lg border p-12 shadow-2xs space-y-4 ${
                isLight ? 'border-slate-200 bg-white' : 'border-[#1e293b] bg-[#0d1117]'
              }`}
            >
              <RefreshCw className="h-8 w-8 animate-spin text-blue-500" />
              <div className="text-center">
                <p className={`text-sm font-bold ${isLight ? 'text-slate-800' : 'text-slate-200'}`}>
                  Carregando chamados do Jira...
                </p>
                <p className={`text-xs mt-1 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                  Buscando dados na janela visível e aplicando mapeamento de campos.
                </p>
              </div>
              {/* Skeleton Grid */}
              <div className="w-full max-w-4xl grid grid-cols-7 gap-2 pt-4">
                {Array.from({ length: 14 }).map((_, i) => (
                  <div
                    key={i}
                    className={`h-16 rounded border animate-pulse ${
                      isLight ? 'bg-slate-100 border-slate-200' : 'bg-[#161b22] border-[#30363d]'
                    }`}
                  />
                ))}
              </div>
            </div>
          ) : isError ? (
            /* Error State */
            <div className="flex-1 flex flex-col items-center justify-center rounded-lg border border-rose-400/50 bg-rose-50/80 p-12 text-center">
              <AlertCircle className="h-12 w-12 text-rose-600 mb-3" />
              <h3 className="text-base font-bold text-slate-900">
                Falha ao carregar entregas do Jira
              </h3>
              <p className="text-xs text-slate-600 max-w-md mt-1 mb-6">
                {(error as Error)?.message || 'Verifique se as credenciais do Jira estão corretas ou se o servidor proxy está ativo.'}
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => refetch()}
                  className="inline-flex items-center gap-1.5 rounded-md bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                >
                  <RefreshCw className="h-4 w-4" />
                  Tentar novamente
                </button>
                <button
                  onClick={() => setIsSettingsOpen(true)}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  Verificar Credenciais
                </button>
              </div>
            </div>
          ) : filteredIssues.length === 0 && hasActiveFilters ? (
            /* Empty Filter State */
            <div
              className={`flex-1 flex flex-col items-center justify-center rounded-lg border p-12 text-center ${
                isLight ? 'border-slate-200 bg-white' : 'border-[#1e293b] bg-[#0d1117]'
              }`}
            >
              <Filter className="h-12 w-12 text-slate-400 mb-3" />
              <h3 className={`text-base font-bold ${isLight ? 'text-slate-800' : 'text-slate-200'}`}>
                Nenhum chamado previsto para este período com os filtros aplicados
              </h3>
              <p className={`text-xs mt-1 mb-6 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                Tente remover alguns dos filtros selecionados ou alterar o intervalo de datas.
              </p>
              <button
                onClick={clearAllFilters}
                className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-xs font-semibold shadow-xs transition-colors cursor-pointer"
              >
                Limpar todos os filtros
              </button>
            </div>
          ) : (
            /* View Switcher based on Sidebar Tab */
            <div className="flex-1 min-h-0 flex flex-col h-full">
              {sidebarTab === 'calendar' && (
                <>
                  {effectiveViewMode === 'month' && (
                    <MonthView
                      currentDate={currentDate}
                      issuesByDateMap={issuesByDateMap}
                      onSelectDay={handleOpenDayModal}
                      theme={theme}
                    />
                  )}

                  {effectiveViewMode === 'week' && (
                    <WeekView
                      currentDate={currentDate}
                      issuesByDateMap={issuesByDateMap}
                      onSelectDay={handleOpenDayModal}
                      theme={theme}
                    />
                  )}

                  {effectiveViewMode === 'day' && (
                    <DayView
                      currentDate={currentDate}
                      dateStr={range.startStr}
                      issues={filteredIssues}
                      onSelectDay={handleOpenDayModal}
                      theme={theme}
                    />
                  )}
                </>
              )}

              {sidebarTab === 'list' && (
                <ListView
                  issues={filteredIssues}
                  onSelectIssue={(issue) => {
                    const issueDate = issue.due_date || (issue as any).delivery_date;
                    if (issueDate) {
                      const dayIssues = issuesByDateMap[issueDate] || [issue];
                      handleOpenDayModal(issueDate, dayIssues);
                    }
                  }}
                  theme={theme}
                />
              )}

              {sidebarTab === 'epics' && (
                <EpicsUnscheduledView
                  theme={theme}
                  canSync={canSync}
                  isReadOnly={isReadOnly}
                />
              )}
            </div>
          )}
        </main>

        {/* Footer Info Bar */}
        <footer
          className={`border-t px-6 py-2 flex items-center justify-between text-[11px] font-medium transition-colors ${
            isLight
              ? 'border-slate-200 bg-white text-slate-600'
              : 'border-[#1e293b] bg-[#0a0c10] text-slate-500'
          }`}
        >
          <div className="flex items-center gap-3">
            <span>
              Total no período: <strong className={isLight ? 'text-slate-900' : 'text-slate-300'}>{filteredIssues.length}</strong> chamados
            </span>
            <span>•</span>
            <span>
              Instância: <strong className={isLight ? 'text-slate-900' : 'text-slate-300'}>aztecnologia.atlassian.net</strong>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span>Calendário de Entregas Jira</span>
            <span>•</span>
            <span className="font-semibold text-slate-500 dark:text-slate-400">Versão: {appVersion}</span>
          </div>
        </footer>
      </div>

      {/* Day Inspector Modal */}
      <DayModal
        isOpen={modalState.isOpen}
        dateStr={modalState.dateStr}
        issues={modalState.issues}
        onClose={handleCloseDayModal}
        theme={theme}
      />

      {/* Admin / Jira Credentials Settings Modal */}
      <AdminSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => {
          setIsSettingsOpen(false);
          refetchProfile();
        }}
        config={config}
        onConfigSaved={() => {
          queryClient.invalidateQueries({ queryKey: ['jiraConfig'] });
          queryClient.invalidateQueries({ queryKey: ['jiraIssues'] });
          refetchProfile();
        }}
        theme={theme}
        initialTab={settingsInitialTab}
        currentUserProfile={userProfile}
        isReadOnly={isReadOnly}
        onUserPermissionsUpdated={refetchProfile}
      />
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <CalendarAppContent />
    </QueryClientProvider>
  );
}
