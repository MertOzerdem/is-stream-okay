# 10: Test duration choice

**What to build:** The visitor selects a 30-second or one-minute independent test before submitting a Twitch or Kick link.

**Blocked by:** None

**Status:** complete

- [x] Show 30 seconds as the default and offer one minute as the longer option.
- [x] Validate the choice on the server and pass the selected duration to both platform probes.
- [x] Scale progress, elapsed time, and interrupted partial-result bounds to the selected duration.
- [x] Reject unsupported durations instead of silently changing the request.
