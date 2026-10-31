// OMDb is the practical legal route to Rotten Tomatoes scores:
// RT has no public API, and scraping their site breaks their ToS.
const TTL_MS = 24 * 60 * 60 * 1000; // scores barely move day to day
const cache = new Map();

function num(value, parser) {
  if (!value || value === "N/A") return null;
  const n = parser(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parse(data) {
  if (!data || data.Response === "False") return null;
  const rt = (data.Ratings || []).find(r => r.Source === "Rotten Tomatoes");
  return {
    title: data.Title,
    year: data.Year,
    rt: rt ? num(rt.Value, s => parseInt(s, 10)) : null,       // "94%" -> 94
    imdb: num(data.imdbRating, parseFloat),                     // "8.1" -> 8.1
    imdbVotes: num(data.imdbVotes, s => parseInt(s, 10)),
    metacritic: num(data.Metascore, s => parseInt(s, 10)),
    released: data.Released && data.Released !== "N/A" ? data.Released : null, // "14 Oct 1994"
  };
}

async function getRatings(imdbId, apiKey) {
  const hit = cache.get(imdbId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const url = `https://www.omdbapi.com/?i=${encodeURIComponent(imdbId)}&apikey=${encodeURIComponent(apiKey)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const data = await res.json().catch(() => null);
    // 401 = bad key or daily limit hit. Don't cache, so it recovers on its own.
    if (!res.ok) throw new Error(`OMDb ${res.status}: ${data && data.Error}`);
    const value = parse(data);
    cache.set(imdbId, { at: Date.now(), value }); // cache "no data" too, saves quota
    return value;
  } catch (err) {
    console.warn(`[omdb] ${imdbId}: ${err.message}`);
    return null;
  }
}

module.exports = { getRatings };
