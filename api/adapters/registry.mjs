// @ts-check
import * as anikoto from '../anikoto.mjs';
import * as hianime from '../hianime.mjs';
import * as aniwatch from '../aniwatch.mjs';
import * as animedubhindi from '../animedubhindi.mjs';
import * as watchanimeworld from '../watchanimeworld.mjs';
import * as animewave from '../animewave.mjs';
import * as animekai from '../animekai.mjs';

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
  priority: 95,
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
  priority: 90,
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
  priority: 100,
  search: (q, opts) => aniwatch.search(q, opts),
  details: (slug, opts) => aniwatch.details(slug, opts),
  sources: (epId, opts) => aniwatch.sources(epId, opts),
  resolve: (embed, opts) => aniwatch.resolve(embed, opts),
});

registerAdapter({
  id: 'animedubhindi',
  name: 'AnimeDubHindi',
  supportedAudio: ['hindi'],
  defaultType: 'mp4',
  priority: 85,
  search: (q, opts) => animedubhindi.search(q, opts),
  details: (slug, opts) => animedubhindi.details(slug, opts),
  sources: (epId, opts) => animedubhindi.sources(epId, opts),
});

registerAdapter({
  id: 'watchanimeworld',
  name: 'WatchAnimeWorld',
  supportedAudio: ['sub', 'dub', 'hindi'],
  defaultType: 'mp4',
  priority: 80,
  search: (q, opts) => watchanimeworld.search(q, opts),
  details: (slug, opts) => watchanimeworld.details(slug, opts),
  sources: (epId, opts) => watchanimeworld.sources(epId, opts),
});

registerAdapter({
  id: 'animewave',
  name: 'AnimeWave',
  supportedAudio: ['sub', 'dub'],
  defaultType: 'hls',
  priority: 75,
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
  priority: 70,
  search: (q, opts) => animekai.search(q, opts),
  details: (slug, opts) => animekai.details(slug, opts),
  sources: (epId, opts) => animekai.sources(epId, opts),
  resolve: (embed, opts) => animekai.resolve(embed, opts),
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
