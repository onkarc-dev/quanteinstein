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
  if (typeof window === 'undefined') return '';
  const local = localStorage.getItem(TOKEN_KEY) || localStorage.getItem('token');
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
  return '';
}

export function getUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch {
    return null;
  }
}

export function saveAuth(data: { token?: string; access_token?: string; refresh_token?: string; user?: AuthUser }) {
  if (typeof window === 'undefined') return;
  const access = data?.access_token || data?.token;
  if (access) {
    localStorage.setItem(TOKEN_KEY, access);
    localStorage.setItem('token', access);
  }
  if (data?.refresh_token) localStorage.setItem(REFRESH_KEY, data.refresh_token);
  if (data?.user) localStorage.setItem(USER_KEY, JSON.stringify(data.user));
}

export function clearAuth() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem('token');
  localStorage.removeItem(USER_KEY);
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

  if (supabase) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        saveAuth({ token: session.access_token });
        return;
      }
    } catch {}
  }

  redirectingToLogin = true;
  clearAuth();
  const expired = path !== '/login' ? '?expired=1' : '';
  window.location.href = `/login${expired}`;
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

  if (!getToken()) return null;

  try {
    return await fetchMe();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      const refresh = typeof window !== 'undefined' ? localStorage.getItem(REFRESH_KEY) : '';
      if (refresh) {
        try {
          const data = await api('/auth/refresh', { method: 'POST', body: JSON.stringify({ refresh_token: refresh }) });
          saveAuth(data);
          return await fetchMe();
        } catch { /* fall through */ }
      }
      clearAuth();
      return null;
    }
    return null;
  }
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

  // If status is 502 or 503 (Render container spinning up from cold sleep), retry automatically
  if ((res.status === 502 || res.status === 503) && retries > 0) {
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
