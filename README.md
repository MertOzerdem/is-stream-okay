# Is Stream Okay 

A no-login Twitch and Kick stream check that runs in a server-side browser. It accepts a channel URL, opens the platform's approved player from the test server, and observes playback for about 30 seconds.
https://is-stream-okay.onrender.com/

## Run locally

Requires Node.js 20 or newer.

```powershell
npm install
npx playwright install chromium
npm start
```

Open `http://localhost:3000` and submit a Twitch or Kick channel URL, such as `https://www.twitch.tv/monstercat` or `https://kick.com/DeenTheGreat`.

## Hosting

The worker must be able to launch Chromium and reach Twitch. Set `PUBLIC_HOSTNAME` to the public host used by the site so the Twitch embed receives the required `parent` value. Set `INTERNAL_BASE_URL` when the worker must reach the app through a private address. The public host must serve the site over HTTPS to comply with Twitch embed requirements.

Each check uses one headless browser for up to 30 seconds. The current process allows two simultaneous checks and keeps result data in memory for ten minutes.

### Container deployment

The repository includes a Docker image based on the Playwright `1.64.1` Chromium image. It runs as a dedicated non-root user. Build and run it with:

```powershell
docker build -t is-stream-okay .
docker run --init --shm-size=1gb -p 3000:3000 -e PORT=3000 -e PUBLIC_HOSTNAME=localhost is-stream-okay
```

For a public deployment, configure the host to serve HTTPS, pass its assigned port as `PORT`, and set `PUBLIC_HOSTNAME` to the public hostname without a scheme. Leave `INTERNAL_BASE_URL` unset unless the service needs a separate private address to reach itself. The host must allow outbound HTTPS to Twitch and Kick and provide enough memory for the configured concurrent Chromium checks.

## Current result

The current slices report whether playback was observed from the test server, along with the current resolution, frame rate, quality options, video/audio codec identifiers, buffering stalls, and decoded audio level. Audio is reported as dBFS, with first-version heuristic classes below −60 dBFS (no signal), −60 to below −35 dBFS (very low), and −35 dBFS or above (signal detected). A measurement with insufficient coverage or an ambiguous source path is shown as unavailable. Interrupted and offline tests retain the measurements collected before they ended; missing metrics remain unavailable. Neither codec notes nor dBFS claims physical sound quality or audibility. Stall duration is measured from the player’s waiting and recovery events and shown with an experimentally calibrated ±0.5-second margin for the current Chromium/player integrations.

Run the HTTP behavior tests with `npm test`.

