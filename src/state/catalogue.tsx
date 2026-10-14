import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, getAnime, getCatalogue, getGenres, getHome, getSchedule, getStats } from '../data/api';
import {
  DAYS,
  hydrateCard,
  hydrateEpisode,
  hydrateGenre,
  seasonSortKey,
  type Anime,
  type Genre,
  type ScheduleEntry,
  type SeasonKey,
} from '../data/model';

type Status = 'loading' | 'ready' | 'error';

/** The five home shelves, picked by the database so the growing catalogue never
    has to fit inside a browser tab to be browsable. */
interface HomeRows {
  trending: Anime[];
  ongoing: Anime[];
  top: Anime[];
  fresh: Anime[];
  added: Anime[];
}

interface Stats {
  titles: number;
  ongoing: number;
  genres: Record<string, number>;
}

interface Catalogue {
  status: Status;
  error: string | null;
  reload: () => void;
  GENRES: Genre[];
  genreLabel: (id: string) => string;
  DAYS: readonly string[];
  SEASONS: SeasonKey[];
  HERO_ANIME: Anime | undefined;
  home: HomeRows;
  stats: Stats | null;
  /** the top-rated head of the catalogue (server-picked), for the Discover strip */
  popular: () => Anime[];
  byId: (id: string) => Anime | undefined;
  /** example queries drawn from the loaded spine, so the hints never lead to zero matches */
  searchExamples: string[];
  scheduleFor: (season: SeasonKey | 'All') => ScheduleEntry[];
}

const EMPTY_HOME: HomeRows = { trending: [], ongoing: [], top: [], fresh: [], added: [] };

const EMPTY = {
  status: 'loading' as Status,
  error: null,
  reload: () => {},
  GENRES: [] as Genre[],
  genreLabel: (id: string) => id,
  DAYS,
  SEASONS: [] as SeasonKey[],
  HERO_ANIME: undefined,
  home: EMPTY_HOME,
  stats: null,
  popular: () => [] as Anime[],
  byId: () => undefined,
  searchExamples: [],
  scheduleFor: () => [] as ScheduleEntry[],
};

const Ctx = createContext<Catalogue>(EMPTY);

export function CatalogueProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const [spine, setSpine] = useState<Anime[]>([]);
  const [genres, setGenres] = useState<Genre[]>([]);
  const [seasons, setSeasons] = useState<SeasonKey[]>([]);
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [home, setHome] = useState<HomeRows>(EMPTY_HOME);
  const [stats, setStats] = useState<Stats | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    setStatus('loading');
    setError(null);

    Promise.all([getCatalogue(), getGenres(), getSchedule(), getHome(), getStats()])
      .then(([cards, gs, sched, homeBody, statsBody]) => {
        if (!live) return;
        setSpine(cards.results.map(hydrateCard));
        setGenres(gs.results.map(hydrateGenre));
        setSeasons(
          /* Newest first: the schedule page opens on the season that is actually running. */
          [...(sched.seasons as SeasonKey[])].sort((a, b) => seasonSortKey(b) - seasonSortKey(a)),
        );
        setEntries(
          sched.days.flatMap((d) =>
            d.entries.flatMap((c) =>
              c.schedule
                ? [
                    {
                      anime: hydrateCard(c),
                      day: d.day,
                      dayLabel: d.dayLabel,
                      date: c.schedule.date,
                      time: c.schedule.time,
                      season: c.schedule.season,
                    },
                  ]
                : [],
            ),
          ),
        );
        setHome({
          trending: homeBody.trending.map(hydrateCard),
          ongoing: homeBody.ongoing.map(hydrateCard),
          top: homeBody.topRated.map(hydrateCard),
          fresh: homeBody.fresh.map(hydrateCard),
          added: homeBody.added.map(hydrateCard),
        });
        setStats(statsBody);
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

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const value = useMemo<Catalogue>(() => {
    const label = new Map(genres.map((g) => [g.id, g.label]));
    return {
      status,
      error,
      reload,
      GENRES: genres,
      genreLabel: (gid: string) => label.get(gid) ?? gid,
      DAYS,
      SEASONS: seasons,
      HERO_ANIME: spine.find((a) => a.rank === 1) ?? spine[0],
      home,
      stats,
      popular: () => home.top.slice(0, 8),
      byId: (id: string) => spine.find((a) => a.id === id),
      searchExamples: (() => {
        /* A title fragment plus the genre the spine leans on most, so
           empty-state hints can never suggest a term with zero matches. */
        const out: string[] = [];
        const word = spine
          .map((a) => a.title.split(/[\s:!?'’,-]+/).find((w) => w.length >= 4))
          .find((w): w is string => Boolean(w));
        if (word) out.push(word);
        const tally = new Map<string, number>();
        for (const a of spine) for (const g of a.genres) tally.set(g, (tally.get(g) ?? 0) + 1);
        const top = [...tally.entries()].sort((x, y) => y[1] - x[1])[0];
        if (top) out.push(label.get(top[0]) ?? top[0]);
        return out;
      })(),
      scheduleFor: (season) =>
        entries
          .filter((e) => season === 'All' || e.season === season)
          .sort((x, y) => x.day - y.day || x.time.localeCompare(y.time)),
    };
  }, [status, error, reload, spine, genres, seasons, entries, home, stats]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useCatalogue = () => useContext(Ctx);

/* The watch page needs the full episode list, which the card list deliberately
   leaves out. One request per title. */
export interface AnimeDetail {
  status: Status;
  error: string | null;
  /** the service answered "no such title" rather than failing — a different page */
  missing: boolean;
  anime: Anime | undefined;
  related: Anime[];
  reload: () => void;
}

export function useAnimeDetail(id: string): AnimeDetail {
  const [state, setState] = useState<{
    status: Status;
    error: string | null;
    missing: boolean;
    anime: Anime | null;
    related: Anime[];
  }>({ status: 'loading', error: null, missing: false, anime: null, related: [] });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!id) return;
    let live = true;
    setState((s) => ({ ...s, status: s.anime ? 'ready' : 'loading', error: null }));
    getAnime(id)
      .then((d) => {
        if (!live) return;
        const { episodes, related, ...card } = d;
        setState({
          status: 'ready',
          error: null,
          missing: false,
          anime: { ...hydrateCard(card), episodes: episodes.map(hydrateEpisode) },
          related: related.map(hydrateCard),
        });
      })
      .catch((err: Error) => {
        if (!live) return;
        setState((s) => ({
          ...s,
          status: 'error',
          missing: err instanceof ApiError && err.status === 404,
          error: err.message,
        }));
      });
    return () => {
      live = false;
    };
  }, [id, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return {
    status: state.status,
    error: state.error,
    missing: state.missing,
    anime: state.anime ?? undefined,
    related: state.related,
    reload,
  };
}
