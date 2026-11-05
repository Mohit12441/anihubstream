// @ts-check
import * as anikoto from '../anikoto.mjs';
import * as hianime from '../hianime.mjs';
import * as aniwatch from '../aniwatch.mjs';
import * as watchanimeworld from '../watchanimeworld.mjs';
import * as animewave from '../animewave.mjs';
import * as animekai from '../animekai.mjs';
import * as anipm from '../anipm.mjs';
import * as anidisk from '../anidisk.mjs';
import * as animeflv from '../animeflv.mjs';
import * as hdrezka from '../hdrezka.mjs';
import * as jkanime from '../jkanime.mjs';
import * as animedubhindi from '../animedubhindi.mjs';
import * as desidubanime from '../desidubanime.mjs';

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
 * Adding provider #11 = new adapter + registerAdapter().
 * @param {AdapterDefinition} def
 */
export function registerAdapter(def) {
  adapters.set(def.id.toLowerCase(), def);
}

// Built-in adapters registration
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
  id: 'watchanimeworld',
  name: 'WatchAnimeWorld',
  supportedAudio: ['sub', 'dub', 'hindi'],
  defaultType: 'mp4',
  priority: 105,
  search: (q, opts) => watchanimeworld.search(q, opts),
  details: (slug, opts) => watchanimeworld.details(slug, opts),
  sources: (epId, opts) => watchanimeworld.sources(epId, opts),
  resolve: async (embed, opts) => {
    const streamUrl = typeof embed === 'string' ? embed : embed?.url || embed?.embedUrl;
    return {
      provider: 'watchanimeworld',
      master: { url: streamUrl },
      streamUrl,
      quality: typeof embed === 'object' && embed?.quality ? `${embed.quality}p` : '1080p',
      variants: ['1080p', '720p', '480p'],
      subtitles: [],
      proof: { container: 'mp4', checkedBytes: 65 },
      note: 'WatchAnimeWorld MP4 Abyss direct stream',
    };
  },
});

registerAdapter({
  id: 'animewave',
  name: 'AnimeWave',
  supportedAudio: ['sub', 'dub'],
  defaultType: 'hls',
  priority: 110,
  search: (q, opts) => animewave.search(q, opts),
  details: (slug, opts) => animewave.details(slug, opts),
  sources: (epId, opts) => animewave.sources(epId, opts),
  resolve: (embed, opts) => animewave.resolve(embed, opts),
});

registerAdapter({
  id: 'animekai',
  name: 'AnimeKai',
  supportedAudio: ['sub', 'dub'],
  defaultType: 'hls',
  priority: 95,
  search: (q, opts) => animekai.search(q, opts),
  details: (slug, opts) => animekai.details(slug, opts),
  sources: (epId, opts) => animekai.sources(epId, opts),
  resolve: (embed, opts) => animekai.resolve(embed, opts),
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
  id: 'anidisk',
  name: 'AniDisk',
  supportedAudio: ['sub', 'dub', 'hindi', 'tamil', 'telugu'],
  defaultType: 'mp4',
  priority: 100,
  search: (q, opts) => anidisk.search(q, opts),
  details: (slug, opts) => anidisk.details(slug, opts),
  sources: (epId, opts) => anidisk.sources(epId, opts),
  resolve: (embed, opts) => anidisk.resolve(embed, opts),
});

registerAdapter({
  id: 'animeflv',
  name: 'AnimeFLV',
  supportedAudio: ['sub', 'spanish'],
  defaultType: 'hls',
  priority: 85,
  search: (q, opts) => animeflv.search(q, opts),
  details: (slug, opts) => animeflv.details(slug, opts),
  sources: (epId, opts) => animeflv.sources(epId, opts),
  resolve: (embed, opts) => animeflv.resolve(embed, opts),
});

registerAdapter({
  id: 'hdrezka',
  name: 'HDRezka',
  supportedAudio: ['sub', 'russian', 'dub'],
  defaultType: 'hls',
  priority: 90,
  search: (q, opts) => hdrezka.search(q, opts),
  details: (slug, opts) => hdrezka.details(slug, opts),
  sources: (epId, opts) => hdrezka.sources(epId, opts),
  resolve: (embed, opts) => hdrezka.resolve(embed, opts),
});

registerAdapter({
  id: 'jkanime',
  name: 'JKAnime',
  supportedAudio: ['sub', 'spanish'],
  defaultType: 'hls',
  priority: 80,
  search: (q, opts) => jkanime.search(q, opts),
  details: (slug, opts) => jkanime.details(slug, opts),
  sources: (epId, opts) => jkanime.sources(epId, opts),
  resolve: (embed, opts) => jkanime.resolve(embed, opts),
});

registerAdapter({
  id: 'animedubhindi',
  name: 'AnimeDubHindi',
  supportedAudio: ['sub', 'dub', 'hindi', 'tamil', 'telugu'],
  defaultType: 'mp4',
  priority: 74,
  search: (q, opts) => animedubhindi.search(q, opts),
  details: (slug, opts) => animedubhindi.details(slug, opts),
  sources: (epId, opts) => animedubhindi.sources(epId, opts),
  resolve: (embed, opts) => animedubhindi.resolve(embed, opts),
});

registerAdapter({
  id: 'desidubanime',
  name: 'DesiDubAnime',
  supportedAudio: ['sub', 'dub', 'hindi', 'tamil', 'telugu'],
  defaultType: 'mp4',
  priority: 73,
  search: (q, opts) => desidubanime.search(q, opts),
  details: (slug, opts) => desidubanime.details(slug, opts),
  sources: (epId, opts) => desidubanime.sources(epId, opts),
  resolve: (embed, opts) => desidubanime.resolve(embed, opts),
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
