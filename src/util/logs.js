import { BRAND } from "../brand.js";
import { getGuild } from "../db/store.js";
import { baseEmbed } from "./format.js";

export async function sendLog(client, serverId, embed, kind = "mod") {
  const cfg = getGuild(serverId);
  const channelId = kind === "mod" ? cfg.modLogChannelId || cfg.logChannelId : cfg.logChannelId;
  if (!channelId) return;
  await client.send(channelId, { embeds: [embed] }).catch(() => {});
}

export async function logAction(client, serverId, { title, description, colour, fields = [] }) {
  const embed = baseEmbed(colour ?? BRAND.colour.info).title(title);
  if (description) embed.description(description);
  for (const f of fields) embed.field(f.name, f.value, f.inline ?? true);
  await sendLog(client, serverId, embed, "mod");
}
