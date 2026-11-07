const ATTR_RE = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;

function attrs(line) {
  const out = {};
  for (const m of line.matchAll(ATTR_RE)) {
    out[m[1]] = m[2].startsWith('"') ? m[2].slice(1, -1) : m[2];
  }
  return out;
}

const abs = (u, base) => {
  try {
    return new URL(u, base).href;
  } catch {
    return u;
  }
};

function norm(a, base, kind) {
  return {
    kind,
    lang: (a.LANGUAGE || 'und').toLowerCase(),
    label: a.NAME || a.LANGUAGE || 'Unknown',
    group: a['GROUP-ID'] || null,
    default: a.DEFAULT === 'YES',
    forced: a.FORCED === 'YES',
    autoselect: a.AUTOSELECT === 'YES',
    channels: a.CHANNELS || null,
    characteristics: a.CHARACTERISTICS || null,
    uri: a.URI ? abs(a.URI, base) : null,
  };
}

const dedupe = (arr, keyFn = (t) => `${t.lang}|${t.label}|${t.uri}`) => {
  const seen = new Set();
  return arr.filter((t) => {
    const k = keyFn(t);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

export function parseMaster(text, base) {
  const audio = [], subtitles = [], qualities = [];
  let pending = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('#EXT-X-MEDIA:')) {
      const a = attrs(line);
      if (a.TYPE === 'AUDIO') audio.push(norm(a, base, 'audio'));
      else if (a.TYPE === 'SUBTITLES') subtitles.push(norm(a, base, 'subtitle'));
      continue;
    }

    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      pending = attrs(line);
      continue;
    }

    if (!line.startsWith('#') && pending) {
      qualities.push({
        url: abs(line, base),
        bandwidth: Number(pending.BANDWIDTH) || 0,
        codecs: pending.CODECS || null,
        height: Number((pending.RESOLUTION || '').split('x')[1]) || 0,
        width: Number((pending.RESOLUTION || '').split('x')[0]) || 0,
        frameRate: Number(pending['FRAME-RATE']) || 0,
        audioGroup: pending.AUDIO || null,
        subtitleGroup: pending.SUBTITLES || null,
      });
      pending = null;
    }
  }

  return {
    audio: dedupe(audio),
    subtitles: dedupe(subtitles),
    qualities: dedupe(qualities, (q) => `${q.height}|${q.bandwidth}|${q.url}`).sort((a, b) => b.height - a.height),
  };
}

export function isMaster(text) {
  return text.includes('#EXT-X-MEDIA:') || text.includes('#EXT-X-STREAM-INF:');
}
