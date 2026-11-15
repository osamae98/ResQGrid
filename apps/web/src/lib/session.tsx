"use client";

import { ApiError, type Me, type Role } from "@resqgrid/api-client";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { qk } from "./queries";

export function useSession() {
  const q = useQuery<Me, Error>({
    queryKey: qk.me,
    queryFn: api.auth.me,
    retry: (n, e) => !(e instanceof ApiError && e.status === 401) && n < 2,
    staleTime: 60_000,
    refetchInterval: false,
  });
  const unauthenticated = q.error instanceof ApiError && q.error.status === 401;
  return { me: q.data, user: q.data?.user, org: q.data?.organization, isLoading: q.isLoading, unauthenticated };
}

/** Client-side mirror of the permission matrix (§3.2). The server enforces it; this only shapes the UI. */
export const can = {
  dispatch: (r?: Role) => r === "admin" || r === "dispatcher",
  triage: (r?: Role) => r === "admin" || r === "dispatcher",
  override: (r?: Role) => r === "admin",
  viewPii: (r?: Role) => r === "admin" || r === "dispatcher" || r === "responder",
  manageTeams: (r?: Role) => r === "admin" || r === "volunteer_coordinator",
  manageResources: (r?: Role) => r === "admin" || r === "volunteer_coordinator",
  reserveResources: (r?: Role) => r === "admin" || r === "dispatcher",
  manageShelters: (r?: Role) => r === "admin" || r === "volunteer_coordinator",
  archive: (r?: Role) => r === "admin" || r === "dispatcher",
  restore: (r?: Role) => r === "admin",
  createReport: (r?: Role) => r !== "viewer",
  admin: (r?: Role) => r === "admin",
};

export function homeFor(role?: Role) {
  switch (role) {
    case "responder":
      return "/responder";
    case "volunteer_coordinator":
      return "/resources";
    case "viewer":
      return "/map";
    default:
      return "/dispatch";
  }
}
