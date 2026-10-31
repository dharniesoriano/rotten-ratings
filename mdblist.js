// Letterboxd has no public API (invite-only) and forbids scraping.
// MDBList aggregates Letterboxd scores legitimately, behind a free key.
const TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map();
let mode = null; // "modern" | "legacy", learned from the first good response

const urls = (id, key) => ({
  modern: `https://api.mdblist.com/imdb/movie/${encodeURIComponent(id)}?apikey=${encodeURIComponent(key)}`,
  legacy: `https://mdblist.com/api/?apikey=${encodeURIComponent(key)}&i=${encodeURIComponent(id)}`,
});

function pickLetterboxd(data) {
  const list = data && Array.isArray(data.ratings) ? data.ratings : [];
  const lb = list.find(r => r && /letterboxd/i.test(String(r.source)));
  if (!lb) return null;
  let v = Number(lb.value);
  if (!Number.isFinite(v) || v <= 0) {
    const s = Number(lb.score); // 0-100 fallback
    if (!Number.isFinite(s) || s <= 0) return null;
    v = s / 20;
  }
  if (v > 5) v = v / 20; // defensive: tolerate a 0-100 value
  return { value: Math.round(v * 10) / 10, votes: Number(lb.votes) || null };
}

async function getLetterboxd(imdbId, apiKey) {
  const hit = cache.get(imdbId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const u = urls(imdbId, apiKey);
  const order = mode ? [mode] : ["modern", "legacy"];
  for (const which of order) {
    try {
      const res = await fetch(u[which], { signal: AbortSignal.timeout(8000) });
      if (res.status === 401 || res.status === 403) throw new Error(`MDBList ${res.status}: invalid API key`);
      if (res.status === 429) throw new Error("MDBList 429: daily request limit reached");
      if (!res.ok) { console.warn(`[mdblist] ${imdbId}: ${which} HTTP ${res.status}`); continue; }
      const data = await res.json();
      if (data && (data.error || data.response === false)) throw new Error(`MDBList: ${data.error || "error"}`);
      mode = which;
      const value = pickLetterboxd(data);
      cache.set(imdbId, { at: Date.now(), value });
      return value;
    } catch (err) {
      console.warn(`[mdblist] ${imdbId}: ${err.message}`);
      if (/invalid|limit/.test(err.message)) return null; // trying the other URL won't help
    }
  }
  return null;
}

module.exports = { getLetterboxd };
