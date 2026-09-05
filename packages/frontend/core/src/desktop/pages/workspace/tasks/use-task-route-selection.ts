import type {
  CopilotTask,
  CopilotTaskFilter,
} from '@affine/core/modules/copilot-tasks/utils';
import {
  filterCopilotTasks,
  getCopilotTaskFilter,
} from '@affine/core/modules/copilot-tasks/utils';
import { useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

const taskFilters = new Set<CopilotTaskFilter>([
  'all',
  'active',
  'approval',
  'completed',
]);

const parseTaskFilter = (value: string | null) =>
  value && taskFilters.has(value as CopilotTaskFilter)
    ? (value as CopilotTaskFilter)
    : null;

export const useTaskRouteSelection = (tasks: CopilotTask[], ready: boolean) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const routedTaskId = searchParams.get('taskId');
  const routedFilter = parseTaskFilter(searchParams.get('filter'));
  const routedTask = useMemo(
    () => tasks.find(task => task.id === routedTaskId) ?? null,
    [routedTaskId, tasks]
  );
  const filter = useMemo<CopilotTaskFilter>(() => {
    if (!routedTask) {
      return routedFilter ?? 'active';
    }
    if (
      routedFilter &&
      filterCopilotTasks([routedTask], routedFilter).length > 0
    ) {
      return routedFilter;
    }
    return getCopilotTaskFilter(routedTask);
  }, [routedFilter, routedTask]);

  const updateRoute = useCallback(
    (taskId: string | null, nextFilter: CopilotTaskFilter) => {
      setSearchParams(
        current => {
          const next = new URLSearchParams(current);
          next.set('filter', nextFilter);
          if (taskId) {
            next.set('taskId', taskId);
          } else {
            next.delete('taskId');
          }
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const visibleTasks = useMemo(
    () => filterCopilotTasks(tasks, filter),
    [filter, tasks]
  );
  const selectedTask =
    !ready && routedTaskId && !routedTask
      ? null
      : (routedTask ?? visibleTasks[0] ?? null);

  useEffect(() => {
    if (!ready) return;
    if (selectedTask?.id !== routedTaskId || routedFilter !== filter) {
      updateRoute(selectedTask?.id ?? null, filter);
    }
  }, [
    filter,
    ready,
    routedFilter,
    routedTaskId,
    selectedTask?.id,
    updateRoute,
  ]);

  const selectTask = useCallback(
    (taskId: string) => {
      const task = tasks.find(item => item.id === taskId);
      if (!task) return;
      const nextFilter = filter === 'all' ? 'all' : getCopilotTaskFilter(task);
      updateRoute(taskId, nextFilter);
    },
    [filter, tasks, updateRoute]
  );

  const selectFilter = useCallback(
    (nextFilter: CopilotTaskFilter) => {
      const firstTask = filterCopilotTasks(tasks, nextFilter)[0] ?? null;
      updateRoute(firstTask?.id ?? null, nextFilter);
    },
    [tasks, updateRoute]
  );

  return {
    filter,
    selectedTask,
    selectFilter,
    selectTask,
    visibleTasks,
  };
};
