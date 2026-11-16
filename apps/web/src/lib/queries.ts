"use client";

import type { ReportFilters, TaskFilters } from "@resqgrid/api-client";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export const qk = {
  me: ["me"] as const,
  reports: ["reports"] as const,
  reportList: (f?: ReportFilters) => ["reports", f ?? {}] as const,
  report: (id: string) => ["report", id] as const,
  tasks: ["tasks"] as const,
  taskList: (f?: TaskFilters) => ["tasks", f ?? {}] as const,
  task: (id: string) => ["task", id] as const,
  teams: ["teams"] as const,
  suggestions: ["suggestions"] as const,
  resources: ["resources"] as const,
  shelters: ["shelters"] as const,
  incidents: ["incidents"] as const,
  kpis: ["kpis"] as const,
  notifications: ["notifications"] as const,
};

export const useReports = (f?: ReportFilters) => useQuery({ queryKey: qk.reportList(f), queryFn: () => api.reports.list(f) });
export const useReport = (id?: string) =>
  useQuery({ queryKey: qk.report(id ?? ""), queryFn: () => api.reports.get(id!), enabled: !!id });
export const useReportTimeline = (id?: string) =>
  useQuery({ queryKey: ["report-timeline", id], queryFn: () => api.reports.timeline(id!), enabled: !!id });
export const useTasks = (f?: TaskFilters) => useQuery({ queryKey: qk.taskList(f), queryFn: () => api.tasks.list(f) });
export const useTask = (id?: string) => useQuery({ queryKey: qk.task(id ?? ""), queryFn: () => api.tasks.get(id!), enabled: !!id });
export const useTaskTimeline = (id?: string) =>
  useQuery({ queryKey: ["task-timeline", id], queryFn: () => api.tasks.timeline(id!), enabled: !!id });
export const useTeams = () => useQuery({ queryKey: qk.teams, queryFn: api.teams.list });
export const useResources = (enabled = true) => useQuery({ queryKey: qk.resources, queryFn: api.resources.list, enabled });
export const useShelters = () => useQuery({ queryKey: qk.shelters, queryFn: api.shelters.list });
export const useIncidents = () => useQuery({ queryKey: qk.incidents, queryFn: api.incidents.list });
export const useKpis = () => useQuery({ queryKey: qk.kpis, queryFn: api.analytics.live });
/** People you can @mention (names and roles only); changes rarely. */
export const useDirectory = () => useQuery({ queryKey: ["directory"], queryFn: api.org.directory, staleTime: 5 * 60_000 });
export const useCapabilities = () => useQuery({ queryKey: ["capabilities"], queryFn: api.teams.capabilities, staleTime: 60_000 });
export const useCategoryRules = () => useQuery({ queryKey: ["category-rules"], queryFn: api.teams.categoryRules, staleTime: 60_000 });
export const useNotifications = () => useQuery({ queryKey: qk.notifications, queryFn: api.notifications.list });
export const useSuggestions = (reportId?: string, caps?: string[]) =>
  useQuery({
    queryKey: [...qk.suggestions, reportId, caps?.join(",")],
    queryFn: () => api.reports.suggestedTeams(reportId!, caps),
    enabled: !!reportId,
    // Cached 10 s, recomputed on team events (§6.2).
    staleTime: 10_000,
  });
