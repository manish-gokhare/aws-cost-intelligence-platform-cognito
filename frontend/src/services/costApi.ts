import { fetchAuthSession } from "aws-amplify/auth";
import type { CostDashboardData } from "../types/cost";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ??
  "http://127.0.0.1:8000";

interface DateRange {
  startDate?: string;
  endDate?: string;
}

function buildDateQuery(
  dateRange?: DateRange,
): string {
  const params = new URLSearchParams();

  if (dateRange?.startDate) {
    params.set(
      "start_date",
      dateRange.startDate,
    );
  }

  if (dateRange?.endDate) {
    params.set(
      "end_date",
      dateRange.endDate,
    );
  }

  const queryString = params.toString();

  return queryString
    ? `?${queryString}`
    : "";
}


// ---------------------------------------------------------------------------
// Cognito authentication
// ---------------------------------------------------------------------------

async function getAuthHeaders(
  forceRefresh = false,
): Promise<Record<string, string>> {
  const session = await fetchAuthSession({
    forceRefresh,
  });

  const accessToken =
    session.tokens?.accessToken?.toString();

  const idToken =
    session.tokens?.idToken?.toString();

  if (!accessToken) {
    throw new Error(
      "No Cognito access token is available.",
    );
  }

  if (!idToken) {
    throw new Error(
      "No Cognito ID token is available.",
    );
  }

  return {
    Authorization: `Bearer ${accessToken}`,
    "X-ID-Token": idToken,
  };
}


// ---------------------------------------------------------------------------
// Authenticated GET
// ---------------------------------------------------------------------------

async function authenticatedGet(
  url: string,
): Promise<Response> {
  // First attempt using the current Cognito session.
  let headers = await getAuthHeaders();

  let response = await fetch(url, {
    method: "GET",
    headers,
  });

  // If the backend says the token is unauthorized,
  // refresh the Cognito session and retry once.
  if (response.status === 401) {
    headers = await getAuthHeaders(true);

    response = await fetch(url, {
      method: "GET",
      headers,
    });
  }

  return response;
}


// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export async function fetchCostDashboard(
  dateRange?: DateRange,
): Promise<CostDashboardData> {
  const queryString =
    buildDateQuery(dateRange);

  const url =
    `${API_BASE_URL}/api/v1/costs/dashboard` +
    queryString;

  const response =
    await authenticatedGet(url);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch cost dashboard: ${response.status} ${response.statusText}`,
    );
  }

  return response.json();
}


// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export async function fetchCostServices(
  dateRange?: DateRange,
): Promise<CostDashboardData["serviceCosts"]> {
  const queryString =
    buildDateQuery(dateRange);

  const url =
    `${API_BASE_URL}/api/v1/costs/services` +
    queryString;

  const response =
    await authenticatedGet(url);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch service costs: ${response.status} ${response.statusText}`,
    );
  }

  return response.json();
}
