import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  LabelBuilder,
  ModalBuilder,
  Permissions,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} from "@zrzur/sdk/bot";
import { BRAND, mentionRole, mentionUser, userId } from "../brand.js";
import { t } from "../core/i18n.js";
import { registry } from "../core/registry.js";
import { actorHas } from "../util/permissions.js";
import {
  findTicketServerByChannel,
  getGuild,
  getOpenTickets,
  saveOpenTickets,
  updateGuild,
} from "../db/store.js";
import { guildT } from "../util/locale.js";

const ticketsFile = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "tickets.json");

const IN_TICKET =
  Permissions.ViewChannel |
  Permissions.ReadMessageHistory |
  Permissions.SendMessage |
  Permissions.UploadFiles |
  Permissions.React;

const reminderTimers = new Map();
const pingCooldown = new Map();
const PING_COOLDOWN_MS = 60_000;
const CLOSE_DELETE_MS = 3500;

function defaultTopics(locale) {
  const raw = t(locale === "ar" ? "ar" : "en", "commands.ticket.defaultTopics");
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string" && raw.includes("|")) {
    return raw.split("|").map((s) => s.trim()).filter(Boolean);
  }
  return locale === "ar"
    ? ["دعم عام", "تبليغ", "اقتراح", "أخرى"]
    : ["General support", "Report", "Suggestion", "Other"];
}

function isStaff(i, cfg) {
  const role = cfg.tickets.staffRoleId || cfg.staffRoleId;
  if (role) {
    return Boolean(i.member?.roles?.includes(role)) || actorHas(i, Permissions.ManageServer);
  }
  return actorHas(i, Permissions.ManageMessages) || actorHas(i, Permissions.ManageChannel);
}

function isOwner(i, ticket) {
  return ticket && userId(i.user) === ticket.owner;
}

function canManage(i, cfg, ticket) {
  return isOwner(i, ticket) || isStaff(i, cfg);
}

function topicsFor(cfg, locale) {
  const stockEn = ["General support", "Report", "Suggestion", "Other"];
  const stockAr = ["دعم عام", "تبليغ", "اقتراح", "أخرى"];
  const list = cfg.tickets.topics?.length ? cfg.tickets.topics : null;
  const isStock =
    Array.isArray(list) &&
    ((list.length === stockAr.length && list.every((topic, i) => topic === stockAr[i])) ||
      (list.length === stockEn.length && list.every((topic, i) => topic === stockEn[i])));
  if (!list || isStock) return defaultTopics(locale).slice(0, 25);
  return list.slice(0, 25);
}

function formatAge(iso, locale) {
  if (!iso) return "—";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const m = Math.floor(ms / 60_000);
  if (m < 1) return locale === "ar" ? "الآن" : "just now";
  if (m < 60) return locale === "ar" ? `${m}د` : `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return locale === "ar" ? `${h}س` : `${h}h`;
  const d = Math.floor(h / 24);
  return locale === "ar" ? `${d}ي` : `${d}d`;
}

function parseReminderMs(raw) {
  const text = String(raw || "").trim().toLowerCase();
  const match = text.match(/^(\d+)\s*(s|sec|m|min|h|hr|d|ث|د|س|ي)?/);
  if (!match) return null;
  const n = Number(match[1]);
  const u = match[2] || "h";
  let ms = n * 3600_000;
  if (["s", "sec", "ث"].includes(u)) ms = n * 1000;
  else if (["m", "min", "د"].includes(u)) ms = n * 60_000;
  else if (["h", "hr", "س"].includes(u)) ms = n * 3600_000;
  else if (["d", "ي"].includes(u)) ms = n * 86400_000;
  return Math.min(Math.max(ms, 60_000), 7 * 86400_000);
}

function normalizeMessages(raw) {
  const list = Array.isArray(raw) ? raw : raw?.messages || [];
  return [...list].reverse();
}

function parseUserToken(arg) {
  if (!arg) return null;
  return (
    String(arg).match(/^<@!?([0-9A-HJKMNP-TV-Z]{26})>$/i)?.[1] ||
    String(arg).match(/^([0-9A-HJKMNP-TV-Z]{26})$/i)?.[1] ||
    null
  );
}

function findUserTicket(open, uid) {
  return Object.entries(open).find(([, ticket]) => ticket.owner === uid) || null;
}

function clearReminderTimer(serverId, channelId) {
  const key = `${serverId}:${channelId}`;
  const timer = reminderTimers.get(key);
  if (timer) clearTimeout(timer);
  reminderTimers.delete(key);
}

function scheduleTicketReminder(client, serverId, channelId, ticket, persist = true) {
  clearReminderTimer(serverId, channelId);
  const raw = String(ticket.reminder || "").trim();
  if (!raw) {
    ticket.reminderAt = null;
    if (persist) {
      const open = getOpenTickets(serverId);
      if (open[channelId]) {
        open[channelId].reminder = "";
        open[channelId].reminderAt = null;
        saveOpenTickets(serverId, open);
      }
    }
    return { ok: true, cleared: true };
  }

  let fireAt = ticket.reminderAt ? Date.parse(ticket.reminderAt) : NaN;
  if (!Number.isFinite(fireAt)) {
    const ms = parseReminderMs(raw);
    if (!ms) return { ok: false, badFormat: true };
    fireAt = Date.now() + ms;
    ticket.reminderAt = new Date(fireAt).toISOString();
  }

  if (persist) {
    const open = getOpenTickets(serverId);
    if (open[channelId]) {
      open[channelId].reminder = raw;
      open[channelId].reminderAt = ticket.reminderAt;
      saveOpenTickets(serverId, open);
    }
  }

  const delay = Math.max(1_000, fireAt - Date.now());
  const key = `${serverId}:${channelId}`;
  const timer = setTimeout(() => {
    reminderTimers.delete(key);
    const open = getOpenTickets(serverId);
    const current = open[channelId];
    if (!current) return;
    const { t: tr } = guildT(serverId);
    client
      .send(channelId, {
        content: tr("commands.ticket.reminderFire", {
          user: mentionUser(current.owner),
          text: current.reminder || raw,
        }),
      })
      .catch(() => {});
    current.reminderAt = null;
    saveOpenTickets(serverId, open);
  }, delay);
  if (typeof timer.unref === "function") timer.unref();
  reminderTimers.set(key, timer);
  return { ok: true };
}

/** Resume durable reminders after process restart. */
export function resumeTicketReminders(client) {
  try {
    if (!existsSync(ticketsFile)) return;
    const db = JSON.parse(readFileSync(ticketsFile, "utf8"));
    for (const [serverId, map] of Object.entries(db || {})) {
      for (const [channelId, ticket] of Object.entries(map || {})) {
        if (ticket?.reminder || ticket?.reminderAt) {
          scheduleTicketReminder(client, serverId, channelId, ticket, false);
        }
      }
    }
  } catch (error) {
    console.warn("[sanad:ticket] resume reminders:", error?.message || error);
  }
}

export async function postTicketOpenPanel(client, channelId, tr) {
  await client.send(channelId, {
    embeds: [
      new EmbedBuilder()
        .title(tr("commands.ticket.panelTitle"))
        .description(tr("commands.ticket.panelBody"))
        .colour(BRAND.colour.ticket)
        .footer(tr("commands.ticket.panelFooter")),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("sanad:ticket:open")
          .setLabel(tr("commands.ticket.openBtn"))
          .setStyle(ButtonStyle.Primary)
          .setEmoji("🎫"),
      ),
    ],
  });
}

function ticketEmbed(tr, ticket, locale = "en") {
  const details = String(ticket.details || tr("common.none")).slice(0, 1600);
  const participants = Array.isArray(ticket.participants) ? ticket.participants : [];
  const extras = participants.filter((id) => id !== ticket.owner && id !== ticket.claimedBy);
  const description = [
    `**${tr("commands.ticket.topicLabel")}** · ${ticket.topic || tr("common.none")}`,
    "",
    `**${tr("commands.ticket.detailsLabel")}**`,
    details,
  ].join("\n");

  const embed = new EmbedBuilder()
    .title(tr("commands.ticket.ticketTitle", { number: ticket.number, topic: ticket.topic }))
    .description(description)
    .field(tr("commands.ticket.openedBy"), mentionUser(ticket.owner), true)
    .field(
      tr("commands.ticket.claimedBy"),
      ticket.claimedBy ? mentionUser(ticket.claimedBy) : tr("commands.ticket.nobody"),
      true,
    )
    .field(
      tr("commands.ticket.status"),
      ticket.claimedBy ? tr("commands.ticket.statusClaimed") : tr("commands.ticket.statusOpen"),
      true,
    )
    .field(tr("commands.ticket.openedAgo"), formatAge(ticket.openedAt, locale), true)
    .field(
      tr("commands.ticket.reminder"),
      ticket.reminder ? String(ticket.reminder).slice(0, 80) : tr("commands.ticket.noReminder"),
      true,
    )
    .footer(tr("commands.ticket.footer"))
    .colour(ticket.claimedBy ? BRAND.colour.success : BRAND.colour.ticket)
    .timestamp(ticket.openedAt || undefined);

  if (extras.length) {
    embed.field(
      tr("commands.ticket.participants"),
      extras.slice(0, 8).map((id) => mentionUser(id)).join(" ") || tr("common.none"),
      false,
    );
  }
  if (ticket.closeReason) {
    embed.field(tr("commands.ticket.closeReason"), String(ticket.closeReason).slice(0, 200), false);
  }
  return embed;
}

function ticketButtons(tr, ticket) {
  const claimed = !!ticket.claimedBy;
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(claimed ? "sanad:ticket:unclaim" : "sanad:ticket:claim")
        .setLabel(claimed ? tr("commands.ticket.unclaim") : tr("commands.ticket.claim"))
        .setStyle(claimed ? ButtonStyle.Secondary : ButtonStyle.Success)
        .setEmoji(claimed ? "🔓" : "✋"),
      new ButtonBuilder()
        .setCustomId("sanad:ticket:info")
        .setLabel(tr("commands.ticket.infoBtn"))
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("ℹ️"),
      new ButtonBuilder()
        .setCustomId("sanad:ticket:reminder-btn")
        .setLabel(tr("commands.ticket.reminderBtn"))
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("⏰"),
      new ButtonBuilder()
        .setCustomId("sanad:ticket:ping")
        .setLabel(tr("commands.ticket.pingStaff"))
        .setStyle(ButtonStyle.Primary)
        .setEmoji("🔔"),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("sanad:ticket:rename")
        .setLabel(tr("commands.ticket.rename"))
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("✏️"),
      new ButtonBuilder()
        .setCustomId("sanad:ticket:add")
        .setLabel(tr("commands.ticket.addSomeone"))
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("➕"),
      new ButtonBuilder()
        .setCustomId("sanad:ticket:remove")
        .setLabel(tr("commands.ticket.removeSomeone"))
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("➖"),
      new ButtonBuilder()
        .setCustomId("sanad:ticket:close")
        .setLabel(tr("commands.ticket.close"))
        .setStyle(ButtonStyle.Danger)
        .setEmoji("🗑️"),
    ),
  ];
}

async function refreshTicketPanel(client, channelId, ticket, tr, locale) {
  if (!ticket?.messageId) return;
  await client
    .editMessage(channelId, ticket.messageId, {
      embeds: [ticketEmbed(tr, ticket, locale)],
      components: ticketButtons(tr, ticket),
    })
    .catch(() => {});
}

async function postTicketPanel(client, channelId, tr, ticket, staffRoleId, locale) {
  const payload = {
    embeds: [ticketEmbed(tr, ticket, locale)],
    components: ticketButtons(tr, ticket),
  };
  await new Promise((r) => setTimeout(r, 500));
  let message = null;
  try {
    message = await client.send(channelId, payload);
  } catch (error) {
    console.warn("[sanad:ticket] panel send:", error?.message || error);
    try {
      message = await client.send(channelId, {
        content: tr("commands.ticket.ticketTitle", {
          number: ticket.number,
          topic: ticket.topic,
        }),
        embeds: [ticketEmbed(tr, ticket, locale)],
      });
    } catch (error2) {
      console.warn("[sanad:ticket] panel fallback:", error2?.message || error2);
      message = await client.send(
        channelId,
        [
          `**${tr("commands.ticket.ticketTitle", { number: ticket.number, topic: ticket.topic })}**`,
          `${tr("commands.ticket.openedBy")}: ${mentionUser(ticket.owner)}`,
          `${tr("commands.ticket.detailsLabel")}:`,
          ticket.details || tr("common.none"),
        ].join("\n"),
      );
    }
  }

  await client
    .send(channelId, {
      embeds: [
        new EmbedBuilder()
          .title(tr("commands.ticket.welcomeTitle"))
          .description(tr("commands.ticket.welcomeBody"))
          .colour(BRAND.colour.info),
      ],
    })
    .catch(() => {});

  const pingBits = [mentionUser(ticket.owner)];
  if (staffRoleId) pingBits.push(mentionRole(staffRoleId));
  await client
    .send(channelId, {
      content: tr("commands.ticket.openPing", { mentions: pingBits.join(" ") }),
    })
    .catch(() => {});

  return message;
}

async function safePerm(fn) {
  try {
    await fn();
    return true;
  } catch (error) {
    if (error?.type === "NotElevated" || /NotElevated/i.test(String(error?.message || error))) return false;
    throw error;
  }
}

function cleanTicketByChannel(channelId) {
  try {
    const serverId = findTicketServerByChannel(channelId);
    if (!serverId) return;
    const mem = getOpenTickets(serverId);
    if (!mem[channelId]) return;
    delete mem[channelId];
    saveOpenTickets(serverId, mem);
    clearReminderTimer(serverId, channelId);
    pingCooldown.delete(channelId);
  } catch {
    /* ignore */
  }
}

async function buildTranscript(client, channelId, ticket, tr) {
  const raw = await client.messages.fetchMany(channelId, { limit: 100 });
  const messages = normalizeMessages(raw);
  const lines = messages.map((m) => {
    const ts = m.created_at || m.createdAt || m.timestamp || "";
    const stamp = ts ? String(ts).slice(0, 19) : "";
    const body = [m.content, ...(m.embeds ?? []).map((e) => e.title || e.description || "")]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    return `[${stamp}] ${m.author || "?"}: ${body || "(attachment/embed)"}`;
  });
  const header = [
    `Sanad ticket #${ticket.number}`,
    `Topic: ${ticket.topic}`,
    `Owner: ${ticket.owner}`,
    `Claimed: ${ticket.claimedBy || "—"}`,
    `Opened: ${ticket.openedAt || "—"}`,
    `Closed: ${new Date().toISOString()}`,
    `Reason: ${ticket.closeReason || "—"}`,
    "",
  ].join("\n");
  const text = `${header}${lines.join("\n")}\n`;
  return {
    name: `ticket-${ticket.number}.txt`,
    data: new TextEncoder().encode(text),
    type: "text/plain",
    lines: lines.length,
    text,
  };
}

export function ticketCommands() {
  return [
    new SlashCommandBuilder("ticket", t("en", "commands.ticket.description"))
      .describe({
        en: t("en", "commands.ticket.description"),
        ar: t("ar", "commands.ticket.description"),
      })
      .subcommand("panel", t("en", "commands.ticket.panel"))
      .subcommand("list", t("en", "commands.ticket.listCmd"))
      .subcommand("close", t("en", "commands.ticket.closeCmd"), (s) =>
        s.string("reason", t("en", "commands.ticket.options.reason"), {
          maxLength: 200,
          descriptions: { ar: t("ar", "commands.ticket.options.reason") },
        }),
      )
      .subcommand("add", t("en", "commands.ticket.addCmd"), (s) =>
        s.user("user", t("en", "common.user"), { required: true }),
      )
      .subcommand("remove", t("en", "commands.ticket.removeCmd"), (s) =>
        s.user("user", t("en", "common.user"), { required: true }),
      )
      .subcommand("claim", t("en", "commands.ticket.claimCmd"))
      .subcommand("unclaim", t("en", "commands.ticket.unclaimCmd"))
      .subcommand("info", t("en", "commands.ticket.infoCmd")),
  ];
}

export function registerTickets(client) {
  client.on("ChannelDelete", (packet) => {
    if (packet?.id) cleanTicketByChannel(packet.id);
  });

  // Resume durable reminders once per process (main bot)
  if (!globalThis.__sanadTicketRemindersResumed) {
    globalThis.__sanadTicketRemindersResumed = true;
    setTimeout(() => {
      resumeTicketReminders(client);
    }, 2000);
  }

  client.command("ticket", async (i) => {
    const { t: tr, locale } = guildT(i.serverId, i.locale);
    const cfg = getGuild(i.serverId);
    if (!cfg.tickets.enabled) {
      return i.reply({ content: tr("commands.ticket.disabled"), ephemeral: true });
    }

    if (i.subcommand === "panel") {
      if (!actorHas(i, Permissions.ManageChannel)) {
        return i.reply({ content: tr("common.noPermission"), ephemeral: true });
      }
      await postTicketOpenPanel(client, i.channelId, tr);
      return i.reply({ content: tr("commands.ticket.panelPosted"), ephemeral: true });
    }

    if (i.subcommand === "list") {
      if (!isStaff(i, cfg)) {
        return i.reply({ content: tr("commands.ticket.staffOnly"), ephemeral: true });
      }
      return i.reply({ embeds: [listTicketsEmbed(i.serverId, tr, locale)], ephemeral: true });
    }

    if (i.subcommand === "close") {
      return closeTicket(client, i, i.channelId, {
        fromButton: false,
        reason: i.option("reason") || "",
      });
    }
    if (i.subcommand === "claim") return claimTicket(client, i, false);
    if (i.subcommand === "unclaim") return unclaimTicket(client, i, false);
    if (i.subcommand === "info") {
      const ticket = getOpenTickets(i.serverId)[i.channelId];
      if (!ticket) return i.reply({ content: tr("commands.ticket.notTicket"), ephemeral: true });
      return i.reply({ embeds: [ticketEmbed(tr, ticket, locale)], ephemeral: true });
    }

    if (i.subcommand === "add") {
      return addParticipant(client, i, i.option("user"), false);
    }
    if (i.subcommand === "remove") {
      return removeParticipant(client, i, i.option("user"), false);
    }
  });

  client.component("sanad:ticket:open", async (i) => {
    const { t: tr, locale } = guildT(i.serverId, i.locale);
    const cfg = getGuild(i.serverId);
    if (!cfg.tickets.enabled) {
      return i.reply({ content: tr("commands.ticket.disabled"), ephemeral: true });
    }
    const existing = findUserTicket(getOpenTickets(i.serverId), userId(i.user));
    if (existing) {
      return i.reply({
        content: tr("commands.ticket.alreadyOpen", { channel: `<#${existing[0]}>` }),
        ephemeral: true,
      });
    }

    const topics = topicsFor(cfg, locale);
    try {
      await i.showModal(
        new ModalBuilder()
          .setCustomId("sanad:ticket:form")
          .setTitle(tr("commands.ticket.formTitle"))
          .addLabelComponents(
            new LabelBuilder().setLabel(tr("commands.ticket.topicLabel")).setStringSelectMenuComponent(
              new StringSelectMenuBuilder()
                .setCustomId("topic")
                .addOptions(topics.map((name) => ({ label: name.slice(0, 80), value: name.slice(0, 100) }))),
            ),
            new LabelBuilder()
              .setLabel(tr("commands.ticket.detailsLabel"))
              .setTextInputComponent((input) =>
                input
                  .setCustomId("details")
                  .setStyle(TextInputStyle.Paragraph)
                  .setMinLength(5)
                  .setMaxLength(1000)
                  .setPlaceholder(tr("commands.ticket.detailsPlaceholder")),
              ),
            new LabelBuilder()
              .setLabel(tr("commands.ticket.reminderLabel"))
              .setTextInputComponent((input) =>
                input
                  .setCustomId("reminder")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setMaxLength(80)
                  .setPlaceholder(tr("commands.ticket.reminderPlaceholder")),
              ),
          ),
      );
    } catch (error) {
      if (/AlreadyAcknowledged|409/i.test(String(error?.message || error))) return;
      throw error;
    }
  });

  client.modal("sanad:ticket:form", async (i) => {
    const { t: tr, locale } = guildT(i.serverId, i.locale);
    const cfg = getGuild(i.serverId);
    if (!cfg.tickets.enabled) {
      return i.reply({ content: tr("commands.ticket.disabled"), ephemeral: true });
    }
    const open = getOpenTickets(i.serverId);
    const existing = findUserTicket(open, userId(i.user));
    if (existing) {
      return i.reply({
        content: tr("commands.ticket.alreadyOpen", { channel: `<#${existing[0]}>` }),
        ephemeral: true,
      });
    }

    await i.defer({ ephemeral: true });

    const again = getOpenTickets(i.serverId);
    const dup = findUserTicket(again, userId(i.user));
    if (dup) {
      return i.editReply(tr("commands.ticket.alreadyOpen", { channel: `<#${dup[0]}>` }));
    }

    const topic = i.fields.getStringSelectValues("topic")[0] || topicsFor(cfg, locale)[0];
    const details = i.fields.getTextInputValue("details") || topic;
    let reminder = "";
    try {
      reminder = i.fields.getTextInputValue("reminder") || "";
    } catch {
      reminder = "";
    }
    reminder = reminder.trim();
    if (reminder && !parseReminderMs(reminder)) {
      return i.editReply(tr("commands.ticket.reminderBadFormat"));
    }

    let number;
    updateGuild(i.serverId, (c) => {
      c.tickets.counter = (c.tickets.counter || 0) + 1;
      number = String(c.tickets.counter).padStart(4, "0");
    });

    try {
      let category = cfg.tickets.categoryId;
      if (category) {
        try {
          await client.rest.get(`/channels/${category}`);
        } catch {
          category = null;
        }
      }
      if (!category) {
        category = await client.servers.ensureCategory(i.serverId, "Tickets");
        updateGuild(i.serverId, (c) => {
          c.tickets.categoryId = category;
        });
      }

      const ownerName = String(i.user?.username || "user")
        .toLowerCase()
        .replace(/[^a-z0-9\u0600-\u06ff-_]/gi, "")
        .slice(0, 12);
      const channel = await client.channels.create(i.serverId, {
        name: `ticket-${number}${ownerName ? `-${ownerName}` : ""}`.slice(0, 40),
        description: tr("commands.ticket.channelDesc", { user: i.user.username }),
        category,
      });
      const id = channel._id;
      const botId = client.user.id ?? client.user._id;

      await safePerm(() =>
        client.channels.setMemberPermissions(
          id,
          botId,
          IN_TICKET | Permissions.ManageChannel | Permissions.ManagePermissions,
        ),
      );
      await safePerm(() => client.channels.setPermissions(id, "default", 0, Permissions.ViewChannel));
      const ownerOk = await safePerm(() =>
        client.channels.setMemberPermissions(id, userId(i.user), IN_TICKET),
      );
      if (!ownerOk) {
        await client.channels.delete(id).catch(() => {});
        return i.editReply(tr("commands.ticket.openFail", { error: tr("commands.ticket.staffPermWarn") }));
      }

      const staff = cfg.tickets.staffRoleId || cfg.staffRoleId;
      if (staff) {
        const ok = await safePerm(() =>
          client.channels.setPermissions(id, staff, IN_TICKET | Permissions.ManageMessages),
        );
        if (!ok) await client.send(id, { content: tr("commands.ticket.staffPermWarn") }).catch(() => {});
      }

      const ticket = {
        owner: userId(i.user),
        topic,
        details,
        reminder,
        reminderAt: null,
        number,
        claimedBy: null,
        claimedAt: null,
        participants: [userId(i.user)],
        serverId: i.serverId,
        openedAt: new Date().toISOString(),
      };

      again[id] = { ...ticket, messageId: null };
      saveOpenTickets(i.serverId, again);

      try {
        const message = await postTicketPanel(client, id, tr, ticket, staff, locale);
        const messageId = message?.id ?? message?._id ?? null;
        again[id] = { ...ticket, messageId };
        saveOpenTickets(i.serverId, again);
        if (reminder) scheduleTicketReminder(client, i.serverId, id, again[id]);
        await i.editReply(tr("commands.ticket.opened", { channel: `<#${id}>` }));
      } catch (panelError) {
        console.warn("[sanad:ticket] panel:", panelError?.message || panelError);
        delete again[id];
        saveOpenTickets(i.serverId, again);
        clearReminderTimer(i.serverId, id);
        await client.channels.delete(id).catch(() => {});
        throw panelError;
      }
    } catch (error) {
      console.warn("[sanad:ticket] open:", error?.message || error);
      const type = error?.type || error?.message || "error";
      const mapped =
        tr(`errors.${type}`) !== `errors.${type}` ? tr(`errors.${type}`) : tr("errors.fallback", { type });
      await i.editReply(tr("commands.ticket.openFail", { error: mapped }));
    }
  });

  client.component("sanad:ticket:claim", async (i) => {
    try {
      await claimTicket(client, i, true);
    } catch (error) {
      console.warn("[sanad:ticket] claim:", error?.message || error);
    }
  });

  client.component("sanad:ticket:info", async (i) => {
    const { t: tr, locale } = guildT(i.serverId, i.locale);
    const ticket = getOpenTickets(i.serverId)[i.channelId];
    if (!ticket) return i.reply({ content: tr("commands.ticket.notTicket"), ephemeral: true });
    return i.reply({
      ephemeral: true,
      embeds: [ticketEmbed(tr, ticket, locale)],
      content: tr("commands.ticket.controlsHint"),
    });
  });

  client.component("sanad:ticket:reminder-btn", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const cfg = getGuild(i.serverId);
    const ticket = getOpenTickets(i.serverId)[i.channelId];
    if (!ticket) return i.reply({ content: tr("commands.ticket.notTicket"), ephemeral: true });
    if (!canManage(i, cfg, ticket)) {
      return i.reply({ content: tr("commands.ticket.staffOrOwner"), ephemeral: true });
    }
    try {
      await i.showModal(
        new ModalBuilder()
          .setCustomId("sanad:ticket:reminder-form")
          .setTitle(tr("commands.ticket.reminderBtn"))
          .addLabelComponents(
            new LabelBuilder()
              .setLabel(tr("commands.ticket.reminderLabel"))
              .setTextInputComponent((input) =>
                input
                  .setCustomId("reminder")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setMaxLength(80)
                  .setPlaceholder(tr("commands.ticket.reminderPlaceholder"))
                  .setValue(ticket.reminder || ""),
              ),
          ),
      );
    } catch (error) {
      if (/AlreadyAcknowledged|409/i.test(String(error?.message || error))) return;
      throw error;
    }
  });

  client.modal("sanad:ticket:reminder-form", async (i) => {
    const { t: tr, locale } = guildT(i.serverId, i.locale);
    const cfg = getGuild(i.serverId);
    const open = getOpenTickets(i.serverId);
    const ticket = open[i.channelId];
    if (!ticket) return i.reply({ content: tr("commands.ticket.notTicket"), ephemeral: true });
    if (!canManage(i, cfg, ticket)) {
      return i.reply({ content: tr("commands.ticket.staffOrOwner"), ephemeral: true });
    }
    let reminder = "";
    try {
      reminder = (i.fields.getTextInputValue("reminder") || "").trim();
    } catch {
      reminder = "";
    }
    if (reminder && !parseReminderMs(reminder)) {
      return i.reply({ content: tr("commands.ticket.reminderBadFormat"), ephemeral: true });
    }
    ticket.reminder = reminder;
    ticket.reminderAt = null;
    const result = scheduleTicketReminder(client, i.serverId, i.channelId, ticket);
    await refreshTicketPanel(client, i.channelId, ticket, tr, locale);
    await i.reply({
      content: reminder
        ? tr("commands.ticket.reminderSet", { text: reminder })
        : tr("commands.ticket.reminderCleared"),
      ephemeral: true,
    });
    void result;
  });

  client.component("sanad:ticket:unclaim", async (i) => {
    try {
      await unclaimTicket(client, i, true);
    } catch (error) {
      console.warn("[sanad:ticket] unclaim:", error?.message || error);
    }
  });

  client.component("sanad:ticket:rename", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const cfg = getGuild(i.serverId);
    const ticket = getOpenTickets(i.serverId)[i.channelId];
    if (!ticket) return i.reply({ content: tr("commands.ticket.notTicket"), ephemeral: true });
    if (!isStaff(i, cfg)) return i.reply({ content: tr("commands.ticket.staffOnly"), ephemeral: true });
    try {
      await i.showModal(
        new ModalBuilder()
          .setCustomId("sanad:ticket:rename-form")
          .setTitle(tr("commands.ticket.renameTitle"))
          .addLabelComponents(
            new LabelBuilder()
              .setLabel(tr("commands.ticket.renameLabel"))
              .setTextInputComponent((input) =>
                input
                  .setCustomId("name")
                  .setStyle(TextInputStyle.Short)
                  .setMinLength(2)
                  .setMaxLength(40)
                  .setPlaceholder(`ticket-${ticket.number}`),
              ),
          ),
      );
    } catch (error) {
      if (/AlreadyAcknowledged|409/i.test(String(error?.message || error))) return;
      throw error;
    }
  });

  client.modal("sanad:ticket:rename-form", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const cfg = getGuild(i.serverId);
    const ticket = getOpenTickets(i.serverId)[i.channelId];
    if (!ticket) return i.reply({ content: tr("commands.ticket.notTicket"), ephemeral: true });
    if (!isStaff(i, cfg)) return i.reply({ content: tr("commands.ticket.staffOnly"), ephemeral: true });
    let name = (i.fields.getTextInputValue("name") || "").trim().toLowerCase().replace(/\s+/g, "-");
    name = name.replace(/[^a-z0-9\u0600-\u06ff-_]/gi, "").slice(0, 40);
    if (!name) return i.reply({ content: tr("common.error"), ephemeral: true });
    if (!name.startsWith("ticket-")) name = `ticket-${name}`;
    try {
      await client.channels.edit(i.channelId, { name });
      await i.reply({ content: tr("commands.ticket.renamed", { name }), ephemeral: true });
      await client.send(
        i.channelId,
        tr("commands.ticket.renameAnnounce", { name, user: mentionUser(userId(i.user)) }),
      );
    } catch {
      await i.reply({ content: tr("common.error"), ephemeral: true });
    }
  });

  client.component("sanad:ticket:ping", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const cfg = getGuild(i.serverId);
    const ticket = getOpenTickets(i.serverId)[i.channelId];
    if (!ticket) return i.reply({ content: tr("commands.ticket.notTicket"), ephemeral: true });
    if (!canManage(i, cfg, ticket)) {
      return i.reply({ content: tr("commands.ticket.staffOrOwner"), ephemeral: true });
    }
    const last = pingCooldown.get(i.channelId) || 0;
    const left = PING_COOLDOWN_MS - (Date.now() - last);
    if (left > 0) {
      return i.reply({
        content: tr("commands.ticket.pingCooldown", { seconds: Math.ceil(left / 1000) }),
        ephemeral: true,
      });
    }
    pingCooldown.set(i.channelId, Date.now());
    const staff = cfg.tickets.staffRoleId || cfg.staffRoleId;
    const target = ticket.claimedBy
      ? mentionUser(ticket.claimedBy)
      : staff
        ? mentionRole(staff)
        : null;
    await i.reply({
      content: target
        ? tr("commands.ticket.pingAnnounce", { staff: target, user: mentionUser(userId(i.user)) })
        : tr("commands.ticket.pingNoStaff"),
    });
  });

  client.component("sanad:ticket:add", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const cfg = getGuild(i.serverId);
    const ticket = getOpenTickets(i.serverId)[i.channelId];
    if (!ticket) return i.reply({ content: tr("commands.ticket.notTicket"), ephemeral: true });
    if (!canManage(i, cfg, ticket)) {
      return i.reply({ content: tr("commands.ticket.staffOrOwner"), ephemeral: true });
    }
    await i.reply({
      ephemeral: true,
      content: tr("commands.ticket.addPrompt"),
      components: [
        new ActionRowBuilder().addComponents(
          new UserSelectMenuBuilder()
            .setCustomId("sanad:ticket:add-pick")
            .setPlaceholder(tr("commands.ticket.addPlaceholder")),
        ),
      ],
    });
  });

  client.component("sanad:ticket:add-pick", async (i) => {
    const uid = i.values[0];
    return addParticipant(client, i, uid, true);
  });

  client.component("sanad:ticket:remove", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const cfg = getGuild(i.serverId);
    const ticket = getOpenTickets(i.serverId)[i.channelId];
    if (!ticket) return i.reply({ content: tr("commands.ticket.notTicket"), ephemeral: true });
    if (!isStaff(i, cfg)) return i.reply({ content: tr("commands.ticket.staffOnly"), ephemeral: true });
    await i.reply({
      ephemeral: true,
      content: tr("commands.ticket.removePrompt"),
      components: [
        new ActionRowBuilder().addComponents(
          new UserSelectMenuBuilder()
            .setCustomId("sanad:ticket:remove-pick")
            .setPlaceholder(tr("commands.ticket.removePlaceholder")),
        ),
      ],
    });
  });

  client.component("sanad:ticket:remove-pick", async (i) => {
    const uid = i.values[0];
    return removeParticipant(client, i, uid, true);
  });

  client.component("sanad:ticket:close", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const cfg = getGuild(i.serverId);
    const ticket = getOpenTickets(i.serverId)[i.channelId];
    if (!ticket) return i.reply({ content: tr("commands.ticket.notTicket"), ephemeral: true });
    if (!canManage(i, cfg, ticket)) {
      return i.reply({ content: tr("commands.ticket.staffOrOwner"), ephemeral: true });
    }
    try {
      await i.showModal(
        new ModalBuilder()
          .setCustomId("sanad:ticket:close-form")
          .setTitle(tr("commands.ticket.close"))
          .addLabelComponents(
            new LabelBuilder()
              .setLabel(tr("commands.ticket.closeReasonLabel"))
              .setTextInputComponent((input) =>
                input
                  .setCustomId("reason")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setMaxLength(200)
                  .setPlaceholder(tr("commands.ticket.closeReasonPlaceholder")),
              ),
          ),
      );
    } catch (error) {
      if (/AlreadyAcknowledged|409/i.test(String(error?.message || error))) return;
      throw error;
    }
  });

  client.modal("sanad:ticket:close-form", async (i) => {
    let reason = "";
    try {
      reason = (i.fields.getTextInputValue("reason") || "").trim();
    } catch {
      reason = "";
    }
    return closeTicket(client, i, i.channelId, { fromModal: true, reason });
  });

  registry.register({
    name: "ticket",
    slash: false,
    aliases: ["تكت", "تذكرة"],
    async execute(ctx) {
      const cfg = getGuild(ctx.serverId);
      if (!cfg.tickets.enabled) return ctx.reply(ctx.t("commands.ticket.disabled"));
      const sub = String(ctx.args[0] || "help").toLowerCase();
      const rest = ctx.args.slice(1);
      const { locale } = guildT(ctx.serverId, ctx.locale);

      if (sub === "help" || sub === "مساعدة" || sub === "?") {
        return ctx.reply(ctx.t("commands.ticket.prefixUsage", { prefix: ctx.prefix || "!" }));
      }

      if (sub === "panel" || sub === "لوحة") {
        if (!(typeof ctx.has === "function" && ctx.has(Permissions.ManageChannel))) {
          return ctx.reply(ctx.t("common.noPermission"));
        }
        await postTicketOpenPanel(ctx.client, ctx.channelId, ctx.t);
        return ctx.reply(ctx.t("commands.ticket.panelPosted"));
      }

      if (sub === "list" || sub === "قائمة") {
        if (!isStaff(ctx, cfg)) return ctx.reply(ctx.t("commands.ticket.staffOnly"));
        return ctx.reply({ embeds: [listTicketsEmbed(ctx.serverId, ctx.t, locale)] });
      }

      if (sub === "info" || sub === "معلومات") {
        const ticket = getOpenTickets(ctx.serverId)[ctx.channelId];
        if (!ticket) return ctx.reply(ctx.t("commands.ticket.notTicket"));
        return ctx.reply({ embeds: [ticketEmbed(ctx.t, ticket, locale)] });
      }

      if (sub === "claim" || sub === "استلام") {
        return claimTicket(ctx.client, ctx, false);
      }

      if (sub === "unclaim" || sub === "تحرير" || sub === "افلات") {
        return unclaimTicket(ctx.client, ctx, false);
      }

      if (sub === "close" || sub === "إغلاق" || sub === "اغلاق") {
        return closeTicket(ctx.client, ctx, ctx.channelId, {
          fromButton: false,
          reason: rest.join(" ").trim(),
        });
      }

      if (sub === "add" || sub === "إضافة" || sub === "اضافة") {
        const uid = parseUserToken(rest[0]);
        if (!uid) return ctx.reply(ctx.t("common.error"));
        return addParticipant(ctx.client, ctx, uid, false);
      }

      if (sub === "remove" || sub === "إزالة" || sub === "ازالة") {
        const uid = parseUserToken(rest[0]);
        if (!uid) return ctx.reply(ctx.t("common.error"));
        return removeParticipant(ctx.client, ctx, uid, false);
      }

      return ctx.reply(ctx.t("commands.ticket.prefixUsage", { prefix: ctx.prefix || "!" }));
    },
  });
}

function listTicketsEmbed(serverId, tr, locale) {
  const open = getOpenTickets(serverId);
  const rows = Object.entries(open);
  if (!rows.length) {
    return new EmbedBuilder()
      .title(tr("commands.ticket.listTitle"))
      .description(tr("commands.ticket.listEmpty"))
      .colour(BRAND.colour.mute);
  }
  const lines = rows
    .slice(0, 20)
    .map(([channelId, ticket]) => {
      const status = ticket.claimedBy
        ? tr("commands.ticket.statusClaimed")
        : tr("commands.ticket.statusOpen");
      const claim = ticket.claimedBy ? mentionUser(ticket.claimedBy) : "—";
      return `\`#${ticket.number}\` <#${channelId}> · ${ticket.topic} · ${status} · ${claim} · ${formatAge(ticket.openedAt, locale)}`;
    })
    .join("\n");
  return new EmbedBuilder()
    .title(tr("commands.ticket.listTitle"))
    .description(lines)
    .footer(tr("commands.ticket.listFooter", { n: rows.length }))
    .colour(BRAND.colour.ticket);
}

async function addParticipant(client, i, uid, fromSelect) {
  const { t: tr, locale } = guildT(i.serverId, i.locale);
  const cfg = getGuild(i.serverId);
  const open = getOpenTickets(i.serverId);
  const ticket = open[i.channelId];
  if (!ticket) {
    const msg = { content: tr("commands.ticket.notTicket"), ephemeral: true };
    return fromSelect ? i.update({ content: msg.content, components: [] }) : i.reply(msg);
  }
  if (!canManage(i, cfg, ticket)) {
    const msg = { content: tr("commands.ticket.staffOrOwner"), ephemeral: true };
    return fromSelect ? i.update({ content: msg.content, components: [] }) : i.reply(msg);
  }
  if (!uid) {
    const msg = { content: tr("common.error"), ephemeral: true };
    return fromSelect ? i.update({ content: msg.content, components: [] }) : i.reply(msg);
  }
  if (uid === ticket.owner) {
    const msg = { content: tr("commands.ticket.alreadyParticipant"), ephemeral: true };
    return fromSelect ? i.update({ content: msg.content, components: [] }) : i.reply(msg);
  }
  try {
    await client.channels.setMemberPermissions(i.channelId, uid, IN_TICKET);
    if (!Array.isArray(ticket.participants)) ticket.participants = [ticket.owner];
    if (!ticket.participants.includes(uid)) ticket.participants.push(uid);
    saveOpenTickets(i.serverId, open);
    await refreshTicketPanel(client, i.channelId, ticket, tr, locale);
    const okMsg = tr("commands.ticket.added", { user: mentionUser(uid) });
    if (fromSelect) await i.update({ content: okMsg, components: [] });
    else await i.reply(okMsg);
    await client
      .send(
        i.channelId,
        tr("commands.ticket.addedAnnounce", {
          by: mentionUser(userId(i.user)),
          user: mentionUser(uid),
        }),
      )
      .catch(() => {});
  } catch {
    const msg = { content: tr("common.error"), ephemeral: true };
    return fromSelect ? i.update({ content: msg.content, components: [] }) : i.reply(msg);
  }
}

async function removeParticipant(client, i, uid, fromSelect) {
  const { t: tr, locale } = guildT(i.serverId, i.locale);
  const cfg = getGuild(i.serverId);
  const open = getOpenTickets(i.serverId);
  const ticket = open[i.channelId];
  if (!ticket) {
    const msg = { content: tr("commands.ticket.notTicket"), ephemeral: true };
    return fromSelect ? i.update({ content: msg.content, components: [] }) : i.reply(msg);
  }
  if (!isStaff(i, cfg)) {
    const msg = { content: tr("commands.ticket.staffOnly"), ephemeral: true };
    return fromSelect ? i.update({ content: msg.content, components: [] }) : i.reply(msg);
  }
  if (!uid || uid === ticket.owner) {
    const msg = { content: tr("commands.ticket.cannotRemoveOwner"), ephemeral: true };
    return fromSelect ? i.update({ content: msg.content, components: [] }) : i.reply(msg);
  }
  try {
    await client.channels.setMemberPermissions(i.channelId, uid, 0);
    if (Array.isArray(ticket.participants)) {
      ticket.participants = ticket.participants.filter((id) => id !== uid);
    }
    saveOpenTickets(i.serverId, open);
    await refreshTicketPanel(client, i.channelId, ticket, tr, locale);
    const okMsg = tr("commands.ticket.removed", { user: mentionUser(uid) });
    if (fromSelect) await i.update({ content: okMsg, components: [] });
    else await i.reply(okMsg);
    await client
      .send(
        i.channelId,
        tr("commands.ticket.removedAnnounce", {
          by: mentionUser(userId(i.user)),
          user: mentionUser(uid),
        }),
      )
      .catch(() => {});
  } catch {
    const msg = { content: tr("common.error"), ephemeral: true };
    return fromSelect ? i.update({ content: msg.content, components: [] }) : i.reply(msg);
  }
}

async function claimTicket(client, i, fromButton) {
  const { t: tr, locale } = guildT(i.serverId, i.locale);
  const cfg = getGuild(i.serverId);
  const open = getOpenTickets(i.serverId);
  const ticket = open[i.channelId];
  if (!ticket) return i.reply({ content: tr("commands.ticket.notTicket"), ephemeral: true });
  if (!isStaff(i, cfg)) return i.reply({ content: tr("commands.ticket.staffOnly"), ephemeral: true });
  const me = userId(i.user);
  if (ticket.claimedBy && ticket.claimedBy !== me) {
    if (!actorHas(i, Permissions.ManageServer)) {
      return i.reply({
        content: tr("commands.ticket.alreadyClaimed", { user: mentionUser(ticket.claimedBy) }),
        ephemeral: true,
      });
    }
  }
  const stole = ticket.claimedBy && ticket.claimedBy !== me;
  ticket.claimedBy = me;
  ticket.claimedAt = new Date().toISOString();
  saveOpenTickets(i.serverId, open);
  const payload = {
    embeds: [ticketEmbed(tr, ticket, locale)],
    components: ticketButtons(tr, ticket),
  };
  if (fromButton) await i.update(payload);
  else {
    await i.reply(
      stole
        ? tr("commands.ticket.transferAnnounce", { user: mentionUser(me) })
        : tr("commands.ticket.claimAnnounce", { user: mentionUser(me) }),
    );
    if (ticket.messageId) {
      await client.editMessage(i.channelId, ticket.messageId, payload).catch(() => {});
    }
    return;
  }
  await client.send(
    i.channelId,
    stole
      ? tr("commands.ticket.transferAnnounce", { user: mentionUser(me) })
      : tr("commands.ticket.claimAnnounce", { user: mentionUser(me) }),
  );
}

async function unclaimTicket(client, i, fromButton) {
  const { t: tr, locale } = guildT(i.serverId, i.locale);
  const cfg = getGuild(i.serverId);
  const open = getOpenTickets(i.serverId);
  const ticket = open[i.channelId];
  if (!ticket) return i.reply({ content: tr("commands.ticket.notTicket"), ephemeral: true });
  if (!isStaff(i, cfg)) return i.reply({ content: tr("commands.ticket.staffOnly"), ephemeral: true });
  if (!ticket.claimedBy) return i.reply({ content: tr("commands.ticket.notClaimed"), ephemeral: true });
  ticket.claimedBy = null;
  ticket.claimedAt = null;
  saveOpenTickets(i.serverId, open);
  const payload = {
    embeds: [ticketEmbed(tr, ticket, locale)],
    components: ticketButtons(tr, ticket),
  };
  if (fromButton) await i.update(payload);
  else {
    await i.reply(tr("commands.ticket.unclaimAnnounce", { user: mentionUser(userId(i.user)) }));
    if (ticket.messageId) {
      await client.editMessage(i.channelId, ticket.messageId, payload).catch(() => {});
    }
    return;
  }
  await client.send(i.channelId, tr("commands.ticket.unclaimAnnounce", { user: mentionUser(userId(i.user)) }));
}

async function closeTicket(client, i, channelId, { fromButton = false, fromModal = false, reason = "" } = {}) {
  const { t: tr } = guildT(i.serverId, i.locale);
  const serverId = i.serverId;
  const cfg = getGuild(serverId);
  const open = getOpenTickets(serverId);
  const ticket = open[channelId];
  if (!ticket) {
    return i.reply({ content: tr("commands.ticket.notTicket"), ephemeral: true });
  }
  if (!canManage(i, cfg, ticket)) {
    return i.reply({ content: tr("commands.ticket.staffOrOwner"), ephemeral: true });
  }

  ticket.closeReason = String(reason || "").trim() || null;
  ticket.closedBy = userId(i.user);
  ticket.closedAt = new Date().toISOString();

  clearReminderTimer(serverId, channelId);
  pingCooldown.delete(channelId);
  delete open[channelId];
  saveOpenTickets(serverId, open);

  await i.reply({ content: tr("commands.ticket.closing"), ephemeral: true }).catch(async () => {
    if (fromButton && !fromModal) {
      await i.update({ content: tr("commands.ticket.closing"), components: [] }).catch(() => {});
    }
  });

  if (ticket.messageId) {
    await client.editMessage(channelId, ticket.messageId, { components: [] }).catch(() => {});
  }

  const reasonLine = ticket.closeReason
    ? `\n${tr("commands.ticket.closeReason")}: ${ticket.closeReason}`
    : "";
  await client
    .send(channelId, {
      embeds: [
        new EmbedBuilder()
          .title(tr("commands.ticket.closedEmbed"))
          .description(
            `${tr("commands.ticket.closedBy", { user: mentionUser(userId(i.user)) })}${reasonLine}`,
          )
          .colour(BRAND.colour.danger),
      ],
    })
    .catch(() => {});

  let transcript = null;
  try {
    transcript = await buildTranscript(client, channelId, ticket, tr);
  } catch (error) {
    console.warn("[sanad:ticket] transcript:", error?.message || error);
  }

  if (transcript) {
    const dmOk = await client.users
      .sendDM(ticket.owner, {
        content: tr("commands.ticket.transcriptDm", { number: ticket.number }),
        files: [{ name: transcript.name, data: transcript.data, type: transcript.type }],
      })
      .then(() => true)
      .catch(() => false);

    if (cfg.tickets.logChannelId) {
      const logEmbed = new EmbedBuilder()
        .title(tr("commands.ticket.logTitle", { number: ticket.number }))
        .field(tr("commands.ticket.topicLabel"), ticket.topic || "—", true)
        .field(tr("common.user"), mentionUser(ticket.owner), true)
        .field(tr("commands.ticket.closedByLabel"), mentionUser(userId(i.user)), true)
        .field(
          tr("commands.ticket.claimedBy"),
          ticket.claimedBy ? mentionUser(ticket.claimedBy) : tr("commands.ticket.nobody"),
          true,
        )
        .field(tr("commands.ticket.openedAgo"), formatAge(ticket.openedAt, "en"), true)
        .field(tr("commands.ticket.messagesLogged"), String(transcript.lines), true)
        .colour(BRAND.colour.mute);
      if (ticket.closeReason) {
        logEmbed.field(tr("commands.ticket.closeReason"), ticket.closeReason.slice(0, 200), false);
      }
      if (!dmOk) {
        logEmbed.field(tr("commands.ticket.dmFail"), tr("commands.ticket.dmFailBody"), false);
      }
      await client
        .send(cfg.tickets.logChannelId, {
          embeds: [logEmbed],
          files: [{ name: transcript.name, data: transcript.data, type: transcript.type }],
        })
        .catch(() => {});
    } else if (!dmOk) {
      await client
        .send(channelId, {
          content: tr("commands.ticket.transcriptLocal"),
          files: [{ name: transcript.name, data: transcript.data, type: transcript.type }],
        })
        .catch(() => {});
    }
  } else if (cfg.tickets.logChannelId) {
    await client
      .send(cfg.tickets.logChannelId, {
        embeds: [
          new EmbedBuilder()
            .title(tr("commands.ticket.logTitle", { number: ticket.number }))
            .field(tr("commands.ticket.topicLabel"), ticket.topic || "—", true)
            .field(tr("common.user"), mentionUser(ticket.owner), true)
            .field(tr("commands.ticket.closedByLabel"), mentionUser(userId(i.user)), true)
            .colour(BRAND.colour.mute),
        ],
      })
      .catch(() => {});
  }

  await new Promise((r) => setTimeout(r, CLOSE_DELETE_MS));
  const deleted = await client.channels.delete(channelId).then(
    () => true,
    () => false,
  );
  if (!deleted && cfg.tickets.logChannelId) {
    await client
      .send(cfg.tickets.logChannelId, {
        content: tr("commands.ticket.deleteFail", { channel: `<#${channelId}>`, number: ticket.number }),
      })
      .catch(() => {});
  }
}
