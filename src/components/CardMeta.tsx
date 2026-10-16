import { type Anime } from '../data/model';
import { formatCardMeta } from '../lib/cardMeta';

export { formatCardMeta };

export interface CardMetaProps {
  anime: Pick<Anime, 'kind' | 'year' | 'episodeCount' | 'episodeTotal'>;
  episode?: string;
  className?: string;
}

export function CardMeta({ anime, episode, className = 'acard__meta' }: CardMetaProps) {
  const metaText = formatCardMeta(anime, episode);
  return <p className={className}>{metaText}</p>;
}
