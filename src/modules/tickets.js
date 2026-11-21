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
import { BRAND, mentionUser, userId } from "../brand.js";
import { t } from "../core/i18n.js";
import { registry } from "../core/registry.js";
import { getGuild, getOpenTickets, saveOpenTickets, updateGuild } from "../db/store.js";
import { guildT } from "../util/locale.js";

const ticketsFile = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "tickets.json");

const IN_TICKET =
  Permissions.ViewChannel |
  Permissions.ReadMessageHistory |
  Permissions.SendMessage |
  Permissions.UploadFiles |
  Permissions.React;

function defaultTopics(locale) {
  const raw = t(locale === "ar" ? "ar" : "en", "commands.ticket.defaultTopics");
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string" && raw.includes("|")) return raw.split("|").map((s) => s.trim()).filter(Boolean);
  return locale === "ar"
    ? ["دعم عام", "تبليغ", "اقتراح", "أخرى"]
    : ["General support", "Report", "Suggestion", "Other"];
}

function isStaff(i, cfg) {
  const role = cfg.tickets.staffRoleId || cfg.staffRoleId;
  // If a staff role is configured, claim/staff actions require that role (or Manage Server).
  if (role) {
    return Boolean(i.member?.roles?.includes(role)) || i.has(Permissions.ManageServer);
  }
  return i.has(Permissions.ManageMessages) || i.has(Permissions.ManageChannel);
}

function isOwner(i, ticket) {
  return ticket && userId(i.user) === ticket.owner;
}

function canManage(i, cfg, ticket) {
  return isOwner(i, ticket) || isStaff(i, cfg);
}

function topicsFor(cfg, locale) {
  const list = cfg.tickets.topics?.length ? cfg.tickets.topics : defaultTopics(locale);
  return list.slice(0, 25);
}

export async function postTicketOpenPanel(client, channelId, tr) {
  await client.send(channelId, {
    embeds: [
      new EmbedBuilder()
        .title(tr("commands.ticket.panelTitle"))
        .description(tr("commands.ticket.panelBody"))
        .colour(BRAND.colour.ticket),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("sanad:ticket:open")
          .setLabel(tr("commands.ticket.openBtn"))
          .setStyle(ButtonStyle.Primary),
      ),
    ],
  });
}

function findUserTicket(open, uid) {
  return Object.entries(open).find(([, ticket]) => ticket.owner === uid) || null;
}

function ticketEmbed(tr, ticket) {
  const details = String(ticket.details || tr("common.none")).slice(0, 1800);
  const description = [
    `**${tr("commands.ticket.topicLabel")}** · ${ticket.topic || tr("common.none")}`,
    "",
    `**${tr("commands.ticket.detailsLabel")}**`,
    details,
  ].join("\n");

  return new EmbedBuilder()
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
    .field(
      tr("commands.ticket.reminder"),
      ticket.reminder ? String(ticket.reminder).slice(0, 80) : tr("commands.ticket.noReminder"),
      true,
    )
    .footer(tr("commands.ticket.footer"))
    .colour(ticket.claimedBy ? BRAND.colour.success : BRAND.colour.ticket)
    .timestamp();
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
        .setCustomId("sanad:ticket:close")
        .setLabel(tr("commands.ticket.close"))
        .setStyle(ButtonStyle.Danger)
        .setEmoji("🗑️"),
    ),
  ];
}

async function postTicketPanel(client, channelId, tr, ticket, staffRoleId) {
  const payload = {
    embeds: [ticketEmbed(tr, ticket)],
    components: ticketButtons(tr, ticket),
  };
  // Wait for channel ACL to settle, then post panel (mentions separately — safer)
  await new Promise((r) => setTimeout(r, 600));
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
        embeds: [ticketEmbed(tr, ticket)],
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
    if (!existsSync(ticketsFile)) return;
    const db = JSON.parse(readFileSync(ticketsFile, "utf8"));
    let changed = false;
    for (const serverId of Object.keys(db)) {
      if (db[serverId]?.[channelId]) {
        delete db[serverId][channelId];
        changed = true;
        const mem = getOpenTickets(serverId);
        delete mem[channelId];
      }
    }
    if (changed) writeFileSync(ticketsFile, JSON.stringify(db, null, 2));
  } catch {
    /* ignore */
  }
}

export function ticketCommands() {
  return [
    new SlashCommandBuilder("ticket", t("en", "commands.ticket.description"))
      .describe({
        en: t("en", "commands.ticket.description"),
        ar: t("ar", "commands.ticket.description"),
      })
      .subcommand("panel", t("en", "commands.ticket.panel"))
      .subcommand("close", t("en", "commands.ticket.closeCmd"))
      .subcommand("add", t("en", "commands.ticket.addCmd"), (s) =>
        s.user("user", t("en", "common.user"), { required: true }),
      )
      .subcommand("claim", t("en", "commands.ticket.claimCmd"))
      .subcommand("info", t("en", "commands.ticket.infoCmd")),
  ];
}

export function registerTickets(client) {
  client.on("ChannelDelete", (packet) => {
    if (packet?.id) cleanTicketByChannel(packet.id);
  });

  client.command("ticket", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const cfg = getGuild(i.serverId);
    if (!cfg.tickets.enabled) {
      return i.reply({ content: tr("commands.ticket.disabled"), ephemeral: true });
    }

    if (i.subcommand === "panel") {
      if (!i.has(Permissions.ManageChannel)) {
        return i.reply({ content: tr("common.noPermission"), ephemeral: true });
      }
      await postTicketOpenPanel(client, i.channelId, tr);
      return i.reply({ content: tr("commands.ticket.panelPosted"), ephemeral: true });
    }

    if (i.subcommand === "close") return closeTicket(client, i, i.channelId);
    if (i.subcommand === "claim") return claimTicket(client, i, false);
    if (i.subcommand === "info") {
      const ticket = getOpenTickets(i.serverId)[i.channelId];
      if (!ticket) return i.reply({ content: tr("commands.ticket.notTicket"), ephemeral: true });
      return i.reply({ embeds: [ticketEmbed(tr, ticket)] });
    }

    if (i.subcommand === "add") {
      const open = getOpenTickets(i.serverId);
      const ticket = open[i.channelId];
      if (!ticket) return i.reply({ content: tr("commands.ticket.notTicket"), ephemeral: true });
      if (!canManage(i, cfg, ticket)) {
        return i.reply({ content: tr("commands.ticket.staffOrOwner"), ephemeral: true });
      }
      const uid = i.option("user");
      try {
        await client.channels.setMemberPermissions(i.channelId, uid, IN_TICKET);
        await i.reply(tr("commands.ticket.added", { user: mentionUser(uid) }));
      } catch {
        await i.reply({ content: tr("common.error"), ephemeral: true });
      }
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
    const { t: tr } = guildT(i.serverId, i.locale);
    const cfg = getGuild(i.serverId);
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

    const topic = i.fields.getStringSelectValues("topic")[0] || topicsFor(cfg, "en")[0];
    const details = i.fields.getTextInputValue("details") || topic;
    let reminder = "";
    try {
      reminder = i.fields.getTextInputValue("reminder") || "";
    } catch {
      reminder = "";
    }

    const number = String((cfg.tickets.counter = (cfg.tickets.counter || 0) + 1)).padStart(4, "0");
    updateGuild(i.serverId, (c) => {
      c.tickets.counter = cfg.tickets.counter;
    });

    try {
      const category =
        cfg.tickets.categoryId || (await client.servers.ensureCategory(i.serverId, "Tickets"));
      if (!cfg.tickets.categoryId) {
        updateGuild(i.serverId, (c) => {
          c.tickets.categoryId = category;
        });
      }

      const channel = await client.channels.create(i.serverId, {
        name: `ticket-${number}`,
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
      await safePerm(() => client.channels.setMemberPermissions(id, userId(i.user), IN_TICKET));

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
        reminder: reminder.trim(),
        number,
        claimedBy: null,
        serverId: i.serverId,
        openedAt: new Date().toISOString(),
      };

      // Save early so /ticket info works even if the first panel post retries
      again[id] = { ...ticket, messageId: null };
      saveOpenTickets(i.serverId, again);

      const message = await postTicketPanel(client, id, tr, ticket, staff);
      const messageId = message?.id ?? message?._id ?? null;
      again[id] = { ...ticket, messageId };
      saveOpenTickets(i.serverId, again);

      if (reminder.trim()) scheduleTicketReminder(client, i.serverId, id, ticket);
      await i.editReply(tr("commands.ticket.opened", { channel: `<#${id}>` }));
    } catch (error) {
      console.warn("[sanad:ticket] open:", error?.message || error);
      const type = error?.type || error?.message || "error";
      const mapped =
        tr(`errors.${type}`) !== `errors.${type}` ? tr(`errors.${type}`) : tr("errors.fallback", { type });
      await i.editReply(tr("commands.ticket.openFail", { error: mapped }));
    }
  });

  client.component("sanad:ticket:claim", (i) => claimTicket(client, i, true));

  client.component("sanad:ticket:info", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const ticket = getOpenTickets(i.serverId)[i.channelId];
    if (!ticket) return i.reply({ content: tr("commands.ticket.closed"), ephemeral: true });
    return i.reply({
      ephemeral: true,
      embeds: [ticketEmbed(tr, ticket)],
      content: tr("commands.ticket.welcomeBody"),
    });
  });

  client.component("sanad:ticket:reminder-btn", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const cfg = getGuild(i.serverId);
    const open = getOpenTickets(i.serverId);
    const ticket = open[i.channelId];
    if (!ticket) return i.reply({ content: tr("commands.ticket.closed"), ephemeral: true });
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
    const { t: tr } = guildT(i.serverId, i.locale);
    const open = getOpenTickets(i.serverId);
    const ticket = open[i.channelId];
    if (!ticket) return i.reply({ content: tr("commands.ticket.closed"), ephemeral: true });
    let reminder = "";
    try {
      reminder = (i.fields.getTextInputValue("reminder") || "").trim();
    } catch {
      reminder = "";
    }
    ticket.reminder = reminder;
    saveOpenTickets(i.serverId, open);
    if (reminder) scheduleTicketReminder(client, i.serverId, i.channelId, ticket);
    if (ticket.messageId) {
      await client
        .editMessage(i.channelId, ticket.messageId, {
          embeds: [ticketEmbed(tr, ticket)],
          components: ticketButtons(tr, ticket),
        })
        .catch(() => {});
    }
    await i.reply({
      content: reminder
        ? tr("commands.ticket.reminderSet", { text: reminder })
        : tr("commands.ticket.reminderCleared"),
      ephemeral: true,
    });
  });

  client.component("sanad:ticket:unclaim", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const cfg = getGuild(i.serverId);
    const open = getOpenTickets(i.serverId);
    const ticket = open[i.channelId];
    if (!ticket) return i.reply({ content: tr("commands.ticket.closed"), ephemeral: true });
    if (!isStaff(i, cfg)) return i.reply({ content: tr("commands.ticket.staffOnly"), ephemeral: true });
    if (!ticket.claimedBy) return i.reply({ content: tr("commands.ticket.notClaimed"), ephemeral: true });
    ticket.claimedBy = null;
    saveOpenTickets(i.serverId, open);
    await i.update({ embeds: [ticketEmbed(tr, ticket)], components: ticketButtons(tr, ticket) });
    await client.send(i.channelId, tr("commands.ticket.unclaimAnnounce", { user: mentionUser(userId(i.user)) }));
  });

  client.component("sanad:ticket:rename", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const cfg = getGuild(i.serverId);
    const ticket = getOpenTickets(i.serverId)[i.channelId];
    if (!ticket) return i.reply({ content: tr("commands.ticket.closed"), ephemeral: true });
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
    const ticket = getOpenTickets(i.serverId)[i.channelId];
    if (!ticket) return i.reply({ content: tr("commands.ticket.closed"), ephemeral: true });
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
    if (!ticket) return i.reply({ content: tr("commands.ticket.closed"), ephemeral: true });
    if (!canManage(i, cfg, ticket)) {
      return i.reply({ content: tr("commands.ticket.staffOrOwner"), ephemeral: true });
    }
    const staff = cfg.tickets.staffRoleId || cfg.staffRoleId;
    await i.reply({
      content: staff
        ? tr("commands.ticket.pingAnnounce", { staff: `<%${staff}>`, user: mentionUser(userId(i.user)) })
        : tr("commands.ticket.pingNoStaff"),
    });
  });

  client.component("sanad:ticket:add", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const cfg = getGuild(i.serverId);
    const ticket = getOpenTickets(i.serverId)[i.channelId];
    if (!ticket) return i.reply({ content: tr("commands.ticket.closed"), ephemeral: true });
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
    const { t: tr } = guildT(i.serverId, i.locale);
    const uid = i.values[0];
    const ok = await client.channels.setMemberPermissions(i.channelId, uid, IN_TICKET).then(
      () => true,
      () => false,
    );
    await i.update({
      content: ok ? tr("commands.ticket.added", { user: mentionUser(uid) }) : tr("common.error"),
      components: [],
    });
    if (ok) {
      await client
        .send(
          i.channelId,
          tr("commands.ticket.addedAnnounce", {
            by: mentionUser(userId(i.user)),
            user: mentionUser(uid),
          }),
        )
        .catch(() => {});
    }
  });

  client.component("sanad:ticket:close", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const cfg = getGuild(i.serverId);
    const ticket = getOpenTickets(i.serverId)[i.channelId];
    if (!ticket) return i.reply({ content: tr("commands.ticket.closed"), ephemeral: true });
    if (!canManage(i, cfg, ticket)) {
      return i.reply({ content: tr("commands.ticket.staffOrOwner"), ephemeral: true });
    }
    await i.reply({
      ephemeral: true,
      content: tr("commands.ticket.confirmClose"),
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("sanad:ticket:close-yes")
            .setLabel(tr("commands.ticket.close"))
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId("sanad:ticket:close-no")
            .setLabel(tr("common.cancel"))
            .setStyle(ButtonStyle.Secondary),
        ),
      ],
    });
  });

  client.component("sanad:ticket:close-no", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    await i.update({ content: tr("commands.ticket.stillOpen"), components: [] });
  });

  client.component("sanad:ticket:close-yes", async (i) => {
    await closeTicket(client, i, i.channelId, true);
  });

  registry.register({
    name: "ticket",
    slash: false,
    aliases: ["تكت", "تذكرة"],
    permission: Permissions.ManageChannel,
    async execute(ctx) {
      const cfg = getGuild(ctx.serverId);
      if (!cfg.tickets.enabled) return ctx.reply(ctx.t("commands.ticket.disabled"));
      await postTicketOpenPanel(ctx.client, ctx.channelId, ctx.t);
      return ctx.reply(ctx.t("commands.ticket.panelPosted"));
    },
  });
}

async function claimTicket(client, i, fromButton) {
  const { t: tr } = guildT(i.serverId, i.locale);
  const cfg = getGuild(i.serverId);
  const open = getOpenTickets(i.serverId);
  const ticket = open[i.channelId];
  if (!ticket) return i.reply({ content: tr("commands.ticket.closed"), ephemeral: true });
  if (!isStaff(i, cfg)) return i.reply({ content: tr("commands.ticket.staffOnly"), ephemeral: true });
  if (ticket.claimedBy && ticket.claimedBy !== userId(i.user)) {
    return i.reply({
      content: tr("commands.ticket.alreadyClaimed", { user: mentionUser(ticket.claimedBy) }),
      ephemeral: true,
    });
  }
  ticket.claimedBy = userId(i.user);
  saveOpenTickets(i.serverId, open);
  const payload = { embeds: [ticketEmbed(tr, ticket)], components: ticketButtons(tr, ticket) };
  if (fromButton) await i.update(payload);
  else {
    await i.reply(tr("commands.ticket.claimAnnounce", { user: mentionUser(ticket.claimedBy) }));
    if (ticket.messageId) {
      await client.editMessage(i.channelId, ticket.messageId, payload).catch(() => {});
    }
    return;
  }
  await client.send(i.channelId, tr("commands.ticket.claimAnnounce", { user: mentionUser(ticket.claimedBy) }));
}

function scheduleTicketReminder(client, serverId, channelId, ticket) {
  const raw = String(ticket.reminder || "").trim().toLowerCase();
  const match = raw.match(/^(\d+)\s*(s|sec|m|min|h|hr|d|ث|د|س|ي)?/);
  if (!match) return;
  const n = Number(match[1]);
  const u = match[2] || "h";
  let ms = n * 3600_000;
  if (["s", "sec", "ث"].includes(u)) ms = n * 1000;
  else if (["m", "min", "د"].includes(u)) ms = n * 60_000;
  else if (["h", "hr", "س"].includes(u)) ms = n * 3600_000;
  else if (["d", "ي"].includes(u)) ms = n * 86400_000;
  ms = Math.min(Math.max(ms, 60_000), 7 * 86400_000);

  setTimeout(() => {
    if (!getOpenTickets(serverId)[channelId]) return;
    const { t: tr } = guildT(serverId);
    client
      .send(channelId, {
        content: tr("commands.ticket.reminderFire", {
          user: mentionUser(ticket.owner),
          text: ticket.reminder,
        }),
      })
      .catch(() => {});
  }, ms);
}

async function closeTicket(client, i, channelId, fromButton = false) {
  const { t: tr } = guildT(i.serverId, i.locale);
  const serverId = i.serverId;
  const cfg = getGuild(serverId);
  const open = getOpenTickets(serverId);
  const ticket = open[channelId];
  if (!ticket) {
    if (fromButton) return i.update({ content: tr("commands.ticket.closed"), components: [] });
    return i.reply({ content: tr("commands.ticket.notTicket"), ephemeral: true });
  }
  if (!canManage(i, cfg, ticket)) {
    if (fromButton) return i.update({ content: tr("commands.ticket.staffOrOwner"), components: [] });
    return i.reply({ content: tr("commands.ticket.staffOrOwner"), ephemeral: true });
  }

  delete open[channelId];
  saveOpenTickets(serverId, open);

  if (fromButton) await i.update({ content: tr("commands.ticket.closing"), components: [] });
  else await i.reply({ content: tr("commands.ticket.closing"), ephemeral: true });

  if (ticket.messageId) {
    await client.editMessage(channelId, ticket.messageId, { components: [] }).catch(() => {});
  }

  await client
    .send(channelId, {
      embeds: [
        new EmbedBuilder()
          .title(tr("commands.ticket.closedEmbed"))
          .description(tr("commands.ticket.closedBy", { user: mentionUser(userId(i.user)) }))
          .colour(BRAND.colour.danger),
      ],
    })
    .catch(() => {});

  try {
    const messages = (await client.messages.fetchMany(channelId, { limit: 100 })).reverse();
    const lines = messages.map((m) => {
      const body = [m.content, ...(m.embeds ?? []).map((e) => e.title || e.description || "")]
        .filter(Boolean)
        .join(" ");
      return `${m.author}: ${body}`;
    });
    await client.users
      .sendDM(ticket.owner, {
        content: tr("commands.ticket.transcriptDm", { number: ticket.number }),
        files: [
          {
            name: `ticket-${ticket.number}.txt`,
            data: new TextEncoder().encode(`Ticket ${ticket.number} · ${ticket.topic}\n\n${lines.join("\n")}\n`),
            type: "text/plain",
          },
        ],
      })
      .catch(() => {});
  } catch {
    /* ignore */
  }

  if (cfg.tickets.logChannelId) {
    await client
      .send(cfg.tickets.logChannelId, {
        embeds: [
          new EmbedBuilder()
            .title(tr("commands.ticket.logTitle", { number: ticket.number }))
            .field(tr("commands.ticket.topicLabel"), ticket.topic, true)
            .field(tr("common.user"), mentionUser(ticket.owner), true)
            .field(tr("commands.ticket.closedByLabel"), mentionUser(userId(i.user)), true)
            .colour(BRAND.colour.mute),
        ],
      })
      .catch(() => {});
  }

  await new Promise((r) => setTimeout(r, 2500));
  await client.channels.delete(channelId).catch(() => {});
}
