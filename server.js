const express = require("express");
const { getRouter } = require("stremio-addon-sdk");
const landingTemplate = require("stremio-addon-sdk/src/landingTemplate");
const addonInterface = require("./addon");
const { renderPoster } = require("./poster");

const PORT = Number(process.env.PORT) || 7000;
const app = express();

app.use(getRouter(addonInterface));

// Rated posters: /poster/tt0111161.jpg?rt=91&lb=4.6
app.get("/poster/:id.jpg", async (req, res) => {
  const { id } = req.params;
  if (!/^tt\d{5,10}$/.test(id)) return res.status(400).end();

  const rt = /^\d{1,3}$/.test(req.query.rt || "") ? Math.min(100, Number(req.query.rt)) : null;
  const lbNum = Number(req.query.lb);
  const lb = req.query.lb && Number.isFinite(lbNum) && lbNum > 0 && lbNum <= 5 ? lbNum : null;

  try {
    const jpeg = await renderPoster(id, rt, lb);
    if (!jpeg) return res.redirect(302, `https://images.metahub.space/poster/medium/${id}/img`);
    res.set({ "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=604800" });
    res.end(jpeg);
  } catch (err) {
    console.warn(`[poster] ${id}: ${err.message}`);
    res.redirect(302, `https://images.metahub.space/poster/medium/${id}/img`);
  }
});

const landing = landingTemplate(addonInterface.manifest);
app.get(["/", "/configure"], (_, res) => res.type("html").send(landing));

app.listen(PORT, () => console.log(`HTTP addon accessible at: http://127.0.0.1:${PORT}/manifest.json`));
