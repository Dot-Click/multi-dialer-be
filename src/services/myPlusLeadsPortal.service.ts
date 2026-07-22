import { envConfig } from "../lib/config";

const PORTAL_BASE_URL = "https://portal.myplusleads.com";

export interface PortalAccount {
  id: string;
  name: string;
  email: string;
  status: string;
  billingType: string;
  monthlyFee: number;
  baseZip: string | null;
}

class MyPlusLeadsPortalError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 502) {
    super(message);
    this.statusCode = statusCode;
  }
}

// In-memory session cache. This portal is authenticated by a browser-style
// session cookie (JSESSIONID + AWS ALB stickiness cookies), not the bearer
// token used by api.myplusleads.com elsewhere in this integration — there is
// no documented API for this, it's reverse-engineered from the enterprise
// dashboard itself. Re-login happens lazily whenever a call looks unauthorized.
let cachedCookieHeader: string | null = null;

function extractSetCookies(res: Response): string[] {
  const getSetCookie = (res.headers as any).getSetCookie;
  if (typeof getSetCookie === "function") {
    return getSetCookie.call(res.headers);
  }
  // Fallback for runtimes without Headers.getSetCookie(): only sees the last
  // Set-Cookie header, but better than nothing.
  const single = res.headers.get("set-cookie");
  return single ? [single] : [];
}

function buildCookieHeader(setCookies: string[]): string {
  const wanted = ["JSESSIONID", "AWSALB", "AWSALBCORS"];
  const pairs: string[] = [];
  for (const raw of setCookies) {
    const [pair] = raw.split(";");
    const [name] = pair.split("=");
    if (wanted.includes(name.trim())) {
      pairs.push(pair.trim());
    }
  }
  return pairs.join("; ");
}

async function loginToPortal(): Promise<string> {
  const email = envConfig.MYPLUSLEADS_PORTAL_EMAIL;
  const password = envConfig.MYPLUSLEADS_PORTAL_PASSWORD;
  if (!email || !password) {
    throw new MyPlusLeadsPortalError("MYPLUSLEADS_PORTAL_EMAIL/PASSWORD are not configured.", 500);
  }

  const body = new URLSearchParams({ email, password, rememberMe: "on" });

  const res = await fetch(`${PORTAL_BASE_URL}/log-in`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    redirect: "manual",
  });

  // A successful login responds with a 302 redirect and sets the session cookies.
  if (res.status !== 302 && res.status !== 200) {
    throw new MyPlusLeadsPortalError(`MyPlusLeads portal login failed: ${res.status}`, 502);
  }

  const cookieHeader = buildCookieHeader(extractSetCookies(res));
  if (!cookieHeader.includes("JSESSIONID")) {
    throw new MyPlusLeadsPortalError("MyPlusLeads portal login did not return a session cookie.", 502);
  }

  cachedCookieHeader = cookieHeader;
  return cookieHeader;
}

async function getSession(): Promise<string> {
  if (cachedCookieHeader) return cachedCookieHeader;
  return loginToPortal();
}

async function fetchAccountList(cookieHeader: string): Promise<any> {
  const res = await fetch(`${PORTAL_BASE_URL}/api/referral-admin/common/get-account-list`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader,
    },
    body: JSON.stringify({
      sortField: "id",
      sortOrder: "asc",
      searchBy: { field: "lastName", value: "" },
      filter: {
        statusActive: false,
        statusPastDue: false,
        statusDisabled: false,
        billingTypeEnterprise: false,
      },
      current: 1,
      // High enough to fetch every account in one page for a Client-managed
      // account list; revisit with real pagination if this ever grows large.
      rowCount: "1000",
    }),
  });

  return { res, data: res.ok ? await res.json().catch(() => null) : null };
}

/**
 * Lists every sub-account on Client's MyPlusLeads enterprise portal, by
 * logging in with Client's own portal credentials (session-cookie based,
 * not the token API). Used only to help Client pick an account by name/email
 * when registering one — MyPlusLeads never exposes sub-account passwords via
 * any API, so that still has to be entered manually afterward.
 */
export async function listPortalAccounts(): Promise<PortalAccount[]> {
  let cookieHeader = await getSession();
  let { res, data } = await fetchAccountList(cookieHeader);

  if (!res.ok || data?.status !== "SUCCESS") {
    // Session likely expired — log in fresh and retry once.
    cachedCookieHeader = null;
    cookieHeader = await loginToPortal();
    ({ res, data } = await fetchAccountList(cookieHeader));
  }

  if (!res.ok || data?.status !== "SUCCESS") {
    throw new MyPlusLeadsPortalError(`MyPlusLeads portal account list failed: ${res.status}`, 502);
  }

  const rows = data?.data?.rows ?? [];
  return rows.map((row: any) => ({
    id: String(row.id),
    name: row.name ?? row.email ?? row.id,
    email: row.email ?? "",
    status: row.status ?? "UNKNOWN",
    billingType: row.billingType ?? "",
    monthlyFee: typeof row.monthlyFee === "number" ? row.monthlyFee : 0,
    baseZip: row.baseZip ?? null,
  }));
}
