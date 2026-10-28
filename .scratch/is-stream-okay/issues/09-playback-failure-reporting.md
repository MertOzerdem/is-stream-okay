# 09: Report runtime and Twitch playback failures clearly

**Status:** complete

**What to build:** Show a useful Turkish message when the browser receives an empty or non-JSON response from the test API. When Twitch explicitly reports that playback is blocked, explain that the independent test environment could not play the stream and that this does not mean the channel is offline. Limit concurrent server-side Chromium checks to fit the Free instance's 512 MB memory limit.

**Blocked by:** None

- [x] Empty or invalid API responses never expose a raw `Response.json()` parse error.
- [x] HTTP errors include the status code when the response body is empty or invalid.
- [x] A Twitch `PLAYBACK_BLOCKED` result is reported as an environment playback restriction, not an offline channel.
- [x] Other unavailable results remain honest and do not claim the stream is broken or offline.
- [x] The Free instance starts no more than one server-side Chromium check at a time.
- [x] The form and result-card behavior is covered through the public page interface.

**Verification:** Browser tests cover empty and malformed POST responses, an empty polling `502` response, a blocked Twitch probe result, and rejection of a concurrent second test. The polling fixture releases its simulated worker after the assertion so it does not occupy the shared test-job registry. The full suite passes.

**Resolution:** A shared Chromium launch profile disables GPU and `/dev/shm` usage, the viewport was reduced, and the service now admits one active probe at a time to lower peak memory on the 512 MB instance.

