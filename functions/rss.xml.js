// @ts-check
import { onRequestGet as feedHandler } from './feed.xml.js';

export async function onRequestGet(context) {
  return feedHandler(context);
}
