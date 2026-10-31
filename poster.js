// Draws a score bar onto posters. Text is converted to vector shapes with a
// bundled font (Inter, SIL OFL), so it never depends on fonts on the server.
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const opentype = require("opentype.js");

const W = 400, H = 600;           // output size, standard 2:3 poster
const BAR = 64;                   // score bar height
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

// Original icons drawn on a 24x24 grid: a generic tomato and a film frame.
const ICONS = {
  tomato: color =>
    `<circle cx="12" cy="13.6" r="9" fill="${color}"/>` +
    `<ellipse cx="8.6" cy="11" rx="2.2" ry="1.4" fill="#ffffff" fill-opacity="0.35"/>` +
    `<path d="M12 3.2 L13.5 6.3 L16.8 5.6 L14.6 8.1 L16.3 10.4 L12.9 9.5 L12 11.9 L11.1 9.5 L7.7 10.4 L9.4 8.1 L7.2 5.6 L10.5 6.3 Z" fill="#3F9A3C"/>`,
  film: color =>
    `<rect x="1.5" y="4.5" width="21" height="15" rx="2.5" fill="${color}"/>` +
    `<rect x="6.2" y="7.6" width="11.6" height="8.8" rx="1" fill="#0b0b0b"/>` +
    [6.6, 10.9, 15.2].map(y =>
      `<rect x="2.9" y="${y}" width="1.9" height="1.9" rx="0.4" fill="#0b0b0b"/>` +
      `<rect x="19.2" y="${y}" width="1.9" height="1.9" rx="0.4" fill="#0b0b0b"/>`).join(""),
};

function item(icon, value) {
  const ICON = 34, VALUE = 30, GAP = 7;
  const vw = font.getAdvanceWidth(value, VALUE);
  return {
    w: Math.ceil(ICON + GAP + vw),
    svg: (x, mid) =>
      `<g transform="translate(${x} ${mid - ICON / 2}) scale(${ICON / 24})">${icon}</g>` +
      text(value, x + ICON + GAP, mid + VALUE * 0.36, VALUE, "#ffffff"),
  };
}

function overlay(rt, lb, date) {
  const items = [];
  // Red tomato = Fresh (60%+), green unripe tomato = Rotten.
  if (rt != null) items.push(item(ICONS.tomato(rt >= 60 ? "#E2392E" : "#7A9A2A"), `${rt}%`));
  if (lb != null) items.push(item(ICONS.film("#2FB98B"), lb.toFixed(1)));
  if (!items.length && !date) return null;

  const EDGE = 16, GAP = 20, DATE = 24, mid = BAR / 2;
  let x = EDGE;
  const parts = items.map(it => { const s = it.svg(x, mid); x += it.w + GAP; return s; });

  if (date) {
    // Shrink the date if it would collide with the scores.
    const room = W - EDGE - (items.length ? x : EDGE);
    let size = DATE;
    while (size > 16 && font.getAdvanceWidth(date, size) > room) size -= 1;
    const dw = font.getAdvanceWidth(date, size);
    parts.push(text(date, W - EDGE - dw, mid + size * 0.36, size, "#ffffff", 0.85));
  }

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
    `<rect x="0" y="0" width="${W}" height="${BAR}" fill="#0b0b0b" fill-opacity="0.8"/>` +
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

async function renderPoster(id, rt, lb, date) {
  const key = `${id}:${rt}:${lb}:${date}`;
  if (cache.has(key)) return cache.get(key);

  const original = await download(id);
  if (!original) return null;

  const jpeg = await withSlot(async () => {
    const svg = overlay(rt, lb, date);
    let img = sharp(original).resize(W, H, { fit: "cover" });
    if (svg) img = img.composite([{ input: svg, top: 0, left: 0 }]);
    return img.jpeg({ quality: 84 }).toBuffer();
  });

  cache.set(key, jpeg);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value); // drop the oldest
  return jpeg;
}

module.exports = { renderPoster, registerSource };
