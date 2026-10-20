import { ArrowRight, Search } from 'lucide-react';
import { useToast } from '../lib/Toast';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  placeholder?: string;
  /** real catalogue terms for the empty-submit hint so it can't dead-end */
  suggestions?: string[];
}

export function SearchBar({
  value,
  onChange,
  onSubmit,
  placeholder = 'Search anime, movies, or genres...',
  suggestions = [],
}: Props) {
  const { notify } = useToast();

  return (
    <form
      className="search search--hero"
      onSubmit={(e) => {
        e.preventDefault();
        const term = value.trim();
        if (term) onSubmit(term);
        else if (suggestions.length) notify(`Try ${suggestions.map((s) => `“${s}”`).join(' or ')}.`);
        else notify('Type a title, genre, or format to search.');
      }}
      role="search"
    >
      <Search size={19} aria-hidden="true" />
      <label className="sr-only" htmlFor="hero-search">
        Search the catalogue
      </label>
      <input
        id="hero-search"
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
      />
      <button type="submit" className="search__submit" aria-label="Search">
        <ArrowRight size={20} />
      </button>
    </form>
  );
}
