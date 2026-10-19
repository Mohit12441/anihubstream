import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Compass, Flame, Radio, Sparkles, Star, X } from 'lucide-react';
import { AnimeCard } from '../components/AnimeCard';
import { AnimeCarousel } from '../components/AnimeCarousel';
import { CatalogueError, CatalogueLoading } from '../components/CatalogueState';
import { HeroBanner } from '../components/HeroBanner';
import { genreIcon } from '../components/genreIcons';
import { listCatalogue } from '../data/api';
import { artUrl, hydrateCard } from '../data/model';
import type { Anime } from '../data/model';
import { useCatalogue } from '../state/catalogue';
import { useSEO } from '../lib/useSEO';
import { ProviderRow, type ProviderMeta, type ProviderSearchResult } from '../components/search/ProviderRow';
import { CategoryPills, type CategoryPillItem } from '../components/ui/CategoryPills';
import '../styles/home.css';

const PROVIDER_METAS: Record<string, ProviderMeta> = {
  anikoto: { name: 'AniKoto', badge: 'HLS 1080p', color: '#6366f1' },
  hianime: { name: 'HiAnime', badge: 'JSON Stream', color: '#ec4899' },
  aniwatch: { name: 'AniWatch', badge: 'Megaplay', color: '#3b82f6' },
  animedubhindi: { name: 'AnimeDubHindi', badge: 'Hindi Dub', color: '#f59e0b' },
  watchanimeworld: { name: 'WatchAnimeWorld', badge: 'Direct MP4', color: '#10b981' },
};


const MOODS = [
  {
    to: '/genres',
    label: 'Browse',
    title: 'Explore Genres',
    copy: 'Neon-lit shelves for every mood',
    art: artUrl('/art/genres-purple.jpg'),
    pc: '#a24bff',
  },
  {
    to: '/schedule',
    label: 'Airing',
    title: 'Ongoing This Season',
    copy: 'Never miss a new episode',
    art: artUrl('/art/schedule-blue.jpg'),
    pc: '#3b82ff',
  },
  {
    to: '/discover',
    label: 'Discover',
    title: 'Good Anime, Better Days',
    copy: 'Stream. Explore. Enjoy.',
    art: artUrl('/art/discover-sunset.jpg'),
    pc: '#ff9420',
  },
];

const rotate = <T,>(arr: T[], seed: number) => {
  if (!seed || arr.length < 2) return arr;
  const k = seed % arr.length;
  return [...arr.slice(k), ...arr.slice(0, k)];
};

export function Home() {
  const navigate = useNavigate();
  const { status, error, reload, GENRES, genreLabel, home } = useCatalogue();
  const [query, setQuery] = useState('');
  const [genre, setGenre] = useState<string | null>(null);
  const [seed, setSeed] = useState(0);

  useSEO({
    title: 'AniHubStream — Watch Anime Free Anytime, Anywhere',
    description: 'Watch high-quality anime online free on AniHubStream. Stream subbed and dubbed anime with fast playback, clean schedules, and full episode guides.',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'AniHubStream',
      url: 'https://anihubstream.com',
      potentialAction: {
        '@type': 'SearchAction',
        target: 'https://anihubstream.com/anime?search={search_term_string}',
        'query-input': 'required name=search_term_string',
      },
    },
  });

  /* The genre shelf asks the database, not the 60-title spine: the catalogue
     grows by hundreds of titles a day, so "every Action title" only exists
     server-side. */
  const [shelf, setShelf] = useState<{ items: Anime[]; total: number } | null>(null);
  const [shelfBusy, setShelfBusy] = useState(false);
  useEffect(() => {
    if (!genre) {
      setShelf(null);
      setShelfBusy(false);
      return;
    }
    let live = true;
    setShelfBusy(true);
    listCatalogue({ genre, sort: 'trend', limit: 20 })
      .then((r) => {
        if (!live) return;
        setShelf({ items: r.results.map(hydrateCard), total: r.total });
      })
      .catch(() => {
        if (live) setShelf({ items: [], total: 0 });
      })
      .finally(() => {
        if (live) setShelfBusy(false);
      });
    return () => {
      live = false;
    };
  }, [genre]);

  const genreAccent = (id: string) => GENRES.find((g) => g.id === id)?.accent ?? '#ff1f4a';

  const featured = useMemo<Anime[]>(
    () => (genre ? shelf?.items ?? [] : rotate(home.trending, seed)),
    [genre, shelf, seed, home.trending],
  );

  const rows = useMemo(
    () => ({
      ongoing: rotate(home.ongoing, seed + 1),
      top: rotate(home.top, seed + 2),
      fresh: rotate(home.fresh, seed + 3),
      added: home.added,
    }),
    [seed, home],
  );

  const [providerStreams, setProviderStreams] = useState<Record<string, ProviderSearchResult[]>>({});
  const [providerFilter, setProviderFilter] = useState<string>('all');
  const [providerLoading, setProviderLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setProviderLoading(true);
    fetch('/api/search?q=demon+slayer')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data?.providers) return;
        setProviderStreams(data.providers);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setProviderLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const providerCategoryPills = useMemo<CategoryPillItem[]>(() => {
    let totalCount = 0;
    for (const list of Object.values(providerStreams)) {
      totalCount += list.length;
    }
    const pills: CategoryPillItem[] = [
      {
        id: 'all',
        label: 'All Streams',
        count: totalCount,
        color: 'var(--brand, #6366f1)',
      },
    ];

    for (const [key, meta] of Object.entries(PROVIDER_METAS)) {
      const items = providerStreams[key] || [];
      if (items.length > 0) {
        pills.push({
          id: key,
          label: meta.name,
          badge: meta.badge,
          count: items.length,
          color: meta.color,
        });
      }
    }
    return pills;
  }, [providerStreams]);

  const activeProviderRows = useMemo(() => {
    const entries = Object.entries(providerStreams).filter(([_, items]) => items && items.length > 0);
    if (providerFilter === 'all') return entries;
    return entries.filter(([key]) => key === providerFilter);
  }, [providerStreams, providerFilter]);

  const heading = genre ? genreLabel(genre) : 'Trending Now';


  return (
    <div className="page home">
      <HeroBanner
        query={query}
        onQuery={setQuery}
        onSearch={(q) => navigate(`/search?q=${encodeURIComponent(q)}`)}
        activeGenre={genre}
        onGenre={(id) => setGenre((cur) => (cur === id ? null : id))}
      />

      <div className="home__rows shell">
        {status !== 'ready' ? (
          status === 'error' ? (
            <CatalogueError error={error} onRetry={reload} />
          ) : (
            <CatalogueLoading grid rows={8} />
          )
        ) : (
          <>
        <section className="home__row" aria-labelledby="row-trending">
          <div className="sec-head">
            <h2 id="row-trending">
              <Flame size={21} aria-hidden="true" />
              {heading}
              <Link to="/anime" className="sec-head__link" aria-label="Browse all anime">
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
            </h2>
            {genre && (
              <span className="pill pill--sm" style={{ '--pc': genreAccent(genre) } as React.CSSProperties}>
                {shelfBusy ? 'Counting…' : `${shelf?.total ?? 0} titles`}
                <button type="button" onClick={() => setGenre(null)} aria-label="Clear genre filter">
                  <X size={14} />
                </button>
              </span>
            )}
          </div>
          <AnimeCarousel label={heading} onShuffle={() => setSeed((s) => s + 1)}>
            {featured.length ? (
              featured.map((a, i) => (
                <AnimeCard key={a.id} anime={a} variant="key" rank={genre ? undefined : i + 1} />
              ))
            ) : (
              <EmptyRow
                text={
                  genre
                    ? shelfBusy
                      ? `Gathering ${heading} titles…`
                      : `No title in the catalogue is tagged ${heading} yet.`
                    : 'The trending list is empty right now — check back soon.'
                }
              />
            )}
          </AnimeCarousel>
        </section>

        <section className="home__row" aria-label="Themed sections">
          <div className="moods">
            {MOODS.map((m) => (
              <Link key={m.to} to={m.to} className="mood" style={{ '--pc': m.pc } as React.CSSProperties}>
                <img src={m.art} alt="" aria-hidden="true" loading="lazy" decoding="async" />
                <div className="mood__body">
                  <small>{m.label}</small>
                  <h3>{m.title}</h3>
                  <p>{m.copy}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* Live Multi-Provider Streams Shelf */}
        <section className="home__row home__provider-streams" aria-labelledby="row-providers">
          <div className="sec-head">
            <h2 id="row-providers">
              <Radio size={21} aria-hidden="true" style={{ color: 'var(--brand, #6366f1)' }} />
              Live Provider Streams
              <Link to="/search?q=demon+slayer" className="sec-head__link" aria-label="Open multi-provider search">
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
            </h2>
            <p className="sec-head__hint">Real-time streams across AniKoto, HiAnime, AniWatch & Hindi Dub</p>
          </div>

          <div style={{ marginBottom: '18px', overflowX: 'auto', paddingBottom: '4px' }}>
            <CategoryPills
              categories={providerCategoryPills}
              activeId={providerFilter}
              onSelect={setProviderFilter}
            />
          </div>

          {providerLoading && Object.keys(providerStreams).length === 0 && (
            <div style={{ padding: '24px 0', color: '#94a3b8', fontSize: '0.88rem' }}>
              Fetching real-time streams from AniKoto, HiAnime, and Hindi Dub mirrors...
            </div>
          )}

          {activeProviderRows.map(([providerKey, items]) => {

            const meta = PROVIDER_METAS[providerKey] || {
              name: providerKey.toUpperCase(),
              badge: 'Stream',
              color: '#6366f1',
            };
            return (
              <ProviderRow
                key={providerKey}
                providerKey={providerKey}
                meta={meta}
                items={items}
              />
            );
          })}
        </section>


        <Row
          id="row-ongoing"
          title="Ongoing This Season"
          icon={<Star size={20} aria-hidden="true" />}
          items={rows.ongoing}
          to="/schedule"
          toLabel="Full schedule"
        />

        <Row
          id="row-top"
          title="Top Anime Right Now"
          icon={<Flame size={20} aria-hidden="true" />}
          items={rows.top}
          to="/anime?sort=rating"
          toLabel="All rankings"
        />

        <Row
          id="row-added"
          title="Just Added"
          icon={<Sparkles size={20} aria-hidden="true" />}
          items={rows.added}
          to="/anime?sort=added"
          toLabel="Recently added"
          poster
        />

        <section className="home__row" aria-labelledby="row-genres">
          <div className="spot">
            <div className="spot__head">
              <h2 id="row-genres">Find your shelf</h2>
              <p>Tap a genre to filter the trending row, or open the full genre browser.</p>
              <Link className="btn btn--sm btn--ghost" to="/genres">
                Explore genres <ArrowRight size={15} />
              </Link>
            </div>
            {GENRES.map((g) => {
              const Icon = genreIcon(g.id);
              return (
                <button
                  key={g.id}
                  type="button"
                  className="spot__item"
                  style={{ '--pc': g.accent } as React.CSSProperties}
                  aria-pressed={genre === g.id}
                  onClick={() => {
                    setGenre(g.id);
                    document.getElementById('row-trending')?.scrollIntoView({ block: 'center' });
                  }}
                >
                  <span className="spot__icon">
                    <Icon size={19} aria-hidden="true" />
                  </span>
                  <span>
                    <b>{g.label}</b>
                    <span>{g.tagline}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <Row
          id="row-fresh"
          title="Newest in the Catalogue"
          icon={<Compass size={20} aria-hidden="true" />}
          items={rows.fresh}
          to="/anime"
          toLabel="Browse all"
          poster
        />
          </>
        )}
      </div>
    </div>
  );
}

function Row({
  id,
  title,
  icon,
  items,
  to,
  toLabel,
  poster,
}: {
  id: string;
  title: string;
  icon: React.ReactNode;
  items: Anime[];
  to: string;
  toLabel: string;
  poster?: boolean;
}) {
  return (
    <section className="home__row" aria-labelledby={id}>
      <div className="sec-head">
        <h2 id={id}>
          {icon}
          {title}
          <Link to={to} className="sec-head__link" aria-label={toLabel}>
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </h2>
        <p className="sec-head__hint">{toLabel}</p>
      </div>
      <AnimeCarousel label={title}>
        {items.length ? (
          items.map((a) => (
            <AnimeCard
              key={a.id}
              anime={a}
              variant={poster ? 'poster' : 'key'}
              badge={a.status === 'Ongoing' ? 'ONGOING' : undefined}
            />
          ))
        ) : (
          <EmptyRow text="Nothing to show here yet." />
        )}
      </AnimeCarousel>
    </section>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <p className="empty-row" role="status">
      {text}
    </p>
  );
}
