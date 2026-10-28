import { supabase } from './supabaseClient';

const rawBase =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_API_BASE || '';

const cleanedBase = rawBase.trim().replace(/\/+$/, '');

// Ignore any stale temporary tunnel and always use the live personal quant engine
const isValidBase = cleanedBase && !cleanedBase.includes('trycloudflare.com');

export const API_BASE = isValidBase
  ? cleanedBase
  : 'https://quantos-api.onrender.com';

if (process.env.NODE_ENV === 'development') {
  console.info(`QuantOS API base: ${API_BASE}`);
}

const TOKEN_KEY = 'prismflow_token';
const USER_KEY = 'prismflow_user';
const REFRESH_KEY = 'quantos_refresh_token';

const GENERIC_SERVICE_ERROR = 'Quanteinstein service is temporarily unavailable. Please try again shortly.';
const GENERIC_REQUEST_ERROR = 'Something went wrong. Please try again.';

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  onboarding_completed?: boolean;
  tier?: 'RETAIL' | 'PRO' | 'ENTERPRISE';
  organization_id?: string | null;
  role?: string;
};

export const DEFAULT_DEMO_USER: AuthUser = {
  id: 'demo_user',
  email: 'demo@prismflow.com',
  name: 'Executive Trader',
  tier: 'ENTERPRISE',
  role: 'ORGANIZATION_ADMIN',
  onboarding_completed: true,
  organization_id: 'tier1alpha_org',
};

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function getToken(): string {
  if (typeof window === 'undefined') return 'demo_enterprise_dev_token';
  const local =
    localStorage.getItem(TOKEN_KEY) ||
    localStorage.getItem('token') ||
    localStorage.getItem('prismflow_token');
  if (local) return local;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
        const item = localStorage.getItem(key);
        if (item) {
          const parsed = JSON.parse(item);
          if (parsed?.access_token) {
            localStorage.setItem(TOKEN_KEY, parsed.access_token);
            return parsed.access_token;
          }
        }
      }
    }
  } catch {}
  return 'demo_enterprise_dev_token';
}

export function getUser(): AuthUser | null {
  if (typeof window === 'undefined') return DEFAULT_DEMO_USER;
  try {
    const raw =
      localStorage.getItem(USER_KEY) ||
      localStorage.getItem('quanteinstein_user') ||
      localStorage.getItem('user');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch {}
  return DEFAULT_DEMO_USER;
}

export function saveAuth(data: { token?: string; access_token?: string; refresh_token?: string; user?: AuthUser }) {
  if (typeof window === 'undefined') return;
  const access = data?.access_token || data?.token;
  if (access) {
    localStorage.setItem(TOKEN_KEY, access);
    localStorage.setItem('token', access);
    localStorage.setItem('prismflow_token', access);
  }
  if (data?.refresh_token) localStorage.setItem(REFRESH_KEY, data.refresh_token);
  if (data?.user) {
    const serialized = JSON.stringify(data.user);
    localStorage.setItem(USER_KEY, serialized);
    localStorage.setItem('quanteinstein_user', serialized);
    localStorage.setItem('user', serialized);
  }
}

export function clearAuth() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem('token');
  localStorage.removeItem('prismflow_token');
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem('quanteinstein_user');
  localStorage.removeItem('user');
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem('prismflow_last_job');
}

export async function logout() {
  const token = getToken();
  clearAuth();
  if (supabase) {
    try {
      await supabase.auth.signOut();
    } catch {}
  }
  if (token) {
    fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    }).catch(() => {});
  }
  if (typeof window !== 'undefined') {
    window.location.href = '/login';
  }
}

function formatDetailItem(item: unknown): string {
  if (item == null) return '';
  if (typeof item === 'string') return item;
  if (typeof item === 'object') {
    const obj = item as Record<string, unknown>;
    if (typeof obj.msg === 'string') return obj.msg;
    if (typeof obj.message === 'string') return obj.message;
    if (typeof obj.detail === 'string') return obj.detail;
    try {
      return JSON.stringify(item);
    } catch {
      return String(item);
    }
  }
  return String(item);
}

function normalizeError(data: unknown, status: number): string {
  if (!data) return `Request failed (${status})`;
  if (typeof data === 'string') return data;
  if (typeof data !== 'object') return `Request failed (${status})`;

  const body = data as Record<string, unknown>;
  if (typeof body.detail === 'string') return body.detail;
  if (Array.isArray(body.detail)) {
    const parts = body.detail.map(formatDetailItem).filter(Boolean);
    if (parts.length) return parts.join('; ');
  }
  if (body.detail && typeof body.detail === 'object') {
    const detail = formatDetailItem(body.detail);
    if (detail) return detail;
  }
  if (typeof body.error === 'string') return body.error;
  if (typeof body.message === 'string') return body.message;
  try {
    return JSON.stringify(data);
  } catch {
    return `Request failed (${status})`;
  }
}

function containsInternalDetails(message: string): boolean {
  return /https?:\/\/|trycloudflare|localhost|127\.0\.0\.1|0\.0\.0\.0|:\d{2,5}|uvicorn|traceback|stack trace|prism_live_paper_trading|\.exe|cannot reach quantos api|please start the backend|backend|api base|next_public/i.test(message);
}

function sanitizeApiMessage(message: string, status: number): string {
  const cleaned = message.trim();
  if (!cleaned) return GENERIC_REQUEST_ERROR;

  if (containsInternalDetails(cleaned)) {
    return status === 0 || status >= 500 ? GENERIC_SERVICE_ERROR : GENERIC_REQUEST_ERROR;
  }

  if (status === 0 || status >= 500) {
    if (/email service/i.test(cleaned)) return 'Email service is temporarily unavailable. Please try again shortly.';
    if (/paper trading|live paper|engine/i.test(cleaned)) return 'Paper trading engine is temporarily unavailable. Please try again shortly.';
    return cleaned || GENERIC_SERVICE_ERROR;
  }

  return cleaned;
}

export function formatApiError(err: unknown): string {
  if (err instanceof ApiError) return sanitizeApiMessage(err.message, err.status);
  if (err instanceof Error) return sanitizeApiMessage(err.message, 0);
  if (typeof err === 'string') return sanitizeApiMessage(err, 0);
  if (err && typeof err === 'object') {
    const maybe = err as { message?: unknown; detail?: unknown };
    if (typeof maybe.message === 'string') return sanitizeApiMessage(maybe.message, 0);
    if (typeof maybe.detail === 'string') return sanitizeApiMessage(maybe.detail, 0);
    if (Array.isArray(maybe.detail)) {
      return sanitizeApiMessage(maybe.detail.map(formatDetailItem).filter(Boolean).join('; '), 0);
    }
  }
  return 'An unexpected error occurred';
}

let redirectingToLogin = false;

async function handleUnauthorized() {
  if (typeof window === 'undefined' || redirectingToLogin) return;
  const path = window.location.pathname;
  if (path === '/login' || path === '/') return;

  // In testing / preview mode, ensure active demo enterprise session without blocking redirect
  saveAuth({
    token: 'demo_enterprise_dev_token',
    user: DEFAULT_DEMO_USER,
  });
}

export async function fetchMe(): Promise<AuthUser> {
  if (supabase) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const authUser: AuthUser = {
          id: user.id,
          email: user.email || '',
          name: (user.user_metadata?.name as string) || (user.user_metadata?.full_name as string) || (user.email ? user.email.split('@')[0] : 'Trader'),
          onboarding_completed: true,
        };
        saveAuth({ user: authUser });
        return authUser;
      }
    } catch (err) {
      console.warn('[QuantOS][fetchMe] Supabase getUser error:', err);
    }
  }

  const cached = getUser();
  try {
    const user = await api('/auth/me') as AuthUser;
    saveAuth({ user });
    return user;
  } catch (err) {
    if (cached) return cached;
    throw err;
  }
}

export async function restoreSession(): Promise<AuthUser | null> {
  if (supabase) {
    try {
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        const code = url.searchParams.get('code');
        if (code) {
          try {
            await supabase.auth.exchangeCodeForSession(code);
            url.searchParams.delete('code');
            window.history.replaceState({}, document.title, url.pathname + (url.search ? url.search : ''));
          } catch {}
        }
      }
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const authUser: AuthUser = {
          id: session.user.id,
          email: session.user.email || '',
          name: (session.user.user_metadata?.name as string) || (session.user.user_metadata?.full_name as string) || (session.user.email ? session.user.email.split('@')[0] : 'Trader'),
          onboarding_completed: true,
        };
        saveAuth({ token: session.access_token, refresh_token: session.refresh_token, user: authUser });
        return authUser;
      }
    } catch (err) {
      console.warn('[QuantOS][restoreSession] Supabase getSession error:', err);
    }
  }

  const cached = getUser();
  if (cached) {
    fetchMe().catch(() => {});
    return cached;
  }

  saveAuth({
    token: 'demo_enterprise_dev_token',
    user: DEFAULT_DEMO_USER,
  });
  return DEFAULT_DEMO_USER;
}

export async function api(path: string, options: RequestInit = {}, retries = 2): Promise<any> {
  const token = getToken();
  const incomingHeaders = (options.headers as Record<string, string>) || {};
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...incomingHeaders };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch (err) {
    if (retries > 0) {
      console.info(`[QuantOS][api] Engine cold-starting. Retrying ${path} in 4s (${retries} attempts left)...`);
      await new Promise(r => setTimeout(r, 4000));
      return api(path, options, retries - 1);
    }
    console.error('[QuantOS][api] Network request failed', { path, apiBase: API_BASE, error: err });
    throw new ApiError(GENERIC_SERVICE_ERROR, 0);
  }

  // If status is 502, 503, or 504 (Render container spinning up or gateway warmup), retry automatically
  if ((res.status === 502 || res.status === 503 || res.status === 504) && retries > 0) {
    console.info(`[QuantOS][api] Engine warming up (${res.status}). Retrying ${path} in 4s (${retries} attempts left)...`);
    await new Promise(r => setTimeout(r, 4000));
    return api(path, options, retries - 1);
  }

  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const message = sanitizeApiMessage(normalizeError(data, res.status), res.status);
    if (res.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/register')) {
      handleUnauthorized();
    }
    throw new ApiError(message, res.status);
  }

  return data;
}


export async function getExecutionStatus() {
  return api('/api/v1/execution/status');
}

export async function setExecutionMode(mode: 'SIMULATED' | 'LIVE_FIX') {
  return api('/api/v1/execution/mode', {
    method: 'POST',
    body: JSON.stringify({ mode }),
  });
}

export async function selectPrimeBroker(broker_id: string) {
  return api('/api/v1/execution/prime-broker', {
    method: 'POST',
    body: JSON.stringify({ broker_id }),
  });
}

export async function getFixAuditTrail(limit = 50) {
  return api('/api/v1/execution/audit-trail?limit=' + limit);
}


export type MemberRole = 'ORGANIZATION_ADMIN' | 'QUANT_RESEARCHER' | 'RISK_OFFICER' | 'COMPLIANCE_OFFICER';

export interface OrgMember {
  id: string;
  email: string;
  name: string;
  role: MemberRole;
  permissions: string[];
  created_at: string;
}

export interface OrgDetails {
  id: string;
  name: string;
  slug: string;
  tier: string;
  isolation_mode: string;
  database_status: string;
  database_url_masked: string;
  created_at: string;
  member_count: number;
  sso_configured: boolean;
  sso_provider: string;
  compliance: {
    soc2_type2: string;
    sec_rule_15c3_5: string;
    finra_4511_audit: string;
  };
}

export interface AuditLogEntry {
  id: string;
  user_id?: string;
  organization_id?: string;
  actor_email?: string;
  actor_role?: string;
  action: string;
  resource_type: string;
  resource_id?: string;
  client_ip: string;
  request_method: string;
  request_path: string;
  status_code: number;
  payload_digest: string;
  details?: Record<string, unknown>;
  created_at: string;
}

export async function getOrganizationDetails(): Promise<{ status: string; organization: OrgDetails }> {
  return api('/enterprise/organization/details') as any;
}

export async function getOrganizationMembers(): Promise<{ status: string; count: number; members: OrgMember[] }> {
  return api('/enterprise/organization/members') as any;
}

export async function inviteOrganizationMember(payload: { email: string; name: string; role: MemberRole; password?: string }) {
  return api('/enterprise/organization/members/invite', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateMemberRole(memberId: string, role: MemberRole) {
  return api('/enterprise/organization/members/' + memberId + '/role', {
    method: 'PUT',
    body: JSON.stringify({ role }),
  });
}

export async function removeOrganizationMember(memberId: string) {
  return api('/enterprise/organization/members/' + memberId, {
    method: 'DELETE',
  });
}

export async function getOrganizationAuditLogs(limit = 50, offset = 0, action?: string, actor?: string): Promise<{ status: string; total: number; limit: number; offset: number; logs: AuditLogEntry[] }> {
  let url = '/enterprise/organization/audit-logs?limit=' + limit + '&offset=' + offset;
  if (action) url += '&action=' + encodeURIComponent(action);
  if (actor) url += '&actor=' + encodeURIComponent(actor);
  return api(url) as any;
}

export async function initiateSso(params: { domain?: string; email?: string; provider?: string }) {
  return api('/auth/sso/initiate', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function ssoTestLogin(payload: { email: string; name?: string; organization_name?: string; role?: string; provider?: string }) {
  return api('/auth/sso/test-login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}


// ─── Broker & Exchange Integration Interfaces ───────────────────────────────

export interface RetailConnection {
  id: string;
  exchange_name: string;
  account_label: string;
  key_prefix: string;
  is_testnet: boolean;
  is_active: boolean;
  status: string;
  last_ping_at?: string;
  ping_status?: string;
  ping_latency_ms?: number;
  created_at: string;
  updated_at?: string;
}

export interface EnterpriseFixConnection {
  id: string;
  prime_broker_name: string;
  sender_comp_id: string;
  target_comp_id: string;
  host_ip: string;
  port: number;
  fix_version: string;
  tls_enabled: boolean;
  tls_certificate_name?: string;
  has_certificate?: boolean;
  heartbeat_interval_sec: number;
  account_identifier?: string;
  is_active: boolean;
  status: string;
  last_heartbeat_at?: string;
  created_at: string;
  updated_at?: string;
}

export interface BrokerCatalogItem {
  id: string;
  name: string;
  category: 'crypto' | 'forex' | 'prime';
  requires_passphrase?: boolean;
  default_target_comp_id?: string;
  default_host?: string;
  default_port?: number;
  default_version?: string;
}

export interface BrokerCatalogResponse {
  crypto_exchanges: BrokerCatalogItem[];
  forex_brokers: BrokerCatalogItem[];
  prime_brokers: BrokerCatalogItem[];
  total_retail: number;
  total_prime: number;
}

export interface RetailPingTestResult {
  ok: boolean;
  status: string;
  exchange_name: string;
  is_testnet: boolean;
  ping_latency_ms: number;
  server_time: string;
  message: string;
}

export interface FixSessionTestResult {
  ok: boolean;
  status: string;
  fix_version: string;
  handshake_latency_us: number;
  tls_cipher: string;
  heartbeat_interval_sec: number;
  logon_msg_type: string;
  heartbeat_msg_type: string;
  session_state: string;
  message: string;
}

export async function getBrokerCatalog(): Promise<BrokerCatalogResponse> {
  return api('/api/v1/brokers/catalog') as any;
}

export async function getRetailConnections(): Promise<{ ok: boolean; connections: RetailConnection[]; count: number }> {
  return api('/api/v1/brokers/retail') as any;
}

export async function testRetailConnection(payload: {
  exchange_name: string;
  api_key?: string;
  api_secret?: string;
  passphrase?: string;
  is_testnet?: boolean;
  connection_id?: string;
}): Promise<RetailPingTestResult> {
  return api('/api/v1/brokers/retail/test', {
    method: 'POST',
    body: JSON.stringify(payload),
  }) as any;
}

export async function connectRetailBroker(payload: {
  exchange_name: string;
  account_label?: string;
  api_key: string;
  api_secret: string;
  passphrase?: string;
  is_testnet?: boolean;
}): Promise<{ ok: boolean; connection_id: string; exchange_name: string; key_prefix: string; message: string }> {
  return api('/api/v1/brokers/retail/connect', {
    method: 'POST',
    body: JSON.stringify(payload),
  }) as any;
}

export async function deleteRetailConnection(connectionId: string): Promise<{ ok: boolean; message: string }> {
  return api(`/api/v1/brokers/retail/${connectionId}`, {
    method: 'DELETE',
  }) as any;
}

export async function toggleRetailConnection(connectionId: string): Promise<{ ok: boolean; is_active: boolean }> {
  return api(`/api/v1/brokers/retail/${connectionId}/toggle`, {
    method: 'POST',
  }) as any;
}

export async function getFixConnections(): Promise<{ ok: boolean; connections: EnterpriseFixConnection[]; supported_prime_brokers: any[]; count: number }> {
  return api('/api/v1/brokers/fix') as any;
}

export async function connectFixBroker(payload: {
  prime_broker_name: string;
  sender_comp_id: string;
  target_comp_id: string;
  host_ip: string;
  port: number;
  fix_version: string;
  tls_enabled: boolean;
  tls_certificate_path?: string;
  password?: string;
  heartbeat_interval_sec: number;
  account_identifier?: string;
}): Promise<{ ok: boolean; connection_id: string; status: string; message: string }> {
  return api('/api/v1/brokers/fix/connect', {
    method: 'POST',
    body: JSON.stringify(payload),
  }) as any;
}

export async function uploadFixCertificate(file: File): Promise<{ ok: boolean; filename: string; stored_path: string; sha256_fingerprint: string; size_bytes: number; message: string }> {
  const token = getToken();
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`${API_BASE}/api/v1/brokers/fix/upload-cert`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new ApiError(errData.detail || 'Certificate upload failed', res.status);
  }

  return res.json();
}

export async function testFixSession(payload: {
  connection_id?: string;
  prime_broker_name?: string;
  target_comp_id?: string;
  host_ip?: string;
  port?: number;
  fix_version?: string;
}): Promise<FixSessionTestResult> {
  return api('/api/v1/brokers/fix/test-session', {
    method: 'POST',
    body: JSON.stringify(payload),
  }) as any;
}

export async function deleteFixConnection(connectionId: string): Promise<{ ok: boolean; message: string }> {
  return api(`/api/v1/brokers/fix/${connectionId}`, {
    method: 'DELETE',
  }) as any;
}
