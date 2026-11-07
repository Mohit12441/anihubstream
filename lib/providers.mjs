export const PROVIDERS = {
  settlar: {
    hosts: ['media.settlar.io', 'embed.settlar.io'],
    referer: 'https://embed.settlar.io/',
    origin: 'https://embed.settlar.io',
  },
  anipm: {
    hosts: ['ani.pm'],
    referer: 'https://ani.pm/',
    origin: 'https://ani.pm',
  },
  beta: {
    hosts: ['beta.cno.to', 'cno.to', 'flashpod.top', 'beamcube.top'],
    referer: 'https://beta.cno.to/',
    origin: 'https://beta.cno.to',
  },
};

export function upstreamHeaders(key, extra = {}) {
  const p = PROVIDERS[key];
  if (!p) throw new Error(`unknown provider ${key}`);
  return {
    Referer: p.referer,
    Origin: p.origin,
    Accept: 'application/json',
    ...extra,
  };
}

export function assertAllowed(url, key) {
  const p = PROVIDERS[key];
  if (!p) throw new Error('unknown provider');
  const host = new URL(url).host;
  const isAllowed = p.hosts.includes(host) || (key === 'beta' && (host.endsWith('.top') || host.endsWith('.cno.to')));
  if (!isAllowed) throw new Error(`host ${host} not allowed for ${key}`);
}
