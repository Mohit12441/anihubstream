/* ============================================================
   AniHubStream — /api client (Pages Functions + D1, same origin).
   Every read is an honest fetch: no bundled fallback data, so a dead
   service shows as an error the viewer can see and retry.
   ============================================================ */

import type { ApiCard, ApiEpisode, ApiGenre, ApiPosition, AnimeTheme } from './model';

const ROOT = `${(import.meta.env.BASE_URL ?? '/').replace(/\/+$/, '')}/api`;

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  let res: Response;
  try {
    res = await fetch(ROOT + path, {
      credentials: 'same-origin',
      signal: AbortSignal.timeout(15_000),
      ...init,
      headers: {
        accept: 'application/json',
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
      },
    });
  } catch (err) {
    throw new ApiError(0, err instanceof DOMException && err.name === 'TimeoutError'
      ? 'The catalogue service took too long to answer.'
      : 'The catalogue service could not be reached.');
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new ApiError(res.status, `The catalogue service answered ${res.status} without JSON.`);
    }
  }
  if (!res.ok) {
    const message = (data as { message?: string } | null)?.message;
    throw new ApiError(res.status, message ?? `Request failed with ${res.status}.`);
  }
  return data as T;
};

interface ListBody<T> {
  results: T[];
}

export interface CataloguePage extends ListBody<ApiCard> {
  page: number;
  limit: number;
  total: number;
  /** present on ranked searches: how many rows the prefilter scan examined,
      and whether that scan hit its cap (the list may then be partial) */
  scanned?: number;
  capped?: boolean;
}

export interface CatalogueQuery {
  q?: string;
  genre?: string;
  season?: string;
  status?: string;
  kind?: string;
  sort?: string;
  page?: number;
  limit?: number;
  provider?: string;
}

/** One server-paged window of the catalogue — the database holds every title
    now, so browsing and searching ask for pages instead of downloading it all. */
export const listCatalogue = (query: CatalogueQuery = {}): Promise<CataloguePage> => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return request<CataloguePage>(`/anime${qs ? `?${qs}` : ''}`);
};

/** The slim in-memory spine: the curated rank-ordered head of the catalogue,
    enough for the hero, search hints and by-id lookups of small saved lists. */
const SPINE_LIMIT = 60;
export const getCatalogue = async (): Promise<ListBody<ApiCard> & { total: number }> => {
  const page = await request<CataloguePage>(`/anime?limit=${SPINE_LIMIT}&sort=rank&page=1`);
  return { results: page.results, total: page.total };
};

export interface HomeBody {
  trending: ApiCard[];
  ongoing: ApiCard[];
  topRated: ApiCard[];
  fresh: ApiCard[];
  added: ApiCard[];
  providers?: Record<string, { id: string; slug: string; title: string; coverUrl: string | null; provider: string }[]>;
}
export const getHome = () => request<HomeBody>('/home');
export const getStats = () =>
  request<{ titles: number; ongoing: number; genres: Record<string, number> }>('/stats');
export const getGenres = () => request<ListBody<ApiGenre>>('/genres');
export const getSchedule = () =>
  request<{ seasons: string[]; days: { day: number; dayLabel: string; entries: ApiCard[] }[] }>('/schedule');
export const getAnime = (id: string) =>
  request<ApiCard & { episodes: ApiEpisode[]; related: ApiCard[]; themes?: AnimeTheme[] }>(`/anime/${encodeURIComponent(id)}`);

export interface PlayQuery {
  id: string;
  ep?: number;
  audio?: string;
  title?: string;
  provider?: string;
  malId?: number | string;
  server?: string;
  anilist?: number | string;
}

export interface PlayResponse {
  ok?: boolean;
  scopedProvider?: string;
  scopedProviderUnavailable?: boolean;
  providerHealth?: Record<string, { status?: string; latencyMs?: number }>;
  availableProviders?: { id: string; name: string; available: boolean; status?: string; latencyMs?: number }[];
  servers?: any[];
  server?: any;
  subtitles?: any[];
  skip?: any;
  data?: {
    servers?: any[];
    [key: string]: any;
  };
  [key: string]: any;
}

export const getPlay = (query: PlayQuery, init?: RequestInit): Promise<PlayResponse> => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return request<PlayResponse>(`/play${qs ? `?${qs}` : ''}`, init);
};

export const getLibrary = () => request<{ count: number; items: { addedAt: string; anime: ApiCard }[] }>('/me/library');
export const addToLibrary = (animeId: string) =>
  request<{ saved: boolean; count: number; anime: ApiCard }>('/me/library', {
    method: 'POST',
    body: JSON.stringify({ animeId }),
  });
export const removeFromLibrary = (animeId: string) =>
  request<{ removed: boolean; count: number }>(`/me/library?animeId=${encodeURIComponent(animeId)}`, {
    method: 'DELETE',
  });

export const getPositions = () => request<{ count: number; items: ApiPosition[] }>('/me/positions?limit=20');
/* keepalive, because the last write of a session is the one that matters and it happens
   while the page is going away — an ordinary fetch there is often cancelled before the
   request leaves. The body is a few dozen bytes, far inside the 64 KB keepalive budget. */
export const savePosition = (episodeId: string, seconds: number) =>
  request<{ saved: boolean }>('/me/positions', {
    method: 'PUT',
    body: JSON.stringify({ episodeId, seconds }),
    keepalive: true,
  });

export const removePosition = (episodeId: string) =>
  request<{ removed: boolean }>(`/me/positions?episodeId=${encodeURIComponent(episodeId)}`, {
    method: 'DELETE',
  });

export interface FederatedSearchResponse {
  query: string;
  total: number;
  count: number;
  results?: any[];
  providers: Record<string, any[]>;
  source?: string;
}

export const searchFederated = (q: string, init?: RequestInit): Promise<FederatedSearchResponse> => {
  return request<FederatedSearchResponse>(`/search?q=${encodeURIComponent(q.trim())}`, init);
};

export interface InstantSearchResult {
  hits: {
    id: string;
    title: string;
    year?: number | null;
    art?: string;
    kind?: string;
  }[];
}

export const searchInstant = (q: string, limit: number = 8, init?: RequestInit): Promise<InstantSearchResult> => {
  return request<InstantSearchResult>(`/search/instant?q=${encodeURIComponent(q.trim())}&limit=${limit}`, init);
};

export interface DownloadQuery {
  id: string;
  ep: number;
  provider?: string;
  audio?: string;
}

export interface DownloadResponse {
  ok: boolean;
  data?: {
    provider: string;
    title: string;
    episode: number;
    audio: string;
    available: boolean;
    error: string | null;
    downloads: any[];
    downloadPage: string | null;
    streamUrl: string | null;
    command: string;
    availableProviders: string[];
  };
}

export const getDownloads = (query: DownloadQuery, init?: RequestInit): Promise<DownloadResponse> => {
  const params = new URLSearchParams({
    id: query.id,
    ep: String(query.ep),
  });
  if (query.provider) params.set('provider', query.provider);
  if (query.audio) params.set('audio', query.audio);
  return request<DownloadResponse>(`/download?${params.toString()}`, init);
};
