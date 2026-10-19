/*
 * MovieBox Web adapter for Nuvio
 * Prototype conversion from the Vega MovieBox Web provider.
 *
 * IMPORTANT:
 * - This is a compatibility scaffold, not a verified working scraper.
 * - Nuvio's getStreams API provides a TMDB ID, but MovieBox Web uses its own
 *   title/detailPath/subjectId identifiers. This adapter attempts a title search
 *   using the TMDB public web page, then searches MovieBox Web.
 * - MovieBox's live response structure may change; test with content you are
 *   authorized to access.
 */

const PROVIDER_NAME = "MovieBox Web";
const BASE_URL = "https://officialmoviebox.com";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const baseHeaders = {
  Accept: "text/html,application/json",
  "User-Agent": USER_AGENT,
  "x-client-info": JSON.stringify({ timezone: "Asia/Colombo" }),
  "x-source": "",
};

function decodeHtml(s) {
  return String(s || "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractTitleFromTmdbHtml(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return "";
  return decodeHtml(m[1]).replace(/\s*\|\s*TMDB.*$/i, "").trim();
}

function collectDetailPaths(html) {
  const out = [];
  const seen = new Set();
  const re = /href=["'](\/moviesDetail\/([^"'?#]+))["']/gi;
  let m;
  while ((m = re.exec(html))) {
    if (!seen.has(m[2])) {
      seen.add(m[2]);
      out.push({ path: m[2], href: m[1] });
    }
  }
  return out;
}

function decodeNuxtObjects(html) {
  // Best-effort extraction of title/subjectId/detailPath from serialized Nuxt state.
  const results = [];
  const strings = html.match(/(?:__NUXT_DATA__|__NUXT__)[\s\S]{0,2000000}/i);
  const scan = strings ? strings[0] : html;
  const re = /"detailPath"\s*:\s*"([^"]+)"[\s\S]{0,1800}?"title"\s*:\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(scan))) results.push({ detailPath: m[1], title: decodeHtml(m[2]) });
  const re2 = /"title"\s*:\s*"([^"]+)"[\s\S]{0,1800}?"detailPath"\s*:\s*"([^"]+)"/g;
  while ((m = re2.exec(scan))) results.push({ detailPath: m[2], title: decodeHtml(m[1]) });
  return results;
}

async function getTitleFromTmdb(tmdbId, mediaType) {
  // TMDB pages are public HTML pages; no API key is used.
  const type = mediaType === "tv" || mediaType === "series" ? "tv" : "movie";
  const url = `https://www.themoviedb.org/${type}/${encodeURIComponent(String(tmdbId))}`;
  const r = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!r.ok) throw new Error(`TMDB title lookup failed (${r.status})`);
  return extractTitleFromTmdbHtml(await r.text());
}

async function findMovieBoxDetail(title) {
  const url = `${BASE_URL}/newWeb/searchResult?keyword=${encodeURIComponent(title)}`;
  const r = await fetch(url, { headers: baseHeaders });
  if (!r.ok) throw new Error(`MovieBox search failed (${r.status})`);
  const html = await r.text();

  const candidates = decodeNuxtObjects(html);
  const links = collectDetailPaths(html);
  const normalized = title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  let candidate = candidates.find(x =>
    x.detailPath && x.title &&
    x.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === normalized
  );
  if (!candidate && candidates.length) candidate = candidates[0];

  let detailPath = candidate && candidate.detailPath;
  if (!detailPath && links.length) detailPath = links[0].path.replace(/^\/moviesDetail\//, "");
  if (!detailPath) throw new Error("No MovieBox detail result found; MovieBox page format may have changed.");

  // Resolve the actual subjectId from the detail page's Nuxt payload.
  const detailUrl = `${BASE_URL}/moviesDetail/${detailPath}`;
  const dr = await fetch(detailUrl, { headers: { ...baseHeaders, Referer: `${BASE_URL}/` } });
  if (!dr.ok) throw new Error(`MovieBox detail request failed (${dr.status})`);
  const detailHtml = await dr.text();

  let subjectId = "";
  const idMatch = detailHtml.match(/"subjectId"\s*:\s*"([^"]+)"/);
  if (idMatch) subjectId = idMatch[1];
  if (!subjectId) {
    const idMatch2 = detailHtml.match(/"subjectId"\s*:\s*(\d+)/);
    if (idMatch2) subjectId = idMatch2[1];
  }
  if (!subjectId) throw new Error("Could not resolve MovieBox subjectId from detail page.");

  return { detailPath, subjectId, detailUrl };
}

async function getStreams(tmdbId, mediaType, season, episode) {
  try {
    if (tmdbId == null || tmdbId === "") return [];
    const title = await getTitleFromTmdb(tmdbId, mediaType);
    if (!title) throw new Error("Could not read the title from TMDB.");

    const item = await findMovieBoxDetail(title);
    const referer = `${BASE_URL}/movies/${item.detailPath}?${new URLSearchParams({
      id: item.subjectId,
      type: "/movie/detail",
      detailSe: season ? String(season) : "",
      detailEp: episode ? String(episode) : "",
      lang: "en",
    }).toString()}`;

    const params = new URLSearchParams({
      subjectId: item.subjectId,
      detailPath: item.detailPath,
    });
    if (season && Number(season) > 0) {
      params.set("se", String(season));
      params.set("ep", String(episode || 1));
    }

    const playUrl = `${BASE_URL}/wefeed-h5api-bff/subject/play?${params.toString()}`;
    const playHeaders = {
      ...baseHeaders,
      Accept: "application/json",
      Referer: referer,
      Origin: BASE_URL,
    };
    const pr = await fetch(playUrl, { headers: playHeaders });
    if (!pr.ok) throw new Error(`MovieBox playback request failed (${pr.status})`);
    const payload = await pr.json();

    const data = payload && payload.data;
    if (!data) return [];
    const sourceList = []
      .concat(data.streams || [], data.hls || [], data.dash || [])
      .filter(s => s && s.url && !s.vipLocked);

    return sourceList.map(s => {
      const resolutionText = String(s.resolutions || "");
      const qualities = resolutionText.split(",").map(Number).filter(n => [360,480,720,1080,2160].includes(n));
      const quality = qualities.length ? `${Math.max.apply(null, qualities)}p` : undefined;
      let urlType = String(s.format || "").toUpperCase();
      if (urlType === "HLS" || urlType === "M3U8" || /\.m3u8(?:\?|$)/i.test(s.url)) urlType = "m3u8";
      else if (urlType === "DASH" || urlType === "MPD" || /\.mpd(?:\?|$)/i.test(s.url)) urlType = "mpd";
      else urlType = "mp4";

      return {
        name: PROVIDER_NAME,
        title: `${s.resolutions || s.format || "Stream"}`,
        url: s.url,
        quality,
        type: urlType,
        headers: {
          "User-Agent": USER_AGENT,
          Referer: `${BASE_URL}/`,
          Origin: BASE_URL,
        },
      };
    });
  } catch (e) {
    console.error(`[${PROVIDER_NAME}]`, e && e.message ? e.message : e);
    return [];
  }
}

module.exports = { getStreams };
