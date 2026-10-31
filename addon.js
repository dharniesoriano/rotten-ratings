const { addonBuilder } = require("stremio-addon-sdk");
const { getRatings } = require("./omdb");
const { getLetterboxd } = require("./mdblist");
const { getRanked } = require("./catalog");

const ENV_KEY = process.env.OMDB_API_KEY || "";
const MDBLIST_KEY = (process.env.MDBLIST_API_KEY || "").trim();
const TIERS = { "All scores": 0, "90%+ Must-See": 90, "75%+ Fresh": 75, "60%+ Fresh": 60 };

// Newest year first, so the Board row shows this year's releases by default.
const THIS_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: THIS_YEAR - 2010 + 1 }, (_, i) => String(THIS_YEAR - i));

const tierExtra = [
  { name: "genre", isRequired: false, options: Object.keys(TIERS) },
  { name: "skip", isRequired: false },
];
const yearExtra = [
  { name: "genre", isRequired: true, options: YEARS },
  { name: "skip", isRequired: false },
];

const catalogs = [
  { type: "movie", id: "rt-movies-v3", name: "🍅 Tomatometer Top", extra: tierExtra },
  { type: "series", id: "rt-series-v3", name: "🍅 Tomatometer Top", extra: tierExtra },
  { type: "movie", id: "rt-year-movies-v3", name: "🍅 Best by Year", extra: yearExtra },
  { type: "series", id: "rt-year-series-v3", name: "🍅 Best by Year", extra: yearExtra },
];
// Letterboxd only covers films, and only appears once an MDBList key is set.
if (MDBLIST_KEY) {
  catalogs.push({ type: "movie", id: "lb-year-movies-v3", name: "🎞 Letterboxd Best by Year", extra: yearExtra });
}

const manifest = {
  id: "community.rotten.ratings",
  version: "1.5.0",
  name: "Rotten Ratings 🍅",
  description: "Popular titles re-ranked by Tomatometer and Letterboxd, with year filters, plus a ratings card on every movie and show.",
  logo: "https://em-content.zobj.net/source/apple/391/tomato_1f345.png",
  resources: ["catalog", "stream"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs,
  config: [
    { key: "omdbKey", type: "text", title: "Your OMDb API key (free at omdbapi.com/apikey.aspx)", required: !ENV_KEY },
  ],
  behaviorHints: { configurable: true, configurationRequired: !ENV_KEY },
};

const builder = new addonBuilder(manifest);
const keysFrom = config => ({
  omdb: ((config && config.omdbKey) || ENV_KEY).trim(),
  mdblist: MDBLIST_KEY,
});

builder.defineCatalogHandler(async ({ type, id, extra = {}, config }) => {
  const keys = keysFrom(config);
  const skip = Number(extra.skip) || 0;
  const year = YEARS.includes(extra.genre) ? extra.genre : YEARS[0];
  let list = [];

  if (id === "lb-year-movies-v3") {
    if (keys.mdblist) list = await getRanked("lb", type, keys, { source: "year", year });
  } else if (keys.omdb) {
    if (id.startsWith("rt-year")) {
      list = await getRanked("rt", type, keys, { source: "year", year });
    } else {
      const min = TIERS[extra.genre] || 0;
      list = (await getRanked("rt", type, keys)).filter(m => m._score >= min);
    }
  }

  const metas = list.slice(skip, skip + 100).map(({ _score, ...meta }) => meta);
  // Never let Stremio cache an empty answer: it would hide a fix for hours.
  if (!metas.length) return { metas: [], cacheMaxAge: 0 };
  // Short cache so updates reach every device within an hour (the server keeps its own 12h cache).
  return { metas, cacheMaxAge: 3600 };
});

function verdict(score) {
  if (score >= 90) return "Must-see";
  if (score >= 60) return "Fresh";
  return "Rotten";
}

builder.defineStreamHandler(async ({ type, id, config }) => {
  const keys = keysFrom(config);
  if (!keys.omdb) return { streams: [] };

  const imdbId = id.split(":")[0]; // series episodes arrive as tt123:season:episode
  const [r, lb] = await Promise.all([
    getRatings(imdbId, keys.omdb),
    type === "movie" && keys.mdblist ? getLetterboxd(imdbId, keys.mdblist) : null,
  ]);
  if (!r && !lb) return { streams: [] };

  const lines = [
    r && (r.rt != null ? `🍅 ${r.rt}% Tomatometer · ${verdict(r.rt)}` : "🍅 No Tomatometer score on record"),
    lb && `🎞 Letterboxd ${lb.value.toFixed(1)}/5`,
    r && r.released && `📅 Released ${r.released}`,
    r && [
      r.imdb != null && `⭐ IMDb ${r.imdb}${r.imdbVotes ? ` (${r.imdbVotes.toLocaleString("en-US")} votes)` : ""}`,
      r.metacritic != null && `Ⓜ Metacritic ${r.metacritic}`,
    ].filter(Boolean).join(" · "),
    "Tap to open on Rotten Tomatoes",
  ].filter(Boolean);

  const search = encodeURIComponent((r && r.title) || imdbId);
  return {
    streams: [{
      name: "🍅 Ratings",
      title: lines.join("\n"),       // older Stremio clients
      description: lines.join("\n"), // newer Stremio clients
      externalUrl: `https://www.rottentomatoes.com/search?search=${search}`,
    }],
    cacheMaxAge: 24 * 3600,
  };
});

module.exports = builder.getInterface();
