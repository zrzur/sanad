import { BRAND } from "../brand.js";
import { getGuild, getStarMap, setStarEntry } from "../db/store.js";
import { baseEmbed, brandFooter } from "../util/format.js";
import { guildT } from "../util/locale.js";

function reactionCount(message, emoji) {
  const reactors = message.reactions?.[emoji] || message.reactions?.["⭐"] || [];
  if (Array.isArray(reactors)) return reactors.length;
  return Object.keys(reactors || {}).length || 0;
}

export function registerStarboard(client) {
  const handle = async ({ channelId, messageId, emoji, delta = 0 }) => {
    let serverId;
    try {
      const ch = await client.rest.get(`/channels/${channelId}`);
      serverId = ch.server;
    } catch {
      return;
    }
    if (!serverId) return;

    const cfg = getGuild(serverId);
    if (!cfg.starboard.enabled || !cfg.starboard.channelId) return;
    if (emoji !== cfg.starboard.emoji && emoji !== "⭐") return;

    const { t: tr } = guildT(serverId);

    // Brief settle so fetch sees the new reaction state
    await new Promise((r) => setTimeout(r, 250));

    let message;
    try {
      message = await client.messages.fetch(channelId, messageId);
    } catch {
      return;
    }

    const count = Math.max(0, reactionCount(message, cfg.starboard.emoji) + delta);
    const map = getStarMap();
    const existing = map[messageId];

    if (count < cfg.starboard.threshold) {
      if (existing?.starMessageId) {
        await client.messages
          .delete(cfg.starboard.channelId, existing.starMessageId)
          .catch(() => {});
        setStarEntry(messageId, null);
      }
      return;
    }

    const embed = baseEmbed(BRAND.colour.star, brandFooter(tr))
      .title(`${cfg.starboard.emoji} ${count}`)
      .description((message.content || tr("starboard.media")).slice(0, 1500))
      .field(tr("starboard.source"), `<#${channelId}>`, true)
      .field(tr("starboard.author"), `<@${message.author}>`, true);

    if (existing?.starMessageId) {
      await client
        .editMessage(cfg.starboard.channelId, existing.starMessageId, { embeds: [embed] })
        .catch(() => {});
      return;
    }

    const sent = await client.send(cfg.starboard.channelId, { embeds: [embed] }).catch(() => null);
    if (sent) {
      setStarEntry(messageId, {
        starMessageId: sent.id ?? sent._id,
        channelId: cfg.starboard.channelId,
      });
    }
  };

  client.onReaction((ev) => handle({ ...ev, delta: 0 }));
  // Some gateways also emit unreact as MessageUnreact / similar — hook if present
  if (typeof client.on === "function") {
    client.on("MessageUnreact", (packet) => {
      handle({
        channelId: packet.channel_id || packet.channel,
        messageId: packet.id || packet.message_id,
        emoji: packet.emoji_id || packet.emoji,
        delta: 0,
      }).catch(() => {});
    });
  }
}
