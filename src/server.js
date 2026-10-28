const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const { observeVideoPlayback, summarizeStalls } = require('./stall-measurement');
const { observeAudioSignal, summarizeAudioSignal } = require('./audio-measurement');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const STATIC_ASSETS = new Map([
  ['/styles.css', { file: 'styles.css', contentType: 'text/css; charset=utf-8' }],
  ['/app.js', { file: 'app.js', contentType: 'text/javascript; charset=utf-8' }],
]);
const TEST_DURATION_MS = 30_000;
const MAX_ACTIVE_TESTS = 2;
const RESULT_TTL_MS = 10 * 60_000;
const jobs = new Map();

function parseHlsManifest(manifest) {
  const qualities = [];
  const codecs = new Set();
  for (const line of manifest.split(/\r?\n/)) {
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;
    const resolution = line.match(/(?:^|,)RESOLUTION=(\d+x\d+)(?:,|$)/)?.[1];
    const frameRate = line.match(/(?:^|,)FRAME-RATE=([\d.]+)(?:,|$)/)?.[1];
    const name = line.match(/(?:^|,)NAME="([^"]+)"(?:,|$)/)?.[1];
    const codecList = line.match(/(?:^|,)CODECS="([^"]+)"(?:,|$)/)?.[1];
    if (name) qualities.push(name);
    else if (resolution) qualities.push(frameRate ? `${resolution} ${Math.round(Number(frameRate))} FPS` : resolution);
    if (codecList) codecList.split(',').forEach((codec) => codecs.add(codec.trim()));
  }
  return { qualities, codecs: [...codecs] };
}

function parseHlsQualities(manifest) {
  return parseHlsManifest(manifest).qualities;
}

function describeCodec(identifier, kind) {
  if (!identifier) return null;
  const value = identifier.toLowerCase();
  if (kind === 'video') {
    const formats = [
      [/^(avc1|avc3)/, 'H.264 / AVC'],
      [/^(hvc1|hev1)/, 'H.265 / HEVC'],
      [/^av01/, 'AV1'],
      [/^vp0?9/, 'VP9'],
    ];
    const label = formats.find(([pattern]) => pattern.test(value))?.[1] || 'Bilinmeyen video codec’i';
    return {
      label,
      identifier,
      qualityExpectation: label.startsWith('Bilinmeyen')
        ? 'Codec tanınmadığı için görüntü kalite beklentisi çıkarılamadı.'
        : 'Kayıplı video sıkıştırması kullanır; netlik bit hızı ve çözünürlüğe de bağlıdır.',
    };
  }

  const audioCodecs = [
    [/^mp4a\.40\.2$/, 'AAC-LC'],
    [/^mp4a\.40\.5$/, 'HE-AAC'],
    [/^mp4a\.40\.29$/, 'HE-AAC v2'],
    [/^opus/, 'Opus'],
    [/^ec-3$/, 'E-AC-3'],
    [/^ac-3$/, 'AC-3'],
    [/^vorbis/, 'Vorbis'],
    [/^(mp4a|mp3|mpeg)/, 'MPEG audio'],
  ];
  const label = audioCodecs.find(([pattern]) => pattern.test(value))?.[1] || 'Bilinmeyen ses codec’i';
  const qualityExpectation = label === 'Opus'
    ? 'Konuşma ve müzik için tasarlanmıştır; codec adı tek başına algılanan kaliteyi göstermez.'
    : label.startsWith('Bilinmeyen')
      ? 'Codec tanınmadığı için ses kalite beklentisi çıkarılamadı.'
      : 'Kayıplı ses sıkıştırması kullanır; codec adı tek başına algılanan kaliteyi göstermez.';
  return { label, identifier, qualityExpectation };
}

function describeCodecs(values) {
  const codecs = (Array.isArray(values) ? values : typeof values === 'string' ? values.split(',') : [])
    .map((value) => typeof value === 'string' ? value.trim() : '')
    .filter(Boolean);
  const videoCodec = codecs.find((codec) => /^(avc1|avc3|hvc1|hev1|av01|vp0?9)/i.test(codec));
  const audioCodec = codecs.find((codec) => /^(mp4a|opus|ec-3|ac-3|vorbis|mp3|mpeg)/i.test(codec));
  const video = describeCodec(videoCodec, 'video');
  const audio = describeCodec(audioCodec, 'audio');
  return {
    video,
    audio,
    qualityExpectation: audio?.qualityExpectation || (codecs.length
      ? 'Ses codec bilgisi alınamadığı için ses kalite beklentisi çıkarılamadı.'
      : null),
  };
}

function parseStreamUrl(input) {
  if (typeof input !== 'string' || input.length > 2048) return null;

  try {
    const url = new URL(input.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length !== 1) return null;
    const host = url.hostname.toLowerCase();
    if (['twitch.tv', 'www.twitch.tv'].includes(host) && /^[a-zA-Z0-9_]{1,25}$/.test(segments[0])) {
      return { platform: 'twitch', channel: segments[0].toLowerCase() };
    }
    if (['kick.com', 'www.kick.com'].includes(host) && /^[a-zA-Z0-9_-]{1,50}$/.test(segments[0])) {
      return { platform: 'kick', channel: segments[0] };
    }
    return null;
  } catch {
    return null;
  }
}

function sendJson(res, status, value) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(value));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 4096) {
        reject(new Error('Request body is too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        reject(new Error('Request body must be valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function createProbeResult({ platform, state, startedAt, durationMs, resolution, codecs, stalls, audio, lastError }) {
  const observedSeconds = startedAt
    ? Math.max(0, Math.round(Math.min(durationMs, Date.now() - startedAt) / 1000))
    : 0;
  const finalState = state === 'starting' || state === 'running' ? 'unavailable' : state;
  const result = { platform, state: finalState, observedSeconds, resolution, codecs, stalls, audio };

  if (finalState === 'unavailable' && lastError) result.lastError = lastError;
  if (finalState === 'offline') {
    result.completionMessage = observedSeconds > 0
      ? 'Yayın test sırasında çevrimdışı oldu.'
      : 'Kanal test başlamadan önce çevrimdışıydı.';
  } else if (finalState === 'unavailable') {
    result.completionMessage = startedAt
      ? 'Test tamamlanamadı; bu ana kadar elde edilen ölçümler aşağıda.'
      : 'Test ortamı oynatmayı başlatamadı.';
  }

  return result;
}

async function runTwitchProbe({ channel, baseUrl, parent, onProgress, durationMs = TEST_DURATION_MS }) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  let startedAt = null;
  let startupDeadline = Date.now() + 45_000;
  let state = 'starting';
  let lastError = null;
  let lastMediaSnapshot = null;
  let lastAudioSnapshot = null;
  const samples = [];
  const availableQualities = new Set();

  function createResult() {
    const resultState = state === 'running' && samples.length ? 'online' : state;
    const lastStats = samples.at(-1);
    return createProbeResult({
      platform: 'twitch',
      state: resultState,
      startedAt,
      durationMs,
      resolution: {
        current: lastStats?.videoResolution || null,
        fps: Number.isFinite(lastStats?.fps) ? lastStats.fps : null,
        available: [...availableQualities],
      },
      codecs: describeCodecs(lastStats?.codecs),
      stalls: lastMediaSnapshot
        ? summarizeStalls(lastMediaSnapshot.events, lastMediaSnapshot.now)
        : null,
      audio: summarizeAudioSignal(lastAudioSnapshot),
      lastError: resultState === 'unavailable' ? (lastError || 'The Twitch player did not provide playback data.') : undefined,
    });
  }

  page.on('pageerror', (error) => { lastError = error.message; });
  try {
    const probeUrl = new URL('/probe', baseUrl);
    probeUrl.searchParams.set('channel', channel);
    probeUrl.searchParams.set('parent', parent || process.env.PUBLIC_HOSTNAME || new URL(baseUrl).hostname);
    await page.goto(probeUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 45_000 });
    startupDeadline = Date.now() + 45_000;
    state = 'running';
    onProgress({ state, elapsedSeconds: 0 });

    while (true) {
      const snapshot = await page.evaluate(() => window.__streamProbe?.snapshot ?? null).catch(() => null);
      const playerFrame = page.frames().find((frame) => frame.url().startsWith('https://embed.twitch.tv/'));
      if (playerFrame) {
        lastMediaSnapshot = await playerFrame.evaluate(observeVideoPlayback).catch(() => lastMediaSnapshot);
        lastAudioSnapshot = await playerFrame.evaluate(observeAudioSignal).catch(() => lastAudioSnapshot);
      }
      if (snapshot) {
        if (snapshot.offline) {
          state = 'offline';
          break;
        }
        if (snapshot.playing && snapshot.stats && !startedAt) {
          startedAt = Date.now();
          state = 'online';
        }
        if (startedAt && snapshot.stats) samples.push(snapshot.stats);
        if (Array.isArray(snapshot.qualities)) {
          snapshot.qualities.forEach((quality) => {
            const name = typeof quality === 'string' ? quality : quality?.name;
            if (name && name.toLowerCase() !== 'auto') availableQualities.add(name);
          });
        }
        if (snapshot.error) lastError = snapshot.error;
      }
      if (startedAt && Date.now() - startedAt >= durationMs) break;
      if (!startedAt && Date.now() >= startupDeadline) {
        state = 'unavailable';
        break;
      }
      onProgress({ state, elapsedSeconds: startedAt ? Math.min(durationMs, Date.now() - startedAt) / 1000 : 0 });
      await page.waitForTimeout(1000);
    }

    return createResult();
  } catch (error) {
    state = 'unavailable';
    lastError = error instanceof Error ? error.message : String(error);
    const interruptedResult = createResult();
    interruptedResult.completionMessage = startedAt
      ? 'Test sırasında kesildi; bu ana kadar elde edilen ölçümler korunuyor.'
      : 'Test başlatılamadı; oynatma verisi elde edilemedi.';
    const wrappedError = new Error(lastError);
    wrappedError.partialResult = interruptedResult;
    throw wrappedError;
  } finally {
    await browser.close();
  }
}

async function runKickProbe({ channel, baseUrl, onProgress, durationMs = TEST_DURATION_MS }) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  let startedAt = null;
  let startupDeadline = Date.now() + 45_000;
  let state = 'starting';
  let previousPlaybackTime = null;
  let lastPlayback = null;
  let lastAudioSnapshot = null;
  const availableQualities = new Set();
  const availableCodecs = new Set();
  const manifestReads = [];

  function createResult() {
    const current = lastPlayback?.width && lastPlayback?.height ? `${lastPlayback.width}x${lastPlayback.height}` : null;
    return createProbeResult({
      platform: 'kick',
      state,
      startedAt,
      durationMs,
      resolution: {
        current,
        fps: Number.isFinite(lastPlayback?.fps) ? lastPlayback.fps : null,
        available: [...availableQualities],
      },
      codecs: describeCodecs([...availableCodecs]),
      stalls: lastPlayback ? summarizeStalls(lastPlayback.events, lastPlayback.now) : null,
      audio: summarizeAudioSignal(lastAudioSnapshot),
    });
  }

  page.on('response', (response) => {
    const contentType = response.headers()['content-type'] || '';
    let pathname = '';
    try { pathname = new URL(response.url()).pathname; } catch { return; }
    if (!pathname.endsWith('.m3u8') && !contentType.toLowerCase().includes('mpegurl')) return;
    manifestReads.push(response.text().then((body) => {
      const manifest = parseHlsManifest(body);
      manifest.qualities.forEach((quality) => availableQualities.add(quality));
      manifest.codecs.forEach((codec) => availableCodecs.add(codec));
    }).catch(() => {}));
  });

  try {
    const probeUrl = new URL('/kick-probe', baseUrl);
    probeUrl.searchParams.set('channel', channel);
    await page.goto(probeUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 45_000 });
    startupDeadline = Date.now() + 45_000;
    state = 'running';
    onProgress({ state, elapsedSeconds: 0 });

    while (true) {
      const playerFrame = page.frames().find((frame) => frame.url().startsWith('https://player.kick.com/'));
      let playback = null;
      if (playerFrame) {
        playback = await playerFrame.evaluate(observeVideoPlayback).catch(() => null);
        lastAudioSnapshot = await playerFrame.evaluate(observeAudioSignal).catch(() => lastAudioSnapshot);
      }

      if (playback?.ended) {
        state = 'offline';
        break;
      }
      if (playback) lastPlayback = playback;
      if (playback && playback.readyState >= 2 && !playback.paused && playback.currentTime > 0) {
        if (previousPlaybackTime !== null && playback.currentTime > previousPlaybackTime + 0.05 && !startedAt) {
          startedAt = Date.now();
          state = 'online';
        }
        if (startedAt) state = 'online';
        previousPlaybackTime = playback.currentTime;
      }

      if (startedAt && Date.now() - startedAt >= durationMs) break;
      if (!startedAt && Date.now() >= startupDeadline) {
        state = 'unavailable';
        break;
      }
      onProgress({ state, elapsedSeconds: startedAt ? Math.min(durationMs, Date.now() - startedAt) / 1000 : 0 });
      await page.waitForTimeout(1000);
    }

    await Promise.allSettled(manifestReads);
    return createResult();
  } catch (error) {
    await Promise.allSettled(manifestReads);
    state = 'unavailable';
    const interruptedResult = createResult();
    interruptedResult.completionMessage = startedAt
      ? 'Test sırasında kesildi; bu ana kadar elde edilen ölçümler korunuyor.'
      : 'Test başlatılamadı; oynatma verisi elde edilemedi.';
    const wrappedError = new Error(error instanceof Error ? error.message : String(error));
    wrappedError.partialResult = interruptedResult;
    throw wrappedError;
  } finally {
    await browser.close();
  }
}

function runPlatformProbe(input) {
  return input.platform === 'kick' ? runKickProbe(input) : runTwitchProbe(input);
}

function createApp({ runProbe = runPlatformProbe } = {}) {
  const server = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url, 'http://localhost');

    if (req.method === 'POST' && requestUrl.pathname === '/api/tests') {
      let body;
      try {
        body = await readJson(req);
      } catch (error) {
        return sendJson(res, 400, { error: error.message });
      }
      const stream = parseStreamUrl(body.url);
      if (!stream) return sendJson(res, 400, { error: 'Geçerli bir Twitch veya Kick kanal linki gir.' });

      const activeCount = [...jobs.values()].filter((job) => job.state !== 'complete').length;
      if (activeCount >= MAX_ACTIVE_TESTS) return sendJson(res, 429, { error: 'Şu anda iki test sürüyor. Biraz sonra tekrar dene.' });

      const id = crypto.randomUUID();
      const job = { id, ...stream, state: 'queued', elapsedSeconds: 0, createdAt: new Date().toISOString() };
      jobs.set(id, job);
      const publicHostname = process.env.PUBLIC_HOSTNAME || new URL(`http://${req.headers.host || 'localhost'}`).hostname;
      const boundPort = server.address()?.port || process.env.PORT || 3000;
      const baseUrl = process.env.INTERNAL_BASE_URL || `http://127.0.0.1:${boundPort}`;

      Promise.resolve().then(() => runProbe({
        ...stream,
        baseUrl,
        parent: publicHostname,
        onProgress: (progress) => Object.assign(job, progress, { state: progress.state || 'running' }),
      })).then((result) => {
        job.state = 'complete';
        job.result = result;
        job.finishedAt = new Date().toISOString();
      }).catch((error) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('Stream test worker failed:', errorMessage);
        const partialResult = error?.partialResult && typeof error.partialResult === 'object'
          ? error.partialResult
          : {};
        const partialSeconds = Number.isFinite(partialResult.observedSeconds)
          ? partialResult.observedSeconds
          : job.elapsedSeconds || 0;
        const observedSeconds = Math.min(TEST_DURATION_MS / 1000, Math.max(0, Math.round(partialSeconds)));
        job.state = 'complete';
        job.result = {
          ...partialResult,
          platform: stream.platform,
          state: 'unavailable',
          observedSeconds,
          completionMessage: partialResult.completionMessage || (observedSeconds > 0
            ? 'Test kesildi; bu ana kadar elde edilen bulgular aşağıda.'
            : 'Test başlatılamadı; oynatma verisi elde edilemedi.'),
          error: 'Test tamamlanamadı.',
        };
        job.finishedAt = new Date().toISOString();
        job.error = errorMessage;
      });

      return sendJson(res, 202, { id, state: job.state });
    }

    const jobMatch = req.method === 'GET' && requestUrl.pathname.match(/^\/api\/tests\/([\da-f-]{36})$/i);
    if (jobMatch) {
      const job = jobs.get(jobMatch[1]);
      if (!job) return sendJson(res, 404, { error: 'Test bulunamadı veya süresi doldu.' });
      return sendJson(res, 200, {
        id: job.id,
        platform: job.platform,
        channel: job.channel,
        state: job.state,
        elapsedSeconds: job.elapsedSeconds,
        createdAt: job.createdAt,
        result: job.result,
      });
    }

    const file = requestUrl.pathname === '/probe' ? 'probe.html'
      : requestUrl.pathname === '/kick-probe' ? 'kick-probe.html'
        : requestUrl.pathname === '/' ? 'index.html' : null;
    if (req.method === 'GET' && file) {
      const content = fs.readFileSync(path.join(PUBLIC_DIR, file));
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'self'; script-src 'self' https://embed.twitch.tv https://player.twitch.tv 'unsafe-inline'; frame-src https://embed.twitch.tv https://player.twitch.tv https://www.twitch.tv https://player.kick.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://api.twitch.tv https://usher.ttvnw.net;",
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
      });
      return res.end(content);
    }

    const asset = req.method === 'GET' && STATIC_ASSETS.get(requestUrl.pathname);
    if (asset) {
      const content = fs.readFileSync(path.join(PUBLIC_DIR, asset.file));
      res.writeHead(200, {
        'content-type': asset.contentType,
        'cache-control': 'public, max-age=300',
        'x-content-type-options': 'nosniff',
      });
      return res.end(content);
    }

    return sendJson(res, 404, { error: 'Not found' });
  });
  return server;
}

const cleanup = setInterval(() => {
  const cutoff = Date.now() - RESULT_TTL_MS;
  for (const [id, job] of jobs) {
    if (Date.parse(job.createdAt) < cutoff) jobs.delete(id);
  }
}, RESULT_TTL_MS);
cleanup.unref();

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, '0.0.0.0', () => {
    console.log(`Is Stream Okay is listening on port ${port}`);
  });
}

module.exports = { createApp, describeCodecs, parseHlsManifest, parseHlsQualities, parseStreamUrl, runKickProbe, runTwitchProbe };

