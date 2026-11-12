import { spawn, execFile } from 'node:child_process';
import { PassThrough } from 'node:stream';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const CURL_BIN = process.platform === 'win32' ? 'curl.exe' : 'curl';

function baseArgs(headers) {
  // Deduplicate and normalize headers (case-insensitive)
  const norm = new Map();
  for (const [k, v] of Object.entries(headers)) {
    norm.set(k.toLowerCase(), { key: k, value: v });
  }

  const a = ['-sS', '-A', UA];
  for (const { key, value } of norm.values()) {
    // If Accept was set lowercase, standardize to Accept
    const headerName = key.toLowerCase() === 'accept' ? 'Accept' : (key.toLowerCase() === 'referer' ? 'Referer' : (key.toLowerCase() === 'origin' ? 'Origin' : key));
    a.push('-H', `${headerName}: ${value}`);
  }
  return a;
}

// Buffered — JSON and small documents only.
export function curlText(url, headers = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const args = ['-sL', '--max-redirs', '5', '--max-time', String(Math.round(timeoutMs / 1000)), ...baseArgs(headers), url];
    execFile(CURL_BIN, args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const e = new Error(`curl: ${stderr.trim().slice(0, 200) || err.message}`);
        return reject(e);
      }
      resolve(stdout);
    });
  });
}

// Streaming — resolves once response headers land, then pipes the body.
export function curlOpen(url, headers = {}, { method = 'GET', timeoutMs = 25000 } = {}) {
  return new Promise((resolve, reject) => {
    const args = [
      ...baseArgs(headers),
      '-L', '--max-redirs', '5', '-D', '-', '--max-time', String(Math.round(timeoutMs / 1000)),
    ];
    if (method === 'HEAD') args.unshift('-I');
    args.push(url);

    const p = spawn(CURL_BIN, args);

    const stream = new PassThrough();
    let buf = Buffer.alloc(0);
    let settled = false;
    let err = '';

    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('error', reject);

    p.stdout.on('data', (chunk) => {
      if (settled) return stream.write(chunk);
      buf = Buffer.concat([buf, chunk]);

      for (;;) {
        const idx = buf.indexOf('\r\n\r\n');
        if (idx === -1) return;
        const head = buf.subarray(0, idx).toString('latin1');
        const rest = buf.subarray(idx + 4);
        const status = Number(head.match(/^HTTP\/[\d.]+ (\d{3})/)?.[1] || 0);

        if (status >= 300 && status < 400) {
          buf = rest;
          continue;
        } // follow block

        settled = true;
        buf = Buffer.alloc(0);
        const ct = head.match(/^content-type:\s*(.+)$/im)?.[1]?.trim() || '';
        const cl = head.match(/^content-length:\s*(.+)$/im)?.[1]?.trim() || '';
        const cr = head.match(/^content-range:\s*(.+)$/im)?.[1]?.trim() || '';
        const ar = head.match(/^accept-ranges:\s*(.+)$/im)?.[1]?.trim() || '';
        if (rest.length) stream.write(rest);
        resolve({
          status,
          contentType: ct,
          contentLength: cl,
          contentRange: cr,
          acceptRanges: ar,
          stream,
          child: p,
        });
        return;
      }
    });

    p.on('close', (code) => {
      if (!settled) {
        const e = new Error(`curl ${code} before headers: ${err.trim().slice(0, 200)}`);
        return reject(e);
      }
      stream.end();
    });
  });
}
