const NAMES = {
  ja: 'Japanese', en: 'English', hi: 'Hindi', ta: 'Tamil', te: 'Telugu',
  fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese (BR)',
  'pt-br': 'Portuguese (BR)', es: 'Spanish', 'es-419': 'Spanish (LATAM)',
  'es-es': 'Spanish (Spain)', ru: 'Russian', ar: 'Arabic', id: 'Indonesian',
  ms: 'Malay', fil: 'Filipino', tl: 'Filipino', th: 'Thai', vi: 'Vietnamese',
  pl: 'Polish', zh: 'Chinese', 'zh-hans': 'Chinese (Simplified)',
  'zh-hant': 'Chinese (Traditional)', ko: 'Korean', und: 'Unknown',
};

export function langName(code) {
  if (!code) return 'Unknown';
  return NAMES[String(code).toLowerCase()] || String(code).toUpperCase();
}

// Order the audio menu: original first, then major dubs, then the rest.
const PRIORITY = ['ja', 'en', 'hi', 'ta', 'te', 'es-419', 'es-es', 'pt-br', 'fr', 'de', 'it'];

export function audioRank(code) {
  const i = PRIORITY.indexOf(String(code || '').toLowerCase());
  return i === -1 ? 100 : i;
}
