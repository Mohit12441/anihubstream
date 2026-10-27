/**
 * Client-Side In-Browser HLS Stream Downloader & Assembler
 *
 * Downloads HLS stream segments in parallel through the local edge proxy
 * and stitches them into a single playable MPEG-TS / MP4 video file.
 */

export interface DownloadProgress {
  loadedSegments: number;
  totalSegments: number;
  percent: number;
  bytesDownloaded: number;
  formattedBytes: string;
}

export interface StreamRendition {
  quality: string;
  bandwidth: number;
  url: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Parses variant renditions from an HLS master playlist
 */
export function parseMasterVariants(text: string, baseUrl: string): StreamRendition[] {
  const lines = text.split(/\r?\n/);
  const renditions: StreamRendition[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;

    const resMatch = line.match(/RESOLUTION=\d+x(\d+)/i);
    const bwMatch = line.match(/BANDWIDTH=(\d+)/i);
    const height = resMatch ? `${resMatch[1]}p` : 'unknown';
    const bandwidth = bwMatch ? Number(bwMatch[1]) : 0;

    let nextUrl = '';
    for (let j = i + 1; j < lines.length; j++) {
      const candidate = lines[j].trim();
      if (!candidate || candidate.startsWith('#')) continue;
      nextUrl = candidate;
      break;
    }

    if (nextUrl) {
      const fullUrl = nextUrl.startsWith('http') ? nextUrl : new URL(nextUrl, baseUrl).href;
      renditions.push({ quality: height, bandwidth, url: fullUrl });
    }
  }

  // Sort highest resolution and bandwidth first
  return renditions.sort((a, b) => {
    const numA = parseInt(a.quality, 10) || 0;
    const numB = parseInt(b.quality, 10) || 0;
    return numB - numA || b.bandwidth - a.bandwidth;
  });
}

/**
 * Parses segment URLs from a media playlist
 */
export function parseMediaSegments(text: string, baseUrl: string): string[] {
  const lines = text.split(/\r?\n/);
  const segments: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const absUrl = line.startsWith('http') ? line : new URL(line, baseUrl).href;
    segments.push(absUrl);
  }

  return segments;
}

/**
 * Resolves a URL to an edge-proxied URL without double-wrapping
 */
export function resolveProxyUrl(targetUrl: string, referer = 'https://megaplay.buzz/'): string {
  if (!targetUrl) return '';
  // Avoid re-wrapping URLs that are already routed through /api/proxy
  if (targetUrl.startsWith('/api/proxy') || targetUrl.includes('/api/proxy?url=')) {
    return targetUrl;
  }
  return `/api/proxy?url=${encodeURIComponent(targetUrl)}&referer=${encodeURIComponent(referer)}`;
}

/**
 * Sniffs first segment buffer to identify container format
 */
export function sniffContainerFormat(buffer: ArrayBuffer): 'mp2t' | 'mp4' | 'unknown' {
  if (!buffer || buffer.byteLength < 4) return 'unknown';
  const u8 = new Uint8Array(buffer);
  // MPEG Transport Stream sync byte 0x47
  if (u8[0] === 0x47) return 'mp2t';
  // ISO Base Media File Format (MP4 / fMP4 'ftyp' or 'moof' box)
  if (
    (u8[4] === 0x66 && u8[5] === 0x74 && u8[6] === 0x79 && u8[7] === 0x70) || // 'ftyp'
    (u8[4] === 0x6d && u8[5] === 0x6f && u8[6] === 0x6f && u8[7] === 0x66)    // 'moof'
  ) {
    return 'mp4';
  }
  return 'unknown';
}

/**
 * Downloads and assembles an HLS stream into a downloadable video file.
 */
export async function downloadHlsStream({
  streamUrl,
  referer = 'https://megaplay.buzz/',
  filename = 'video.mp4',
  quality,
  concurrency = 10,
  signal,
  onProgress,
}: {
  streamUrl: string;
  referer?: string;
  filename: string;
  quality?: string;
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (p: DownloadProgress) => void;
}): Promise<Blob> {
  const proxiedMasterUrl = resolveProxyUrl(streamUrl, referer);

  // 1. Fetch master playlist
  const masterRes = await fetch(proxiedMasterUrl, { signal });
  if (!masterRes.ok) {
    throw new Error(`Failed to load stream master playlist (${masterRes.status})`);
  }
  const masterText = await masterRes.text();

  // 2. Select variant or use directly if it is already a media playlist
  let targetPlaylistUrl = streamUrl;
  let targetPlaylistText = masterText;

  if (masterText.includes('#EXT-X-STREAM-INF')) {
    const variants = parseMasterVariants(masterText, streamUrl);
    let chosen = variants[0];
    if (quality) {
      const match = variants.find((v) => v.quality.toLowerCase() === quality.toLowerCase() || v.quality.includes(quality));
      if (match) chosen = match;
    }

    if (chosen) {
      targetPlaylistUrl = chosen.url;
      const proxiedRendition = resolveProxyUrl(chosen.url, referer);
      const renditionRes = await fetch(proxiedRendition, { signal });
      if (!renditionRes.ok) {
        throw new Error(`Failed to load quality rendition playlist (${renditionRes.status})`);
      }
      targetPlaylistText = await renditionRes.text();
    }
  }

  // 3. Parse segments
  const segmentUrls = parseMediaSegments(targetPlaylistText, targetPlaylistUrl);
  if (segmentUrls.length === 0) {
    throw new Error('No video segments found in the playlist.');
  }

  const total = segmentUrls.length;
  const chunks: ArrayBuffer[] = new Array(total);
  let loaded = 0;
  let totalBytes = 0;

  // 4. Concurrent chunk download worker pool
  const workerPoolSize = Math.max(1, Math.min(concurrency, total, 16));
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < total) {
      if (signal?.aborted) throw new Error('Download cancelled by user.');
      const idx = nextIdx++;
      const segUrl = segmentUrls[idx];
      const proxiedSegUrl = resolveProxyUrl(segUrl, referer);

      let retries = 2;
      let buf: ArrayBuffer | null = null;

      while (retries >= 0) {
        try {
          const res = await fetch(proxiedSegUrl, { signal });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          buf = await res.arrayBuffer();
          break;
        } catch (err) {
          if (signal?.aborted) throw err;
          retries--;
          if (retries < 0) throw new Error(`Failed segment ${idx + 1}/${total}: ${(err as Error).message}`);
          await new Promise((r) => setTimeout(r, 400));
        }
      }

      if (buf) {
        chunks[idx] = buf;
        loaded++;
        totalBytes += buf.byteLength;
        if (onProgress) {
          onProgress({
            loadedSegments: loaded,
            totalSegments: total,
            percent: Math.round((loaded / total) * 100),
            bytesDownloaded: totalBytes,
            formattedBytes: formatBytes(totalBytes),
          });
        }
      }
    }
  }

  const workers = Array.from({ length: workerPoolSize }, () => worker());
  await Promise.all(workers);

  if (signal?.aborted) {
    throw new Error('Download cancelled by user.');
  }

  // 5. Container Sniffing & Blob Assembly
  const format = chunks.length > 0 ? sniffContainerFormat(chunks[0]) : 'unknown';
  const mimeType = format === 'mp2t' ? 'video/mp2t' : 'video/mp4';
  const blob = new Blob(chunks, { type: mimeType });

  // If container is MPEG-TS and filename ended with .mp4, rename to .ts
  // so system video players (VLC, Windows Media Player, QuickTime, mobile)
  // accurately demux without "file format not supported" container errors
  const finalFilename = format === 'mp2t' && filename.endsWith('.mp4')
    ? filename.replace(/\.mp4$/, '.ts')
    : filename;

  // 6. Trigger native browser save
  triggerBrowserSave(blob, finalFilename);

  return blob;
}

/**
 * Triggers native browser file download from Blob
 */
export function triggerBrowserSave(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
