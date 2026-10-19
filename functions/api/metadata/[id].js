import { onRequestGet as getAnime } from '../anime/[id].js';

export async function onRequestGet(context) {
  return getAnime(context);
}
