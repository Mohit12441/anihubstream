import type { Genre } from '../data/model';
import { genreIcon } from './genreIcons';

interface Props {
  genres: Genre[];
  active?: string | null;
  onSelect: (id: string) => void;
}

export function GenreChips({ genres, active, onSelect }: Props) {
  return (
    <ul className="chips" aria-label="Genre filters">
      {genres.map((g) => {
        const Icon = genreIcon(g.id);
        return (
          <li key={g.id}>
            <button
              type="button"
              className="pill chips__item"
              style={{ '--pc': g.accent } as React.CSSProperties}
              aria-pressed={active === g.id}
              onClick={() => onSelect(g.id)}
              title={`${g.label} — ${g.tagline}`}
            >
              <Icon size={14} aria-hidden="true" />
              {g.label}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
