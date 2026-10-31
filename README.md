# Rotten Ratings 🍅 — Stremio addon

Popular movies and series re-ranked by Tomatometer, plus a ratings card (RT · IMDb · Metacritic) on every title.

## Deploy (free, ~5 minutes)
1. Create a new GitHub repo and upload all these files to it (no folders needed).
2. On render.com: New → Blueprint → pick the repo.
3. When asked for OMDB_API_KEY, paste your free key from omdbapi.com.
4. Once it's live, add `https://YOUR-APP.onrender.com/manifest.json` in Stremio (Addons → search bar → Install).

Log into the same Stremio account on your TV and the addon syncs over.

## Run locally instead
`npm install && OMDB_API_KEY=yourkey npm start`, then install `http://127.0.0.1:7000/manifest.json`.

## Rated posters
Rows from this addon show posters with RT and Letterboxd badges baked in, served from `/poster/<imdb-id>.jpg`.
Set `PUBLIC_URL` to your public address (render.yaml does this). The font is Inter (SIL OFL, see FONT-LICENSE.txt).

## Notes
- Free Render servers sleep after ~15 idle minutes, so the first load after a nap can take up to a minute.
- Keep your URL private: your key is baked in (1,000 OMDb calls/day free).
- `POOL_SIZE` env var (default 100) sets how many popular titles get re-ranked.
- OMDb's RT data is strong for films, patchy for TV, and covers critics only (no audience score).
