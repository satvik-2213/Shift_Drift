const BASE = "/api";

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function getJSON(path, params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") query.set(key, value);
  }
  const qs = query.toString();
  const res = await fetch(`${BASE}${path}${qs ? `?${qs}` : ""}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error || `${path} failed (${res.status})`, res.status);
  }
  return res.json();
}

export const getMeta = () => getJSON("/meta");
export const getFilters = (params) => getJSON("/filters", params);
export const getSession = () => getJSON("/session");

export async function login(username, password) {
  const res = await fetch(`${BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error || "Login failed", res.status);
  return body;
}

export async function logout() {
  await fetch(`${BASE}/logout`, { method: "POST" });
}

export async function changePassword(currentPassword, newPassword) {
  const res = await fetch(`${BASE}/change-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error || "Password change failed", res.status);
  return body;
}

export const getOutliers = (params) => getJSON("/outliers", params);
export const getCombos = (params) => getJSON("/combos", params);
export const getStats = (params) => getJSON("/stats", params);
export const getHeadcount = (params) => getJSON("/headcount", params);
export const getHeadcountExits = (params) => getJSON("/headcount/exits", params);
export const getHeadcountJoins = (params) => getJSON("/headcount/joins", params);
export const getAttritionTrends = (params) => getJSON("/attrition/trends", params);
export const searchEmployees = (search) => getJSON("/employees", { search });

function csvUrl(path, params) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") query.set(key, value);
  }
  return `${BASE}${path}?${query.toString()}`;
}

export const outliersCsvUrl = (params) => csvUrl("/outliers.csv", params);
export const combosCsvUrl = (params) => csvUrl("/combos.csv", params);
export const attritionTrendsCsvUrl = (params) => csvUrl("/attrition/trends.csv", params);
export const attritionTrendsXlsxUrl = (params) => csvUrl("/attrition/trends.xlsx", params);
export const headcountCsvUrl = (params) => csvUrl("/headcount.csv", params);
