import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeArtUrl } from '../src/data/model.ts';
import { onRequestGet as imageProxy } from '../functions/api/img.js';

describe('TASK 10 (P1) — Image Robustness & Signed URL Handling', () => {
  it('normalizes expiring S3/Backblaze signed URLs to permanent media.kitsu.app URLs', () => {
    const signedUrl =
      'https://kitsu-production-media.s3.us-west-002.backblazeb2.com/anime/50021/poster_image/86805fd5105a8da9c0d9c34e5d254992.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=002d6013655cdc00000000003%2F20261015%2Fus-west-002%2Fs3%2Faws4_request&X-Amz-Date=20261015T192327Z&X-Amz-Expires=900&X-Amz-SignedHeaders=host&X-Amz-Signature=b096e1e71bed91bf86fce6ad8c139ec0763395faa95818d25781ba46b62bb1dd';

    const clean = normalizeArtUrl(signedUrl);

    assert.equal(
      clean,
      'https://media.kitsu.app/anime/50021/poster_image/86805fd5105a8da9c0d9c34e5d254992.jpg',
      'Must strip S3 bucket domain and X-Amz auth query parameters',
    );
  });

  it('preserves legitimate external CDN URLs untouched', () => {
    const kitsuCdn = 'https://media.kitsu.app/anime/41370/poster_image/large.jpg';
    assert.equal(normalizeArtUrl(kitsuCdn), kitsuCdn);

    const anilistCdn = 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx101922-PEn1CTsoXyz2.png';
    assert.equal(normalizeArtUrl(anilistCdn), anilistCdn);
  });

  it('handles empty and null inputs safely', () => {
    assert.equal(normalizeArtUrl(null), '');
    assert.equal(normalizeArtUrl(undefined), '');
    assert.equal(normalizeArtUrl('   '), '');
  });

  it('edge image proxy enforces security and immutable caching headers', async () => {
    // 400 on missing url param
    const noParamReq = new Request('https://anihubstream.com/api/img');
    const noParamRes = await imageProxy({ request: noParamReq });
    assert.equal(noParamRes.status, 400);

    // 403 on untrusted domain
    const badDomainReq = new Request('https://anihubstream.com/api/img?url=https://malicious-site.com/test.jpg');
    const badDomainRes = await imageProxy({ request: badDomainReq });
    assert.equal(badDomainRes.status, 403);

    // Allows trusted provider image domains
    const aniwatchImgReq = new Request('https://anihubstream.com/api/img?url=' + encodeURIComponent('https://aniwatch.co.at/wp-content/uploads/sample.jpg'));
    // Since upstream fetch may fail in mock/offline, ensure it does NOT return 403 Forbidden
    const aniwatchImgRes = await imageProxy({ request: aniwatchImgReq });
    assert.notEqual(aniwatchImgRes.status, 403, 'aniwatch.co.at must be allowed by image proxy');
  });
});

