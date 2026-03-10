import path from "node:path";
import { fileURLToPath } from "node:url";
import { APP_NAME, buildRuntimeSettings, createApp, initializeRuntimeState } from "./app.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const settings = buildRuntimeSettings({
  env: process.env,
  publicDir: path.join(__dirname, "public"),
  imagesDir: path.join(__dirname, "images"),
});

initializeRuntimeState({ settings })
  .then(({ db, dbClient, customerStatsProvider }) => {
    const app = createApp({
      settings,
      db,
      dbClient,
      customerStatsProvider,
    });

    app.listen(settings.port, () => {
      console.log(`${APP_NAME} listening on :${settings.port}`);
      console.log(`Static root: ${settings.publicDir}`);
      console.log(`Database (${dbClient?.kind || "unknown"}): ${dbClient?.description || "n/a"}`);
      console.log(`Customer stats provider: ${customerStatsProvider?.name || "n/a"}`);
    });
  })
  .catch((error) => {
    console.error("DB init failed:", error);
    process.exit(1);
  });
