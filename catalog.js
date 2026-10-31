const { getRatings } = require("./omdb");

const CINEMETA = "https://v3-cinemeta.strem.io";
const POOL_SIZE = Number(process.env.POOL_SIZE) || 100; // titles re-ranked per type
const TTL_MS = 12 * 60 * 60 * 1000;
const ranked = new Map(); // "type:source:year" -> { at, promise }

// Popular titles from Stremio's own Cinemeta, paged until we have enough.
// source "top" = popular right now; source "year" + a year = popular that year.
async function fetchPool(type, source, year, size) {
  const seen = new Map();
  let skip = 0;
  while (seen.size < size) {
    const extras = [year && `genre=${encodeURIComponent(year)}`, skip && `skip=${skip}`].filter(Boolean).join("&");
    const url = `${CINEMETA}/catalog/${type}/${source}${extras ? `/${extras}` : ""}.json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      console.warn(`[cinemeta] ${type}: HTTP ${res.status} for ${url}`);
      break;
    }
    const { metas = [] } = await res.json();
    if (!metas.length) break;
    skip += metas.length;
    for (const m of metas) {
      if (m && typeof m.id === "string" && m.id.startsWith("tt") && !seen.has(m.id)) seen.set(m.id, m);
    }
  }
  return [...seen.values()].slice(0, size);
}

// Gentle on OMDb: a handful of requests in flight, never a stampede.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function build(type, source, year, apiKey) {
  const pool = await fetchPool(type, source, year, POOL_SIZE);
  const rows = await mapLimit(pool, 5, async meta => ({ meta, r: await getRatings(meta.id, apiKey) }));
  const found = rows.filter(x => x.r).length;
  const scored = rows.filter(x => x.r && x.r.rt != null).length;
  console.log(`[catalog] ${type} ${year || source}: ${pool.length} popular titles, ${found} found on OMDb, ${scored} with RT scores`);

  return rows
    .filter(x => x.r && x.r.rt != null)
    .sort((a, b) => b.r.rt - a.r.rt || (b.r.imdb || 0) - (a.r.imdb || 0))
    .map(({ meta, r }, i) => ({
      id: meta.id,
      type,
      name: meta.name,
      poster: meta.poster,
      background: meta.background,
      logo: meta.logo,
      genres: meta.genres,
      imdbRating: r.imdb != null ? String(r.imdb) : meta.imdbRating,
      releaseInfo: `🍅 ${r.rt}%${meta.releaseInfo ? ` · ${meta.releaseInfo}` : ""}`,
      description: [
        `#${i + 1} by Tomatometer · 🍅 ${r.rt}%` +
          (r.imdb != null ? ` · ⭐ ${r.imdb}` : "") +
          (r.metacritic != null ? ` · Ⓜ ${r.metacritic}` : ""),
        meta.description || "",
      ].join("\n\n").trim(),
      _rt: r.rt,
    }));
}

async function getRanked(type, apiKey, { source = "top", year = "" } = {}) {
  const cacheKey = `${type}:${source}:${year}`;
  const hit = ranked.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;

  // Share one in-flight build between simultaneous requests.
  const promise = build(type, source, year, apiKey).then(list => {
    if (!list.length) ranked.delete(cacheKey); // bad key / outage: retry next time
    return list;
  }).catch(err => {
    ranked.delete(cacheKey);
    console.warn(`[catalog] ${cacheKey}: ${err.message}`);
    return [];
  });
  ranked.set(cacheKey, { at: Date.now(), promise });
  return promise;
}

module.exports = { getRanked };
