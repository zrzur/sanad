import "dotenv/config";

process.on("unhandledRejection", (error) => {
  console.error("[sanad] unhandledRejection:", error?.message || error);
});
process.on("uncaughtException", (error) => {
  console.error("[sanad] uncaughtException:", error?.message || error);
});

import { config } from "./config.js";
import { createBot, registerPlatformCommands } from "./core/createBot.js";
import { registerPrefixBridges } from "./core/prefixBridge.js";
import { flushAllStores, purgeNonHumanLevels } from "./db/store.js";
import { InstanceManager } from "./managers/InstanceManager.js";
import { acquirePidLock } from "./util/lock.js";

if (!config.mainToken) {
  console.error("Missing ZRZUR_BOT_TOKEN in .env");
  process.exit(1);
}

acquirePidLock();
purgeNonHumanLevels();

const instances = new InstanceManager(createBot);
registerPlatformCommands(instances);
registerPrefixBridges();

const main = await createBot({
  token: config.mainToken,
  label: "main",
  syncCommands: true,
  instanceManager: instances,
});

await instances.restoreAll();

console.log(
  `Sanad online · ${main.user?.username} · slash+/prefix · i18n ar/en · instances ready`,
);

process.on("unhandledRejection", (error) => {
  console.error("[sanad] unhandledRejection", error?.message || error);
});
process.on("uncaughtException", (error) => {
  console.error("[sanad] uncaughtException", error?.message || error);
});

function shutdown(code = 0) {
  try {
    flushAllStores();
  } catch {
    /* ignore */
  }
  try {
    main.destroy();
  } catch {
    /* ignore */
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("beforeExit", () => {
  try {
    flushAllStores();
  } catch {
    /* ignore */
  }
});
