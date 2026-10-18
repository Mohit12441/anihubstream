import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookmarkX, Clock, Heart, Info, Play } from 'lucide-react';
import { AnimeCard } from '../components/AnimeCard';
import { Art } from '../components/Art';
import { CatalogueError, CatalogueLoading } from '../components/CatalogueState';
import { Embers } from '../components/Embers';
import { getAnime } from '../data/api';
import { artUrl, hydrateCard } from '../data/model';
import type { Anime } from '../data/model';
import { CardMeta } from '../components/CardMeta';
import { pct, stamp } from '../lib/time';
import { useSEO } from '../lib/useSEO';
import { useCatalogue } from '../state/catalogue';
import { useLibrary } from '../state/library';
import '../styles/pages.css';

export function MyList() {
  const { byId } = useCatalogue();
  const { status, error, reload, items, history, favourites, isBusy, toggle, toggleFavourite } = useLibrary();

  useSEO({
    title: 'My List & Watch History — Saved Anime | AniHubStream',
    description: 'Track your personal anime watchlist, resume playback from saved positions, and manage favorites on AniHubStream.',
    canonicalUrl: 'https://anihubstream.com/mylist',
    noindex: true,
  });

  /* The provider spine only carries the curated head of the catalogue; a
     favourite picked from deeper pages is fetched by id so the list never
     silently drops a title the viewer saved. */
  const [deepFaves, setDeepFaves] = useState<Record<string, Anime>>({});
  useEffect(() => {
    let live = true;
    const missing = [...favourites].filter((id) => !byId(id) && !deepFaves[id]);
    if (!missing.length) return;
    Promise.allSettled(missing.map((id) => getAnime(id).then((d) => [id, hydrateCard(d)] as const))).then(
      (res) => {
        if (!live) return;
        const found: Record<string, Anime> = {};
        for (const r of res) if (r.status === 'fulfilled') found[r.value[0]] = r.value[1];
        if (Object.keys(found).length) setDeepFaves((prev) => ({ ...prev, ...found }));
      },
    );
    return () => {
      live = false;
    };
  }, [favourites, byId, deepFaves]);

  const faved = [...favourites].map((id) => byId(id) ?? deepFaves[id]).filter((a): a is Anime => Boolean(a));

  return (
    <div className="page mylist">
      <header className="banner banner--crimson">
        <img
          className="banner__img"
          src={artUrl('/art/watch-scene.jpg')}
          alt=""
          aria-hidden="true"
          decoding="async"
        />
        <div className="banner__veil" />
        <Embers count={12} tone="crimson" />
        <div className="banner__inner shell">
          <div>
            <p className="banner__kicker">This viewer&rsquo;s record</p>
            <h1 className="banner__title">
              <span className="banner__title-a">My</span>
              <span className="banner__title-b">List</span>
            </h1>
            <p className="banner__sub">
              {status === 'ready'
                ? `${items.length} saved · ${history.length} in progress`
                : 'Saved titles and where you stopped'}
            </p>
          </div>
        </div>
      </header>

      <div className="shell mylist__body">
        {status === 'error' && <CatalogueError error={error} onRetry={reload} />}

        {status === 'loading' && <CatalogueLoading grid={false} rows={4} />}

        {status === 'ready' && (
          <>
            <section aria-labelledby="continue">
              <div className="sec-head">
                <h2 id="continue">
                  <Clock size={19} aria-hidden="true" />
                  Continue watching
                  <span className="sec-head__count">{history.length}</span>
                </h2>
                <p className="sec-head__hint">Last 20 positions for this browser&rsquo;s viewer id</p>
              </div>

              {history.length ? (
                <ul className="lrow-list">
                  {history.map((h) => (
                    <li className="lrow" key={h.episodeId}>
                      <Link
                        className="lrow__thumb"
                        to={`/watch/${h.anime.id}?ep=${h.episodeNumber}`}
                        tabIndex={-1}
                        aria-hidden="true"
                      >
                        <Art sources={[h.anime.key, h.anime.poster]} alt="" hideWhenEmpty />
                      </Link>
                      <div className="lrow__body">
                        <Link className="lrow__title" to={`/watch/${h.anime.id}?ep=${h.episodeNumber}`}>
                          {h.anime.title}
                        </Link>
                        <p className="lrow__meta">
                          Episode {h.episodeNumber} · {h.episodeTitle}
                          <span className="lrow__time">
                            {stamp(h.seconds)} / {stamp(h.runtimeSeconds)}
                          </span>
                        </p>
                        <div className="lrow__bar" aria-hidden="true">
                          <i style={{ width: `${pct(h.seconds, h.runtimeSeconds)}%` }} />
                        </div>
                      </div>
                      <Link className="btn btn--sm btn--primary lrow__go" to={`/watch/${h.anime.id}?ep=${h.episodeNumber}`}>
                        <Play size={13} fill="currentColor" strokeWidth={0} aria-hidden="true" />
                        Resume
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty" role="status">
                  <b>No playback positions recorded yet.</b>
                  Open any title — the player saves where you stop.
                </p>
              )}
            </section>

            <section aria-labelledby="saved">
              <div className="sec-head">
                <h2 id="saved">
                  <BookmarkX size={19} aria-hidden="true" />
                  Saved titles
                  <span className="sec-head__count">{items.length}</span>
                </h2>
                <p className="sec-head__hint">
                  <Link to="/anime">Browse the catalogue</Link>
                </p>
              </div>

              {items.length ? (
                <ul className="lrow-list">
                  {items.map((a) => (
                    <li className="lrow" key={a.id}>
                      <Link className="lrow__thumb" to={`/watch/${a.id}`} tabIndex={-1} aria-hidden="true">
                        <Art sources={[a.poster, a.key]} alt="" hideWhenEmpty />
                      </Link>
                      <div className="lrow__body">
                        <Link className="lrow__title" to={`/watch/${a.id}`}>
                          {a.title}
                        </Link>
                        <CardMeta anime={a} className="lrow__meta" />
                      </div>
                      <button
                        type="button"
                        className="btn btn--sm btn--ghost"
                        onClick={() => void toggle(a.id)}
                        disabled={isBusy(a.id)}
                      >
                        <BookmarkX size={14} aria-hidden="true" />
                        {isBusy(a.id) ? 'Removing…' : 'Remove'}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty" role="status">
                  <b>Your list is empty.</b>
                  Use <i>Add to List</i> on a watch page — it writes to this viewer&rsquo;s record in the database.
                </p>
              )}
            </section>

            <section aria-labelledby="device-faves">
              <div className="sec-head">
                <h2 id="device-faves">
                  <Heart size={19} aria-hidden="true" />
                  Favourites on this device
                  <span className="sec-head__count">{faved.length}</span>
                </h2>
                <p className="sec-head__hint">Stored in this browser only</p>
              </div>

              {faved.length ? (
                <ul className="pgrid">
                  {faved.map(
                    (a) =>
                      a && (
                        <li key={a.id}>
                          <AnimeCard anime={a} variant="poster" />
                          <button
                            type="button"
                            className="btn btn--sm btn--ghost mylist__unfav"
                            onClick={() => toggleFavourite(a.id)}
                          >
                            <Heart size={13} aria-hidden="true" />
                            Remove favourite
                          </button>
                        </li>
                      ),
                  )}
                </ul>
              ) : (
                <p className="empty" role="status">
                  <b>Nothing hearted yet.</b>
                  The heart on a watch page keeps a title here, on this device only.
                </p>
              )}
            </section>
          </>
        )}

        <p className="note">
          <Info size={14} aria-hidden="true" />
          Saved titles and playback positions live in this site&rsquo;s database against an anonymous viewer id held
          in an HttpOnly cookie — no account, no password. Clearing that cookie, or browsing from another device,
          starts a fresh list.
        </p>
      </div>
    </div>
  );
}
