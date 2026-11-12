// @ts-check
import * as anikoto from '../anikoto.mjs';
import * as hianime from '../hianime.mjs';
import * as aniwatch from '../aniwatch.mjs';
import * as anipm from '../anipm.mjs';

/**
 * @typedef {Object} AdapterDefinition
 * @property {string} id
 * @property {string} name
 * @property {string[]} supportedAudio
 * @property {('hls' | 'mp4')} defaultType
 * @property {number} priority
 * @property {(q: string, opts?: any) => Promise<any[]>} search
 * @property {(slugOrId: string, opts?: any) => Promise<any>} details
 * @property {(epIdOrRef: string, opts?: any) => Promise<any>} sources
 * @property {((embed: any, opts?: any) => Promise<any>)=} resolve
 */

/** @type {Map<string, AdapterDefinition>} */
const adapters = new Map();

/**
 * Registers an anime streaming provider adapter.
 * @param {AdapterDefinition} def
 */
export function registerAdapter(def) {
  adapters.set(def.id.toLowerCase(), def);
}

// Built-in adapters registration (active providers only)
registerAdapter({
  id: 'anikoto',
  name: 'AniKoto',
  supportedAudio: ['sub', 'dub'],
  defaultType: 'hls',
  priority: 65,
  search: (q, opts) => anikoto.search(q, opts),
  details: (slug, opts) => anikoto.details(slug, opts),
  sources: (epId, opts) => anikoto.sources(epId, opts),
  resolve: (embed, opts) => anikoto.resolve(embed, opts),
});

registerAdapter({
  id: 'hianime',
  name: 'HiAnime',
  supportedAudio: ['sub', 'dub'],
  defaultType: 'hls',
  priority: 70,
  search: (q, opts) => hianime.search(q, opts),
  details: (slug, opts) => hianime.details(slug, opts),
  sources: (epId, opts) => hianime.sources(epId, opts),
  resolve: (embed, opts) => hianime.resolve(embed, opts),
});

registerAdapter({
  id: 'aniwatch',
  name: 'AniWatch',
  supportedAudio: ['sub', 'dub'],
  defaultType: 'hls',
  priority: 75,
  search: (q, opts) => aniwatch.search(q, opts),
  details: (slug, opts) => aniwatch.details(slug, opts),
  sources: (epId, opts) => aniwatch.sources(epId, opts),
  resolve: (embed, opts) => aniwatch.resolve(embed, opts),
});

registerAdapter({
  id: 'anipm',
  name: 'AniPM',
  supportedAudio: ['sub', 'dub'],
  defaultType: 'hls',
  priority: 115,
  search: (q, opts) => anipm.search(q, opts),
  details: (slug, opts) => anipm.details(slug, opts),
  sources: (epId, opts) => anipm.sources(epId, opts),
  resolve: (embed, opts) => anipm.resolve(embed, opts),
});

registerAdapter({
  id: 'torrent',
  name: 'P2P Swarm',
  supportedAudio: ['sub', 'dub'],
  defaultType: 'hls',
  priority: 60,
  search: async (q) => [{ id: `torrent:${q}`, title: q, type: 'torrent' }],
  details: async (slug) => ({ id: slug, title: slug, episodes: [{ id: `${slug}:1`, number: 1 }] }),
  sources: async (epId) => [{ embedUrl: `magnet:?xt=urn:btih:anihub-${epId}`, server: 'WebTorrent P2P' }],
  resolve: async (embed) => {
    const streamUrl = typeof embed === 'string' ? embed : embed?.embedUrl || 'magnet:?xt=urn:btih:anihub';
    return {
      provider: 'torrent',
      master: { url: streamUrl },
      streamUrl,
      quality: '1080p',
      variants: ['1080p'],
      subtitles: [],
      note: 'WebTorrent browser-assisted peer-to-peer fallback stream',
    };
  },
});

/**
 * Retrieves an adapter by provider ID.
 * @param {string} id
 * @returns {AdapterDefinition | undefined}
 */
export function getAdapter(id) {
  if (!id) return undefined;
  return adapters.get(id.toLowerCase());
}

/**
 * Lists all registered adapters.
 * @returns {AdapterDefinition[]}
 */
export function listAdapters() {
  return Array.from(adapters.values()).sort((a, b) => b.priority - a.priority);
}

/**
 * Returns list of registered adapter IDs.
 * @returns {string[]}
 */
export function listAdapterIds() {
  return listAdapters().map((a) => a.id);
}
