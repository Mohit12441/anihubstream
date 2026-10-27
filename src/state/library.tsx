import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { addToLibrary, getLibrary, getPositions, removeFromLibrary, savePosition } from '../data/api';
import { episodeIdOf, hydrateCard, type Anime, type ApiPosition } from '../data/model';

type Status = 'loading' | 'ready' | 'error';

export interface HistoryEntry {
  anime: Anime;
  episodeId: string;
  episodeNumber: number;
  episodeTitle: string;
  seconds: number;
  runtimeSeconds: number;
  updatedAt: string;
}

interface LibraryValue {
  status: Status;
  error: string | null;
  /** titles saved to this viewer's list, newest first */
  items: Anime[];
  has: (id: string) => boolean;
  isBusy: (id: string) => boolean;
  toggle: (id: string) => Promise<boolean>;
  /** favourites are a device preference and live in localStorage, not the database */
  favourites: Set<string>;
  toggleFavourite: (id: string) => void;
  history: HistoryEntry[];
  secondsFor: (animeId: string, n: number) => number | undefined;
  recordPosition: (anime: Anime, n: number, episodeTitle: string, seconds: number, runtimeSeconds: number) => void;
  reload: () => void;
}

const FAV_KEY = 'anihub:favourites';

const readFavourites = (): Set<string> => {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
};

const writeFavourites = (ids: Set<string>) => {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify([...ids]));
  } catch {
    /* private mode / quota — the list simply does not persist on this device */
  }
};

const toEntry = (p: ApiPosition): HistoryEntry => ({
  anime: hydrateCard(p.anime),
  episodeId: p.episodeId,
  episodeNumber: p.episodeNumber,
  episodeTitle: p.episodeTitle,
  seconds: p.seconds,
  runtimeSeconds: p.runtimeSeconds,
  updatedAt: p.updatedAt,
});

const Ctx = createContext<LibraryValue | null>(null);

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Anime[]>([]);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [favourites, setFavourites] = useState<Set<string>>(readFavourites);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [nonce, setNonce] = useState(0);

  /* background resume writes: one in flight, debounced, flushed on unmount */
  const pending = useRef<{ animeId: string; n: number; seconds: number } | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let live = true;
    setStatus('loading');
    setError(null);
    Promise.all([getLibrary(), getPositions()])
      .then(([list, positions]) => {
        if (!live) return;
        setItems(list.items.map((i) => i.anime).map(hydrateCard));
        setHistory(positions.items.map(toEntry));
        setStatus('ready');
      })
      .catch((err: Error) => {
        if (!live) return;
        setError(err.message);
        setStatus('error');
      });
    return () => {
      live = false;
    };
  }, [nonce]);

  const flush = useCallback(async () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    try {
      await savePosition(episodeIdOf(p.animeId, p.n), p.seconds);
    } catch {
      /* the device copy in localStorage is still correct — a lost background
         write must not interrupt playback */
    }
  }, []);

  useEffect(() => {
    const beforeUnload = () => {
      void flush();
    };
    window.addEventListener('pagehide', beforeUnload);
    return () => {
      window.removeEventListener('pagehide', beforeUnload);
      beforeUnload();
    };
  }, [flush]);

  const recordPosition = useCallback(
    (anime: Anime, n: number, episodeTitle: string, seconds: number, runtimeSeconds: number) => {
      if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(runtimeSeconds)) return;
      const clamped = Math.min(seconds, runtimeSeconds);
      pending.current = { animeId: anime.id, n, seconds: clamped };
      if (timer.current === null) {
        timer.current = window.setTimeout(() => {
          timer.current = null;
          void flush();
        }, 10_000);
      }
      /* keep the in-memory history in step with the device copy so My List and the
         card resume hints reflect this session without a reload */
      const episodeId = episodeIdOf(anime.id, n);
      setHistory((prev) =>
        [
          {
            anime,
            episodeId,
            episodeNumber: n,
            episodeTitle,
            seconds: clamped,
            runtimeSeconds,
            updatedAt: new Date().toISOString(),
          },
          ...prev.filter((h) => h.episodeId !== episodeId),
        ].slice(0, 20),
      );
    },
    [flush],
  );

  const setBusyFor = (id: string, on: boolean) =>
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const toggle = useCallback(
    async (animeId: string) => {
      const saved = items.some((a) => a.id === animeId);
      setBusyFor(animeId, true);
      setError(null);
      try {
        if (saved) {
          await removeFromLibrary(animeId);
          setItems((prev) => prev.filter((a) => a.id !== animeId));
        } else {
          const fresh = await addToLibrary(animeId);
          const card = hydrateCard(fresh.anime);
          setItems((prev) => (prev.some((a) => a.id === card.id) ? prev : [card, ...prev]));
        }
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not reach the library service.');
        return false;
      } finally {
        setBusyFor(animeId, false);
      }
    },
    [items],
  );

  const toggleFavourite = useCallback((animeId: string) => {
    setFavourites((prev) => {
      const next = new Set(prev);
      if (next.has(animeId)) next.delete(animeId);
      else next.add(animeId);
      writeFavourites(next);
      return next;
    });
  }, []);

  const value = useMemo<LibraryValue>(
    () => ({
      status,
      error,
      items,
      has: (id) => items.some((a) => a.id === id),
      isBusy: (id) => busy.has(id),
      toggle,
      favourites,
      toggleFavourite,
      history,
      secondsFor: (animeId, n) => history.find((h) => h.episodeId === episodeIdOf(animeId, n))?.seconds,
      recordPosition,
      reload: () => setNonce((x) => x + 1),
    }),
    [status, error, items, busy, toggle, favourites, toggleFavourite, history, recordPosition],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLibrary() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useLibrary must be used inside <LibraryProvider>');
  return ctx;
}
