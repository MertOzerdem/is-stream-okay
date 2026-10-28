// Five controlled live comparisons peaked at 306 ms; use a 500 ms reporting bound.
const STALL_ERROR_MARGIN_MS = 500;

// Playwright serializes this standalone function into the platform player's frame.
function observeVideoPlayback() {
  const video = document.querySelector('video');
  if (!video) return null;

  let tracker = window.__isStreamOkayStallTracker;
  if (!tracker) {
    tracker = { video: null, events: [], fpsStarted: false, fps: null, frameCount: 0, fpsStartedAt: performance.now() };
    window.__isStreamOkayStallTracker = tracker;
  }

  if (tracker.video !== video) {
    if (tracker.video && tracker.listeners) {
      tracker.video.removeEventListener('waiting', tracker.listeners.onWaiting);
      tracker.video.removeEventListener('playing', tracker.listeners.onPlaying);
    }
    tracker.video = video;
    tracker.fpsStarted = false;
    tracker.fps = null;
    tracker.frameCount = 0;
    tracker.fpsStartedAt = performance.now();
    tracker.listeners = {
      onWaiting: (event) => {
        tracker.events.push({ type: 'waiting', timestamp: event.timeStamp });
      },
      onPlaying: (event) => {
        tracker.events.push({ type: 'playing', timestamp: event.timeStamp });
      },
    };
    video.addEventListener('waiting', tracker.listeners.onWaiting);
    video.addEventListener('playing', tracker.listeners.onPlaying);
    if (!video.paused && video.readyState >= 2) {
      const lastEvent = tracker.events.at(-1);
      if (!lastEvent || lastEvent.type !== 'playing') {
        tracker.events.push({ type: 'playing', timestamp: performance.now() });
      }
    }
  }

  if (!tracker.fpsStarted && video.requestVideoFrameCallback) {
    tracker.fpsStarted = true;
    const countFrame = (now) => {
      if (tracker.video !== video) return;
      tracker.frameCount += 1;
      const elapsed = now - tracker.fpsStartedAt;
      if (elapsed >= 1000) {
        tracker.fps = tracker.frameCount * 1000 / elapsed;
        tracker.frameCount = 0;
        tracker.fpsStartedAt = now;
      }
      video.requestVideoFrameCallback(countFrame);
    };
    video.requestVideoFrameCallback(countFrame);
  }

  return {
    readyState: video.readyState,
    paused: video.paused,
    ended: video.ended,
    currentTime: video.currentTime,
    width: video.videoWidth,
    height: video.videoHeight,
    fps: tracker.fps,
    events: tracker.events,
    now: performance.now(),
  };
}

function summarizeStalls(events, endTimestamp) {
  if (!Array.isArray(events) || !Number.isFinite(endTimestamp)) return null;
  const orderedEvents = events
    .filter((event) => ['waiting', 'playing'].includes(event?.type) && Number.isFinite(event.timestamp))
    .sort((first, second) => first.timestamp - second.timestamp);

  let observationStartedAt = null;
  let stallStartedAt = null;
  let count = 0;
  let totalMilliseconds = 0;

  for (const event of orderedEvents) {
    if (event.type === 'playing') {
      if (observationStartedAt === null) {
        observationStartedAt = event.timestamp;
        continue;
      }
      if (stallStartedAt !== null) {
        count += 1;
        totalMilliseconds += Math.max(0, event.timestamp - stallStartedAt);
        stallStartedAt = null;
      }
    } else if (observationStartedAt !== null && stallStartedAt === null) {
      stallStartedAt = event.timestamp;
    }
  }

  if (observationStartedAt === null) return null;
  if (stallStartedAt !== null) {
    count += 1;
    totalMilliseconds += Math.max(0, endTimestamp - stallStartedAt);
  }

  return {
    count,
    totalMilliseconds: Math.round(totalMilliseconds),
    observationMilliseconds: Math.round(Math.max(0, endTimestamp - observationStartedAt)),
    errorMarginMilliseconds: STALL_ERROR_MARGIN_MS,
  };
}

module.exports = { observeVideoPlayback, STALL_ERROR_MARGIN_MS, summarizeStalls };

