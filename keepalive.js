// Keeps Render's free server awake and pre-builds rows + posters,
// so the TV never waits for a cold start or a poster being drawn.
const PORT = Number(process.env.PORT) || 7000;
const LOCAL = `http://127.0.0.1:${PORT}`;
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/$/, "");
const PING_MIN = Number(process.env.KEEP_AWAKE_MINUTES) || 10;  // Render sleeps after 15 idle minutes
const WARM_HOURS = 12;                                            // matches the server's list cache
const POSTERS_PER_ROW = 40;                                       // roughly what a Board row shows

function startKeepAwake() {
  if (process.env.KEEP_AWAKE === "off" || !/^https?:\/\//.test(PUBLIC_URL)) {
    console.log("[awake] off (no PUBLIC_URL set)");
    return;
  }
  // Pinging the public address counts as outside traffic, which is what keeps Render awake.
  const ping = () =>
    fetch(`${PUBLIC_URL}/health`, { signal: AbortSignal.timeout(15000) })
      .then(r => { if (!r.ok) console.warn(`[awake] ping HTTP ${r.status}`); })
      .catch(err => console.warn(`[awake] ping failed: ${err.message}`));
  setInterval(ping, PING_MIN * 60 * 1000);
  console.log(`[awake] pinging ${PUBLIC_URL}/health every ${PING_MIN} min`);
}

let warming = false;
async function warmUp(catalogs) {
  if (warming) return;
  warming = true;
  const started = Date.now();
  try {
    for (const c of catalogs) {
      try {
        const res = await fetch(`${LOCAL}/catalog/${c.type}/${c.id}.json`, { signal: AbortSignal.timeout(120000) });
        const { metas = [] } = await res.json();
        let ready = 0;
        for (const m of metas.slice(0, POSTERS_PER_ROW)) {
          const u = new URL(m.poster);
          if (!u.pathname.startsWith("/poster/")) continue;
          const r = await fetch(`${LOCAL}${u.pathname}${u.search}`, { signal: AbortSignal.timeout(60000) });
          await r.arrayBuffer();
          if (r.ok) ready++;
        }
        console.log(`[warm] ${c.id}: ${metas.length} titles, ${ready} posters ready`);
      } catch (err) {
        console.warn(`[warm] ${c.id}: ${err.message}`);
      }
    }
  } finally {
    warming = false;
    console.log(`[warm] done in ${Math.round((Date.now() - started) / 1000)}s`);
  }
}

function startWarmCycle(catalogs) {
  setTimeout(() => warmUp(catalogs), 5000); // shortly after boot
  setInterval(() => warmUp(catalogs), WARM_HOURS * 60 * 60 * 1000);
}

module.exports = { startKeepAwake, startWarmCycle };
