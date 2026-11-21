import { config } from "../config.js";
import { getGuild } from "../db/store.js";
import { makeT, resolveLocale } from "./i18n.js";

export function userId(user) {
  return user?.id ?? user?._id;
}

export function mentionUser(id) {
  return `<@${id}>`;
}

/** Build a unified context for slash interactions or prefix messages. */
export function fromInteraction(client, interaction, extras = {}) {
  const serverId = interaction.serverId;
  const guild = serverId ? getGuild(serverId) : null;
  // Prefer server /language — not the user's client locale
  const locale = resolveLocale(guild?.locale || null, null);
  const tFn = makeT(locale);
  const uid = userId(interaction.user);

  return {
    client,
    source: "slash",
    interaction,
    message: null,
    serverId,
    channelId: interaction.channelId,
    user: interaction.user,
    userId: uid,
    member: interaction.member,
    guild,
    locale,
    t: tFn,
    prefix: guild?.prefix || config.defaultPrefix,
    option: (name) => interaction.option(name),
    args: [],
    rawArgs: "",
    isOwner: config.ownerIds.includes(uid) || extras.isMainOwner?.(uid),
    async reply(payload) {
      const data = typeof payload === "string" ? { content: payload } : payload;
      try {
        if (interaction.deferred || interaction.replied) return await interaction.editReply(data);
        return await interaction.reply(data);
      } catch (error) {
        if (error?.type === "InteractionAlreadyAcknowledged") {
          return interaction.editReply(data).catch(() => null);
        }
        throw error;
      }
    },
    async defer(opts) {
      if (interaction.deferred || interaction.replied) return;
      try {
        await interaction.defer(opts ?? { ephemeral: true });
      } catch (error) {
        if (error?.type !== "InteractionAlreadyAcknowledged") throw error;
      }
    },
    has: (perm) => interaction.has(perm),
    ...extras,
  };
}

export function fromMessage(client, message, { command, args, rawArgs, serverId }) {
  const guild = serverId ? getGuild(serverId) : null;
  const locale = resolveLocale(guild?.locale);
  const tFn = makeT(locale);
  const uid = message.author;

  return {
    client,
    source: "prefix",
    interaction: null,
    message,
    serverId,
    channelId: message.channel,
    user: { _id: uid, id: uid, username: message.user?.username || uid },
    userId: uid,
    member: message.member,
    guild,
    locale,
    t: tFn,
    prefix: guild?.prefix || config.defaultPrefix,
    option: () => undefined,
    args,
    rawArgs,
    commandName: command,
    isOwner: config.ownerIds.includes(uid),
    async reply(payload) {
      const data = typeof payload === "string" ? { content: payload } : payload;
      return client.send(message.channel, data);
    },
    async defer() {},
    has() {
      return true;
    },
  };
}
