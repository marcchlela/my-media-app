import type {
  AccountMeResponse,
  Capabilities,
  HealthResponse,
  HlsStatus,
  MediaItem,
  PlaybackOptions,
  SessionResponse,
} from './types';
import { CONNECTION_ERROR, joinServerUrl, normalizeServerUrl } from '../lib/server-url';

export class ApiError extends Error {
  constructor(message: string, public readonly status = 0) {
    super(message);
    this.name = 'ApiError';
  }
}

type ApiConfig = {
  getServerUrl: () => string;
  getToken: () => string | null;
  onUnauthorized?: () => void | Promise<void>;
  fetchImpl?: typeof fetch;
};

type ApiRequestInit = Omit<RequestInit, 'body'> & { body?: unknown };

export class MyFlixApi {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: ApiConfig) {
    this.fetchImpl = config.fetchImpl || fetch;
  }

  absoluteUrl(resource: string): string {
    return joinServerUrl(this.config.getServerUrl(), resource);
  }

  mediaHeaders(): Record<string, string> {
    const token = this.config.getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async request<T>(resource: string, init: ApiRequestInit = {}): Promise<T> {
    const token = this.config.getToken();
    const headers = new Headers(init.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    let body = init.body as BodyInit | null | undefined;
    if (init.body !== undefined && !(init.body instanceof FormData) && typeof init.body !== 'string') {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(init.body);
    }
    let response: Response;
    try {
      response = await this.fetchImpl(this.absoluteUrl(resource), { ...init, headers, body });
    } catch {
      throw new ApiError(CONNECTION_ERROR);
    }
    const payload = await response.json().catch(() => ({})) as { error?: string };
    if (response.status === 401 && token) await this.config.onUnauthorized?.();
    if (!response.ok) throw new ApiError(payload.error || `MyFlix request failed (${response.status}).`, response.status);
    return payload as T;
  }

  health() { return this.request<HealthResponse>('/health'); }
  capabilities() { return this.request<Capabilities>('/api/capabilities'); }
  me() { return this.request<AccountMeResponse>('/api/account/me'); }
  library() { return this.request<MediaItem[]>('/api/library'); }
  login(email: string, password: string) {
    return this.request<SessionResponse>('/api/account/login', { method: 'POST', body: { email, password } });
  }
  signup(input: { firstName: string; lastName: string; email: string; password: string; confirmPassword: string }) {
    return this.request<SessionResponse>('/api/account/signup', { method: 'POST', body: input });
  }
  logout() { return this.request<{ ok: true }>('/api/account/logout', { method: 'POST' }); }
  updateProfile(firstName: string, lastName: string) {
    return this.request<{ ok: true; user: SessionResponse['user'] }>('/api/account/profile', { method: 'PATCH', body: { firstName, lastName } });
  }
  changePassword(currentPassword: string, newPassword: string, confirmPassword: string) {
    return this.request<{ ok: true }>('/api/account/password', { method: 'PATCH', body: { currentPassword, newPassword, confirmPassword } });
  }
  saveProgress(payload: { mediaId: string; position: number; duration: number; percent: number; updatedAt: number }) {
    return this.request<{ ok: true }>('/api/account/progress', { method: 'POST', body: payload });
  }
  setFavorite(payload: { isShow: boolean; mediaId?: string; showId?: string }, favorite: boolean) {
    return this.request<{ ok: true }>('/api/account/favorite', { method: favorite ? 'POST' : 'DELETE', body: payload });
  }
  playbackOptions(mediaId: string) { return this.request<PlaybackOptions>(`/api/media/${encodeURIComponent(mediaId)}/playback-options`); }
  startHls(mediaId: string, body: { mode: 'adaptive' | 'manual' | 'compatibility'; quality?: number }) {
    return this.request<{ ok: true; status: HlsStatus }>(`/api/media/${encodeURIComponent(mediaId)}/hls`, { method: 'POST', body });
  }
  hlsStatus(mediaId: string, cacheKey: string) {
    return this.request<{ ok: true; status: HlsStatus }>(`/api/media/${encodeURIComponent(mediaId)}/hls/status?cacheKey=${encodeURIComponent(cacheKey)}`);
  }
  heartbeat(body: Record<string, unknown>) {
    return this.request<{ sessionId: string }>('/api/playback/session', { method: 'POST', body });
  }
  endPlaybackSession(sessionId: string) {
    return this.request<{ ok: true }>(`/api/playback/session/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
  }
  subtitleUrl(mediaId: string, subtitleId: string) {
    return this.absoluteUrl(`/api/media/${encodeURIComponent(mediaId)}/subtitles/${encodeURIComponent(subtitleId)}`);
  }
  setPoster(payload: { mediaId?: string; showId?: string; tmdbPath: string }) {
    return this.request<{ ok: true }>('/api/account/poster', { method: 'POST', body: payload });
  }
  resetPoster(payload: { mediaId?: string; showId?: string }) {
    return this.request<{ ok: true }>('/api/account/poster', { method: 'DELETE', body: payload });
  }
}

export async function checkConnection(serverUrl: string, fetchImpl: typeof fetch = fetch) {
  const normalized = normalizeServerUrl(serverUrl);
  const api = new MyFlixApi({ getServerUrl: () => normalized, getToken: () => null, fetchImpl });
  const health = await api.health();
  if (!health.ok) throw new ApiError('The server responded, but MyFlix is not ready.');
  const [capabilities, account] = await Promise.all([api.capabilities(), api.me()]);
  return { serverUrl: normalized, health, capabilities, account };
}
