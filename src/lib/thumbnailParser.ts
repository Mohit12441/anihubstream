/**
 * WebVTT Video Thumbnail & Sprite Sheet Parser
 * Parses VTT thumbnail tracks (standalone images or sprite sheets with #xywh coordinates)
 * and resolves instantaneous preview frames for player scrubbing.
 */

export interface ThumbnailCue {
  start: number;
  end: number;
  url: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  isSprite: boolean;
}

/**
 * Parses WebVTT timestamp strings into seconds.
 * Supports both "HH:MM:SS.mmm" and "MM:SS.mmm".
 */
export function parseVttTime(timeStr: string): number {
  if (!timeStr) return 0;
  const clean = timeStr.trim().replace(',', '.');
  const parts = clean.split(':');

  if (parts.length === 3) {
    const hours = Number.parseFloat(parts[0]) || 0;
    const mins = Number.parseFloat(parts[1]) || 0;
    const secs = Number.parseFloat(parts[2]) || 0;
    return hours * 3600 + mins * 60 + secs;
  }
  if (parts.length === 2) {
    const mins = Number.parseFloat(parts[0]) || 0;
    const secs = Number.parseFloat(parts[1]) || 0;
    return mins * 60 + secs;
  }
  return Number.parseFloat(clean) || 0;
}

/**
 * Resolves a relative URL against a base URL
 */
export function resolveRelativeUrl(relativeUrl: string, baseUrl?: string): string {
  if (!relativeUrl) return '';
  if (!baseUrl || relativeUrl.startsWith('http://') || relativeUrl.startsWith('https://') || relativeUrl.startsWith('//') || relativeUrl.startsWith('/')) {
    return relativeUrl;
  }
  try {
    const base = new URL(baseUrl);
    return new URL(relativeUrl, base).href;
  } catch {
    return relativeUrl;
  }
}

/**
 * Parses complete WebVTT text into an array of ThumbnailCue objects
 */
export function parseThumbnailVtt(vttContent: string, baseUrl?: string): ThumbnailCue[] {
  if (!vttContent || typeof vttContent !== 'string') return [];

  const lines = vttContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const cues: ThumbnailCue[] = [];

  let currentStart = -1;
  let currentEnd = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (!line || line.startsWith('WEBVTT') || line.startsWith('NOTE')) {
      continue;
    }

    // Match timestamp arrow: "00:00:00.000 --> 00:00:05.000"
    if (line.includes('-->')) {
      const [startRaw, endRaw] = line.split('-->').map((p) => p.trim().split(/\s+/)[0]);
      currentStart = parseVttTime(startRaw);
      currentEnd = parseVttTime(endRaw);
      continue;
    }

    // If we have an active timestamp interval, the following line contains the image URL and coordinates
    if (currentStart >= 0 && currentEnd >= 0) {
      const rawUrl = line;
      if (!rawUrl) continue;

      let imageUrl = rawUrl;
      let x: number | undefined;
      let y: number | undefined;
      let width: number | undefined;
      let height: number | undefined;
      let isSprite = false;

      // Check for spatial fragment: #xywh=0,0,160,90
      const hashIndex = rawUrl.indexOf('#xywh=');
      if (hashIndex !== -1) {
        imageUrl = rawUrl.slice(0, hashIndex);
        const coordsStr = rawUrl.slice(hashIndex + 6);
        const [cx, cy, cw, ch] = coordsStr.split(',').map((v) => Number.parseInt(v, 10));

        if (!isNaN(cx) && !isNaN(cy) && !isNaN(cw) && !isNaN(ch)) {
          x = cx;
          y = cy;
          width = cw;
          height = ch;
          isSprite = true;
        }
      }

      cues.push({
        start: currentStart,
        end: currentEnd,
        url: resolveRelativeUrl(imageUrl, baseUrl),
        x,
        y,
        width,
        height,
        isSprite,
      });

      currentStart = -1;
      currentEnd = -1;
    }
  }

  // Ensure cues are sorted chronologically by start time
  return cues.sort((a, b) => a.start - b.start);
}

/**
 * Performs O(log n) binary search to locate the thumbnail cue for a given playhead time
 */
export function findThumbnailCue(cues: ThumbnailCue[], time: number): ThumbnailCue | null {
  if (!cues || cues.length === 0) return null;
  const clampedTime = Math.max(0, time);

  if (clampedTime <= cues[0].start) return cues[0];
  if (clampedTime >= cues[cues.length - 1].end) return cues[cues.length - 1];

  let low = 0;
  let high = cues.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const cue = cues[mid];

    if (clampedTime >= cue.start && clampedTime < cue.end) {
      return cue;
    }
    if (clampedTime < cue.start) {
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return cues[Math.min(low, cues.length - 1)] ?? null;
}
