import { fail } from './_lib.js';

/* Unmatched /api/* must answer in JSON. Without this the SPA fallback in
   _redirects serves index.html with a 200, and a client parsing JSON fails
   with a parse error instead of a status it can act on. */
export const onRequest = async ({ request }) => {
  const { pathname } = new URL(request.url);
  return fail(404, 'not_found', `no API route for ${pathname}`);
};
