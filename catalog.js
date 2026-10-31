const { getRatings } = require("./omdb");
const { getLetterboxd } = require("./mdblist");
const { registerSource } = require("./poster");

const CINEMETA = "https://v3-cinemeta.strem.io";
const POOL_SIZE = Number(process.env.POOL_SIZE) || 100; // titles re-ranked per list
const TTL_MS = 12 * 60 * 60 * 1000;
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL ||
  `http://127.0.0.1:${Number(process.env.PORT) || 7000}`).replace(/\/$/, "");
const ranked = new Map(); // "metric:type:source:year" -> { at, promise }

// How each list scores and labels a title.
const METRICS = {
  rt: {
    label: "Tomatometer",
    score: async (id, keys) => {
      const r = await getRatings(id, keys.omdb);
      return r && r.rt != null ? { score: r.rt, extra: r.imdb, r } : null;
    },
    badge: s => `🍅 ${s.score}%`,
    line: s => `🍅 ${s.score}%` +
      (s.r.imdb != null ? ` · ⭐ ${s.r.imdb}` : "") +
      (s.r.metacritic != null ? ` · Ⓜ ${s.r.metacritic}` : ""),
  },
  lb: {
    label: "Letterboxd",
    score: async (id, keys) => {
      const r = await getLetterboxd(id, keys.mdblist);
      return r ? { score: r.value, extra: r.votes, r } : null;
    },
    badge: s => `🎞 ${s.score.toFixed(1)}/5`,
    line: s => `🎞 Letterboxd ${s.score.toFixed(1)}/5` +
      (s.r.votes ? ` (${s.r.votes.toLocaleString("en-US")} ratings)` : ""),
  },
};

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

// Gentle on the rating APIs: a handful of requests in flight, never a stampede.
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

// Movies: "Oct 2026" from OMDb's "14 Oct 2026". Series: Cinemeta's run, e.g. "2019–2023".
function dateLabel(type, released, releaseInfo) {
  if (type === "movie" && released) {
    const [, mon, yr] = released.split(" ");
    if (mon && /^\d{4}$/.test(yr || "")) return `${mon} ${yr}`;
  }
  if (releaseInfo) return String(releaseInfo).replace(/-/g, "–").slice(0, 12);
  return released ? released.slice(-4) : null;
}

async function build(metric, type, source, year, keys) {
  const m = METRICS[metric];
  const pool = await fetchPool(type, source, year, POOL_SIZE);
  const rows = (await mapLimit(pool, 5, async meta => ({ meta, s: await m.score(meta.id, keys) }))).filter(x => x.s);
  console.log(`[catalog] ${metric} ${type} ${year || source}: ${pool.length} popular titles, ${rows.length} with ${m.label} scores`);

  rows.sort((a, b) => b.s.score - a.s.score || (b.s.extra || 0) - (a.s.extra || 0));

  // Both scores go on every poster, so fetch whichever one this list didn't rank by.
  // Both lookups are cached for 24h, so overlapping lists cost nothing extra.
  await mapLimit(rows, 5, async row => {
    let omdb;
    if (metric === "rt") {
      row.rt = row.s.score;
      omdb = row.s.r;
      const lb = type === "movie" && keys.mdblist ? await getLetterboxd(row.meta.id, keys.mdblist) : null;
      row.lb = lb ? lb.value : null;
    } else {
      row.lb = row.s.score;
      omdb = keys.omdb ? await getRatings(row.meta.id, keys.omdb) : null;
      row.rt = omdb && omdb.rt != null ? omdb.rt : null;
    }
    row.date = dateLabel(type, omdb && omdb.released, row.meta.releaseInfo);
  });

  return rows.map(({ meta, s, rt, lb, date }, i) => {
    registerSource(meta.id, meta.poster);
    const q = [rt != null && `rt=${rt}`, lb != null && `lb=${lb}`, date && `d=${encodeURIComponent(date)}`]
      .filter(Boolean).join("&");
    const scores = [rt != null && `🍅 ${rt}%`, lb != null && `🎞 ${lb.toFixed(1)}/5`].filter(Boolean).join(" · ");
    return {
      id: meta.id,
      type,
      name: meta.name,
      poster: `${PUBLIC_URL}/poster/${meta.id}.jpg${q ? `?${q}` : ""}`,
      posterShape: "poster",
      background: meta.background,
      logo: meta.logo,
      genres: meta.genres,
      imdbRating: meta.imdbRating,
      releaseInfo: `${m.badge(s)}${meta.releaseInfo ? ` · ${meta.releaseInfo}` : ""}`,
      description: [`#${i + 1} by ${m.label} · ${scores}`, meta.description || ""].join("\n\n").trim(),
      _score: s.score,
    };
  });
}

async function getRanked(metric, type, keys, { source = "top", year = "" } = {}) {
  const cacheKey = `${metric}:${type}:${source}:${year}`;
  const hit = ranked.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;

  // Share one in-flight build between simultaneous requests.
  const promise = build(metric, type, source, year, keys).then(list => {
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
