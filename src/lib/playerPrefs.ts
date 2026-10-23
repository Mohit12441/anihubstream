/* ============================================================
   Player preferences — localStorage only, non-sensitive data.
   Speed, subtitle styling, volume, accent, auto-next, resume
   position. No tokens, no credentials, no personal data.
   ============================================================ */

export type QualityId = 'auto' | '360p' | '480p' | '720p' | '1080p' | '1440p';
export type AspectId = 'default' | 'fit' | 'fill' | '16:9' | '4:3';
export type AccentId = 'crimson' | 'purple' | 'blue' | 'emerald' | 'neutral';
export type Density = 'comfortable' | 'compact';
export type CaptionPosition = 'bottom' | 'middle' | 'top';
export type CaptionBackdrop = 'none' | 'box' | 'shadow';
/** which audio to ask the bridge for; a dub the source does not really carry falls back to 'sub' */
export type AudioId = 'sub' | 'dub' | 'hindi' | string;

export interface SubtitleSettings {
  enabled: boolean;
  /** ISO 639-1 code (see SUB_LANG_NAMES); 'Off' is carried by `enabled`, not here */
  language: string;
  size: number;
  color: string;
  background: number;
  backdrop: CaptionBackdrop;
  outline: boolean;
  position: CaptionPosition;
}

export interface PlayerPrefs {
  speed: number;
  quality: QualityId;
  aspect: AspectId;
  volume: number;
  muted: boolean;
  autoNext: boolean;
  autoSkipIntro: boolean;
  autoSkipOutro: boolean;
  rememberPosition: boolean;
  /** which audio to ask the bridge for (original or dubbed); persisted viewer choice */
  audio: AudioId;
  /** null = follow whatever the viewer last chose for this session */
  defaultSpeed: number | null;
  defaultSubLang: string | null;
  subtitles: SubtitleSettings;
  accent: AccentId;
  density: Density;
  /** Experimental P2P segment sharing between concurrent viewers (WebRTC mesh) */
  enableP2P: boolean;
}

export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export const QUALITIES: { id: QualityId; label: string; note: string }[] = [
  { id: 'auto', label: 'Auto', note: '' },
  { id: '360p', label: '360p', note: '' },
  { id: '480p', label: '480p', note: '' },
  { id: '720p', label: '720p', note: '' },
  { id: '1080p', label: '1080p', note: '' },
  { id: '1440p', label: '1440p', note: '' },
];

export const ASPECTS: { id: AspectId; label: string; hint: string }[] = [
  { id: 'default', label: 'Default', hint: 'auto' },
  { id: 'fit', label: 'Fit', hint: 'letterbox' },
  { id: 'fill', label: 'Fill', hint: 'crop' },
  { id: '16:9', label: '16:9', hint: 'stretch-free' },
  { id: '4:3', label: '4:3', hint: 'pillarbox' },
];

export const ACCENTS: { id: AccentId; label: string; color: string }[] = [
  { id: 'crimson', label: 'Crimson', color: 'var(--crimson)' },
  { id: 'purple', label: 'Purple', color: 'var(--purple)' },
  { id: 'blue', label: 'Electric blue', color: 'var(--blue)' },
  { id: 'emerald', label: 'Emerald', color: 'var(--green)' },
  { id: 'neutral', label: 'Neutral white', color: '#f3f4f8' },
];

/* Subtitle languages are keyed by ISO 639-1 code.  The provider's own tokens are
   three-letter (eng, ger, fre, rus, ara, spa, por, ita) and its display names
   carry suffixes like "Spanish (- Spanish(Latin America))", so both sides are
   folded through this table before anything is matched. */
export const SUB_LANG_NAMES: Record<string, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  it: 'Italiano',
  pt: 'Português',
  ru: 'Русский',
  ar: 'العربية',
  hi: 'हिन्दी',
  ja: '日本語',
  ko: '한국어',
  zh: '中文',
  /* the rest are what these sources actually carry — an unmapped language arrives with no
     code, so it gets no `lang` attribute and shows its provider name as its own label */
  id: 'Bahasa Indonesia',
  ms: 'Bahasa Melayu',
  th: 'ไทย',
  vi: 'Tiếng Việt',
  fil: 'Filipino',
};

/** Provider tokens, stored labels and legacy display names -> ISO 639-1 code. */
const SUB_ALIASES: Record<string, string> = {
  eng: 'en', english: 'en', en: 'en',
  spa: 'es', span: 'es', es: 'es', español: 'es', espanol: 'es',
  fre: 'fr', fra: 'fr', french: 'fr', fr: 'fr', français: 'fr',
  ger: 'de', deu: 'de', german: 'de', de: 'de', deutsch: 'de',
  ita: 'it', italian: 'it', it: 'it', italiano: 'it',
  por: 'pt', portuguese: 'pt', pt: 'pt', português: 'pt',
  rus: 'ru', russian: 'ru', ru: 'ru', русский: 'ru',
  ara: 'ar', arabic: 'ar', ar: 'ar', العربية: 'ar',
  hin: 'hi', hindi: 'hi', hi: 'hi', हिन्दी: 'hi',
  jpn: 'ja', jap: 'ja', japanese: 'ja', ja: 'ja', 日本語: 'ja',
  kor: 'ko', korean: 'ko', ko: 'ko', 한국어: 'ko',
  chi: 'zh', zho: 'zh', chinese: 'zh', zh: 'zh', 中文: 'zh',
  ind: 'id', id: 'id', indonesia: 'id', indonesian: 'id',
  bahasa: 'id', 'bahasa indonesia': 'id', 'bahasa malaysia': 'ms',
  may: 'ms', ms: 'ms', malay: 'ms', melayu: 'ms', 'bahasa melayu': 'ms',
  tha: 'th', th: 'th', thai: 'th', ไทย: 'th',
  vie: 'vi', vi: 'vi', vietnamese: 'vi', vietsub: 'vi', tiếng: 'vi', việt: 'vi',
  fil: 'fil', tl: 'fil', filipino: 'fil', tagalog: 'fil',
};

/** '' / 'Off' / unknown -> null; anything naming a language -> its code. */
export const subLangCode = (input: string | null | undefined): string | null => {
  const raw = (input ?? '').trim().toLowerCase();
  if (!raw || raw === 'off' || raw === 'none') return null;
  if (SUB_LANG_NAMES[raw]) return raw;
  if (SUB_ALIASES[raw]) return SUB_ALIASES[raw];
  /* Provider display names arrive in two shapes this table cannot match whole: a
     parenthetical variant — "Spanish (- Spanish(Latin America))" — and the doubled form
     the anime sources use — "Thai — Thai", "Vietnamese — Vietnamese". Fold on their
     words, two-word phrase before single word, so "bahasa indonesia" is not read as an
     unknown "bahasa". Vietnamese diacritics are letters too (Latin Extended Additional). */
  const words = raw
    .split('(')[0]
    .split(/[^a-z\u00c0-\u024f\u1e00-\u1eff]+/)
    .filter(Boolean);
  for (let i = 0; i < words.length; i += 1) {
    const phrase = words.slice(i, i + 2).join(' ');
    if (SUB_ALIASES[phrase]) return SUB_ALIASES[phrase];
    if (SUB_ALIASES[words[i]]) return SUB_ALIASES[words[i]];
  }
  return null;
};

export const subLangLabel = (code: string | null | undefined): string =>
  (code && SUB_LANG_NAMES[code]) || code || 'Off';

export const DEFAULT_SUBTITLES: SubtitleSettings = {
  enabled: true,
  language: 'en',
  size: 16,
  color: '#ffffff',
  background: 0.55,
  backdrop: 'box',
  outline: true,
  position: 'bottom',
};

export const DEFAULT_PREFS: PlayerPrefs = {
  speed: 1,
  quality: '1080p',
  aspect: 'default',
  volume: 0.8,
  muted: false,
  autoNext: true,
  autoSkipIntro: false,
  autoSkipOutro: false,
  rememberPosition: true,
  audio: 'sub',
  defaultSpeed: null,
  defaultSubLang: null,
  subtitles: DEFAULT_SUBTITLES,
  accent: 'crimson',
  density: 'comfortable',
  enableP2P: false,
};

const PREFS_KEY = 'anihub:player-prefs';
const POS_KEY = 'anihub:positions';

export interface EpisodePosition {
  t: number;
  d: number;
  finished: boolean;
}
export type PositionMap = Record<string, EpisodePosition>;

export const positionKey = (animeId: string, ep: number) => `${animeId}:e${ep}`;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== typeof fallback || Array.isArray(parsed) !== Array.isArray(fallback)) return fallback;
    return { ...(fallback as object), ...(parsed as object) } as T;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota — preferences simply do not persist */
  }
}

/* ---------------- preferences ---------------- */

export function loadPrefs(): PlayerPrefs {
  const stored = read<PlayerPrefs>(PREFS_KEY, DEFAULT_PREFS);
  const speed = SPEEDS.includes(stored.speed as (typeof SPEEDS)[number]) ? stored.speed : 1;
  const volume = Math.min(1, Math.max(0, Number(stored.volume) || 0));
  const quality = QUALITIES.some((q) => q.id === stored.quality) ? stored.quality : '1080p';
  const aspect = ASPECTS.some((a) => a.id === stored.aspect) ? stored.aspect : 'default';
  const accent = ACCENTS.some((a) => a.id === stored.accent) ? stored.accent : 'crimson';
  const defaultSpeed =
    typeof stored.defaultSpeed === 'number' && SPEEDS.includes(stored.defaultSpeed as (typeof SPEEDS)[number])
      ? stored.defaultSpeed
      : null;
  const defaultSubLang = subLangCode(stored.defaultSubLang);
  const audio: AudioId = stored.audio === 'dub' ? 'dub' : 'sub';
  return {
    ...DEFAULT_PREFS,
    ...stored,
    speed,
    volume,
    quality,
    aspect,
    accent,
    audio,
    defaultSpeed,
    defaultSubLang,
    density: stored.density === 'compact' ? 'compact' : 'comfortable',
    subtitles: sanitizeSubs(stored.subtitles),
  };
}

function sanitizeSubs(input?: SubtitleSettings): SubtitleSettings {
  const s = { ...DEFAULT_SUBTITLES, ...(input ?? {}) };
  /* fold a recognised code / legacy label ("English", "Español", "eng"); otherwise keep a
     verbatim provider track name the grid let the viewer pick, so the choice survives reload */
  const lang = (s.language ?? '').trim();
  s.language = subLangCode(lang) ?? (lang && !/^(off|none)$/i.test(lang) ? lang : 'en');
  s.size = Math.min(30, Math.max(11, Number(s.size) || 16));
  s.background = Math.min(1, Math.max(0, Number(s.background) || 0));
  if (!/^#[0-9a-f]{6}$/i.test(s.color)) s.color = '#ffffff';
  if (s.position !== 'middle' && s.position !== 'top') s.position = 'bottom';
  if (s.backdrop !== 'shadow' && s.backdrop !== 'none') s.backdrop = 'box';
  return s;
}

export function savePrefs(prefs: PlayerPrefs) {
  write(PREFS_KEY, prefs);
}

export function resetSubtitles(): SubtitleSettings {
  return { ...DEFAULT_SUBTITLES };
}

/* ---------------- resume positions ---------------- */

export function loadPositions(): PositionMap {
  const raw = read<PositionMap>(POS_KEY, {});
  const out: PositionMap = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v && typeof v.t === 'number' && typeof v.d === 'number' && v.d > 0) {
      out[k] = { t: Math.max(0, v.t), d: v.d, finished: Boolean(v.finished) };
    }
  }
  return out;
}

export function savePosition(key: string, t: number, d: number): PositionMap {
  const all = loadPositions();
  all[key] = { t: Math.max(0, Math.min(t, d)), d, finished: t >= d - 2 };
  write(POS_KEY, all);
  return all;
}
