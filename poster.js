// Draws a score bar onto posters. Text is converted to vector shapes with a
// bundled font (Inter, SIL OFL), so it never depends on fonts on the server.
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const opentype = require("opentype.js");

const W = 400, H = 600;           // output size, standard 2:3 poster
const BAR = 92;                   // score bar height
const MAX_CACHE = 400;            // finished posters kept in memory (~40 KB each)
const MAX_RENDERS = 2;            // Render's free tier has very little CPU

const fontBuf = fs.readFileSync(path.join(__dirname, "inter-800.woff"));
const font = opentype.parse(fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength));
sharp.concurrency(1);

const sources = new Map(); // imdbId -> original poster URL, learned from catalog builds
const cache = new Map();   // "id:rt:lb" -> jpeg Buffer
let active = 0;
const waiting = [];

const metahub = id => `https://images.metahub.space/poster/medium/${id}/img`;
const registerSource = (id, url) => { if (url) sources.set(id, url); };

function text(str, x, baseline, size, fill, opacity = 1) {
  const d = font.getPath(str, x, baseline, size).toPathData(2);
  return `<path d="${d}" fill="${fill}" fill-opacity="${opacity}"/>`;
}

function pill(label, value, fill) {
  const LABEL = 20, VALUE = 40, PAD = 14, GAP = 8, HEIGHT = 62;
  const lw = font.getAdvanceWidth(label, LABEL);
  const vw = font.getAdvanceWidth(value, VALUE);
  const w = Math.ceil(PAD + lw + GAP + vw + PAD);
  return {
    w,
    svg: (x, y) => {
      const mid = y + HEIGHT / 2;
      return `<rect x="${x}" y="${y}" width="${w}" height="${HEIGHT}" rx="12" fill="${fill}"/>` +
        text(label, x + PAD, mid + LABEL * 0.36, LABEL, "#ffffff", 0.82) +
        text(value, x + PAD + lw + GAP, mid + VALUE * 0.36, VALUE, "#ffffff");
    },
    height: HEIGHT,
  };
}

function overlay(rt, lb) {
  const pills = [];
  if (rt != null) pills.push(pill("RT", `${rt}%`, rt >= 60 ? "#C8322A" : "#5A7319"));
  if (lb != null) pills.push(pill("LB", lb.toFixed(1), "#0F6E56"));
  if (!pills.length) return null;

  const GAP = 12;
  const total = pills.reduce((s, p) => s + p.w, 0) + GAP * (pills.length - 1);
  let x = Math.round((W - total) / 2);
  const y = H - BAR + Math.round((BAR - pills[0].height) / 2);
  const parts = pills.map(p => { const s = p.svg(x, y); x += p.w + GAP; return s; });

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
    `<rect x="0" y="${H - BAR}" width="${W}" height="${BAR}" fill="#0b0b0b" fill-opacity="0.82"/>` +
    parts.join("") + `</svg>`
  );
}

async function download(id) {
  const tries = [...new Set([sources.get(id), metahub(id)].filter(Boolean))];
  for (const url of tries) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      console.warn(`[poster] ${id}: HTTP ${res.status} from ${url}`);
    } catch (err) {
      console.warn(`[poster] ${id}: ${err.message}`);
    }
  }
  return null;
}

async function withSlot(fn) {
  if (active >= MAX_RENDERS) await new Promise(r => waiting.push(r));
  active++;
  try { return await fn(); } finally { active--; const next = waiting.shift(); if (next) next(); }
}

async function renderPoster(id, rt, lb) {
  const key = `${id}:${rt}:${lb}`;
  if (cache.has(key)) return cache.get(key);

  const original = await download(id);
  if (!original) return null;

  const jpeg = await withSlot(async () => {
    const svg = overlay(rt, lb);
    let img = sharp(original).resize(W, H, { fit: "cover" });
    if (svg) img = img.composite([{ input: svg, top: 0, left: 0 }]);
    return img.jpeg({ quality: 84 }).toBuffer();
  });

  cache.set(key, jpeg);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value); // drop the oldest
  return jpeg;
}

module.exports = { renderPoster, registerSource };
