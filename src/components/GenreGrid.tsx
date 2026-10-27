import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Genre } from '../data/model';
import { genreIcon } from './genreIcons';

interface Props {
  genres: Genre[];
  active: string | null;
  counts: Record<string, number>;
  onSelect: (id: string) => void;
}

export function GenreGrid({ genres, active, counts, onSelect }: Props) {
  return (
    <ul className="ggrid">
      {genres.map((g) => {
        const Icon = genreIcon(g.id);
        const on = active === g.id;
        return (
          <li key={g.id}>
            <Link
              to={`/genres?genre=${g.id}`}
              className={`gcard${on ? ' is-on' : ''}`}
              style={{ '--pc': g.accent } as React.CSSProperties}
              onClick={(e) => {
                e.preventDefault();
                onSelect(g.id);
              }}
              aria-pressed={on}
              aria-expanded={on}
              aria-controls="genres-reveal-section"
            >
              <span className="gcard__art">
                <img src={g.art} alt="" aria-hidden="true" loading="lazy" decoding="async" />
                <span className="gcard__wash" />
                <span className="gcard__count">
                  {counts[g.id] ?? 0} {counts[g.id] === 1 ? 'title' : 'titles'}
                </span>
                <span className="gcard__icon">
                  <Icon size={18} aria-hidden="true" />
                </span>
              </span>
              <span className="gcard__foot">
                <span>
                  <b>{g.label}</b>
                  <span>{g.tagline}</span>
                </span>
                <span className="gcard__go" aria-hidden="true">
                  <ArrowRight size={16} />
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
