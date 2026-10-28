# Stream stall measurement research

Reviewed 2026-10-28 for [ticket 05](../../.scratch/is-stream-okay/issues/05-stalls.md).

## Findings

- **Twitch:** the documented Embed API exposes `getPlaybackStats().bufferSize` in seconds and `skippedFrames` as a dropped-frame count. `PLAY` means the player was unpaused and may still be buffering; `PLAYING` means video playback started. `isPaused()` also treats buffering and seeking as playing. The documented API does not expose a dedicated buffering-start event. A zero or low `bufferSize` can therefore support an inference about starvation, but Twitch does not specify a threshold or update cadence that makes it an exact stall boundary. [Twitch Embed API](https://dev.twitch.tv/docs/embed/video-and-clips)
- **Kick:** Kick’s public embed guide documents the `player.kick.com/<username>` iframe and URL options such as `autoplay` and `muted`; it does not document a JavaScript playback-event API. This is a limit of the public guide, not proof that no private or undocumented API exists. [Kick embed guide](https://help.kick.com/en/articles/8010826-how-to-embed-your-kick-livestream)
- **HTML media events:** `waiting` fires when playback stops because there is temporarily not enough media data; `playing` fires when playback is ready to resume after a delay or pause. Those events fit a playback-stall interval better than `stalled`, which describes an unexpected lack of incoming media data and has a user-agent-defined timeout (the standard says it should be about three seconds). Count recovered `waiting` → `playing` intervals after initial playback; close an interval at the observation boundary if it remains open. [HTML `waiting`](https://html.spec.whatwg.org/multipage/media.html#event-media-waiting), [HTML `playing`](https://html.spec.whatwg.org/multipage/media.html#event-media-playing), [HTML `stalled`](https://html.spec.whatwg.org/multipage/media.html#event-media-stalled)
- **Timestamps:** DOM `Event.timeStamp` is a high-resolution timestamp relative to when the event occurred. High Resolution Time uses a monotonic clock for measuring durations, but user agents may coarsen its resolution (the current W3C text specifies 100 microseconds or a higher implementation-defined value, with 5 microseconds or higher for cross-origin-isolated contexts). That describes timestamp resolution, not the end-to-end accuracy of a media transition or a player API’s buffer updates. [DOM `Event.timeStamp`](https://dom.spec.whatwg.org/#dom-event-timestamp), [High Resolution Time](https://www.w3.org/TR/hr-time-3/#coarsen-time)

## Implementation implications

1. For Kick, observe the iframe’s actual `video` element and pair its `waiting` and `playing` events using timestamps from the same media document. Ignore startup before the first `playing` event and avoid double-counting repeated `waiting` events.
2. For Twitch, sample `bufferSize` and keep `PLAYING` transitions as corroborating evidence. Treat buffer exhaustion as an inferred signal and validate the threshold and sampling behavior against controlled interruptions before presenting it as equivalent to Kick’s media events.
3. Use monotonic timestamps for elapsed durations. A nominal timer or timestamp precision alone does not justify an end-to-end claim such as “±0.5 s.”

## Validation performed

- A controlled Chromium fixture emitted `playing`, `waiting`, then `playing` after a one-second timer. The measured interval was compared with `performance.now()` in the same frame.
- Live Twitch and Kick players were each observed for 30 seconds with no injected interruption; both reported zero stalls.
- HLS `.ts`/`.m4s` segment requests were delayed in live Twitch and Kick players. The resulting `waiting` → `playing` durations are playback-wait durations, not the raw network-delay duration: the player can use buffered media before waiting and needs time to resume after data returns.
- Five controlled player interruptions were compared with independent video `currentTime` progression and, for Kick, video-frame callback gaps. The largest observed absolute difference was 306 ms on Twitch; the UI rounds up to a ±0.5-second margin. Re-run this calibration when Chromium or either player integration changes. If the video element or timestamps are unavailable, report stall measurement as unavailable.

## Evidence versus inference

The API fields and event meanings above are documented facts. Pairing native `waiting`/`playing` events into measured incidents is an implementation choice; direct access to the Twitch iframe’s video element through Playwright was also empirically confirmed in the live experiment, but is not a public Twitch Embed API guarantee. The numeric margin comes from controlled browser and player-path comparisons, not from the public platform documentation.

