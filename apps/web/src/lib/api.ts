import { ApiError, createApiClient } from "@resqgrid/api-client";
import { tx } from "./i18n";

/** Points at the in-app mock by default; set NEXT_PUBLIC_API_URL to the FastAPI origin later. */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api/mock";

export const api = createApiClient({ baseUrl: API_URL });

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const reasons = (e.details?.reasons as string[] | undefined)?.map(formatReason).join(", ");
    return reasons ? `${e.message} — ${reasons}` : e.message;
  }
  return e instanceof Error ? e.message : tx("Something went wrong");
}

export function formatReason(r: string) {
  if (r.startsWith("missing:")) return `${tx("missing")} ${tx(capName(r.slice(8)))}`;
  if (r.startsWith("stale:")) return `${tx("stale")} ${r.slice(6)}`;
  return tx(r.replaceAll("_", " "));
}

/** Display name for a capability key, matching the catalog names (first_aid → "First aid"). */
export function capName(k: string) {
  return k === "search_rescue" ? "Search & rescue" : k.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());
}

export { ApiError };
