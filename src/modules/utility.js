import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Permissions,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  contextCommand,
} from "@zrzur/sdk/bot";
import { BRAND, mentionUser, userId } from "../brand.js";
import { registry } from "../core/registry.js";
import { getGiveaways, getGuild, setGiveaway, updateGuild } from "../db/store.js";
import { baseEmbed, brandFooter, parseDuration } from "../util/format.js";
import { guildT } from "../util/locale.js";
import { userAvatarUrl } from "../util/media.js";

function fakeUlid() {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let out = "";
  for (let i = 0; i < 26; i++) out += alphabet[(Math.random() * alphabet.length) | 0];
  return out;
}

const polls = new Map();

/** Role ids offered by the self-role StringSelect on a message. */
function extractRoleMenuOptions(message) {
  const rows = message?.components ?? [];
  for (const row of rows) {
    const comps = Array.isArray(row.components) ? row.components : [row];
    for (const c of comps) {
      const options = c?.options ?? c?.data?.options;
      const type = c?.type ?? c?.data?.type;
      const id = c?.customId ?? c?.custom_id ?? c?.data?.custom_id;
      if (
        options?.length &&
        (type === "StringSelect" || id === "sanad:roles:pick" || id?.startsWith?.("sanad:roles:"))
      ) {
        return options.map((o) => o.value).filter(Boolean);
      }
    }
  }
  return null;
}

export function utilityCommands() {
  // Default description = English; .describe adds ar/en for the user's client locale
  return [
    new SlashCommandBuilder("help", "Sanad help").describe({
      en: "Sanad help",
      ar: "دليل أوامر سند",
    }),
    new SlashCommandBuilder("ping", "Latency check").describe({
      en: "Latency check",
      ar: "زمن الاستجابة",
    }),
    new SlashCommandBuilder("serverinfo", "Server info").describe({
      en: "Server info",
      ar: "معلومات السيرفر",
    }),
    new SlashCommandBuilder("userinfo", "Member info")
      .describe({ en: "Member info", ar: "معلومات عضو" })
      .user("user", "Member", { descriptions: { en: "Member", ar: "العضو" } }),
    new SlashCommandBuilder("avatar", "Member avatar")
      .describe({ en: "Member avatar", ar: "صورة العضو" })
      .user("user", "Member", { descriptions: { en: "Member", ar: "العضو" } }),
    new SlashCommandBuilder("poll", "Start a poll")
      .describe({ en: "Start a poll", ar: "استطلاع رأي" })
      .string("question", "Question", {
        required: true,
        maxLength: 200,
        descriptions: { en: "Question", ar: "السؤال" },
      })
      .string("options", "Comma-separated choices", {
        required: true,
        maxLength: 400,
        descriptions: { en: "Comma-separated choices", ar: "خيارات مفصولة بفاصلة" },
      }),
    new SlashCommandBuilder("announce", "Post an announcement")
      .describe({ en: "Post an announcement", ar: "إعلان" })
      .string("text", "Announcement text", {
        required: true,
        maxLength: 2000,
        descriptions: { en: "Announcement text", ar: "النص" },
      })
      .channel("channel", "Channel", { descriptions: { en: "Channel", ar: "القناة" } })
      .permissions(Permissions.ManageMessages),
    new SlashCommandBuilder("embed", "Send a rich embed")
      .describe({ en: "Send a rich embed", ar: "إرسال رسالة منسّقة" })
      .string("title", "Title", {
        required: true,
        maxLength: 256,
        descriptions: { en: "Title", ar: "العنوان" },
      })
      .string("description", "Body", {
        required: true,
        maxLength: 2000,
        descriptions: { en: "Body", ar: "الوصف" },
      })
      .string("colour", "HEX colour", { descriptions: { en: "HEX colour", ar: "لون HEX" } })
      .channel("channel", "Channel", { descriptions: { en: "Channel", ar: "القناة" } })
      .permissions(Permissions.ManageMessages),
    new SlashCommandBuilder("say", "Say something")
      .describe({ en: "Say something", ar: "قل شيئاً" })
      .string("text", "Text", {
        required: true,
        maxLength: 2000,
        descriptions: { en: "Text", ar: "النص" },
      })
      .permissions(Permissions.ManageMessages),
    new SlashCommandBuilder("suggest", "Submit a suggestion")
      .describe({ en: "Submit a suggestion", ar: "قدّم اقتراحاً" })
      .string("idea", "Your idea", {
        required: true,
        maxLength: 1000,
        descriptions: { en: "Your idea", ar: "اقتراحك" },
      }),
    new SlashCommandBuilder("autorespond", "Auto-responders")
      .describe({ en: "Auto-responders", ar: "ردود تلقائية" })
      .subcommand("add", "Add a reply", (s) =>
        s
          .string("trigger", "Trigger", {
            required: true,
            maxLength: 80,
            descriptions: { en: "Trigger", ar: "المحفّز" },
          })
          .string("response", "Response", {
            required: true,
            maxLength: 500,
            descriptions: { en: "Response", ar: "الرد" },
          })
          .boolean("exact", "Exact match?", {
            descriptions: { en: "Exact match?", ar: "تطابق تام؟" },
          }),
      )
      .subcommand("remove", "Remove a reply", (s) =>
        s.string("trigger", "Trigger", {
          required: true,
          descriptions: { en: "Trigger", ar: "المحفّز" },
        }),
      )
      .subcommand("list", "List replies")
      .permissions(Permissions.ManageMessages),
    new SlashCommandBuilder("rolemenu", "Self-role menu")
      .describe({ en: "Self-role menu", ar: "قائمة أدوار ذاتية" })
      .role("role1", "Role 1", { required: true, descriptions: { en: "Role 1", ar: "دور 1" } })
      .role("role2", "Role 2", { descriptions: { en: "Role 2", ar: "دور 2" } })
      .role("role3", "Role 3", { descriptions: { en: "Role 3", ar: "دور 3" } })
      .role("role4", "Role 4", { descriptions: { en: "Role 4", ar: "دور 4" } })
      .role("role5", "Role 5", { descriptions: { en: "Role 5", ar: "دور 5" } })
      .permissions(Permissions.AssignRoles),
    new SlashCommandBuilder("giveaway", "Giveaway")
      .describe({ en: "Giveaway", ar: "سحب هدية" })
      .subcommand("start", "Start a giveaway", (s) =>
        s
          .string("prize", "Prize", {
            required: true,
            maxLength: 200,
            descriptions: { en: "Prize", ar: "الجائزة" },
          })
          .integer("minutes", "Duration in minutes", {
            required: true,
            min: 1,
            max: 10080,
            descriptions: { en: "Duration in minutes", ar: "المدة بالدقائق" },
          })
          .integer("winners", "Winner count", {
            min: 1,
            max: 20,
            descriptions: { en: "Winner count", ar: "عدد الفائزين" },
          })
          .string("description", "Extra instructions (optional)", {
            maxLength: 500,
            descriptions: {
              en: "Extra instructions",
              ar: "تعليمات إضافية",
            },
          })
          .integer("min_account_days", "Minimum account age in days", {
            min: 0,
            max: 3650,
            descriptions: {
              en: "Minimum account age in days",
              ar: "أقل عمر للحساب بالأيام",
            },
          }),
      )
      .subcommand("end", "End early", (s) =>
        s.string("message_id", "Message id", {
          required: true,
          descriptions: { en: "Message id", ar: "معرّف الرسالة" },
        }),
      )
      .permissions(Permissions.ManageMessages),
    new SlashCommandBuilder("reminder", "Set a reminder")
      .describe({ en: "Set a reminder", ar: "تذكير" })
      .string("when", "When? e.g. 30m or 2h", {
        required: true,
        descriptions: { en: "When? e.g. 30m or 2h", ar: "بعد كم؟ مثل 30m أو 2h" },
      })
      .string("text", "Reminder text", {
        required: true,
        maxLength: 300,
        descriptions: { en: "Reminder text", ar: "التذكير" },
      }),
    contextCommand("User", "User Info", { en: "User Info", ar: "معلومات العضو" }),
    contextCommand("Message", "Quote", { en: "Quote", ar: "اقتباس" }),
  ];
}

export function registerUtility(client) {
  client.command("help", (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const bodyKey = client.__sanad?.isMain === false ? "commands.help.bodyChild" : "commands.help.body";
    return i.reply({
      embeds: [
        baseEmbed(BRAND.colour.primary, brandFooter(tr))
          .title(tr("commands.help.title"))
          .description(tr(bodyKey, { prefix: getGuild(i.serverId).prefix || "!" }))
          .footer(tr("brand.tagline")),
      ],
    });
  });

  client.command("ping", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const t0 = Date.now();
    await i.reply({ content: "…" });
    await i.editReply(tr("commands.ping.pong", { ms: Date.now() - t0 }));
  });

  client.command("serverinfo", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    await i.defer();
    try {
      const server = await client.rest.get(`/servers/${i.serverId}`);
      const embed = baseEmbed(BRAND.colour.info)
        .title(server.name)
        .field(tr("commands.serverinfo.id"), server._id, true)
        .field(tr("commands.serverinfo.owner"), mentionUser(server.owner), true)
        .field(tr("commands.serverinfo.desc"), (server.description || tr("common.none")).slice(0, 500), false);
      await i.editReply({ embeds: [embed] });
    } catch {
      await i.editReply(tr("common.error"));
    }
  });

  async function replyUserInfo(i, targetId) {
    const { t: tr } = guildT(i.serverId, i.locale);
    await i.defer();
    try {
      const user = await client.rest.get(`/users/${targetId}`);
      const member = await client.rest.get(`/servers/${i.serverId}/members/${targetId}`).catch(() => null);
      const avatar = await userAvatarUrl(client, user);
      const embed = baseEmbed(BRAND.colour.info)
        .title(user.display_name || user.username)
        .field(tr("commands.userinfo.id"), user._id, true)
        .field(tr("commands.userinfo.joined"), member?.joined_at?.slice(0, 19) || tr("common.none"), true)
        .field(tr("commands.userinfo.roles"), String(member?.roles?.length ?? 0), true);
      if (avatar) embed.icon(avatar);
      await i.editReply({ embeds: [embed] });
    } catch {
      await i.editReply(tr("common.error"));
    }
  }

  client.command("userinfo", (i) => replyUserInfo(i, i.option("user") ?? userId(i.user)));
  client.command("User Info", (i) => replyUserInfo(i, i.targetId));

  client.command("avatar", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const target = i.option("user") ?? userId(i.user);
    try {
      const user = await client.rest.get(`/users/${target}`);
      const avatar = await userAvatarUrl(client, user);
      if (!avatar) {
        return i.reply({ content: tr("commands.avatar.none") });
      }
      const embed = baseEmbed(BRAND.colour.info)
        .title(user.display_name || user.username)
        .toJSON();
      embed.image_url = avatar;
      await i.reply({ embeds: [embed] });
    } catch {
      await i.reply({ content: tr("common.error"), ephemeral: true });
    }
  });

  client.command("Quote", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    await i.defer({ ephemeral: true });
    try {
      const msg = await client.messages.fetch(i.channelId, i.targetId);
      await i.editReply({
        embeds: [
          baseEmbed(BRAND.colour.mute)
            .title(tr("commands.quote.title"))
            .description((msg.content || tr("commands.quote.empty")).slice(0, 2000))
            .footer(tr("commands.quote.from", { author: msg.author })),
        ],
      });
    } catch {
      await i.editReply(tr("commands.quote.fail"));
    }
  });

  client.command("poll", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const options = String(i.option("options"))
      .split(/[,،]/)
      .map((o) => o.trim())
      .filter(Boolean)
      .slice(0, 5);
    if (options.length < 2) {
      return i.reply({ content: tr("commands.poll.needTwo"), ephemeral: true });
    }
    const id = i.id;
    polls.set(id, { question: i.option("question"), options, votes: new Map(), serverId: i.serverId });
    await i.reply(renderPoll(id, tr));
  });

  client.component(/^sanad:poll:[0-9A-HJKMNP-TV-Z]{26}:\d$/, async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const parts = i.customId.split(":");
    const id = parts[2];
    const index = Number(parts[3]);
    const poll = polls.get(id);
    if (!poll) return i.reply({ content: tr("commands.poll.ended"), ephemeral: true });
    poll.votes.set(userId(i.user), index);
    await i.update(renderPoll(id, tr));
  });

  client.command("announce", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const channelId = i.option("channel") || i.channelId;
    await client.send(channelId, {
      embeds: [
        new EmbedBuilder()
          .title(tr("commands.announce.title"))
          .description(i.option("text"))
          .colour(BRAND.colour.primary)
          .footer(tr("commands.announce.by", { user: i.user.username })),
      ],
    });
    await i.reply({ content: tr("commands.announce.done"), ephemeral: true });
  });

  client.command("embed", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const channelId = i.option("channel") || i.channelId;
    await client.send(channelId, {
      embeds: [
        new EmbedBuilder()
          .title(i.option("title"))
          .description(i.option("description"))
          .colour(i.option("colour") || BRAND.colour.primary),
      ],
    });
    await i.reply({ content: tr("commands.embed.done"), ephemeral: true });
  });

  client.command("say", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    await client.send(i.channelId, i.option("text"));
    await i.reply({ content: tr("commands.say.done"), ephemeral: true });
  });

  client.command("suggest", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const cfg = getGuild(i.serverId);
    const channelId = cfg.suggest.channelId || i.channelId;
    await client.send(channelId, {
      embeds: [
        baseEmbed(BRAND.colour.info)
          .title(tr("commands.suggest.title"))
          .description(i.option("idea"))
          .field(tr("commands.suggest.from"), mentionUser(userId(i.user)), true),
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("sanad:suggest:up")
            .setLabel(tr("commands.suggest.yes"))
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId("sanad:suggest:down")
            .setLabel(tr("commands.suggest.no"))
            .setStyle(ButtonStyle.Danger),
        ),
      ],
    });
    await i.reply({ content: tr("commands.suggest.sent"), ephemeral: true });
  });

  const suggestVotes = new Map();
  client.component("sanad:suggest:", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const key = `${i.messageId}:${userId(i.user)}`;
    const up = i.customId.endsWith("up");
    suggestVotes.set(key, up ? 1 : -1);
    const related = [...suggestVotes.entries()].filter(([k]) => k.startsWith(`${i.messageId}:`));
    const yes = related.filter(([, v]) => v === 1).length;
    const no = related.filter(([, v]) => v === -1).length;
    await i.reply({
      content: tr("commands.suggest.vote", { yes, no }),
      ephemeral: true,
    });
  });

  client.command("autorespond", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    if (i.subcommand === "list") {
      const list = getGuild(i.serverId).autoresponders;
      if (!list.length) return i.reply({ content: tr("commands.autorespond.empty"), ephemeral: true });
      return i.reply({
        content: list.map((a) => `• \`${a.trigger}\` → ${a.response}`).join("\n").slice(0, 1900),
        ephemeral: true,
      });
    }
    if (i.subcommand === "remove") {
      const trigger = String(i.option("trigger")).toLowerCase();
      updateGuild(i.serverId, (c) => {
        c.autoresponders = c.autoresponders.filter((a) => a.trigger !== trigger);
      });
      return i.reply({ content: tr("commands.autorespond.removed"), ephemeral: true });
    }
    updateGuild(i.serverId, (c) => {
      const trigger = String(i.option("trigger")).toLowerCase();
      c.autoresponders = c.autoresponders.filter((a) => a.trigger !== trigger);
      c.autoresponders.push({
        trigger,
        response: i.option("response"),
        exact: !!i.option("exact"),
      });
    });
    await i.reply({ content: tr("commands.autorespond.added"), ephemeral: true });
  });

  client.command("rolemenu", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const roles = ["role1", "role2", "role3", "role4", "role5"]
      .map((n) => i.option(n))
      .filter(Boolean)
      .map((id) => ({ id, name: i.resolved.roles?.[id]?.name ?? id }));
    await i.reply({
      content: tr("commands.rolemenu.pick"),
      components: [
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("sanad:roles:pick")
            .setPlaceholder(tr("commands.rolemenu.placeholder"))
            .setMinValues(0)
            .setMaxValues(roles.length)
            .addOptions(roles.map((r) => ({ label: r.name.slice(0, 80), value: r.id }))),
        ),
      ],
    });
  });

  client.component("sanad:roles:pick", async (i) => {
    const { t: tr, locale } = guildT(i.serverId, i.locale);
    if (!i.has(Permissions.AssignRoles, "app")) {
      return i.reply({ content: tr("commands.rolemenu.noPerm"), ephemeral: true });
    }
    await i.defer({ ephemeral: true });

    const offered = extractRoleMenuOptions(i.message) || i.values;
    const offeredSet = new Set(offered);
    const chosen = i.values.filter((v) => offeredSet.has(v));
    const uid = userId(i.user);

    try {
      // members.fetch unwraps { member, roles } — raw REST was sending role objects and failing
      const member = await client.members.fetch(i.serverId, uid);
      const current = Array.isArray(member.roles) ? member.roles : [];
      const kept = current.filter((r) => !offeredSet.has(r));
      await client.members.edit(i.serverId, uid, { roles: [...kept, ...chosen] });
      await i.editReply(
        chosen.length ? tr("commands.rolemenu.updated") : tr("commands.rolemenu.cleared"),
      );
    } catch (error) {
      console.warn("[sanad:rolemenu]", error?.type || error?.message || error);
      const { explain } = await import("../util/errors.js");
      await i.editReply(explain(error, locale) || tr("commands.rolemenu.fail"));
    }
  });

  // giveaways — professional panel + participants pagination + disk persist
  const giveaways = new Map();
  const GW_PAGE = 15;
  const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

  /** Approximate account creation from Zrzur/ULID user id */
  function accountAgeDays(uid) {
    try {
      const s = String(uid || "")
        .slice(0, 10)
        .toUpperCase();
      if (s.length < 10) return null;
      let t = 0n;
      for (const c of s) {
        const i = CROCKFORD.indexOf(c);
        if (i < 0) return null;
        t = t * 32n + BigInt(i);
      }
      const created = Number(t);
      if (!Number.isFinite(created) || created <= 0) return null;
      return Math.floor((Date.now() - created) / 86_400_000);
    } catch {
      return null;
    }
  }

  function persistGiveaway(id, g) {
    setGiveaway(id, {
      prize: g.prize,
      description: g.description || null,
      winners: g.winners,
      endsAt: g.endsAt,
      channelId: g.channelId,
      serverId: g.serverId,
      host: g.host,
      minAccountDays: g.minAccountDays || 0,
      entrants: [...g.entrants],
    });
  }

  function giveawayEmbed(tr, g, { ended = false, winnersText = null } = {}) {
    const ends = Math.floor(g.endsAt / 1000);
    const descParts = [
      g.description || tr("commands.giveaway.defaultDesc"),
      "",
      tr("commands.giveaway.clickBelow"),
    ];
    if (g.minAccountDays > 0) {
      descParts.push(tr("commands.giveaway.minAgeLine", { days: g.minAccountDays }));
    }
    const embed = baseEmbed(ended ? BRAND.colour.mute : BRAND.colour.giveaway, brandFooter(tr))
      .title(tr("commands.giveaway.titleEmoji", { prize: g.prize }))
      .description(descParts.join("\n"))
      .field(tr("commands.giveaway.winnersField"), String(g.winners), true)
      .field(tr("commands.giveaway.hostField"), mentionUser(g.host), true)
      .field(
        tr("commands.giveaway.endsField"),
        ended ? tr("commands.giveaway.endedTitle") : `<t:${ends}:R>`,
        true,
      )
      .field(tr("commands.giveaway.entrantsField"), String(g.entrants?.size ?? 0), true);
    if (winnersText) embed.field(tr("commands.giveaway.resultField"), winnersText, false);
    return embed;
  }

  function giveawayButtons(tr, g, { ended = false } = {}) {
    if (ended) return [];
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("sanad:gw:join")
          .setLabel(tr("commands.giveaway.join").slice(0, 80))
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("sanad:gw:list")
          .setLabel(tr("commands.giveaway.participantsBtn").slice(0, 80))
          .setStyle(ButtonStyle.Secondary),
      ),
    ];
  }

  function hydrateGiveaway(id, raw) {
    const g = {
      prize: raw.prize,
      description: raw.description || null,
      winners: raw.winners || 1,
      endsAt: raw.endsAt,
      channelId: raw.channelId,
      serverId: raw.serverId,
      host: raw.host,
      minAccountDays: raw.minAccountDays || 0,
      entrants: new Set(raw.entrants || []),
      done: false,
    };
    giveaways.set(id, g);
    const wait = Math.max(1_000, (raw.endsAt || 0) - Date.now());
    setTimeout(() => finishGiveaway(client, id, g, g.serverId), wait);
    return g;
  }

  for (const [id, raw] of Object.entries(getGiveaways())) {
    if (raw?.endsAt && raw.channelId) hydrateGiveaway(id, raw);
  }

  async function refreshGiveawayMessage(id, g, tr) {
    await client
      .editMessage(g.channelId, id, {
        embeds: [giveawayEmbed(tr, g)],
        components: giveawayButtons(tr, g),
      })
      .catch(() => {});
  }

  function participantsPayload(tr, g, gwId, page) {
    const list = [...g.entrants];
    const pages = Math.max(1, Math.ceil(list.length / GW_PAGE) || 1);
    const p = Math.min(Math.max(0, page), pages - 1);
    const slice = list.slice(p * GW_PAGE, p * GW_PAGE + GW_PAGE);
    const lines = slice.length
      ? slice.map((id, n) => `**${p * GW_PAGE + n + 1}.** ${mentionUser(id)}`).join("\n")
      : tr("commands.giveaway.noParticipantsYet");
    const embed = baseEmbed(BRAND.colour.info, brandFooter(tr))
      .title(tr("commands.giveaway.participantsTitle", { count: list.length, page: p + 1, pages }))
      .description(lines);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`sanad:gw:page:${gwId}:${p - 1}`)
        .setLabel("◀")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(p <= 0),
      new ButtonBuilder()
        .setCustomId(`sanad:gw:page:${gwId}:${p + 1}`)
        .setLabel("▶")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(p >= pages - 1),
    );
    return { embeds: [embed], components: list.length ? [row] : [], ephemeral: true };
  }

  client.command("giveaway", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    if (i.subcommand === "end") {
      const id = i.option("message_id");
      const g = giveaways.get(id);
      if (!g) return i.reply({ content: tr("commands.giveaway.notFound"), ephemeral: true });
      await finishGiveaway(client, id, g, i.serverId);
      return i.reply({ content: tr("commands.giveaway.ended"), ephemeral: true });
    }

    const prize = i.option("prize");
    const minutes = i.option("minutes");
    const winners = i.option("winners") || 1;
    const description = i.option("description") || null;
    const minAccountDays = i.option("min_account_days") || 0;
    const endsAt = Date.now() + minutes * 60_000;
    const host = userId(i.user);
    const draft = {
      prize,
      description,
      winners,
      endsAt,
      channelId: i.channelId,
      serverId: i.serverId,
      entrants: new Set(),
      host,
      minAccountDays,
    };
    const msg = await client.send(i.channelId, {
      embeds: [giveawayEmbed(tr, draft)],
      components: giveawayButtons(tr, draft),
    });
    const id = msg.id ?? msg._id;
    giveaways.set(id, draft);
    persistGiveaway(id, draft);
    setTimeout(() => finishGiveaway(client, id, draft, i.serverId), minutes * 60_000);
    await i.reply({ content: tr("commands.giveaway.started"), ephemeral: true });
  });

  client.component("sanad:gw:join", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const g = giveaways.get(i.messageId);
    if (!g || g.done) {
      return i.reply({ content: tr("commands.giveaway.alreadyEnded"), ephemeral: true });
    }
    const uid = userId(i.user);
    if (g.entrants.has(uid)) {
      return i.reply({
        content: tr("commands.giveaway.alreadyJoined", { count: g.entrants.size }),
        ephemeral: true,
      });
    }
    if (g.minAccountDays > 0) {
      const age = accountAgeDays(uid);
      if (age != null && age < g.minAccountDays) {
        return i.reply({
          content: tr("commands.giveaway.tooYoung", { days: g.minAccountDays, age }),
          ephemeral: true,
        });
      }
    }
    g.entrants.add(uid);
    persistGiveaway(i.messageId, g);
    await refreshGiveawayMessage(i.messageId, g, tr);
    await i.reply({
      content: tr("commands.giveaway.joined", { count: g.entrants.size }),
      ephemeral: true,
    });
  });

  client.component("sanad:gw:list", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const g = giveaways.get(i.messageId);
    if (!g) return i.reply({ content: tr("commands.giveaway.alreadyEnded"), ephemeral: true });
    await i.reply(participantsPayload(tr, g, i.messageId, 0));
  });

  client.component("sanad:gw:page:", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const parts = String(i.customId || "").split(":");
    // sanad:gw:page:{gwId}:{page}
    const gwId = parts[3];
    const page = Number(parts[4]);
    const g = giveaways.get(gwId);
    if (!g) return i.reply({ content: tr("commands.giveaway.alreadyEnded"), ephemeral: true });
    const payload = participantsPayload(tr, g, gwId, Number.isFinite(page) ? page : 0);
    try {
      await i.update(payload);
    } catch {
      await i.reply(payload);
    }
  });

  async function finishGiveaway(client, id, g, serverId) {
    if (g.done) return;
    g.done = true;
    const { t: tr } = guildT(serverId || g.serverId);
    const pool = [...g.entrants];
    const picked = [];
    while (picked.length < g.winners && pool.length) {
      const idx = Math.floor(Math.random() * pool.length);
      picked.push(pool.splice(idx, 1)[0]);
    }
    const winnersText = picked.length
      ? tr("commands.giveaway.winners", { prize: g.prize, list: picked.map(mentionUser).join(", ") })
      : tr("commands.giveaway.noEntrants", { prize: g.prize });
    await client.send(g.channelId, winnersText).catch(() => {});
    await client
      .editMessage(g.channelId, id, {
        embeds: [giveawayEmbed(tr, g, { ended: true, winnersText })],
        components: [],
      })
      .catch(() => {});
    giveaways.delete(id);
    setGiveaway(id, null);
  }

  // reminders
  client.command("reminder", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const { parseDuration } = await import("../util/format.js");
    const seconds = parseDuration(i.option("when"));
    if (!seconds || seconds < 10) {
      return i.reply({ content: tr("commands.reminder.badTime"), ephemeral: true });
    }
    const text = i.option("text");
    await i.reply({ content: tr("commands.reminder.set", { seconds }), ephemeral: true });
    setTimeout(() => {
      client.users
        .sendDM(userId(i.user), tr("commands.reminder.fire", { text }))
        .catch(() =>
          client
            .send(i.channelId, `${mentionUser(userId(i.user))} ${tr("commands.reminder.fire", { text })}`)
            .catch(() => {}),
        );
    }, seconds * 1000);
  });

  registry.register({
    name: "suggest",
    slash: false,
    aliases: ["اقتراح"],
    async execute(ctx) {
      const idea = ctx.rawArgs?.trim();
      if (!idea) return ctx.reply(ctx.t("commands.suggest.options.idea"));
      const cfg = getGuild(ctx.serverId);
      const channelId = cfg.suggest.channelId || ctx.channelId;
      await ctx.client.send(channelId, {
        embeds: [
          baseEmbed(BRAND.colour.info)
            .title(ctx.t("commands.suggest.title"))
            .description(idea)
            .field(ctx.t("commands.suggest.from"), mentionUser(ctx.userId), true),
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("sanad:suggest:up")
              .setLabel(ctx.t("commands.suggest.yes"))
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId("sanad:suggest:down")
              .setLabel(ctx.t("commands.suggest.no"))
              .setStyle(ButtonStyle.Danger),
          ),
        ],
      });
      return ctx.reply(ctx.t("commands.suggest.sent"));
    },
  });

  registry.register({
    name: "poll",
    slash: false,
    aliases: ["تصويت"],
    permission: Permissions.ManageMessages,
    async execute(ctx) {
      const raw = ctx.rawArgs || "";
      const pipe = raw.includes("|") ? raw.split("|") : raw.split(/\s+/);
      const question = (pipe[0] || "").trim();
      const options = pipe
        .slice(1)
        .join(" ")
        .split(/[,،]/)
        .map((o) => o.trim())
        .filter(Boolean)
        .slice(0, 5);
      if (!question || options.length < 2) {
        return ctx.reply(ctx.t("commands.poll.needTwo"));
      }
      const id = fakeUlid();
      polls.set(id, { question, options, votes: new Map(), serverId: ctx.serverId });
      return ctx.reply(renderPoll(id, ctx.t));
    },
  });

  registry.register({
    name: "giveaway",
    slash: false,
    aliases: ["سحب", "gw"],
    permission: Permissions.ManageMessages,
    async execute(ctx) {
      // !giveaway prize | 30m | 1
      const parts = (ctx.rawArgs || "").split("|").map((s) => s.trim()).filter(Boolean);
      const prize = parts[0];
      const minutes = Math.max(1, Math.floor((parseDuration(parts[1] || "30m") || 1800) / 60));
      const winners = Math.max(1, Number(parts[2]) || 1);
      if (!prize) return ctx.reply(ctx.t("commands.giveaway.prefixUsage"));
      const endsAt = Date.now() + minutes * 60_000;
      const draft = {
        prize,
        description: null,
        winners,
        endsAt,
        channelId: ctx.channelId,
        serverId: ctx.serverId,
        entrants: new Set(),
        host: ctx.userId,
        minAccountDays: 0,
      };
      const msg = await ctx.client.send(ctx.channelId, {
        embeds: [giveawayEmbed(ctx.t, draft)],
        components: giveawayButtons(ctx.t, draft),
      });
      const id = msg.id ?? msg._id;
      giveaways.set(id, draft);
      persistGiveaway(id, draft);
      setTimeout(() => finishGiveaway(ctx.client, id, draft, ctx.serverId), minutes * 60_000);
      return ctx.reply(ctx.t("commands.giveaway.started"));
    },
  });
}

function renderPoll(id, tr) {
  const poll = polls.get(id);
  const counts = poll.options.map((_, index) => [...poll.votes.values()].filter((v) => v === index).length);
  const total = counts.reduce((a, b) => a + b, 0);
  const lines = poll.options.map((option, index) => {
    const share = total ? Math.round((counts[index] / total) * 100) : 0;
    return `**${option}**: ${counts[index]} (${share}%)`;
  });
  const votesLabel = tr
    ? tr("commands.poll.votes", { count: total })
    : `${total}`;
  return {
    content: `**${poll.question}**\n${lines.join("\n")}\n${votesLabel}`,
    components: [
      new ActionRowBuilder().addComponents(
        ...poll.options.map((option, index) =>
          new ButtonBuilder()
            .setCustomId(`sanad:poll:${id}:${index}`)
            .setLabel(option.slice(0, 80))
            .setStyle(ButtonStyle.Secondary),
        ),
      ),
    ],
  };
}

export async function handleAutorespond(client, message) {
  let serverId = message.server;
  if (!serverId) {
    try {
      const ch = await client.rest.get(`/channels/${message.channel}`);
      serverId = ch.server;
    } catch {
      return;
    }
  }
  if (!serverId || !message.content) return;
  const cfg = getGuild(serverId);
  const text = message.content.toLowerCase();
  for (const rule of cfg.autoresponders) {
    const hit = rule.exact ? text === rule.trigger : text.includes(rule.trigger);
    if (hit) {
      await client.messages.reply(message, rule.response).catch(() => {});
      break;
    }
  }
}
