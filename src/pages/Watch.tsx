import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  BookmarkPlus,
  ChevronRight,
  Clock,
  Download,
  Heart,
  Info,
  ListVideo,
  Play,
  Server,
  Share2,
  SkipBack,
  SkipForward,
  Tv,
} from 'lucide-react';
import { AdvancedPlayer } from '../components/player/AdvancedPlayer';
import { DownloadModal } from '../components/player/DownloadModal';
import { cleanServerName, getProvider } from '../components/player/ServerPopover';
import type { PlayServer } from '../components/player/PlayerInput';
import { providerFromId, serverIdFromProvider } from '../data/servers';
import { AnimeCard } from '../components/AnimeCard';
import { AiringCountdown } from '../components/AiringCountdown';
import { CatalogueError, CatalogueLoading } from '../components/CatalogueState';
import { EpisodeSidebar } from '../components/EpisodeSidebar';
import { cleanAnimeTitle, isHashToken, ratingLabel, toSeconds, type Anime, type Episode } from '../data/model';
import { getPlay } from '../data/api';
import { useToast } from '../lib/Toast';
import { accentVars, usePlayerPreferences } from '../lib/usePlayerPrefs';
import { positionKey } from '../lib/playerPrefs';
import { useAnimeDetail, useCatalogue } from '../state/catalogue';
import { useLibrary } from '../state/library';
import { useSEO } from '../lib/useSEO';
import { SLUG_REDIRECTS } from '../data/redirects';
import { prefetchEpisode, type BridgeSource } from '../lib/streamBridge';
import { warmStreamOrigins } from '../lib/warmConnections';
import '../styles/watch.css';
import '../styles/player.css';

export function titleMatches(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return true;
  const wordsA = a.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const wordsB = b.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (wordsA.length === 0 || wordsB.length === 0) return true;
  const setA = new Set(wordsA);
  const overlap = wordsB.filter((w) => setA.has(w)).length;
  const ratio = overlap / Math.max(setA.size, wordsB.length);
  return ratio >= 0.5;
}

export const DEFAULT_PLAY_SERVERS: PlayServer[] = [
  { id: 'anikoto:HD-1', name: 'AniKoto · HD-1', provider: 'anikoto', quality: '1080p', audio: 'sub', status: 'ready', streamUrl: '', type: 'hls' },
  { id: 'anikoto:Vidstream-2', name: 'AniKoto · Vidstream-2', provider: 'anikoto', quality: '1080p', audio: 'sub', status: 'ready', streamUrl: '', type: 'hls' },
  { id: 'anikoto:Vidstream-1', name: 'AniKoto · Vidstream-1', provider: 'anikoto', quality: '1080p', audio: 'sub', status: 'ready', streamUrl: '', type: 'hls' },
  { id: 'anikoto:HD-2', name: 'AniKoto · HD-2', provider: 'anikoto', quality: '1080p', audio: 'sub', status: 'ready', streamUrl: '', type: 'hls' },
  { id: 'anikoto:HD-1-dub', name: 'AniKoto · HD-1 (DUB)', provider: 'anikoto', quality: '1080p', audio: 'dub', status: 'ready', streamUrl: '', type: 'hls' },
  { id: 'anikoto:Vidstream-2-dub', name: 'AniKoto · Vidstream-2 (DUB)', provider: 'anikoto', quality: '1080p', audio: 'dub', status: 'ready', streamUrl: '', type: 'hls' },
  { id: 'anikoto:Vidstream-1-dub', name: 'AniKoto · Vidstream-1 (DUB)', provider: 'anikoto', quality: '1080p', audio: 'dub', status: 'ready', streamUrl: '', type: 'hls' },
  { id: 'anikoto:HD-2-dub', name: 'AniKoto · HD-2 (DUB)', provider: 'anikoto', quality: '1080p', audio: 'dub', status: 'ready', streamUrl: '', type: 'hls' },
  { id: 'hianime:HD-1', name: 'HiAnime · HD-1', provider: 'hianime', quality: '1080p', audio: 'sub', status: 'ready', streamUrl: '', type: 'hls' },
  { id: 'aniwatch:HD-1', name: 'AniWatch · HD-1', provider: 'aniwatch', quality: '1080p', audio: 'sub', status: 'ready', streamUrl: '', type: 'hls' },
  { id: 'aniwatch:HD-1-dub', name: 'AniWatch · HD-1 (DUB)', provider: 'aniwatch', quality: '1080p', audio: 'dub', status: 'ready', streamUrl: '', type: 'hls' },
  { id: 'anipm:beta', name: 'AniPM · Beta', provider: 'anipm', quality: '1080p', audio: 'sub', status: 'ready', streamUrl: '', type: 'hls' },
  { id: 'torrent:P2P-1', name: 'P2P Swarm · WebTorrent', provider: 'torrent', quality: '1080p', audio: 'sub', status: 'ready', streamUrl: '', type: 'hls' },
];

export function Watch() {
  const { id = '', ep } = useParams<{ id: string; ep?: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    if (id && SLUG_REDIRECTS[id] && SLUG_REDIRECTS[id] !== id) {
      const canonical = SLUG_REDIRECTS[id];
      const target = ep ? `/watch/${canonical}/${ep}` : `/watch/${canonical}`;
      navigate(target, { replace: true });
    }
  }, [id, ep, navigate]);

  const { notify } = useToast();
  const { status, error, missing, anime: loadedAnime, related, reload } = useAnimeDetail(id);

  // Federated/fallback anime for search results and external provider cards
  const anime = useMemo<Anime | null>(() => {
    if (loadedAnime) {
      return {
        ...loadedAnime,
        title: cleanAnimeTitle(loadedAnime.title),
      };
    }
    // If we are still loading a catalog anime (not an external provider id and no explicit title query),
    // wait for loadedAnime to arrive so we don't flash mutilated fallback titles or kick off premature stream resolution
    if (status === 'loading' && !params.get('title') && !id?.includes(':')) {
      return null;
    }
    if (!id) return null;
    const queryTitle = params.get('title') || '';
    const queryPoster = params.get('poster') || '';
    const cleanBase = id
      .replace(/^(?:hianime|anikoto|aniwatch|watchanimeworld|animewave|animekai):/i, '')
      .replace(/-([a-z0-9]{4,8})$/i, (match, token) => (isHashToken(token) ? '' : match))
      .replace(/[-_:]+/g, ' ')
      .trim();
    const fallbackTitle =
      cleanAnimeTitle(queryTitle) ||
      cleanBase.replace(/\b\w/g, (c) => c.toUpperCase());
    const isMovie = cleanBase.toLowerCase().includes('movie') || id.toLowerCase().includes('movie');
    const requestedEp = Number.parseInt(ep ?? '', 10);
    const validRequested = Number.isFinite(requestedEp) && requestedEp > 0 ? Math.min(requestedEp, 2000) : 1;
    const queryEp = Number.parseInt(params.get('ep') ?? '', 10);
    const validQueryEp = Number.isFinite(queryEp) && queryEp > 0 ? Math.min(queryEp, 2000) : 1;
    const totalEps = isMovie ? 1 : Math.max(validRequested, validQueryEp, 12);

    return {
      id,
      title: fallbackTitle,
      native: '',
      year: new Date().getFullYear(),
      rating: 8.0,
      season: '',
      kind: isMovie ? 'Movie' : 'TV',
      status: 'Finished',
      genres: [],
      poster: queryPoster,
      key: queryPoster,
      accent: '#6366f1',
      synopsis: `Watch ${fallbackTitle} streaming online on AniHubStream.`,
      episodeCount: totalEps,
      episodeTotal: totalEps,
      episodes: [],
    };
  }, [loadedAnime, id, params]);

  const episodes: Episode[] = useMemo(() => {
    if (!anime) return [];

    const isUpcoming = anime.status === 'Upcoming' || anime.status === 'NOT_YET_RELEASED';
    if (isUpcoming) {
      return [];
    }

    const baseList = (anime.episodes && anime.episodes.length > 0) ? [...anime.episodes] : [];
    const existingCount = baseList.length;

    // For ongoing series that have not yet aired any episodes, show empty state instead of phantom shells
    if (anime.status === 'Ongoing' && existingCount === 0) {
      return [];
    }

    const isMovie = (anime.kind && anime.kind.toLowerCase() === 'movie') || anime.title.toLowerCase().includes('movie');
    if (isMovie) {
      if (existingCount > 0) return baseList;
      return [{
        n: 1,
        title: anime.title || 'Movie',
        runtime: '90m',
        thumb: anime.key || anime.poster || '',
        synopsis: anime.synopsis || '',
        markers: [],
        airdate: null,
      }];
    }

    const requestedEp = Number.parseInt(ep ?? '', 10);
    const validRequested = Number.isFinite(requestedEp) && requestedEp > 0 ? requestedEp : 0;
    const queryEp = Number.parseInt(params.get('ep') ?? '', 10);
    const validQueryEp = Number.isFinite(queryEp) && queryEp > 0 ? queryEp : 0;

    // Only expand shells if a specific episode was requested beyond the current list (e.g. via schedule deep link)
    // or if the anime has 0 episodes in DB and is finished
    const isFinished = anime.status === 'Finished';
    const targetExplicit = Math.max(validRequested, validQueryEp);
    const count = Math.max(
      existingCount,
      Math.min(
        targetExplicit > 0
          ? targetExplicit
          : (existingCount === 0 && isFinished ? (anime.episodeCount || anime.episodeTotal || 1) : existingCount),
        2000
      )
    );

    if (existingCount >= count) {
      return baseList;
    }

    // Expand missing episode shells up to count so schedule links and deep links never clamp down to ep 1
    for (let i = existingCount + 1; i <= count; i++) {
      baseList.push({
        n: i,
        title: `Episode ${i}`,
        runtime: '24m',
        thumb: anime.key || anime.poster || '',
        synopsis: '',
        markers: [],
        airdate: null,
      });
    }

    return baseList;
  }, [anime, ep, params]);

  const { genreLabel } = useCatalogue();
  const { has, isBusy, toggle, favourites, toggleFavourite, recordPosition } = useLibrary();
  const { prefs, patch, patchSubs, restoreSubs, restoreAppearance, positions, record } = usePlayerPreferences();

  const [epNum, setEpNum] = useState<number>(() => {
    const rawEp = ep ?? params.get('ep');
    if (rawEp) {
      const parsed = Number.parseInt(rawEp, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.min(parsed, 2000);
      }
    }
    return 1;
  });
  const [theatre, setTheatre] = useState(false);
  const [isStreamResolved, setIsStreamResolved] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [epDrawerOpen, setEpDrawerOpen] = useState(false);
  const [currentStream, setCurrentStream] = useState<BridgeSource | null>(null);
  const lastFallbackNotified = useRef<string>('');
  const [playServers, setPlayServers] = useState<PlayServer[]>(DEFAULT_PLAY_SERVERS);
  const [_scopedProviderUnavailable, setScopedProviderUnavailable] = useState(false);
  const [_providerHealth, setProviderHealth] = useState<Record<string, { status?: string; latencyMs?: number }>>({});
  const [_availableProvidersList, setAvailableProvidersList] = useState<{ id: string; name: string; available: boolean; status?: string; latencyMs?: number }[]>([]);
  const targetProvider = (
    params.get('provider') ||
    (id?.startsWith('hianime:') ? 'hianime' : id?.startsWith('anikoto:') ? 'anikoto' : id?.startsWith('aniwatch:') ? 'aniwatch' : id?.startsWith('anipm:') ? 'anipm' : '')
  ).toLowerCase();
  const [activeServerId, setActiveServerId] = useState<string>(() => {
    const srvParam = params.get('server');
    if (srvParam) return srvParam.includes(':') ? srvParam : `${targetProvider || 'anikoto'}:${srvParam}`;
    if (targetProvider === 'anipm') return 'anipm:beta';
    return targetProvider
      ? serverIdFromProvider(targetProvider, prefs.audio)
      : (prefs.audio === 'dub' ? 'anikoto:HD-1-dub' : 'anikoto:HD-1');
  });
  const [activeTab, setActiveTab] = useState<'episode' | 'anime'>('episode');

  const activeProvider = useMemo(() => {
    const raw = targetProvider || (activeServerId ? (activeServerId.includes(':') ? activeServerId.split(':')[0] : '') : 'anikoto');
    if (raw.toLowerCase().includes('anipm')) return 'AniPM';
    if (raw.toLowerCase().includes('anikoto')) return 'AniKoto';
    if (raw.toLowerCase().includes('hianime')) return 'HiAnime';
    if (raw.toLowerCase().includes('aniwatch')) return 'AniWatch';
    if (raw.toLowerCase().includes('torrent') || raw.toLowerCase().includes('p2p')) return 'P2P';
    return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : 'AniKoto';
  }, [targetProvider, activeServerId]);

  const currentSubservers = useMemo(() => {
    const isDub = prefs.audio === 'dub';
    const targetKey = activeProvider.toLowerCase();

    // Strict provider isolation: ONLY servers from this specific provider are allowed
    const providerScoped = playServers.filter((s) => {
      const p = (s.provider || (s.id.includes(':') ? s.id.split(':')[0] : '')).toLowerCase();
      if (targetKey === 'anipm') return p === 'anipm' || s.id.startsWith('anipm:');
      if (targetKey === 'anikoto') return p === 'anikoto' || s.id.startsWith('anikoto:');
      if (targetKey === 'hianime') return p === 'hianime' || s.id.startsWith('hianime:');
      if (targetKey === 'aniwatch') return p === 'aniwatch' || s.id.startsWith('aniwatch:');
      if (targetKey === 'p2p') return p === 'torrent' || s.id.startsWith('torrent:');
      return p === targetKey;
    });

    const audioMatching = providerScoped.filter((s) => {
      const sDub = s.id.includes('-dub') || (s.audio || '').toLowerCase() === 'dub';
      return isDub ? sDub : !sDub;
    });
    return audioMatching.length > 0 ? audioMatching : providerScoped;
  }, [playServers, activeProvider, prefs.audio]);

  const activeServer = useMemo(() => {
    const match = currentSubservers.find((s) => s.id === activeServerId);
    if (match) return match;
    return currentSubservers[0] || playServers[0] || null;
  }, [currentSubservers, activeServerId, playServers]);

  useEffect(() => {
    if (!targetProvider) return;
    const targetKey = targetProvider.toLowerCase();
    const currentProv = (activeServerId.includes(':') ? activeServerId.split(':')[0] : '').toLowerCase();
    if (currentProv !== targetKey) {
      if (targetKey === 'anipm') {
        setActiveServerId('anipm:beta');
      } else {
        setActiveServerId(serverIdFromProvider(targetKey, prefs.audio));
      }
    }
  }, [targetProvider, prefs.audio]);

  const hasDubForProvider = useMemo(() => {
    const provServers = playServers.filter((s) => getProvider(s).toLowerCase() === activeProvider.toLowerCase());
    return provServers.some((s) => s.id.includes('-dub') || (s.audio || '').toLowerCase() === 'dub');
  }, [playServers, activeProvider]);

  const switchAudioMode = (targetAudio: 'sub' | 'dub') => {
    if (prefs.audio === targetAudio) return;
    patch({ audio: targetAudio });
    const matching = playServers.find((s) => {
      const isProv = getProvider(s).toLowerCase() === activeProvider.toLowerCase();
      const isDub = s.id.includes('-dub') || (s.audio || '').toLowerCase() === 'dub';
      return isProv && (targetAudio === 'dub' ? isDub : !isDub);
    });
    if (matching) {
      handleSelectServer(matching);
    } else {
      const newParams = new URLSearchParams(params);
      newParams.set('audio', targetAudio);
      navigate(`/watch/${encodeURIComponent(anime?.id || id || '')}/${epNum}?${newParams.toString()}`, { replace: true });
      notify(`Audio switched to ${targetAudio.toUpperCase()}`);
    }
  };

  /* Reset stream resolved state on anime or episode change */
  useEffect(() => {
    setIsStreamResolved(false);
    setCurrentStream(null);
  }, [id, epNum]);

  /* Fallback toast notification when requested provider differs from resolved stream */
  useEffect(() => {
    if (!currentStream?.provider || !targetProvider || targetProvider === 'auto') return;
    if (currentStream.provider === targetProvider) return;
    const key = `${targetProvider}->${currentStream.provider}`;
    if (lastFallbackNotified.current === key) return;
    lastFallbackNotified.current = key;
    notify(`Requested ${targetProvider} unavailable — streaming from ${currentStream.provider}`);
  }, [currentStream?.provider, targetProvider, notify]);

  /* Lazy/eager server list fetch from Layer 1 API */
  useEffect(() => {
    if (!anime) return;
    let cancelled = false;

    const targetAnilist = (anime as any).sourceIds?.anilist || (anime as any).anilistId || (/^\d+$/.test(anime.id) ? anime.id : undefined);

    getPlay({
      id: anime.id,
      ep: epNum,
      audio: prefs.audio ?? 'sub',
      title: anime.title || undefined,
      provider: targetProvider || undefined,
      malId: anime.malId || undefined,
      anilist: targetAnilist,
    })
      .then((data) => {
        if (cancelled) return;
        setScopedProviderUnavailable(Boolean(data.scopedProviderUnavailable));
        if (data.providerHealth) {
          setProviderHealth(data.providerHealth);
        }
        if (Array.isArray(data.availableProviders)) {
          setAvailableProvidersList(data.availableProviders);
        }
        const rawServerList = Array.isArray(data.servers) ? data.servers : (Array.isArray(data.data?.servers) ? data.data.servers : []);
        let mismatchedTitle = '';
        const serverList = rawServerList.filter((s: PlayServer) => {
          if (s.resolvedTitle && !titleMatches(s.resolvedTitle, anime.title)) {
            mismatchedTitle = s.resolvedTitle;
            return false;
          }
          return true;
        });
        if (mismatchedTitle && serverList.length < rawServerList.length) {
          notify(`Server title mismatch (${mismatchedTitle}) — filtered`);
        }
        if (serverList.length > 0) {
          const mergedServers = [
            ...serverList,
            ...DEFAULT_PLAY_SERVERS.filter((def) => !serverList.some((s: PlayServer) => s.id === def.id)),
          ];
          setPlayServers(mergedServers);
          const explicitServer = params.get('server');
          const isDub = (prefs.audio ?? 'sub') === 'dub';
          let matchedServer: PlayServer | null = null;

          if (explicitServer) {
            const fullTargetId = explicitServer.includes(':')
              ? explicitServer
              : (targetProvider ? `${targetProvider}:${explicitServer}` : explicitServer);
            matchedServer = mergedServers.find((s: PlayServer) => {
              if (s.id.toLowerCase() === fullTargetId.toLowerCase()) return true;
              if (targetProvider && s.provider?.toLowerCase() !== targetProvider && !s.id.toLowerCase().startsWith(`${targetProvider}:`)) {
                return false;
              }
              return s.id === explicitServer || s.id.endsWith(`:${explicitServer}`) || s.id.endsWith(`:${explicitServer}-dub`);
            }) || null;
          }

          if (!matchedServer && targetProvider) {
            matchedServer = mergedServers.find((s: PlayServer) => {
              const matchesProv = s.provider?.toLowerCase() === targetProvider || s.id?.toLowerCase().startsWith(`${targetProvider}:`);
              const matchesAudio = isDub ? (s.id.includes('-dub') || s.audio === 'dub') : (!s.id.includes('-dub') && s.audio !== 'dub');
              return matchesProv && matchesAudio;
            }) || mergedServers.find((s: PlayServer) =>
              s.provider?.toLowerCase() === targetProvider || s.id?.toLowerCase().startsWith(`${targetProvider}:`)
            ) || null;
          }

          if (!matchedServer && serverList.length > 0) {
            // Default: activate the backend's pre-resolved winner in servers[0]
            matchedServer = serverList[0];
          }

          if (matchedServer) {
            setActiveServerId(matchedServer.id);
          }
        }
      })
      .catch(() => {
        // Handled gracefully
      });

    return () => {
      cancelled = true;
    };
  }, [anime?.id, anime?.title, epNum, prefs.audio, params]);

  /* Path param :ep sync with edge-case clamping and resume fallback */
  useEffect(() => {
    if (!anime || episodes.length === 0) return;

    if (ep !== undefined) {
      const parsed = Number.parseInt(ep, 10);
      const total = episodes.length;
      if (!Number.isFinite(parsed) || parsed < 1) {
        // Non-numeric or < 1 -> default to 1, replace URL
        navigate(`/watch/${anime.id}/1`, { replace: true });
        setEpNum(1);
      } else if (parsed > total && total >= (anime.episodeTotal || anime.episodeCount || total)) {
        // Exceeds total -> clamp to max episode, replace URL
        navigate(`/watch/${anime.id}/${total}`, { replace: true });
        setEpNum(total);
      } else {
        // Valid episode -> set player if changed
        setEpNum((prev) => (prev === parsed ? prev : parsed));
      }
    } else {
      // /watch/:id without :ep -> load saved resume episode (or ep 1)
      const queryEp = Number.parseInt(params.get('ep') ?? '', 10);
      let targetEp = 1;
      let hasExplicitTarget = false;
      if (Number.isFinite(queryEp) && queryEp >= 1) {
        targetEp = episodes.length >= (anime.episodeTotal || anime.episodeCount || 1)
          ? Math.min(queryEp, episodes.length)
          : queryEp;
        hasExplicitTarget = true;
      } else {
        const savedKey = Object.keys(positions).find(
          (k) => k.startsWith(`${anime.id}:e`) || k.startsWith(`${anime.id}#`)
        );
        if (savedKey) {
          const match = /(?:#|:e)(\d+)$/.exec(savedKey);
          if (match) {
            const resumeEp = Number.parseInt(match[1], 10);
            if (Number.isFinite(resumeEp) && resumeEp >= 1 && resumeEp <= episodes.length) {
              targetEp = resumeEp;
              hasExplicitTarget = true;
            }
          }
        }
      }
      // Only navigate if there is a saved resume target beyond episode 1, preserving clean HTTP 200 for bots/landing
      if (hasExplicitTarget && targetEp !== 1) {
        navigate(`/watch/${anime.id}/${targetEp}`, { replace: true });
      }
      setEpNum(targetEp);
    }
  }, [anime, ep, episodes, params, navigate, positions]);


  const episode = useMemo(() => {
    if (!episodes.length) return undefined;
    return episodes[Math.min(Math.max(epNum, 1), episodes.length) - 1];
  }, [episodes, epNum]);

  const cleanSynopsis = useMemo(() => {
    if (!anime?.synopsis) return 'Watch high definition anime with English subtitles and dub on AniHubStream.';
    return anime.synopsis.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150);
  }, [anime?.synopsis]);

  const canonicalUrl = useMemo(() => {
    if (!anime) return undefined;
    return ep !== undefined && epNum && epNum >= 1
      ? `https://anihubstream.com/watch/${anime.id}/${epNum}`
      : `https://anihubstream.com/watch/${anime.id}`;
  }, [anime, ep, epNum]);

  const jsonLd = useMemo(() => {
    if (!anime) return null;
    const origin = 'https://anihubstream.com';
    const mainEntity = {
      '@type': episode ? 'TVEpisode' : 'TVSeries',
      name: episode ? `${anime.title} Episode ${episode.n}` : anime.title,
      alternateName: anime.native || undefined,
      description: cleanSynopsis,
      image: anime.key || anime.poster,
      url: canonicalUrl,
      ...(episode ? { episodeNumber: episode.n } : {}),
      ...(!episode && anime.episodeTotal ? { numberOfEpisodes: anime.episodeTotal } : {}),
      ...(anime.rating > 0
        ? {
            aggregateRating: {
              '@type': 'AggregateRating',
              ratingValue: anime.rating > 10 ? Number((anime.rating / 10).toFixed(1)) : anime.rating,
              bestRating: 10,
              worstRating: 0,
              ratingCount: 150,
            },
          }
        : {}),
    };

    const breadcrumbs = {
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: 'Home',
          item: origin,
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: 'Anime',
          item: `${origin}/anime`,
        },
        {
          '@type': 'ListItem',
          position: 3,
          name: anime.title,
          item: `${origin}/watch/${anime.id}`,
        },
        ...(episode ? [{
          '@type': 'ListItem',
          position: 4,
          name: `Episode ${episode.n}`,
          item: canonicalUrl,
        }] : []),
      ],
    };

    return {
      '@context': 'https://schema.org',
      '@graph': [mainEntity, breadcrumbs],
    };
  }, [anime, episode, cleanSynopsis, canonicalUrl]);

  useSEO({
    title: anime
      ? `${anime.title}${episode ? ` Ep ${episode.n}` : anime.year ? ` (${anime.year})` : ''} — Watch Free | AniHubStream`
      : 'Watch Anime Free | AniHubStream',
    description: cleanSynopsis,
    image: anime?.key || anime?.poster,
    type: episode ? 'video.episode' : 'video.tv_show',
    canonicalUrl,
    jsonLd,
  });

  const idx = episode?.n ?? 1;
  const key = anime ? positionKey(anime.id, idx) : '';
  const runtime = episode ? toSeconds(episode.runtime) : 0;

  const selectEpisode = useCallback(
    (n: number) => {
      if (!anime || episodes.length === 0) return;
      const clamped = Math.min(Math.max(n, 1), episodes.length);
      setEpNum(clamped);
      navigate(`/watch/${anime.id}/${clamped}`);
    },
    [anime, episodes, navigate],
  );


  const selectSeason = useCallback(
    (seasonId: string) => {
      if (!seasonId || seasonId === anime?.id) return;
      navigate(`/watch/${seasonId}/1`);
    },
    [anime?.id, navigate],
  );

  const prefetchedNext = useRef<number | null>(null);

  useEffect(() => {
    prefetchedNext.current = null;
    warmStreamOrigins();
  }, [anime?.id, epNum]);

  // Prefetch next episode after 2 minutes on watch page
  useEffect(() => {
    if (!anime) return;
    const nextEp = epNum + 1;
    if (nextEp > episodes.length) return;
    const timer = window.setTimeout(() => {
      if (prefetchedNext.current !== nextEp) {
        prefetchedNext.current = nextEp;
        void prefetchEpisode(anime.id, nextEp, prefs.audio ?? 'sub');
      }
    }, 120_000);
    return () => window.clearTimeout(timer);
  }, [anime, epNum, prefs.audio]);

  const save = async () => {
    if (!anime) return;
    const wasSaved = has(anime.id);
    const ok = await toggle(anime.id);
    if (!ok) notify('The library service did not answer — nothing was changed.');
    else notify(wasSaved ? 'Removed from your list.' : 'Saved to your list.');
  };

  const queryTime = Number(params.get('time') || params.get('t')) || 0;
  const saved = prefs.rememberPosition ? positions[key] : undefined;
  // query parameter time/t takes precedence; otherwise resume from saved position
  const resumeAt = queryTime > 0
    ? queryTime
    : saved && !saved.finished
      ? Math.min(saved.t, Math.max(0, runtime - 5))
      : 0;

  if (missing && !loadedAnime && !params.get('title') && !params.get('provider')) {
    return (
      <div className="page watch__missing shell">
        <h1>Anime Not Found</h1>
        <p>
          {error ?? `We couldn't find an anime with the id “${id}”.`} Explore popular series and movies instead.
        </p>
        <div className="watch__missing-cta">
          <Link className="btn btn--primary" to="/anime">
            Browse anime
          </Link>
          <Link className="btn btn--ghost" to="/">
            Back home
          </Link>
        </div>
      </div>
    );
  }

  if (status === 'error' && !loadedAnime && !params.get('title') && !params.get('provider')) {
    return (
      <div className="page watch shell">
        <CatalogueError error={error} onRetry={reload} />
      </div>
    );
  }

  if ((status !== 'ready' && !anime) || !anime) {
    return (
      <div className="page watch watch--loading shell">
        <CatalogueLoading grid={false} rows={4} />
      </div>
    );
  }

  // Graceful empty state for newly announced/ongoing shows that have no episodes released yet
  if (episodes.length === 0 || !episode) {
    return (
      <div className="page watch shell" style={{ '--tint': anime.accent, ...accentVars(prefs.accent) } as React.CSSProperties}>
        <nav className="watch__crumbs" aria-label="Breadcrumb">
          <ol>
            <li><Link to="/">Home</Link><ChevronRight size={13} aria-hidden="true" /></li>
            <li><Link to="/anime">Anime</Link><ChevronRight size={13} aria-hidden="true" /></li>
            <li><span aria-current="page">{anime.title}</span></li>
          </ol>
        </nav>
        <div className="watch__empty-banner" style={{ textAlign: 'center', padding: '60px 20px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', margin: '20px 0' }}>
          <Clock size={48} style={{ opacity: 0.6, marginBottom: '16px' }} />
          <h2>Episodes Coming Soon</h2>
          <p style={{ maxWidth: '500px', margin: '12px auto 24px', opacity: 0.8 }}>
            <strong>{anime.title}</strong> is currently {anime.status.toLowerCase()} ({anime.season || anime.year}). Episodes will appear here as soon as they air.
          </p>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
            <Link className="btn btn--primary" to="/schedule">Check Release Schedule</Link>
            <Link className="btn btn--ghost" to="/anime">Browse Anime</Link>
          </div>
        </div>
      </div>
    );
  }

  const last = episodes.length;
  const inList = has(anime.id);
  const busy = isBusy(anime.id);
  const faved = favourites.has(anime.id);
  const goNext = () => idx < last && selectEpisode(idx + 1);
  const goPrev = () => idx > 1 && selectEpisode(idx - 1);

  const handleSelectServer = (server: PlayServer) => {
    setActiveServerId(server.id);
    const isDub = server.id.includes('-dub') || server.audio?.toLowerCase() === 'dub' || server.type?.toLowerCase() === 'dub';
    const srvAudio: 'dub' | 'sub' = isDub ? 'dub' : 'sub';
    patch({ audio: srvAudio });
    const newProv = server.provider || providerFromId(server.id).split(':')[0];
    const newParams = new URLSearchParams(params);
    newParams.set('provider', newProv);
    const serverNameOnly = server.id.includes(':') ? server.id.split(':')[1].replace(/-dub$/i, '').replace(/-sub$/i, '') : server.id;
    newParams.set('server', serverNameOnly);
    newParams.set('audio', srvAudio);
    navigate(`/watch/${encodeURIComponent(anime?.id || id || '')}/${epNum}?${newParams.toString()}`, { replace: true });
    notify(`Switched to ${server.name} (${srvAudio.toUpperCase()})`);
  };

  const crumbs = [
    { label: 'Home', to: '/' },
    { label: 'Anime', to: '/anime' },
    { label: anime.title, to: `/anime/${anime.id}` },
    ...(anime.genres.length
      ? [{ label: genreLabel(anime.genres[0]), to: `/anime?genre=${anime.genres[0]}` }]
      : []),
  ];

  return (
    <div
      className={`page watch${theatre ? ' is-theatre' : ''}`}
      style={{ '--tint': anime.accent, ...accentVars(prefs.accent) } as React.CSSProperties}
    >
      {theatre && <div className="watch__veil" onClick={() => setTheatre(false)} aria-hidden="true" />}

      <nav className="watch__crumbs shell" aria-label="Breadcrumb">
        <ol>
          {crumbs.map((c) => (
            <li key={c.to}>
              <Link to={c.to}>{c.label}</Link>
              <ChevronRight size={13} aria-hidden="true" />
            </li>
          ))}
          <li>
            <span aria-current="page">Episode {idx}</span>
          </li>
        </ol>
      </nav>

      <div className="watch__grid shell">
        <div className="watch__main">
          <AdvancedPlayer
            anime={anime}
            animeId={anime.id}
            episode={episode}
            next={episodes[idx] ?? null}
            hasPrev={idx > 1}
            hasNext={idx < last}
            onPrev={goPrev}
            onNext={goNext}
            theatre={theatre}
            onTheatre={setTheatre}
            prefs={prefs}
            patch={patch}
            patchSubs={patchSubs}
            restoreSubs={restoreSubs}
            restoreAppearance={restoreAppearance}
            resumeAt={resumeAt}
            onProgress={(t) => {
              record(key, t, runtime);
              recordPosition(anime, idx, episode?.title || `Episode ${idx}`, t, runtime);
              // Prefetch next episode when reaching 80% progress
              if (runtime > 0 && t / runtime >= 0.8 && anime && idx < anime.episodes.length) {
                const nextEp = idx + 1;
                if (prefetchedNext.current !== nextEp) {
                  prefetchedNext.current = nextEp;
                  void prefetchEpisode(anime.id, nextEp, prefs.audio ?? 'sub');
                }
              }
            }}
            onStreamResolved={setIsStreamResolved}
            onStreamInfo={setCurrentStream}
            serverId={activeServerId}
            onServerChange={setActiveServerId}
            servers={currentSubservers}
            onSelectServer={handleSelectServer}
            initialServer={activeServer}
            initialPartyRoom={params.get('party')}
          />

          {/* EXTERNAL SUBSERVER SELECTOR */}
          {currentSubservers.length > 0 && (
            <div className="watch__servers-external">
              <div className="watch__ext-subservers-row">
                <span className="watch__ext-label">
                  <Server size={13} aria-hidden="true" />
                  <span>{activeProvider} Mirrors ({prefs.audio === 'dub' ? 'DUB' : 'SUB'}):</span>
                </span>
                <div className="watch__ext-subservers-list">
                  {currentSubservers.map((s) => {
                    const isSelected = s.id === activeServerId;
                    const isUnavailable = s.status === 'unavailable';
                    const name = s.name || cleanServerName(s);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        disabled={isUnavailable}
                        className={`watch__ext-subserver-btn${isSelected ? ' is-active' : ''}${isUnavailable ? ' opacity-50 cursor-not-allowed' : ''}`}
                        onClick={!isUnavailable ? () => handleSelectServer(s) : undefined}
                        title={isUnavailable ? (s.unavailableReason || 'Unavailable') : `Switch to ${s.name}`}
                      >
                        <span className={`watch__ext-subserver-dot${isUnavailable ? ' bg-amber-400' : ''}`} />
                        <span>{name}</span>
                        {isUnavailable && <span className="text-[10px] text-amber-400 ml-1 font-semibold">(Unavailable)</span>}
                        {isSelected && !isUnavailable && <span className="watch__ext-active-badge">Active</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* STREAM UTILITY TOOLBAR */}
          <div className="watch__toolbar">
            {/* Quick Episode Navigation */}
            <div className="watch__tb-nav">
              <button
                type="button"
                className="watch__tb-btn"
                onClick={goPrev}
                disabled={idx <= 1}
                title="Previous Episode"
                aria-label="Previous Episode"
              >
                <SkipBack size={15} />
                <span className="watch__tb-label">Prev</span>
              </button>
              <button
                type="button"
                className="watch__tb-ep-badge watch__tb-ep-btn"
                onClick={() => setEpDrawerOpen(true)}
                title="View all episodes (open drawer)"
                aria-label={`Episode ${idx} of ${last}. Click to open episode list.`}
              >
                <ListVideo size={13} className="watch__tb-ep-icon" aria-hidden="true" />
                <span>EP</span>
                <strong>{idx}</strong>
                <span className="watch__tb-ep-total">/ {last}</span>
              </button>
              <button
                type="button"
                className="watch__tb-btn"
                onClick={goNext}
                disabled={idx >= last}
                title="Next Episode"
                aria-label="Next Episode"
              >
                <span className="watch__tb-label">Next</span>
                <SkipForward size={15} />
              </button>
            </div>

            {/* Quick Audio Switcher */}
            <div className="watch__tb-stream">
              <div className="watch__tb-audio-switch" role="group" aria-label="Audio selection">
                <button
                  type="button"
                  className={`watch__tb-audio-pill${prefs.audio !== 'dub' ? ' is-active' : ''}`}
                  onClick={() => switchAudioMode('sub')}
                  aria-pressed={prefs.audio !== 'dub'}
                >
                  <span className="watch__tb-audio-dot" />
                  <span>SUB</span>
                </button>
                {hasDubForProvider && (
                  <button
                    type="button"
                    className={`watch__tb-audio-pill${prefs.audio === 'dub' ? ' is-active' : ''}`}
                    onClick={() => switchAudioMode('dub')}
                    aria-pressed={prefs.audio === 'dub'}
                  >
                    <span className="watch__tb-audio-dot" />
                    <span>DUB</span>
                  </button>
                )}
              </div>
            </div>

            {/* Quick Utility Actions */}
            <div className="watch__tb-actions">
              <button
                type="button"
                className={`watch__tb-btn${inList ? ' is-active' : ''}`}
                onClick={() => void save()}
                disabled={busy}
                title={inList ? 'In My List' : 'Add to My List'}
              >
                <BookmarkPlus size={16} />
                <span className="watch__tb-label">{busy ? 'Saving…' : inList ? 'Saved' : 'List'}</span>
              </button>

              <button
                type="button"
                className="watch__tb-btn"
                onClick={() => setDownloadOpen(true)}
                title="Download Episode (High Speed Kiwi CDN)"
              >
                <Download size={16} />
                <span className="watch__tb-label">Download</span>
              </button>

              <button
                type="button"
                className="watch__tb-btn"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(window.location.href)
                    .then(() => notify('Link copied to clipboard.'))
                    .catch(() => notify(window.location.href));
                }}
                title="Share Episode"
              >
                <Share2 size={16} />
                <span className="watch__tb-label">Share</span>
              </button>

              <button
                type="button"
                className={`watch__tb-btn watch__tb-fav${faved ? ' is-faved' : ''}`}
                onClick={() => {
                  toggleFavourite(anime.id);
                  notify(faved ? 'Removed from favourites.' : 'Saved to favourites.');
                }}
                title={faved ? 'Remove from Favourites' : 'Add to Favourites'}
                aria-pressed={faved}
              >
                <Heart size={16} fill={faved ? 'currentColor' : 'none'} />
              </button>
            </div>
          </div>

          {/* TABBED METADATA CONTAINER */}
          <div className="watch__tabs-card">
            {/* Tab Nav Headers */}
            <div className="watch__tabs-header" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'episode'}
                className={`watch__tab-btn${activeTab === 'episode' ? ' is-active' : ''}`}
                onClick={() => setActiveTab('episode')}
              >
                <Tv size={16} aria-hidden="true" />
                <span>Episode Overview</span>
                <span className="watch__tab-badge">Ep {idx}</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'anime'}
                className={`watch__tab-btn${activeTab === 'anime' ? ' is-active' : ''}`}
                onClick={() => setActiveTab('anime')}
              >
                <Info size={16} aria-hidden="true" />
                <span>About Series</span>
                {anime.rating ? (
                  <span className="watch__tab-badge watch__tab-badge--rating">★ {ratingLabel(anime.rating)}</span>
                ) : null}
              </button>
            </div>

            {/* TAB 1: EPISODE DETAILS */}
            {activeTab === 'episode' && (
              <div className="watch__tab-panel" role="tabpanel">
                <div className="watch__ep-overview">
                  {episode?.thumb ? (
                    <div className="watch__ep-thumb-wrap">
                      <img
                        src={episode.thumb}
                        alt={episode.title || `Episode ${idx}`}
                        className="watch__ep-thumb"
                        loading="lazy"
                      />
                      <span className="watch__ep-thumb-duration">{episode.runtime || '24m'}</span>
                    </div>
                  ) : null}

                  <div className="watch__ep-info">
                    <div className="watch__ep-head">
                      <h2>
                        Episode {idx}
                        {episode?.title && episode.title.trim().toLowerCase() !== `episode ${idx}` ? (
                          <span className="watch__ep-subtitle">: {episode.title}</span>
                        ) : null}
                      </h2>
                      <div className="watch__ep-chips">
                        {isStreamResolved && <span className="badge badge--accent">1080p HD</span>}
                        <span className="badge">{prefs.audio === 'dub' ? 'English Dub' : 'Japanese Sub'}</span>
                        {episode?.airdate && (
                          <span className="badge badge--subtle">
                            <Clock size={11} aria-hidden="true" /> Aired: {episode.airdate}
                          </span>
                        )}
                        {episode?.runtime && episode.runtime !== '—' && (
                          <span className="badge badge--subtle">{episode.runtime}</span>
                        )}
                      </div>
                    </div>

                    <p className="watch__ep-synopsis">
                      {episode?.synopsis
                        ? episode.synopsis
                        : anime.synopsis
                          ? anime.synopsis
                          : 'No synopsis available for this episode.'}
                    </p>

                    {/* Up Next Mini-Card */}
                    {idx < last && episodes[idx] && (
                      <div className="watch__ep-next-teaser" onClick={goNext} role="button" tabIndex={0}>
                        <span className="watch__ep-next-label">UP NEXT</span>
                        <span className="watch__ep-next-title">
                          Episode {idx + 1}: {episodes[idx]?.title || `Episode ${idx + 1}`}
                        </span>
                        <ChevronRight size={14} aria-hidden="true" />
                      </div>
                    )}

                    {/* Live Broadcast Airing Countdown */}
                    {anime.schedule?.day && anime.schedule?.time && anime.status === 'Ongoing' && (
                      <div style={{ marginTop: '16px' }}>
                        <AiringCountdown
                          anime={{
                            id: anime.id,
                            title: anime.title,
                            poster: anime.poster,
                            status: anime.status,
                            schedule: anime.schedule,
                            episodeTotal: anime.episodeTotal,
                            episodeCount: anime.episodes?.length ?? anime.episodeCount,
                          }}
                          variant="banner"
                          showRemindMe
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: ANIME DETAILS */}
            {activeTab === 'anime' && (
              <div className="watch__tab-panel" role="tabpanel">
                <div className="watch__anime-overview">
                  <div className="watch__anime-title-row">
                    <div>
                      <h2>{anime.title}</h2>
                      {anime.native && <p className="watch__native" lang="ja">{anime.native}</p>}
                    </div>
                    {anime.season && <span className="badge badge--accent">{anime.season}</span>}
                  </div>

                  <ul className="watch__badges">
                    {anime.genres.map((g: string) => (
                      <li key={g} className="badge">
                        <Link to={`/genres?genre=${g}`}>{genreLabel(g)}</Link>
                      </li>
                    ))}
                  </ul>

                  <p className="watch__syn">{anime.synopsis}</p>

                  <dl className="watch__facts">
                    <div>
                      <dt>Rating</dt>
                      <dd>{ratingLabel(anime.rating)}</dd>
                    </div>
                    <div>
                      <dt>Year</dt>
                      <dd>{anime.year}</dd>
                    </div>
                    <div>
                      <dt>Format</dt>
                      <dd>{anime.kind}</dd>
                    </div>
                    <div>
                      <dt>Status</dt>
                      <dd>{anime.status}</dd>
                    </div>
                    <div>
                      <dt>Total Episodes</dt>
                      <dd>{anime.episodeTotal || anime.episodes?.length || anime.episodeCount || last}</dd>
                    </div>
                    <div>
                      <dt>Your Position</dt>
                      <dd>{positions[key] ? `${Math.round(positions[key].t / 60)} min in` : 'Not started'}</dd>
                    </div>
                  </dl>

                  {anime.schedule?.day && anime.schedule?.time && (
                    <div style={{ marginTop: '18px' }}>
                      <AiringCountdown
                        anime={{
                          id: anime.id,
                          title: anime.title,
                          poster: anime.poster,
                          status: anime.status,
                          schedule: anime.schedule,
                          episodeTotal: anime.episodeTotal,
                          episodeCount: anime.episodes?.length ?? anime.episodeCount,
                        }}
                        variant="banner"
                        showRemindMe
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <EpisodeSidebar
          anime={{ ...anime, episodes }}
          current={idx}
          onSelect={selectEpisode}
          onSelectSeason={selectSeason}
          autoNext={prefs.autoNext}
          onAutoNext={(v) => patch({ autoNext: v })}
          positions={positions}
          theatre={theatre}
          onTheatre={setTheatre}
        />

        {epDrawerOpen && (
          <EpisodeSidebar
            anime={{ ...anime, episodes }}
            current={idx}
            onSelect={selectEpisode}
            onSelectSeason={selectSeason}
            autoNext={prefs.autoNext}
            onAutoNext={(v) => patch({ autoNext: v })}
            positions={positions}
            theatre={theatre}
            onTheatre={setTheatre}
            isDrawer
            onCloseDrawer={() => setEpDrawerOpen(false)}
          />
        )}
      </div>

      <section className="watch__more shell" aria-labelledby="watch-more">
        <div className="sec-head">
          <h2 id="watch-more">
            <Play size={19} aria-hidden="true" />
            More from this shelf
          </h2>
        </div>
        <div className="watch__more-grid">
          {related.length ? (
            related.map((a) => <AnimeCard key={a.id} anime={a} variant="key" />)
          ) : (
            <p className="empty-row">No related titles are linked to this one in the database.</p>
          )}
        </div>
      </section>

      <DownloadModal
        isOpen={downloadOpen}
        onClose={() => setDownloadOpen(false)}
        anime={anime}
        episode={episode}
        currentStream={currentStream}
        activeProvider={targetProvider || currentStream?.provider || (activeServerId ? providerFromId(activeServerId).split(':')[0] : 'anikoto')}
        notify={notify}
      />
    </div>
  );
}
