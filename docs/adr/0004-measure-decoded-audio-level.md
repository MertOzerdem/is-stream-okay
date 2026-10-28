# ADR-0004: Measure decoded audio as digital level

## Context

Twitch and Kick expose a player volume setting, but it does not describe the waveform level encoded in the stream. The result must describe only audio observed in the independent server-side test and must not claim what a viewer can hear in a room or device.

## Decision

Read the selected player frame's decoded media samples with a Web Audio `MediaElementAudioSourceNode` and `AnalyserNode`. Unmute the media element and set its volume to 1 so player volume does not scale the measured stream. Connect the graph through a zero-gain node and launch Chromium with `--mute-audio` to keep the test worker silent. Start the observation clock only after the audio context reaches `running`.

Use an `AudioWorklet` to aggregate non-overlapping 2048-frame chunks across the observation; fall back to 2048-frame analyser windows sampled every 35 ms when worklets are unavailable. Convert sampled mean-square RMS to dBFS. Report a full result when the audio context is running, at least 10 windows were read, and sample coverage is at least 90%. When coverage is lower, report a partial result only if at least 5 seconds of actual samples were collected, and label its measured duration and coverage. An all-zero result remains unavailable when ambiguous for a decoded cross-origin source.

Use first-version heuristic labels: below −60 dBFS is “sinyal algılanmadı,” −60 to below −35 dBFS is “çok düşük,” and −35 dBFS or above is “sinyal var.” Display levels below −90 dBFS at the measurement floor. Explain that dBFS is a digital level and does not measure physical audibility.

## Consequences

- The output describes decoded signal level at the player's full volume, independent of the viewer's volume control.
- Partial dBFS summarizes sampled intervals only; it is not an estimate for unsampled parts of the observation.
- CORS restrictions, autoplay or context suspension before enough samples exist, and changed player internals can make a measurement unavailable. If the context suspends after enough samples were collected, preserve the sampled measurement and mark it partial when coverage is below the full threshold. A non-zero sample from a decoded source validates the sample path; ambiguous zero samples are not presented as proof of a silent stream.
- The thresholds are product heuristics calibrated with controlled PCM fixtures; they are not universal audio-quality or audibility standards. Revalidate live Twitch and Kick paths after Chromium or player changes.
