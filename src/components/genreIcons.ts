import type { LucideIcon } from 'lucide-react';
import {
  Clapperboard,
  Coffee,
  Compass,
  DoorOpen,
  Heart,
  Laugh,
  MoonStar,
  Rocket,
  Skull,
  Sparkles,
  Swords,
  Wand2,
} from 'lucide-react';

export type Icon = LucideIcon;

export const GENRE_ICONS: Record<string, Icon> = {
  action: Swords,
  adventure: Compass,
  fantasy: Wand2,
  isekai: DoorOpen,
  romance: Heart,
  'slice-of-life': Coffee,
  horror: Skull,
  comedy: Laugh,
  supernatural: Sparkles,
  'sci-fi': Rocket,
  drama: Clapperboard,
  mystery: MoonStar,
};

export const genreIcon = (id: string): Icon => GENRE_ICONS[id] ?? Sparkles;
