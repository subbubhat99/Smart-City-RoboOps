import type { Dashboard, Point, Restriction } from "./models";

export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL?.trim() || "/api/v1"
).replace(/\/+$/, "");
export function getToken() {
  return sessionStorage.getItem("roboops.session-token") || "";
}
export function setToken(token: string) {
  token
    ? sessionStorage.setItem("roboops.session-token", token)
    : sessionStorage.removeItem("roboops.session-token");
}

export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const token = getToken();
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
    const data = await response.json().catch(() => null);
    if (!response.ok)
      throw new Error(
        typeof data?.detail === "string"
          ? data.detail
          : `Request failed (${response.status}). Check the API configuration.`,
      );
    return data as T;
  } catch (error) {
    if (
      error instanceof TypeError ||
      (error instanceof DOMException && error.name === "AbortError")
    )
      throw new Error(
        "Cannot reach the RoboOps Python service. Start the backend and check the API URL. No operation was confirmed; refresh before retrying.",
      );
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export const operations = {
  dashboard: () => request<Dashboard>("/dashboard"),
  simulate: () =>
    request<Restriction>("/incidents/simulate", { method: "POST" }),
  reset: () => request<Dashboard>("/demo/reset", { method: "POST" }),
  action: (
    item: Restriction,
    action: string,
    robotId?: string,
    reason = "",
    outcome?: string,
  ) =>
    request<Restriction>(`/restrictions/${item.id}/actions`, {
      method: "POST",
      body: JSON.stringify({
        expectedRevision: item.revision,
        action,
        robotId,
        reason,
        ...(outcome ? { outcome } : {}),
      }),
    }),
  boundary: (item: Restriction, polygon: Point[]) =>
    request<Restriction>(`/restrictions/${item.id}/boundary`, {
      method: "PATCH",
      body: JSON.stringify({ expectedRevision: item.revision, polygon }),
    }),
};
