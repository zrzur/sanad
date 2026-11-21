import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export const config = {
  root,
  dataDir: join(root, "data"),
  defaultPrefix: process.env.SANAD_PREFIX || "!",
  defaultLocale: process.env.SANAD_LOCALE || "ar",
  ownerIds: (process.env.SANAD_OWNER_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  apiUrl: process.env.ZRZUR_API_URL,
  wsUrl: process.env.ZRZUR_WS_URL,
  serverId: process.env.ZRZUR_SERVER_ID || undefined,
  mainToken: process.env.ZRZUR_BOT_TOKEN,
  spotify: {
    clientId: process.env.SPOTIFY_CLIENT_ID || "",
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET || "",
  },
  brand: {
    name: "سند",
    nameEn: "Sanad",
    colour: "#E11D48",
  },
};
