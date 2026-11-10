/* ------------------------------------------------------------------ *
 * 阅界 · API 层
 * - 统一 base URL（vite proxy / Electron file:// 回退到本地 7411）
 * - 超时、JSON 错误结构、友好中文错误
 * - 外链 / 数据目录 / 窗口控制的可选 Electron 桥接
 * ------------------------------------------------------------------ */

import type {
  BooksResponse,
  HealthResponse,
  ManualBook,
  ManualBookInput,
  Paper,
  PaperInput,
  PapersResponse,
  RecommendationResponse,
  RecommendationSource,
  Settings,
  SettingsUpdate,
  WereadOverview,
  WereadTestResult,
} from './types';

const DEFAULT_PORT = 7411;

function normalizeBase(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return '/api';
  if (/\/api$/.test(trimmed)) return trimmed;
  return `${trimmed}/api`;
}

function resolveApiBase(): string {
  const envBase = import.meta.env.VITE_API_BASE as string | undefined;
  const desktopBase = typeof window !== 'undefined' ? window.desktop?.apiBase : undefined;
  const injected = typeof window !== 'undefined' ? window.__READSCOPE_API_BASE__ : undefined;
  const configured = envBase || desktopBase || injected;
  if (configured) return normalizeBase(configured);
  if (typeof location !== 'undefined' && location.protocol === 'file:') {
    return `http://127.0.0.1:${DEFAULT_PORT}/api`;
  }
  return '/api';
}

export const API_BASE = resolveApiBase();

/* ------------------------------ 错误 ------------------------------- */

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code = 'UNKNOWN', status = 0) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return '操作失败，请稍后重试';
}

/* ------------------------------ 请求 ------------------------------- */

interface RequestOptions extends RequestInit {
  timeoutMs?: number;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { timeoutMs = 15_000, headers, ...rest } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...rest,
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(rest.body ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
        ...headers,
      },
      signal: controller.signal,
    });

    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        throw new ApiError(
          response.ok ? '本地服务返回了无法解析的数据' : `请求失败（${response.status}）`,
          'BAD_RESPONSE',
          response.status,
        );
      }
    }

    if (!response.ok) {
      const apiError = extractApiError(payload);
      throw new ApiError(apiError.message, apiError.code, response.status);
    }

    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError('请求超时，请稍后重试', 'TIMEOUT');
    }
    throw new ApiError('无法连接到本地服务，请确认已运行 npm run server', 'NETWORK_ERROR');
  } finally {
    clearTimeout(timer);
  }
}

function extractApiError(payload: unknown): { code: string; message: string } {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const candidate = (payload as { error?: unknown }).error;
    if (candidate && typeof candidate === 'object') {
      const { code, message } = candidate as { code?: unknown; message?: unknown };
      return {
        code: typeof code === 'string' ? code : 'API_ERROR',
        message: typeof message === 'string' && message ? message : '请求失败',
      };
    }
  }
  return { code: 'API_ERROR', message: '请求失败，请稍后重试' };
}

/* ------------------------------ 方法 ------------------------------- */

export const api = {
  base: API_BASE,

  health(): Promise<HealthResponse> {
    return request<HealthResponse>('/health', { timeoutMs: 2_500 });
  },

  getSettings(): Promise<Settings> {
    return request<Settings>('/settings');
  },

  putSettings(patch: SettingsUpdate): Promise<Settings> {
    return request<Settings>('/settings', {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
  },

  testWeread(): Promise<WereadTestResult> {
    return request<WereadTestResult>('/weread/test', { method: 'POST', timeoutMs: 20_000 });
  },

  getOverview(refresh = false): Promise<WereadOverview> {
    return request<WereadOverview>(`/weread/overview${refresh ? '?refresh=1' : ''}`, {
      timeoutMs: 30_000,
    });
  },

  getBooks(): Promise<BooksResponse> {
    return request<BooksResponse>('/books');
  },

  createBook(input: ManualBookInput): Promise<{ item: ManualBook }> {
    return request<{ item: ManualBook }>('/books', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  updateBook(id: string, patch: Partial<ManualBookInput>): Promise<{ item: ManualBook }> {
    return request<{ item: ManualBook }>(`/books/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  deleteBook(id: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/books/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  getPapers(): Promise<PapersResponse> {
    return request<PapersResponse>('/papers');
  },

  createPaper(input: PaperInput): Promise<{ item: Paper }> {
    return request<{ item: Paper }>('/papers', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  updatePaper(id: string, patch: Partial<PaperInput>): Promise<{ item: Paper }> {
    return request<{ item: Paper }>(`/papers/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  deletePaper(id: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/papers/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  getRecommendation(): Promise<RecommendationResponse> {
    return request<RecommendationResponse>('/recommendations/today', { timeoutMs: 30_000 });
  },

  refreshRecommendation(source: RecommendationSource): Promise<RecommendationResponse> {
    return request<RecommendationResponse>('/recommendations/refresh', {
      method: 'POST',
      body: JSON.stringify({ source }),
      timeoutMs: 35_000,
    });
  },

  exportRecommendationsUrl(): string {
    return `${API_BASE}/recommendations/export`;
  },
};

/* --------------------------- 浏览器 / 桌面 -------------------------- */

export function openExternal(url: string | null | undefined): boolean {
  if (!url) return false;
  const desktop = typeof window !== 'undefined' ? window.desktop : undefined;
  if (desktop?.openExternal) {
    void desktop.openExternal(url);
    return true;
  }
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (opened) opened.opener = null;
  return true;
}

export function openDataFolder(path?: string): boolean {
  const desktop = typeof window !== 'undefined' ? window.desktop : undefined;
  if (desktop?.openDataFolder) {
    void desktop.openDataFolder(path);
    return true;
  }
  return false;
}

export function minimizeWindow(): void {
  void window.desktop?.minimize?.();
}

export function closeWindow(): void {
  void window.desktop?.close?.();
}

export async function togglePinWindow(): Promise<boolean | null> {
  const desktop = window.desktop;
  if (!desktop?.togglePin) return null;
  const result = await desktop.togglePin();
  return typeof result === 'boolean' ? result : null;
}
