const { addonBuilder } = require("stremio-addon-sdk");
const { getRatings } = require("./omdb");
const { getRanked } = require("./catalog");

const ENV_KEY = process.env.OMDB_API_KEY || "";
const TIERS = { "90%+ Must-See": 90, "75%+ Fresh": 75, "60%+ Fresh": 60 };

const tierExtra = [
  { name: "genre", isRequired: false, options: Object.keys(TIERS) },
  { name: "skip", isRequired: false },
];

const manifest = {
  id: "community.rotten.ratings",
  version: "1.0.1",
  name: "Rotten Ratings 🍅",
  description: "Popular titles re-ranked by Tomatometer, plus a ratings card (RT · IMDb · Metacritic) on every movie and show.",
  logo: "https://em-content.zobj.net/source/apple/391/tomato_1f345.png",
  resources: ["catalog", "stream"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: [
    { type: "movie", id: "rt-movies-v2", name: "🍅 Tomatometer Top", extra: tierExtra },
    { type: "series", id: "rt-series-v2", name: "🍅 Tomatometer Top", extra: tierExtra },
  ],
  config: [
    { key: "omdbKey", type: "text", title: "Your OMDb API key (free at omdbapi.com/apikey.aspx)", required: !ENV_KEY },
  ],
  behaviorHints: { configurable: true, configurationRequired: !ENV_KEY },
};

const builder = new addonBuilder(manifest);
const keyFrom = config => (config && config.omdbKey) || ENV_KEY;

builder.defineCatalogHandler(async ({ type, extra = {}, config }) => {
  const key = keyFrom(config);
  if (!key) return { metas: [] };

  const min = TIERS[extra.genre] || 0;
  const skip = Number(extra.skip) || 0;
  const list = (await getRanked(type, key)).filter(m => m._rt >= min);
  const metas = list.slice(skip, skip + 100).map(({ _rt, ...meta }) => meta);

  // Never let Stremio cache an empty answer: it would hide a fix for hours.
  if (!metas.length) return { metas: [], cacheMaxAge: 0 };
  return { metas, cacheMaxAge: 6 * 3600, staleRevalidate: 24 * 3600 };
});

function verdict(score) {
  if (score >= 90) return "Must-see";
  if (score >= 60) return "Fresh";
  return "Rotten";
}

builder.defineStreamHandler(async ({ id, config }) => {
  const key = keyFrom(config);
  if (!key) return { streams: [] };

  const imdbId = id.split(":")[0]; // series episodes arrive as tt123:season:episode
  const r = await getRatings(imdbId, key);
  if (!r) return { streams: [] };

  const lines = [
    r.rt != null ? `🍅 ${r.rt}% Tomatometer · ${verdict(r.rt)}` : "🍅 No Tomatometer score on record",
    [
      r.imdb != null && `⭐ IMDb ${r.imdb}${r.imdbVotes ? ` (${r.imdbVotes.toLocaleString("en-US")} votes)` : ""}`,
      r.metacritic != null && `Ⓜ Metacritic ${r.metacritic}`,
    ].filter(Boolean).join(" · "),
    "Tap to open on Rotten Tomatoes",
  ].filter(Boolean);

  const search = encodeURIComponent(r.title || imdbId);
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
