# MovieBox Web → Nuvio plugin (prototype)

This is an experimental conversion scaffold, not a verified working plugin.

## Contents
- `manifest.json`: Nuvio provider repository manifest.
- `providers/moviebox-web.js`: Nuvio-style `getStreams(tmdbId, mediaType, season, episode)` adapter.

## Important limitations
- Vega uses its own catalog/meta/link pipeline; this adapter cannot reuse that pipeline unchanged.
- It attempts to map TMDB IDs to titles via public TMDB HTML, then locate a MovieBox detail page and call a playback endpoint.
- MovieBox's serialized Nuxt data and playback API can change. The extraction is best-effort and may return no streams.
- No live network or Nuvio runtime test has been performed in this environment.
- Only use sources for content you are authorized to access.

## Installation
The manifest must be hosted at a stable HTTPS URL for Nuvio's repository installer. A local ZIP file is not itself a repository URL. For local development, host this folder over HTTPS or publish it to a GitHub repository/Pages branch, then add the hosted `manifest.json` URL in Nuvio's Plugins settings. Do not add it under Addons.
