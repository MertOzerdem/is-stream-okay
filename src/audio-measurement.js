const AUDIO_NO_SIGNAL_THRESHOLD_DBFS = -60;
const AUDIO_LOW_SIGNAL_THRESHOLD_DBFS = -35;
const AUDIO_MEASUREMENT_FLOOR_DBFS = -90;
const AUDIO_MIN_SAMPLE_WINDOWS = 10;
const AUDIO_MIN_COVERAGE_PERCENT = 90;
const AUDIO_MIN_PARTIAL_SAMPLE_MILLISECONDS = 5_000;

// Playwright serializes this standalone function into the platform player's frame.
async function observeAudioSignal() {
  const sampleIntervalMilliseconds = 35;
  const media = document.querySelector('video, audio');
  if (!media) return null;

  let tracker = window.__isStreamOkayAudioTracker;
  if (!tracker) {
    tracker = {
      media: null,
      context: null,
      analyser: null,
      meter: null,
      samplingMode: null,
      timer: null,
      startedAt: null,
      lastSampleAt: null,
      sampledMilliseconds: 0,
      sumSquaredRms: 0,
      sampleWeight: 0,
      sampleWindows: 0,
      hasNonZeroSamples: false,
      decodedAudioByteCount: null,
      mediaSourceType: null,
      sourceOrigin: null,
      setupError: null,
    };
    window.__isStreamOkayAudioTracker = tracker;
  }

  if (tracker.media !== media) {
    if (tracker.timer) window.clearInterval(tracker.timer);
    if (tracker.context) tracker.context.close().catch(() => {});
    tracker.media = media;
    tracker.context = null;
    tracker.analyser = null;
    tracker.meter = null;
    tracker.samplingMode = null;
    tracker.timer = null;
    tracker.decodedAudioByteCount = null;
    tracker.mediaSourceType = null;
    tracker.sourceOrigin = null;
    tracker.setupError = null;
  }

  if (!media.paused && media.readyState >= 2 && !tracker.context && !tracker.setupError) {
    try {
      const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextConstructor) throw new Error('AudioContext is unavailable.');
      const context = new AudioContextConstructor();
      const silentOutput = context.createGain();
      silentOutput.gain.value = 0;

      let meter = null;
      let analyser = null;
      let samplingMode = 'audio-worklet';
      try {
        if (!context.audioWorklet || !window.AudioWorkletNode) throw new Error('AudioWorklet is unavailable.');
        const processorSource = [
          'class StreamAudioMeter extends AudioWorkletProcessor {',
          '  constructor() { super(); this.frameCount = 0; this.sumSquares = 0; }',
          '  process(inputs, outputs) {',
          '    const channels = inputs[0] || [];',
          '    const frameCount = channels[0]?.length || outputs[0]?.[0]?.length || 0;',
          '    for (let frame = 0; frame < frameCount; frame += 1) {',
          '      let mono = 0;',
          '      for (const channel of channels) mono += channel[frame] || 0;',
          '      if (channels.length) mono /= channels.length;',
          '      this.sumSquares += mono * mono;',
          '      this.frameCount += 1;',
          '    }',
          '    if (this.frameCount >= 2048) {',
          '      this.port.postMessage({ frameCount: this.frameCount, meanSquare: this.sumSquares / this.frameCount });',
          '      this.frameCount = 0; this.sumSquares = 0;',
          '    }',
          '    for (const outputChannel of (outputs[0] || [])) outputChannel.fill(0);',
          '    return true;',
          '  }',
          '}',
          "registerProcessor('is-stream-okay-audio-meter', StreamAudioMeter);",
        ].join('\n');
        const moduleUrl = URL.createObjectURL(new Blob([processorSource], { type: 'application/javascript' }));
        try {
          await context.audioWorklet.addModule(moduleUrl);
        } finally {
          URL.revokeObjectURL(moduleUrl);
        }
        meter = new AudioWorkletNode(context, 'is-stream-okay-audio-meter', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        });
      } catch {
        samplingMode = 'analyser-fallback';
        analyser = context.createAnalyser();
        analyser.fftSize = 2048;
      }

      const source = context.createMediaElementSource(media);
      if (meter) {
        source.connect(meter);
        meter.connect(silentOutput);
      } else {
        source.connect(analyser);
        analyser.connect(silentOutput);
      }
      silentOutput.connect(context.destination);

      tracker.context = context;
      tracker.analyser = analyser;
      tracker.meter = meter;
      tracker.samplingMode = samplingMode;
      tracker.lastSampleAt = null;
      if (meter) {
        meter.port.onmessage = (event) => {
          const { frameCount, meanSquare } = event.data || {};
          if (!Number.isFinite(frameCount) || !Number.isFinite(meanSquare) || frameCount <= 0) return;
          media.muted = false;
          media.volume = 1;
          tracker.sumSquaredRms += meanSquare;
          tracker.sampleWeight += 1;
          tracker.sampleWindows += 1;
          tracker.sampledMilliseconds += frameCount / context.sampleRate * 1000;
          if (meanSquare > 0) tracker.hasNonZeroSamples = true;
          updateSourceEvidence();
        };
      }
      await context.resume().catch(() => {});
    } catch {
      tracker.setupError = 'audio-path-unavailable';
    }
  }

  function updateSourceEvidence() {
    tracker.decodedAudioByteCount = Number.isFinite(media.webkitAudioDecodedByteCount)
      ? media.webkitAudioDecodedByteCount
      : null;
    tracker.mediaSourceType = media.srcObject?.constructor?.name || null;
    try {
      tracker.sourceOrigin = media.currentSrc ? new URL(media.currentSrc, location.href).origin : null;
    } catch {
      tracker.sourceOrigin = null;
    }
  }

  if (tracker.context) {
    media.muted = false;
    media.volume = 1;
    if (tracker.context.state === 'suspended') await tracker.context.resume().catch(() => {});
    if (tracker.context.state === 'running') tracker.startedAt ??= performance.now();

    if (tracker.samplingMode === 'analyser-fallback' && !tracker.timer) {
      tracker.timer = window.setInterval(() => {
        if (tracker.media !== media || !tracker.context || !tracker.analyser) return;
        media.muted = false;
        media.volume = 1;
        if (tracker.context.state !== 'running') return;

        const now = performance.now();
        const samples = new Float32Array(tracker.analyser.fftSize);
        tracker.analyser.getFloatTimeDomainData(samples);
        let sumSquares = 0;
        for (const sample of samples) sumSquares += sample * sample;
        const windowRms = Math.sqrt(sumSquares / samples.length);
        const windowMilliseconds = samples.length / tracker.context.sampleRate * 1000;
        const elapsedSinceLastSample = tracker.lastSampleAt === null
          ? windowMilliseconds
          : Math.max(0, now - tracker.lastSampleAt);
        const coveredMilliseconds = Math.min(windowMilliseconds, elapsedSinceLastSample);
        const coverageWeight = coveredMilliseconds / windowMilliseconds;
        tracker.sampledMilliseconds += coveredMilliseconds;
        tracker.sumSquaredRms += windowRms * windowRms * coverageWeight;
        tracker.sampleWeight += coverageWeight;
        tracker.sampleWindows += 1;
        if (windowRms > 0) tracker.hasNonZeroSamples = true;
        updateSourceEvidence();
        tracker.lastSampleAt = now;
      }, sampleIntervalMilliseconds);
    }
  }

  const now = performance.now();
  const observationMilliseconds = tracker.startedAt === null ? 0 : Math.max(0, now - tracker.startedAt);
  const coveragePercent = observationMilliseconds > 0
    ? Math.min(100, tracker.sampledMilliseconds / observationMilliseconds * 100)
    : 0;

  return {
    state: tracker.setupError
      ? 'unavailable'
      : tracker.context?.state === 'running' ? 'ready' : 'waiting',
    reason: tracker.setupError,
    sumSquaredRms: tracker.sumSquaredRms,
    sampleWeight: tracker.sampleWeight,
    sampleWindows: tracker.sampleWindows,
    hasNonZeroSamples: tracker.hasNonZeroSamples,
    decodedAudioByteCount: tracker.decodedAudioByteCount,
    mediaSourceType: tracker.mediaSourceType,
    sourceOrigin: tracker.sourceOrigin,
    frameOrigin: location.origin,
    samplingMode: tracker.samplingMode,
    observationMilliseconds: Math.round(observationMilliseconds),
    sampledMilliseconds: Math.round(tracker.sampledMilliseconds),
    coveragePercent: Math.round(coveragePercent * 10) / 10,
  };
}

function summarizeAudioSignal(snapshot) {
  const sampleWeight = Number.isFinite(snapshot?.sampleWeight) ? snapshot.sampleWeight : snapshot?.sampleWindows;
  const silentSourcePathIsAmbiguous = snapshot?.hasNonZeroSamples === false
    && Number.isFinite(snapshot.decodedAudioByteCount)
    && snapshot.decodedAudioByteCount > 0
    && !['MediaSource', 'MediaSourceHandle'].includes(snapshot.mediaSourceType)
    && snapshot.sourceOrigin !== snapshot.frameOrigin;
  const observationMilliseconds = Number.isFinite(snapshot?.observationMilliseconds)
    ? snapshot.observationMilliseconds
    : 0;
  const coveragePercent = Number.isFinite(snapshot?.coveragePercent) ? snapshot.coveragePercent : 0;
  const sampledMilliseconds = Number.isFinite(snapshot?.sampledMilliseconds)
    ? snapshot.sampledMilliseconds
    : observationMilliseconds * coveragePercent / 100;
  const coverageStatus = coveragePercent >= AUDIO_MIN_COVERAGE_PERCENT
    ? 'full'
    : sampledMilliseconds >= AUDIO_MIN_PARTIAL_SAMPLE_MILLISECONDS ? 'partial' : null;
  if (!snapshot
    || !Number.isFinite(snapshot.sumSquaredRms)
    || !Number.isFinite(snapshot.sampleWindows)
    || !Number.isFinite(sampleWeight)
    || sampleWeight <= 0
    || snapshot.sampleWindows < AUDIO_MIN_SAMPLE_WINDOWS
    || !Number.isFinite(snapshot.observationMilliseconds)
    || !Number.isFinite(snapshot.coveragePercent)
    || !coverageStatus
    || silentSourcePathIsAmbiguous) {
    return {
      status: 'unavailable',
      reason: snapshot?.reason || (silentSourcePathIsAmbiguous ? 'silent-source-path-ambiguous' : 'measurement-not-continuous'),
      levelDbfs: null,
      measurementFloorDbfs: AUDIO_MEASUREMENT_FLOOR_DBFS,
      observationMilliseconds,
      sampledMilliseconds,
      coveragePercent,
      samplingMode: snapshot?.samplingMode || null,
      sampleWindows: Number.isFinite(snapshot?.sampleWindows) ? snapshot.sampleWindows : 0,
      thresholds: {
        noSignalDbfs: AUDIO_NO_SIGNAL_THRESHOLD_DBFS,
        lowSignalDbfs: AUDIO_LOW_SIGNAL_THRESHOLD_DBFS,
      },
    };
  }

  const meanSquare = snapshot.sumSquaredRms / sampleWeight;
  const rms = Math.sqrt(Math.max(0, meanSquare));
  const rawLevelDbfs = rms > 0 ? 20 * Math.log10(rms) : Number.NEGATIVE_INFINITY;
  const levelDbfs = Number.isFinite(rawLevelDbfs) && rawLevelDbfs >= AUDIO_MEASUREMENT_FLOOR_DBFS
    ? Math.round(rawLevelDbfs * 10) / 10
    : null;
  const status = rawLevelDbfs < AUDIO_NO_SIGNAL_THRESHOLD_DBFS
    ? 'no-signal'
    : rawLevelDbfs < AUDIO_LOW_SIGNAL_THRESHOLD_DBFS ? 'very-low' : 'signal';

  return {
    status,
    levelDbfs,
    measurementFloorDbfs: AUDIO_MEASUREMENT_FLOOR_DBFS,
    observationMilliseconds,
    sampledMilliseconds,
    coveragePercent,
    coverageStatus,
    samplingMode: snapshot.samplingMode || null,
    sampleWindows: snapshot.sampleWindows,
    thresholds: {
      noSignalDbfs: AUDIO_NO_SIGNAL_THRESHOLD_DBFS,
      lowSignalDbfs: AUDIO_LOW_SIGNAL_THRESHOLD_DBFS,
    },
  };
}

module.exports = {
  AUDIO_LOW_SIGNAL_THRESHOLD_DBFS,
  AUDIO_MEASUREMENT_FLOOR_DBFS,
  AUDIO_NO_SIGNAL_THRESHOLD_DBFS,
  observeAudioSignal,
  summarizeAudioSignal,
};
