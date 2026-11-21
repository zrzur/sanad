import { Client, EmbedBuilder, Intents, Permissions } from "@zrzur/sdk/bot";
import { config } from "../config.js";
import { getGuild, updateGuild } from "../db/store.js";
import { handleAutomod, registerAntiRaid } from "../modules/automod.js";
import { handleLevelMessage, levelingCommands, registerLeveling } from "../modules/leveling.js";
import { moderationCommands, registerModeration } from "../modules/moderation.js";
import { registerSetup, setupCommands } from "../modules/setup.js";
import { registerStarboard } from "../modules/starboard.js";
import { registerTickets, ticketCommands } from "../modules/tickets.js";
import { handleAutorespond, registerUtility, utilityCommands } from "../modules/utility.js";
import { dashboardCommands, registerDashboard } from "../modules/dashboard.js";
import { panelCommands, registerPanel } from "../modules/panel.js";
import { registerWelcome } from "../modules/welcome.js";
import { makeT, t } from "./i18n.js";
import { fromMessage } from "./context.js";
import { registry } from "./registry.js";

/** Extra registry commands: prefix, language, music, instance */
export function registerPlatformCommands(instanceManager) {
  registry.register({
    name: "prefix",
    aliases: ["برفكس"],
    permission: Permissions.ManageServer,
    build: (b) =>
      b.string("value", t("en", "commands.prefix.options.value"), {
        maxLength: 5,
        descriptions: { ar: t("ar", "commands.prefix.options.value") },
      }),
    async execute(ctx) {
      const value = ctx.option("value") || ctx.args[0];
      if (!value) {
        return ctx.reply({
          content: ctx.t("commands.prefix.current", { prefix: ctx.prefix }),
          ephemeral: true,
        });
      }
      if (String(value).length > 5) {
        return ctx.reply({ content: ctx.t("common.error"), ephemeral: true });
      }
      updateGuild(ctx.serverId, (g) => {
        g.prefix = String(value);
      });
      return ctx.reply({
        content: ctx.t("commands.prefix.updated", { prefix: value }),
        ephemeral: true,
      });
    },
  });

  registry.register({
    name: "language",
    aliases: ["lang", "لغة"],
    permission: Permissions.ManageServer,
    build: (b) =>
      b.string("locale", t("en", "commands.language.options.locale"), {
        required: true,
        choices: [
          { name: "العربية", value: "ar" },
          { name: "English", value: "en" },
        ],
      }),
    async execute(ctx) {
      const locale = ctx.option("locale") || ctx.args[0] || "ar";
      if (!["ar", "en"].includes(locale)) {
        return ctx.reply({ content: ctx.t("common.error"), ephemeral: true });
      }
      updateGuild(ctx.serverId, (g) => {
        g.locale = locale;
      });
      const tLocal = makeT(locale);
      return ctx.reply({
        content: tLocal("commands.language.updated", { locale }),
        ephemeral: true,
      });
    },
  });

  registry.register({
    name: "play",
    aliases: ["p", "شغل"],
    cooldown: 3,
    build: (b) =>
      b
        .string("query", t("en", "commands.play.options.query"), {
          required: true,
          descriptions: {
            ar: t("ar", "commands.play.options.query"),
            en: "Spotify URL, playlist, album, or song search",
          },
        })
        .channel("channel", t("en", "commands.play.options.channel"), {
          descriptions: { ar: t("ar", "commands.play.options.channel") },
        }),
    async execute(ctx) {
      const { enqueue, resolveTracks, refreshNowPlaying } = await import("../managers/music.js");
      const { getUserVoiceChannel } = await import("../managers/voiceTracker.js");
      const query = ctx.option("query") || ctx.rawArgs;
      if (!query) return ctx.reply({ content: ctx.t("commands.play.needQuery"), ephemeral: true });
      const voiceChannelId =
        ctx.option("channel") || getUserVoiceChannel(ctx.client, ctx.userId);
      if (!voiceChannelId) {
        return ctx.reply({ content: ctx.t("commands.play.needChannel"), ephemeral: true });
      }
      try {
        if (ctx.interaction && !ctx.interaction.deferred) await ctx.defer({ ephemeral: true });
      } catch {
        /* ignore */
      }
      try {
        let tracks;
        try {
          tracks = await resolveTracks(query);
        } catch (error) {
          const msg = String(error?.message || error);
          if (msg.includes("SPOTIFY_NOT_CONFIGURED")) {
            return ctx.reply({ content: ctx.t("commands.play.spotifyMissing"), ephemeral: true });
          }
          if (msg.includes("YOUTUBE_DISABLED")) {
            return ctx.reply({ content: ctx.t("commands.play.youtubeDisabled"), ephemeral: true });
          }
          if (msg.includes("SPOTIFY_ONLY")) {
            return ctx.reply({ content: ctx.t("commands.play.spotifyOnly"), ephemeral: true });
          }
          if (msg.includes("SPOTIFY_NO_PREVIEW") || msg.includes("NO_FULL_AUDIO") || msg.includes("SPOTIFY_EMPTY")) {
            return ctx.reply({ content: ctx.t("commands.play.noPreview"), ephemeral: true });
          }
          throw error;
        }
        if (!tracks.length) {
          return ctx.reply({ content: ctx.t("commands.play.fail"), ephemeral: true });
        }

        let firstPosition = 0;
        for (const track of tracks) {
          const { position } = await enqueue(ctx.client, {
            serverId: ctx.serverId,
            voiceChannelId,
            textChannelId: ctx.channelId,
            track,
            requestedBy: ctx.userId,
          });
          if (!firstPosition) firstPosition = position;
        }

        await refreshNowPlaying(ctx.client, ctx.serverId).catch(() => {});

        const title = tracks[0].display || tracks[0].title || tracks[0].name;
        if (tracks.length > 1) {
          return ctx.reply({
            content: ctx.t("commands.play.spotifyQueued", { count: tracks.length, title }),
            ephemeral: true,
          });
        }
        return ctx.reply({
          content:
            firstPosition <= 1
              ? ctx.t("commands.play.now", { title })
              : ctx.t("commands.play.queued", { title, position: firstPosition }),
          ephemeral: true,
        });
      } catch (error) {
        console.error("[sanad:play]", ctx.serverId, error?.message || error);
        return ctx.reply({ content: ctx.t("commands.play.fail"), ephemeral: true });
      }
    },
  });

  registry.register({
    name: "skip",
    aliases: ["تخطي"],
    async execute(ctx) {
      const { skip, getQueue } = await import("../managers/music.js");
      const { getUserVoiceChannel } = await import("../managers/voiceTracker.js");
      const session = getQueue(ctx.client, ctx.serverId);
      const inVoice = getUserVoiceChannel(ctx.client, ctx.userId) === session.channelId;
      const isMod = typeof ctx.has === "function" && ctx.has(Permissions.ManageMessages);
      if (session.channelId && !inVoice && !isMod && !ctx.isOwner) {
        return ctx.reply({ content: ctx.t("commands.play.needDj"), ephemeral: true });
      }
      const ok = skip(ctx.client, ctx.serverId);
      return ctx.reply(ok ? ctx.t("commands.skip.done") : ctx.t("commands.skip.empty"));
    },
  });

  registry.register({
    name: "stop",
    aliases: ["وقف"],
    async execute(ctx) {
      const { stop, getQueue } = await import("../managers/music.js");
      const { getUserVoiceChannel } = await import("../managers/voiceTracker.js");
      const session = getQueue(ctx.client, ctx.serverId);
      const inVoice = getUserVoiceChannel(ctx.client, ctx.userId) === session.channelId;
      const isMod = typeof ctx.has === "function" && ctx.has(Permissions.ManageMessages);
      if (session.channelId && !inVoice && !isMod && !ctx.isOwner) {
        return ctx.reply({ content: ctx.t("commands.play.needDj"), ephemeral: true });
      }
      await stop(ctx.client, ctx.serverId);
      return ctx.reply(ctx.t("commands.stop.done"));
    },
  });

  registry.register({
    name: "queue",
    aliases: ["q", "طابور"],
    async execute(ctx) {
      const { getQueue } = await import("../managers/music.js");
      const session = getQueue(ctx.client, ctx.serverId);
      if (!session.current && !session.queue.length) {
        return ctx.reply(ctx.t("commands.queue.empty"));
      }
      const lines = [];
      if (session.current) lines.push(`▶ ${session.current.title}`);
      session.queue.forEach((tr, i) => lines.push(`${i + 1}. ${tr.title}`));
      return ctx.reply({
        embeds: [
          new EmbedBuilder()
            .title(ctx.t("commands.queue.title"))
            .description(lines.join("\n").slice(0, 4000))
            .colour(config.brand.colour),
        ],
      });
    },
  });

  registry.register({
    name: "np",
    aliases: ["nowplaying"],
    async execute(ctx) {
      const { buildNowPlayingPayload } = await import("../managers/music.js");
      const payload = buildNowPlayingPayload(ctx.client, ctx.serverId);
      if (!payload) return ctx.reply(ctx.t("commands.np.empty"));
      return ctx.reply(payload);
    },
  });

  registry.register({
    name: "instance",
    aliases: ["نسخة", "bot"],
    ownerOnly: true,
    build: (b) =>
      b
        .subcommand("add", t("en", "commands.instance.add"), (s) =>
          s
            .string("token", t("en", "commands.instance.options.token"), {
              required: true,
              maxLength: 200,
            })
            .string("label", t("en", "commands.instance.options.label"), { maxLength: 40 }),
        )
        .subcommand("remove", t("en", "commands.instance.remove"), (s) =>
          s.string("id", t("en", "commands.instance.options.id"), { required: true }),
        )
        .subcommand("list", t("en", "commands.instance.list")),
    async execute(ctx) {
      if (!ctx.isOwner && !config.ownerIds.includes(ctx.userId)) {
        return ctx.reply({ content: ctx.t("commands.instance.ownerOnly"), ephemeral: true });
      }
      const sub = ctx.interaction?.subcommand || ctx.args[0];
      if (!instanceManager) {
        return ctx.reply({ content: ctx.t("common.error"), ephemeral: true });
      }

      if (sub === "list") {
        const rows = instanceManager.list();
        if (!rows.length) {
          return ctx.reply({
            content: `${ctx.t("commands.instance.empty")}\n${ctx.t("commands.instance.hint")}`,
            ephemeral: true,
          });
        }
        const body = rows
          .map((r) => `• **${r.label}** · \`${r.id}\` · ${r.username || "?"} · ${r.tokenMasked}`)
          .join("\n");
        return ctx.reply({
          embeds: [
            new EmbedBuilder()
              .title(ctx.t("commands.instance.listTitle"))
              .description(body)
              .colour(config.brand.colour),
          ],
          ephemeral: true,
        });
      }

      if (sub === "remove") {
        const id = ctx.option("id") || ctx.args[1];
        const ok = await instanceManager.remove(id);
        return ctx.reply({
          content: ok ? ctx.t("commands.instance.removed", { id }) : ctx.t("commands.instance.notFound"),
          ephemeral: true,
        });
      }

      if (sub === "add") {
        const token = ctx.option("token") || ctx.args[1];
        const label = ctx.option("label") || ctx.args[2];
        if (!token) {
          return ctx.reply({ content: ctx.t("commands.instance.hint"), ephemeral: true });
        }
        try {
          if (ctx.interaction && !ctx.interaction.deferred) await ctx.defer({ ephemeral: true });
        } catch {
          /* ignore */
        }
        try {
          const rec = await instanceManager.add(token, label);
          return ctx.reply({
            content: ctx.t("commands.instance.added", {
              label: rec.label,
              username: rec.username,
              id: rec.id,
            }),
            ephemeral: true,
          });
        } catch {
          return ctx.reply({ content: ctx.t("commands.instance.badToken"), ephemeral: true });
        }
      }

      return ctx.reply({ content: ctx.t("commands.instance.hint"), ephemeral: true });
    },
  });

  registry.register({
    name: "help",
    aliases: ["مساعدة", "اوامر"],
    slash: false,
    async execute(ctx) {
      const bodyKey = ctx.isMainBot === false ? "commands.help.bodyChild" : "commands.help.body";
      return ctx.reply({
        embeds: [
          new EmbedBuilder()
            .title(ctx.t("commands.help.title"))
            .description(ctx.t(bodyKey, { prefix: ctx.prefix }))
            .colour(config.brand.colour)
            .footer(ctx.t("brand.tagline")),
        ],
      });
    },
  });
}

async function resolveServerId(client, message) {
  if (message.server) return message.server;
  try {
    const ch = await client.rest.get(`/channels/${message.channel}`);
    return ch.server;
  } catch {
    return null;
  }
}

/**
 * Create a Sanad runtime (main or child instance).
 * Same features, different bot token → different public name.
 */
export async function createBot({ token, label = "main", syncCommands = true, instanceManager = null }) {
  const isMain = label === "main";
  // Prefix (!help) needs Message Content: enable it on Zrzur → My Bots, then SANAD_PRIVILEGED_INTENTS=1
  const wantPrivileged = process.env.SANAD_PRIVILEGED_INTENTS === "1";
  const freeIntents = Intents.Default;
  const privilegedIntents =
    Intents.Default | Intents.MessageContent | Intents.ServerMembers | Intents.Reactions;

  const makeClient = (intents) =>
    new Client({
      token,
      apiUrl: config.apiUrl,
      wsUrl: config.wsUrl,
      intents,
      onError: (error, interaction) => {
        console.error(`[sanad:${label}]`, interaction?.commandName || interaction?.customId || "err", error);
      },
    });

  let client = makeClient(wantPrivileged ? privilegedIntents : freeIntents);

  client.__sanad = { label, isMain };

  const { attachVoiceTracker } = await import("../managers/voiceTracker.js");
  attachVoiceTracker(client);

  registerModeration(client);
  registerSetup(client);
  registerLeveling(client);
  registerWelcome(client);
  registerTickets(client);
  registerPanel(client);
  registerDashboard(client);
  registerUtility(client);
  registerAntiRaid(client);
  registerStarboard(client);

  const { registerMusicControls, restoreMusicSessions } = await import("../managers/music.js");
  registerMusicControls(client);
  if (isMain && !client.__sanadMusicRestore) {
    client.__sanadMusicRestore = true;
    setTimeout(() => {
      restoreMusicSessions(client).catch((error) => {
        console.warn("[sanad:music] restore:", error?.message || error);
      });
    }, 1500);
  }

  for (const def of registry.list()) {
    // Secondary bots must not expose /instance
    if (def.name === "instance" && !isMain) continue;
    if (def.slash === false && !def.context) continue;
    if (def.context) {
      client.command(def.contextName || def.name, async (i) => {
        const { fromInteraction } = await import("./context.js");
        const ctx = fromInteraction(client, i, {
          isMainOwner: (id) => config.ownerIds.includes(id),
          isMainBot: isMain,
        });
        if (def.ownerOnly && !ctx.isOwner) {
          return i.reply({ content: ctx.t("commands.instance.ownerOnly"), ephemeral: true });
        }
        return def.execute(ctx);
      });
      continue;
    }
    if (def.slash === false) continue;
    client.command(def.name, async (i) => {
      const { fromInteraction } = await import("./context.js");
      const ctx = fromInteraction(client, i, {
        isMainOwner: (id) => config.ownerIds.includes(id),
        isMainBot: isMain,
      });
      if (def.permission != null && i.serverId && !i.has(def.permission)) {
        return i.reply({ content: ctx.t("common.noPermission"), ephemeral: true });
      }
      if (def.ownerOnly && !ctx.isOwner) {
        return i.reply({ content: ctx.t("commands.instance.ownerOnly"), ephemeral: true });
      }
      const wait = registry.checkCooldown(def, ctx.userId);
      if (wait) return i.reply({ content: `⏳ ${wait}s`, ephemeral: true });
      return def.execute(ctx);
    });
  }

  client.onMessage(async (message) => {
    // Only the main bot runs automod/xp/autorespond — avoids duplicate actions
    if (isMain) {
      const blocked = await handleAutomod(client, message);
      if (blocked) return;
      await handleLevelMessage(client, message);
      await handleAutorespond(client, message);
    }

    let content = String(message.content || message.body || "").trim();
    if (!content) return;

    const botId = client.user?.id || client.user?._id;
    const mentionRe = botId ? new RegExp(`^<@!?${botId}>\\s*`) : null;
    const mentioned = mentionRe ? mentionRe.test(content) : false;

    // Child instances only answer when @mentioned — prevents double !help replies
    if (!isMain && !mentioned) return;
    if (mentioned && mentionRe) content = content.replace(mentionRe, "").trim();

    const serverId = await resolveServerId(client, message);
    if (!serverId) return;
    const guild = getGuild(serverId);
    const prefix = guild.prefix || config.defaultPrefix;

    let body = content;
    if (!mentioned) {
      if (!content.startsWith(prefix)) return;
      body = content.slice(prefix.length).trim();
    } else if (content.startsWith(prefix)) {
      body = content.slice(prefix.length).trim();
    }
    if (!body) return;

    const [name, ...args] = body.split(/\s+/);
    const def = registry.resolvePrefix(name);
    if (!def) return;
    if (def.name === "instance" && !isMain) return;

    const ctx = fromMessage(client, message, {
      command: def.name,
      args,
      rawArgs: body.slice(name.length).trim(),
      serverId,
    });
    ctx.isOwner = config.ownerIds.includes(ctx.userId);
    ctx.isMainBot = isMain;

    if (def.ownerOnly && !ctx.isOwner) {
      await ctx.reply(ctx.t("commands.instance.ownerOnly"));
      return;
    }
    if (def.permission != null) {
      // Owner bypass only for instance; staff must still pass permission bits
      const ownerBypass = def.ownerOnly && ctx.isOwner;
      if (!ownerBypass) {
        let allowed = ctx.isOwner && def.name === "instance";
        try {
          const me = await client.rest.get(`/servers/${serverId}/members/${ctx.userId}`);
          const member = me?.member ?? me;
          const server = await client.rest.get(`/servers/${serverId}`);
          const roles = server?.roles || [];
          const mine = new Set(member?.roles || []);
          const need = BigInt(def.permission);
          for (const role of roles) {
            if (!mine.has(role._id || role.id)) continue;
            if ((BigInt(role.permissions || 0) & need) === need) {
              allowed = true;
              break;
            }
          }
          if ((BigInt(server?.default_permissions || 0) & need) === need) allowed = true;
          // Server owner always allowed
          if (server?.owner === ctx.userId) allowed = true;
        } catch (error) {
          console.warn(`[sanad:${label}:perm]`, def.name, error?.message || error);
          // Fail closed — only server owner (checked above) or explicit instance owner bypass
          allowed = false;
        }
        if (!allowed) {
          await ctx.reply(ctx.t("common.noPermission"));
          return;
        }
      }
    }
    const wait = registry.checkCooldown(def, ctx.userId);
    if (wait) {
      await ctx.reply(`⏳ ${wait}s`);
      return;
    }
    try {
      await def.execute(ctx);
    } catch (error) {
      console.error(`[sanad:${label}:prefix]`, def.name, error);
      await ctx.reply(ctx.t("common.error")).catch(() => {});
    }
  });

  await client.login(token);

  if (syncCommands) {
    const legacy = [
      ...moderationCommands(),
      ...setupCommands(),
      ...levelingCommands(),
      ...ticketCommands(),
      ...panelCommands(),
      ...dashboardCommands(),
      ...utilityCommands(),
    ];
    const fromRegistry = registry.toSlashPayload().filter((c) => {
      const json = typeof c.toJSON === "function" ? c.toJSON() : c;
      if (!isMain && json.name === "instance") return false;
      return true;
    });
    const byName = new Map();
    for (const c of legacy) {
      const json = typeof c.toJSON === "function" ? c.toJSON() : c;
      byName.set(json.name, c);
    }
    for (const c of fromRegistry) {
      const json = typeof c.toJSON === "function" ? c.toJSON() : c;
      if (!isMain && json.name === "instance") continue;
      byName.set(json.name, c);
    }
    const commands = [...byName.values()];
    // Hard replace so stale Arabic-default descriptions cannot linger in the picker
    try {
      const existing = await client.fetchCommands({ serverId: config.serverId });
      for (const cmd of existing || []) {
        const id = cmd.id ?? cmd._id;
        if (id) await client.deleteCommand(id, { serverId: config.serverId }).catch(() => {});
      }
    } catch (error) {
      console.warn(`[sanad:${label}] clear commands:`, error?.message || error);
    }
    await client.syncCommands(commands, { serverId: config.serverId });
    try {
      const check = await client.fetchCommands({ serverId: config.serverId });
      const odd = (check || [])
        .filter((c) => /[\u0600-\u06FF]/.test(c.description || ""))
        .map((c) => c.name);
      if (odd.length) {
        console.warn(`[sanad:${label}] slash still Arabic default:`, odd.join(", "));
      } else {
        console.log(`[sanad:${label}] synced ${check?.length ?? 0} slash commands (EN defaults)`);
      }
    } catch {
      /* ignore */
    }
  }

  await client.setStatus(t("en", "brand.status")).catch(() => {});

  console.log(
    t(config.defaultLocale, "brand.ready", {
      name: `${config.brand.name}/${label}`,
      username: client.user?.username,
      prefix: config.defaultPrefix,
      locale: config.defaultLocale,
    }),
  );

  void instanceManager;
  return client;
}
