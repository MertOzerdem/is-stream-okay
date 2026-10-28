const assert = require('node:assert/strict');
const test = require('node:test');
const { chromium } = require('playwright');
const {
  AUDIO_LOW_SIGNAL_THRESHOLD_DBFS,
  AUDIO_NO_SIGNAL_THRESHOLD_DBFS,
  AUDIO_MEASUREMENT_FLOOR_DBFS,
  observeAudioSignal,
  summarizeAudioSignal,
} = require('../src/audio-measurement');

function makePcmWave({ rmsDbfs, seconds = 2, sampleRate = 48_000 }) {
  const frameCount = seconds * sampleRate;
  const dataBytes = frameCount * 2;
  const wave = Buffer.alloc(44 + dataBytes);
  wave.write('RIFF', 0);
  wave.writeUInt32LE(wave.length - 8, 4);
  wave.write('WAVE', 8);
  wave.write('fmt ', 12);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(sampleRate, 24);
  wave.writeUInt32LE(sampleRate * 2, 28);
  wave.writeUInt16LE(2, 32);
  wave.writeUInt16LE(16, 34);
  wave.write('data', 36);
  wave.writeUInt32LE(dataBytes, 40);

  const peak = rmsDbfs === null ? 0 : 10 ** (rmsDbfs / 20) * Math.sqrt(2);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const sample = Math.round(Math.sin((2 * Math.PI * 1000 * frame) / sampleRate) * peak * 32767);
    wave.writeInt16LE(sample, 44 + frame * 2);
  }
  return wave;
}

async function measureFixture(browser, wave) {
  const page = await browser.newPage();
  await page.route('https://audio.fixture.test/**', async (route) => {
    if (new URL(route.request().url()).pathname === '/stream.wav') {
      return route.fulfill({ status: 200, contentType: 'audio/wav', body: wave });
    }
    return route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><audio id="stream" src="/stream.wav" loop></audio>',
    });
  });
  await page.goto('https://audio.fixture.test/');
  await page.locator('#stream').evaluate((audio) => audio.play());
  await page.evaluate(observeAudioSignal);
  await page.waitForTimeout(1200);
  const snapshot = await page.evaluate(observeAudioSignal);
  const result = summarizeAudioSignal(snapshot);
  await page.close();
  return result;
}

test('classifies silent, very-low, and normal digital audio from full-window samples', async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  });
  try {
    const examples = [
      { rmsDbfs: null, status: 'no-signal' },
      { rmsDbfs: -45, status: 'very-low' },
      { rmsDbfs: -20, status: 'signal' },
    ];
    for (const example of examples) {
      const result = await measureFixture(browser, makePcmWave(example));
      assert.equal(result.status, example.status);
      assert.ok(result.sampleWindows >= 10);
      assert.ok(result.coveragePercent >= 90);
      assert.ok(result.observationMilliseconds >= 800);
      if (example.rmsDbfs !== null) {
        assert.ok(Math.abs(result.levelDbfs - example.rmsDbfs) < 1.5);
      } else {
        assert.equal(result.levelDbfs, null);
      }
    }
  } finally {
    await browser.close();
  }
});

test('classifies the aggregate level across the entire observation window', () => {
  const result = summarizeAudioSignal({
    state: 'ready',
    sumSquaredRms: 0.01 * 10,
    sampleWindows: 100,
    observationMilliseconds: 5000,
    coveragePercent: 100,
  });
  const expectedDbfs = 10 * Math.log10((0.01 * 10) / 100);
  assert.equal(result.levelDbfs, Math.round(expectedDbfs * 10) / 10);
  assert.equal(result.status, 'signal');
  assert.equal(result.thresholds.noSignalDbfs, AUDIO_NO_SIGNAL_THRESHOLD_DBFS);
  assert.equal(result.thresholds.lowSignalDbfs, AUDIO_LOW_SIGNAL_THRESHOLD_DBFS);
  assert.equal(result.measurementFloorDbfs, AUDIO_MEASUREMENT_FLOOR_DBFS);
});

test('reports audio measurement as unavailable when coverage or player access is invalid', () => {
  assert.equal(summarizeAudioSignal(null).status, 'unavailable');
  assert.equal(summarizeAudioSignal({ state: 'waiting' }).status, 'unavailable');
  assert.equal(summarizeAudioSignal({
    state: 'ready',
    sumSquaredRms: 0.1,
    sampleWindows: 20,
    observationMilliseconds: 1000,
    coveragePercent: 20,
  }).status, 'unavailable');
});

test('does not call zero Web Audio samples silence when a cross-origin decoded source is ambiguous', () => {
  const snapshot = {
    state: 'ready',
    sumSquaredRms: 0,
    sampleWindows: 20,
    observationMilliseconds: 1000,
    coveragePercent: 100,
    hasNonZeroSamples: false,
    decodedAudioByteCount: 1024,
    mediaSourceType: null,
    sourceOrigin: 'https://media.example.test',
    frameOrigin: 'https://player.example.test',
  };
  assert.equal(summarizeAudioSignal(snapshot).status, 'unavailable');
  assert.equal(summarizeAudioSignal(snapshot).reason, 'silent-source-path-ambiguous');
  assert.equal(summarizeAudioSignal({ ...snapshot, decodedAudioByteCount: 0 }).status, 'no-signal');
  assert.equal(summarizeAudioSignal({ ...snapshot, mediaSourceType: 'MediaSourceHandle' }).status, 'no-signal');
});

