const { serveHTTP } = require("stremio-addon-sdk");
const addonInterface = require("./addon");

serveHTTP(addonInterface, { port: Number(process.env.PORT) || 7000 });
