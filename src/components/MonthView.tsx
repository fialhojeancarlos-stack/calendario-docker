import React, { useRef, useState, useEffect } from 'react';
import { CalendarWeek, CalendarDay, JiraIssue } from '../types';
import { buildMonthGrid } from '../utils/dateUtils';
import { IssueCard } from './IssueCard';

interface MonthViewProps {
  currentDate: Date;
  issuesByDateMap: Map<string, JiraIssue[]>;
  onSelectDay: (dateStr: string, issues: JiraIssue[]) => void;
  theme?: 'light' | 'dark';
}

const WEEKDAY_NAMES = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];

interface MonthDayCellProps {
  day: CalendarDay;
  onSelectDay: (dateStr: string, issues: JiraIssue[]) => void;
  theme?: 'light' | 'dark';
}

const MonthDayCell: React.FC<MonthDayCellProps> = ({ day, onSelectDay, theme = 'light' }) => {
  const cellRef = useRef<HTMLDivElement>(null);
  const [maxVisibleCount, setMaxVisibleCount] = useState<number>(1);

  const isLight = theme === 'light';

  // Dynamic calculation of cards capacity via ResizeObserver
  useEffect(() => {
    const el = cellRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const height = entry.contentRect.height;
        const totalIssues = day.issues.length;
        if (totalIssues === 0) {
          setMaxVisibleCount(0);
          continue;
        }

        // Header ~ 22px + top/bottom padding ~ 6px
        const headerAndPadding = 28;
        const overflowBtnHeight = 18;
        const cardHeight = 30; // compact card height

        const available = height - headerAndPadding;
        
        // Max cards that fit WITHOUT overflow button
        let count = Math.floor(available / cardHeight);

        // If total issues exceeds count, we need an overflow button
        if (totalIssues > count) {
          const availableWithBtn = available - overflowBtnHeight;
          count = Math.floor(availableWithBtn / cardHeight);
        }

        // Always show at least 1 card when there are issues
        setMaxVisibleCount(Math.max(1, count));
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [day.issues.length]);

  const totalIssues = day.issues.length;
  const visibleIssues = day.issues.slice(0, maxVisibleCount);
  const overflowCount = totalIssues - visibleIssues.length;

  return (
    <div
      ref={cellRef}
      id={`month-cell-${day.dateString}`}
      onClick={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).id?.startsWith('month-cell-header')) {
          onSelectDay(day.dateString, day.issues);
        }
      }}
      className={`group relative flex flex-col min-h-[105px] h-full p-1.5 border-b border-r transition-colors overflow-hidden ${
        isLight ? 'border-slate-200' : 'border-[#1e293b]'
      } ${
        day.isToday
          ? isLight
            ? 'bg-blue-50/70 border-blue-300'
            : 'bg-[#11141b]'
          : day.isCurrentMonth
          ? isLight
            ? 'bg-white hover:bg-slate-50'
            : 'bg-[#0a0c10]'
          : isLight
          ? 'bg-slate-100/60 text-slate-400'
          : 'bg-[#0a0c10]/40 opacity-40'
      }`}
    >
      {/* Day Header Number */}
      <div
        id={`month-cell-header-${day.dateString}`}
        onClick={() => onSelectDay(day.dateString, day.issues)}
        className="flex items-center justify-between pb-1 cursor-pointer shrink-0"
      >
        <span
          className={`text-xs font-bold ${
            day.isToday
              ? 'text-blue-600 font-extrabold'
              : day.isCurrentMonth
              ? isLight
                ? 'text-slate-800'
                : 'text-slate-200'
              : isLight
              ? 'text-slate-400'
              : 'text-slate-500'
          }`}
        >
          {day.dayNumber}
        </span>

        {totalIssues > 0 && (
          <span
            className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
              isLight
                ? 'bg-slate-100 border-slate-300 text-slate-700'
                : 'bg-[#161b22] border-[#30363d] text-slate-300'
            }`}
          >
            {totalIssues}
          </span>
        )}
      </div>

      {/* Cards List */}
      <div className="flex-1 space-y-1 overflow-hidden mt-0.5 flex flex-col justify-start">
        {visibleIssues.map((issue) => (
          <IssueCard
            key={issue.issue_key}
            issue={issue}
            compact={true}
            theme={theme}
            onClick={() => onSelectDay(day.dateString, day.issues)}
          />
        ))}
      </div>

      {/* Overflow Indicator Button */}
      {overflowCount > 0 && (
        <button
          id={`overflow-btn-${day.dateString}`}
          onClick={(e) => {
            e.stopPropagation();
            onSelectDay(day.dateString, day.issues);
          }}
          className={`mt-1 shrink-0 w-full text-left px-1 py-0.5 text-[10px] font-bold rounded transition-colors truncate cursor-pointer ${
            isLight 
              ? 'text-blue-600 hover:text-blue-800 hover:bg-blue-50' 
              : 'text-slate-400 hover:text-blue-400 hover:bg-[#161b22]'
          }`}
        >
          + {overflowCount} {overflowCount === 1 ? 'mais' : 'mais'}
        </button>
      )}
    </div>
  );
};

export const MonthView: React.FC<MonthViewProps> = ({ currentDate, issuesByDateMap, onSelectDay, theme = 'light' }) => {
  const weeks: CalendarWeek[] = buildMonthGrid(currentDate, issuesByDateMap);
  const isLight = theme === 'light';

  return (
    <div
      className={`flex flex-col h-full w-full border rounded-lg overflow-hidden shadow-xs transition-colors ${
        isLight ? 'border-slate-200 bg-slate-200/50' : 'border-[#1e293b] bg-[#010409]'
      }`}
    >
      {/* Grid Weekday Headers */}
      <div
        className={`grid grid-cols-7 h-10 border-b items-center text-center text-[10px] font-bold uppercase tracking-widest ${
          isLight
            ? 'bg-slate-100 border-slate-200 text-slate-600'
            : 'bg-[#0d1117] border-[#1e293b] text-slate-500'
        }`}
      >
        {WEEKDAY_NAMES.map((name) => (
          <div key={name}>{name}</div>
        ))}
      </div>

      {/* 7x6 or 7x5 Month Grid dynamically fitting all weeks */}
      <div
        className="grid grid-cols-7 flex-1 border-collapse min-h-0 overflow-y-auto"
        style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(105px, 1fr))` }}
      >
        {weeks.flatMap((week) =>
          week.days.map((day) => (
            <MonthDayCell key={day.dateString} day={day} onSelectDay={onSelectDay} theme={theme} />
          ))
        )}
      </div>
    </div>
  );
};
