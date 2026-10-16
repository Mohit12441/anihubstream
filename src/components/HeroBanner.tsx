import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Play } from 'lucide-react';
import { Embers } from './Embers';
import { GenreChips } from './GenreChips';
import { SearchBar } from './SearchBar';
import { HERO } from '../data/model';
import { GENRES } from '../data/genres';
import { useCatalogue } from '../state/catalogue';
import { usePrefersReducedMotion } from '../lib/motion';

interface Props {
  query: string;
  onQuery: (v: string) => void;
  onSearch: (v: string) => void;
  activeGenre: string | null;
  onGenre: (id: string) => void;
}

export function HeroBanner({ query, onQuery, onSearch, activeGenre, onGenre }: Props) {
  const { HERO_ANIME, searchExamples } = useCatalogue();
  const ref = useRef<HTMLElement>(null);
  const reduced = usePrefersReducedMotion();
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        setOffset(Math.min(Math.max(-r.top, 0), 700) * 0.16);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [reduced]);

  return (
    <section className="hero" ref={ref} aria-label="AniHubStream featured">
      <div className="hero__art" style={{ transform: `translate3d(0, ${offset}px, 0) scale(1.06)` }}>
        <img src={HERO.art} alt="" aria-hidden="true" decoding="async" />
      </div>
      <div className="hero__veil" />
      <div className="hero__vignette" />
      <Embers count={26} tone="crimson" className="hero__embers" />

      <div className="hero__inner shell">
        <div className="hero__copy">
          <p className="hero__kicker">{HERO.kicker}</p>

          <h1 className="hero__title">
            <span className="hero__title-a">{HERO.title[0]}</span> <span className="hero__title-b">{HERO.title[1]}</span>
          </h1>

          <p className="hero__sub">{HERO.sub}</p>
          <p className="hero__lede">{HERO.copy}</p>

          <SearchBar
            value={query}
            onChange={onQuery}
            onSubmit={onSearch}
            suggestions={searchExamples}
          />

          <GenreChips genres={GENRES.slice(0, 7)} active={activeGenre} onSelect={onGenre} />

          <div className="hero__cta">
            {HERO_ANIME && (
              <Link className="btn btn--primary" to={`/watch/${HERO_ANIME.id}`}>
                <Play size={17} fill="currentColor" strokeWidth={0} aria-hidden="true" />
                Watch Now
              </Link>
            )}
            <Link className="btn btn--ghost" to="/anime">
              Explore Anime
            </Link>
          </div>
        </div>

        <div className="vj hero__vj" aria-hidden="true">
          <span className="vj__jp" lang="ja">{HERO.jp}</span>
          <span className="vj__en">{HERO.en}</span>
        </div>
      </div>
    </section>
  );
}
