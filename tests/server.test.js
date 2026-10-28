const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const http = require('node:http');
const { chromium } = require('playwright');
const { createApp, describeCodecs, parseHlsManifest, runTwitchProbe } = require('../src/server');
const { observeVideoPlayback, summarizeStalls, STALL_ERROR_MARGIN_MS } = require('../src/stall-measurement');

test('measures controlled waiting intervals within the stated margin', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent('<video></video>');
    const video = page.locator('video');
    await video.evaluate(observeVideoPlayback);
    const controlledInterval = await video.evaluate(async (element) => {
      element.dispatchEvent(new Event('playing'));
      const startedAt = performance.now();
      element.dispatchEvent(new Event('waiting'));
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const endedAt = performance.now();
      element.dispatchEvent(new Event('playing'));
      return { expectedMilliseconds: endedAt - startedAt };
    });

    const snapshot = await video.evaluate(observeVideoPlayback);
    const stalls = summarizeStalls(snapshot.events, snapshot.now);
    assert.equal(stalls.count, 1);
    assert.ok(Math.abs(stalls.totalMilliseconds - controlledInterval.expectedMilliseconds) <= STALL_ERROR_MARGIN_MS);
    assert.equal(stalls.errorMarginMilliseconds, STALL_ERROR_MARGIN_MS);
  } finally {
    await browser.close();
  }
});

test('reports no stalls for a controlled uninterrupted playback', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent('<video></video>');
    const video = page.locator('video');
    await video.evaluate(observeVideoPlayback);
    await video.evaluate((element) => element.dispatchEvent(new Event('playing')));
    const snapshot = await video.evaluate(observeVideoPlayback);
    const stalls = summarizeStalls(snapshot.events, snapshot.now);
    assert.equal(stalls.count, 0);
    assert.equal(stalls.totalMilliseconds, 0);
    assert.ok(stalls.observationMilliseconds > 0);
    assert.equal(stalls.errorMarginMilliseconds, STALL_ERROR_MARGIN_MS);
  } finally {
    await browser.close();
  }
});

test('counts recovered and open stalls without double-counting repeated waiting events', () => {
  assert.deepEqual(summarizeStalls([
    { type: 'waiting', timestamp: 5 },
    { type: 'playing', timestamp: 10 },
    { type: 'waiting', timestamp: 20 },
    { type: 'waiting', timestamp: 30 },
    { type: 'playing', timestamp: 70 },
    { type: 'waiting', timestamp: 100 },
  ], 150), {
    count: 2,
    totalMilliseconds: 100,
    observationMilliseconds: 140,
    errorMarginMilliseconds: STALL_ERROR_MARGIN_MS,
  });
});

test('extracts codec identifiers and quality options from an HLS master playlist', () => {
  const manifest = parseHlsManifest(`#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,FRAME-RATE=60.000,CODECS="avc1.64002A,mp4a.40.2"
https://example.test/variant.m3u8`);

  assert.deepEqual(manifest.qualities, ['1920x1080 60 FPS']);
  assert.deepEqual(manifest.codecs, ['avc1.64002A', 'mp4a.40.2']);
  assert.deepEqual(describeCodecs(manifest.codecs), {
    video: {
      label: 'H.264 / AVC',
      identifier: 'avc1.64002A',
      qualityExpectation: 'Kayıplı video sıkıştırması kullanır; netlik bit hızı ve çözünürlüğe de bağlıdır.',
    },
    audio: {
      label: 'AAC-LC',
      identifier: 'mp4a.40.2',
      qualityExpectation: 'Kayıplı ses sıkıştırması kullanır; codec adı tek başına algılanan kaliteyi göstermez.',
    },
    qualityExpectation: 'Kayıplı ses sıkıştırması kullanır; codec adı tek başına algılanan kaliteyi göstermez.',
  });
});

test('does not invent codec details or quality expectations when metadata is missing', () => {
  assert.deepEqual(describeCodecs(undefined), { video: null, audio: null, qualityExpectation: null });
});

test('includes both the public and internal page hosts in Twitch embed parents', async () => {
  let probeUrl;
  const server = http.createServer((req, res) => {
    probeUrl = new URL(req.url, `http://${req.headers.host}`);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<script>window.__streamProbe = { snapshot: { offline: true } };</script>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const result = await runTwitchProbe({
      channel: 'sample-channel',
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      parent: 'is-stream-okay.onrender.com',
      onProgress: () => {},
    });

    assert.equal(result.state, 'offline');
    assert.deepEqual(probeUrl.searchParams.getAll('parent'), [
      'is-stream-okay.onrender.com',
      '127.0.0.1',
    ]);
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
});

test('uses Render public HTTPS origin for server-side stream probes', async () => {
  const previousExternalUrl = process.env.RENDER_EXTERNAL_URL;
  const previousExternalHostname = process.env.RENDER_EXTERNAL_HOSTNAME;
  const previousPublicHostname = process.env.PUBLIC_HOSTNAME;
  process.env.RENDER_EXTERNAL_URL = 'https://is-stream-okay.onrender.com';
  process.env.RENDER_EXTERNAL_HOSTNAME = 'is-stream-okay.onrender.com';
  delete process.env.PUBLIC_HOSTNAME;
  let probeInput;
  try {
    await withServer({
      runProbe: async (input) => {
        probeInput = input;
        return { state: 'online', observedSeconds: 30 };
      },
    }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/tests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'twitch.tv/monstercat' }),
      });

      assert.equal(response.status, 202);
      await new Promise(setImmediate);
    });
  } finally {
    if (previousExternalUrl === undefined) delete process.env.RENDER_EXTERNAL_URL;
    else process.env.RENDER_EXTERNAL_URL = previousExternalUrl;
    if (previousExternalHostname === undefined) delete process.env.RENDER_EXTERNAL_HOSTNAME;
    else process.env.RENDER_EXTERNAL_HOSTNAME = previousExternalHostname;
    if (previousPublicHostname === undefined) delete process.env.PUBLIC_HOSTNAME;
    else process.env.PUBLIC_HOSTNAME = previousPublicHostname;
  }

  assert.equal(probeInput.baseUrl, 'https://is-stream-okay.onrender.com');
  assert.equal(probeInput.parent, 'is-stream-okay.onrender.com');
});

async function withServer(options, run) {
  const app = createApp(options);
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const address = app.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    app.closeAllConnections?.();
    app.close();
  }
}

test('rejects unsupported and malformed stream links with a useful response', async () => {
  await withServer({}, async (baseUrl) => {
    for (const url of ['https://youtube.com/example', 'not a url', 'https://twitch.tv/']) {
      const response = await fetch(`${baseUrl}/api/tests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      assert.equal(response.status, 400);
      assert.match((await response.json()).error, /Twitch/i);
    }
  });
});

test('accepts a Twitch channel and returns a pollable test result', async () => {
  await withServer({
    runProbe: async ({ onProgress }) => {
      onProgress({ state: 'running', elapsedSeconds: 1 });
      return { state: 'online', observedSeconds: 30 };
    },
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/tests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://www.twitch.tv/monstercat' }),
    });

    assert.equal(response.status, 202);
    const { id } = await response.json();
    assert.ok(id);

    let result;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const poll = await fetch(`${baseUrl}/api/tests/${id}`);
      result = await poll.json();
      if (result.state === 'complete') break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    assert.equal(result.state, 'complete');
    assert.equal(result.channel, 'monstercat');
    assert.equal(result.result.state, 'online');
  });
});

test('accepts the scheme-less Twitch link shown in the page example', async () => {
  await withServer({ runProbe: async () => ({ state: 'online', observedSeconds: 30 }) }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/tests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'twitch.tv/monstercat' }),
    });

    assert.equal(response.status, 202);
  });
});

test('accepts a Kick channel and routes it through the independent test worker', async () => {
  await withServer({
    runProbe: async ({ platform, channel }) => ({ platform, state: 'online', observedSeconds: 30, channel }),
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/tests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://kick.com/DeenTheGreat' }),
    });

    assert.equal(response.status, 202);
    const { id } = await response.json();
    let job;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      job = await (await fetch(`${baseUrl}/api/tests/${id}`)).json();
      if (job.state === 'complete') break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    assert.equal(job.state, 'complete');
    assert.equal(job.channel, 'DeenTheGreat');
    assert.equal(job.result.platform, 'kick');
  });
});

test('limits concurrent server-side browser checks to one active test', async () => {
  const releases = [];
  await withServer({
    runProbe: ({ onProgress }) => new Promise((resolve) => {
      onProgress({ state: 'online', elapsedSeconds: 1 });
      releases.push(() => resolve({ state: 'online', observedSeconds: 30 }));
    }),
  }, async (baseUrl) => {
    const start = () => fetch(`${baseUrl}/api/tests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://twitch.tv/monstercat' }),
    });

    assert.equal((await start()).status, 202);
    await new Promise((resolve) => setImmediate(resolve));
    const limited = await start();
    assert.equal(limited.status, 429);
    releases.forEach((release) => release());
    await new Promise((resolve) => setImmediate(resolve));
  });
});

test('serves the no-login test page', async () => {
  await withServer({}, async (baseUrl) => {
    const response = await fetch(baseUrl);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Twitch veya Kick yayın linkini yapıştır/i);

    const stylesheet = await fetch(`${baseUrl}/styles.css`);
    assert.equal(stylesheet.status, 200);
    assert.match(stylesheet.headers.get('content-type'), /text\/css/);

    const script = await fetch(`${baseUrl}/app.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /javascript/);
  });
});

test('shows a readable message when the test API returns an empty error response', async () => {
  await withServer({}, async (baseUrl) => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.route(`${baseUrl}/api/tests`, (route) => route.fulfill({ status: 503, body: '' }));
      await page.goto(baseUrl);
      await page.locator('#stream-url').fill('https://twitch.tv/monstercat');
      await page.locator('#submit-button').click();

      const error = page.locator('#form-error');
      await error.waitFor({ state: 'visible', timeout: 5000 });
      assert.equal(await error.innerText(), 'Sunucu geçici olarak yanıt veremedi (503). Lütfen tekrar dene.');
      assert.doesNotMatch(await error.innerText(), /Unexpected end of JSON input/);
    } finally {
      await browser.close();
    }
  });
});

test('explains a Twitch playback block without reporting the channel as offline', async () => {
  await withServer({
    runProbe: async () => ({
      state: 'unavailable',
      observedSeconds: 0,
      completionMessage: 'Test ortamı oynatmayı başlatamadı.',
      lastError: 'Twitch playback was blocked.',
    }),
  }, async (baseUrl) => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.goto(baseUrl);
      await page.locator('#stream-url').fill('https://twitch.tv/monstercat');
      await page.locator('#submit-button').click();
      await page.locator('#result-card').waitFor({ timeout: 5000 });

      assert.equal(await page.locator('#result-title').innerText(), 'Test tamamlanamadı');
      assert.equal(
        await page.locator('#result-message').innerText(),
        'Twitch oynatıcısı bu test ortamında oynatmayı engelledi. Bu sonuç kanalın çevrimdışı olduğu anlamına gelmez.',
      );
    } finally {
      await browser.close();
    }
  });
});

test('shows resolution, frame rate, and available qualities in the result card', async () => {
  await withServer({
    runProbe: async ({ platform, channel }) => ({
      platform,
      state: 'online',
      observedSeconds: 30,
      resolution: platform === 'kick'
        ? { current: '1280x720', fps: 30, available: ['1280x720 30 FPS'] }
        : { current: '1920x1080', fps: 60, available: ['1080p60', '720p60'] },
      channel,
    }),
  }, async (baseUrl) => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.goto(baseUrl);
      const checks = [
        { url: 'https://www.twitch.tv/monstercat', resolution: /1920x1080/, fps: /60 FPS/, quality: /1080p60.*720p60/ },
        { url: 'https://kick.com/DeenTheGreat', resolution: /1280x720/, fps: /30 FPS/, quality: /1280x720 30 FPS/ },
      ];
      for (const check of checks) {
        await page.locator('#stream-url').fill(check.url);
        await page.locator('#submit-button').click();
        await page.locator('#resolution-card:not([hidden])').waitFor({ timeout: 5000 });

        const card = await page.locator('#resolution-card').innerText();
        assert.match(card, check.resolution);
        assert.match(card, check.fps);
        assert.match(card, check.quality);
      }
    } finally {
      await browser.close();
    }
  });
});

test('does not guess resolution or frame rate when the player provides no metrics', async () => {
  await withServer({
    runProbe: async ({ platform }) => ({
      platform,
      state: 'unavailable',
      observedSeconds: 0,
      resolution: { current: null, fps: null, available: [] },
      codecs: { video: null, audio: null, qualityExpectation: null },
      stalls: null,
    }),
  }, async (baseUrl) => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.goto(baseUrl);
      await page.locator('#stream-url').fill('https://kick.com/DeenTheGreat');
      await page.locator('#submit-button').click();
      await page.locator('#resolution-card:not([hidden])').waitFor({ timeout: 5000 });
      const card = await page.locator('#resolution-card').innerText();
      assert.match(card, /Mevcut çözünürlük\s+Bilgi alınamadı/);
      assert.match(card, /Kare hızı\s+Bilgi alınamadı/);
      assert.match(card, /Seçenek bilgisi alınamadı/);
      assert.match(await page.locator('#codec-card').innerText(), /Codec bilgisi alınamadı/);
      assert.match(await page.locator('#stall-card').innerText(), /Takılma ölçümü alınamadı/);
    } finally {
      await browser.close();
    }
  });
});

test('shows stall count, total stall time, observation time, and verified margin', async () => {
  await withServer({
    runProbe: async ({ platform }) => ({
      platform,
      state: 'online',
      observedSeconds: 30,
      stalls: {
        count: 2,
        totalMilliseconds: 1750,
        observationMilliseconds: 30_000,
        errorMarginMilliseconds: STALL_ERROR_MARGIN_MS,
      },
    }),
  }, async (baseUrl) => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.goto(baseUrl);
      await page.locator('#stream-url').fill('https://kick.com/DeenTheGreat');
      await page.locator('#submit-button').click();
      await page.locator('#stall-card:not([hidden])').waitFor({ timeout: 5000 });

      assert.equal(await page.locator('#stall-count').innerText(), '2');
      assert.equal(await page.locator('#stall-duration').innerText(), '1,8 sn');
      assert.equal(await page.locator('#stall-observation').innerText(), '30,0 sn');
      assert.equal(await page.locator('#stall-error-margin').innerText(), '±0,5 sn');
    } finally {
      await browser.close();
    }
  });
});

test('shows video and audio codec names with a concise quality note', async () => {
  await withServer({
    runProbe: async ({ platform }) => ({
      platform,
      state: 'online',
      observedSeconds: 30,
      codecs: {
        video: { label: 'H.264 / AVC', identifier: 'avc1.4D401F' },
        audio: { label: 'AAC-LC', identifier: 'mp4a.40.2' },
        qualityExpectation: 'AAC-LC is lossy; codec name alone does not determine perceived quality.',
      },
    }),
  }, async (baseUrl) => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.goto(baseUrl);
      await page.locator('#stream-url').fill('https://kick.com/DeenTheGreat');
      await page.locator('#submit-button').click();
      await page.locator('#codec-card:not([hidden])').waitFor({ timeout: 5000 });

      const card = await page.locator('#codec-card').innerText();
      assert.match(card, /H\.264 \/ AVC/);
      assert.match(card, /avc1\.4D401F/);
      assert.match(card, /AAC-LC/);
      assert.match(card, /mp4a\.40\.2/);
      assert.match(card, /does not determine perceived quality/);
    } finally {
      await browser.close();
    }
  });
});

test('shows measured audio level, full observation coverage, and signal classification', async () => {
  await withServer({
    runProbe: async ({ platform }) => ({
      platform,
      state: 'online',
      observedSeconds: 30,
      audio: {
        status: 'signal',
        levelDbfs: -28.5,
        measurementFloorDbfs: -90,
        observationMilliseconds: 29_950,
        coveragePercent: 99.5,
        sampleWindows: 600,
      },
    }),
  }, async (baseUrl) => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.goto(baseUrl);
      await page.locator('#stream-url').fill('https://kick.com/DeenTheGreat');
      await page.locator('#submit-button').click();
      await page.locator('#audio-card:not([hidden])').waitFor({ timeout: 5000 });

      const card = await page.locator('#audio-card').innerText();
      assert.match(card, /-28,5 dBFS/);
      assert.match(card, /Sinyal var/);
      assert.match(card, /30,0 sn/);
      assert.match(card, /%99,5/);
      assert.match(card, /çok düşük ≥ −60 ve < −35 dBFS/);
      assert.match(card, /fiziksel ortamındaki veya cihazındaki duyulabilirliği ölçmez/);
    } finally {
      await browser.close();
    }
  });
});

test('does not present an inaccessible audio path as a silent stream', async () => {
  await withServer({
    runProbe: async ({ platform }) => ({
      platform,
      state: 'online',
      observedSeconds: 30,
      audio: {
        status: 'unavailable',
        levelDbfs: null,
        measurementFloorDbfs: -90,
        observationMilliseconds: 30_000,
        coveragePercent: 0,
        sampleWindows: 0,
      },
    }),
  }, async (baseUrl) => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.goto(baseUrl);
      await page.locator('#stream-url').fill('https://kick.com/DeenTheGreat');
      await page.locator('#submit-button').click();
      await page.locator('#audio-card:not([hidden])').waitFor({ timeout: 5000 });

      const card = await page.locator('#audio-card').innerText();
      assert.match(card, /Ölçüm alınamadı/);
      assert.match(card, /Oynatıcı ses örneklerine erişim sağlamadı/);
      assert.doesNotMatch(card, /Sinyal algılanmadı/);
    } finally {
      await browser.close();
    }
  });
});

test('shows collected measurements when a probe is interrupted', async () => {
  await withServer({
    runProbe: async ({ onProgress }) => {
      onProgress({ state: 'running', elapsedSeconds: 8 });
      const error = new Error('controlled test interruption');
      error.partialResult = {
        observedSeconds: 8,
        resolution: { current: '1280x720', fps: null, available: ['1080p'] },
        codecs: {
          video: { label: 'H.264 / AVC', identifier: 'avc1.4D401F' },
          audio: { label: 'AAC-LC', identifier: 'mp4a.40.2' },
          qualityExpectation: 'Kayıplı ses sıkıştırması kullanır.',
        },
        stalls: {
          count: 1,
          totalMilliseconds: 700,
          observationMilliseconds: 8000,
          errorMarginMilliseconds: STALL_ERROR_MARGIN_MS,
        },
        audio: {
          status: 'signal',
          levelDbfs: -28.5,
          measurementFloorDbfs: -90,
          observationMilliseconds: 7900,
          coveragePercent: 99,
          sampleWindows: 180,
        },
        completionMessage: 'Kontrollü kesinti simülasyonu.',
      };
      throw error;
    },
  }, async (baseUrl) => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.goto(baseUrl);
      await page.locator('#stream-url').fill('https://twitch.tv/caedrel');
      await page.locator('#submit-button').click();
      await page.locator('#result-card').waitFor({ timeout: 5000 });

      assert.equal(await page.locator('#panel-title').innerText(), 'Kısmi test sonucu');
      assert.equal(await page.locator('#result-title').innerText(), 'Test kısmen tamamlandı');
      assert.match(await page.locator('#result-message').innerText(), /Kontrollü kesinti simülasyonu/);
      assert.match(await page.locator('#result-message').innerText(), /Bilgi alınamadı/);
      assert.equal(await page.locator('#current-resolution').innerText(), '1280x720');
      assert.equal(await page.locator('#current-fps').innerText(), 'Bilgi alınamadı');
      const codecCard = await page.locator('#codec-card').innerText();
      assert.match(codecCard, /H\.264 \/ AVC/);
      assert.match(codecCard, /avc1\.4D401F/);
      assert.match(codecCard, /AAC-LC/);
      assert.match(codecCard, /mp4a\.40\.2/);
      assert.equal(await page.locator('#stall-count').innerText(), '1');
      assert.equal(await page.locator('#audio-level').innerText(), '-28,5 dBFS');
      assert.equal(await page.locator('.result-icon').innerText(), '!');
      assert.match(await page.locator('#elapsed-time').innerText(), /8 \/ 30 sn/);
    } finally {
      await browser.close();
    }
  });
});

test('identifies a stream that goes offline after partial observation', async () => {
  await withServer({
    runProbe: async ({ platform }) => ({
      platform,
      state: 'offline',
      observedSeconds: 7,
      resolution: { current: '1920x1080', fps: 60, available: ['1080p60'] },
      codecs: { video: { label: 'H.264 / AVC', identifier: 'avc1.4D401F' }, audio: null },
      stalls: null,
      audio: { status: 'unavailable' },
      completionMessage: 'Yayın test sırasında çevrimdışı oldu.',
    }),
  }, async (baseUrl) => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.goto(baseUrl);
      await page.locator('#stream-url').fill('https://kick.com/DeenTheGreat');
      await page.locator('#submit-button').click();
      await page.locator('#result-card').waitFor({ timeout: 5000 });

      assert.equal(await page.locator('#result-title').innerText(), 'Yayın test sırasında çevrimdışı oldu');
      assert.match(await page.locator('#result-message').innerText(), /7 saniye sonra çevrimdışı oldu/);
      assert.equal(await page.locator('#current-resolution').innerText(), '1920x1080');
      assert.equal(await page.locator('#current-fps').innerText(), '60 FPS');
      assert.equal(await page.locator('#audio-status').innerText(), 'Ölçüm alınamadı');
    } finally {
      await browser.close();
    }
  });
});

