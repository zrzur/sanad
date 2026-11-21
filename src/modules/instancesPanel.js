/**
 * Owner-only full control panel for Sanad multi-bot instances.
 * Callers: createBot.js → registerInstancesPanel + instancesPanelPayload.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from "@zrzur/sdk/bot";
import { config } from "../config.js";
import { brandFooter } from "../util/format.js";
import { guildT } from "../util/locale.js";

function isSanadOwner(userId) {
  return Boolean(userId && config.ownerIds.includes(userId));
}

function uidOf(i) {
  return i.userId || i.user?.id || i.user?._id;
}

function displayName(row) {
  return row?.username || row?.label || row?.id || "?";
}

function stateLabel(tr, row) {
  if (row.online) return tr("commands.instance.statusOnline");
  if (row.paused) return tr("commands.instance.statusPaused");
  return tr("commands.instance.statusOffline");
}

function stateShort(tr, row) {
  if (row.online) return tr("commands.instance.statusOnlineShort");
  if (row.paused) return tr("commands.instance.statusPausedShort");
  return tr("commands.instance.statusOfflineShort");
}

function statusLine(tr, row) {
  const label = row.label && row.label !== row.username ? ` · ${row.label}` : "";
  return `${stateLabel(tr, row)} **${displayName(row)}**${label}\n┗ \`${row.id}\` · ${row.tokenMasked || "***"}`;
}

export function buildInstancesEmbed(tr, rows) {
  const body = rows.length
    ? rows.map((r) => statusLine(tr, r)).join("\n\n")
    : `${tr("commands.instance.empty")}\n${tr("commands.instance.hint")}`;
  return new EmbedBuilder()
    .title(tr("commands.instance.listTitle"))
    .description(`${tr("commands.instance.panelBlurb")}\n\n${body}`.slice(0, 4000))
    .field(tr("commands.instance.countField"), String(rows.length), true)
    .field(tr("commands.instance.onlineField"), String(rows.filter((r) => r.online).length), true)
    .field(tr("commands.instance.pausedField"), String(rows.filter((r) => r.paused).length), true)
    .footer(brandFooter(tr))
    .colour(config.brand.colour)
    .timestamp();
}

function buildDetailEmbed(tr, row) {
  return new EmbedBuilder()
    .title(tr("commands.instance.detailTitle", { name: displayName(row) }))
    .description(tr("commands.instance.detailBody", { id: row.id }))
    .field(tr("commands.instance.stateField"), stateLabel(tr, row), true)
    .field(tr("commands.instance.labelField"), row.label || "—", true)
    .field(tr("commands.instance.tokenField"), row.tokenMasked || "***", true)
    .footer(brandFooter(tr))
    .colour(row.online ? "#14B8A6" : row.paused ? "#F59E0B" : "#64748B")
    .timestamp();
}

export function buildInstancesComponents(tr, rows) {
  const components = [];

  if (rows.length) {
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("sanad:inst:pick")
          .setPlaceholder(tr("commands.instance.selectManage").slice(0, 100))
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(
            ...rows.slice(0, 25).map((r) => ({
              label: String(displayName(r)).slice(0, 100),
              description: tr("commands.instance.selectStopDesc", {
                id: r.id,
                state: stateShort(tr, r),
              }).slice(0, 100),
              value: r.id,
            })),
          ),
      ),
    );
  }

  // Bulk controls — full owner power (5 per row)
  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("sanad:inst:refresh")
        .setLabel(tr("commands.instance.btnRefresh").slice(0, 80))
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("sanad:inst:pause-all")
        .setLabel(tr("commands.instance.btnPauseAll").slice(0, 80))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!rows.some((r) => r.online)),
      new ButtonBuilder()
        .setCustomId("sanad:inst:start-all")
        .setLabel(tr("commands.instance.btnStartAll").slice(0, 80))
        .setStyle(ButtonStyle.Success)
        .setDisabled(!rows.some((r) => !r.online)),
      new ButtonBuilder()
        .setCustomId("sanad:inst:restart-all")
        .setLabel(tr("commands.instance.btnRestartAll").slice(0, 80))
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!rows.length),
      new ButtonBuilder()
        .setCustomId("sanad:inst:end")
        .setLabel(tr("commands.instance.btnEnd").slice(0, 80))
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  return components;
}

function buildDetailComponents(tr, row) {
  const online = Boolean(row.online);
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`sanad:inst:pause:${row.id}`)
        .setLabel(tr("commands.instance.btnPause").slice(0, 80))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!online),
      new ButtonBuilder()
        .setCustomId(`sanad:inst:start:${row.id}`)
        .setLabel(tr("commands.instance.btnStart").slice(0, 80))
        .setStyle(ButtonStyle.Success)
        .setDisabled(online),
      new ButtonBuilder()
        .setCustomId(`sanad:inst:restart:${row.id}`)
        .setLabel(tr("commands.instance.btnRestart").slice(0, 80))
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`sanad:inst:delete:${row.id}`)
        .setLabel(tr("commands.instance.btnDelete").slice(0, 80))
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("sanad:inst:refresh")
        .setLabel(tr("commands.instance.btnBack").slice(0, 80))
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

export function instancesPanelPayload(instanceManager, tr, notice = null) {
  const rows = instanceManager.list();
  const payload = {
    embeds: [buildInstancesEmbed(tr, rows)],
    components: buildInstancesComponents(tr, rows),
    ephemeral: true,
  };
  if (notice) payload.content = notice;
  else payload.content = null;
  return payload;
}

function detailPayload(tr, row, notice = null) {
  const payload = {
    embeds: [buildDetailEmbed(tr, row)],
    components: buildDetailComponents(tr, row),
    ephemeral: true,
  };
  if (notice) payload.content = notice;
  else payload.content = null;
  return payload;
}

function confirmDeletePayload(tr, row) {
  return {
    embeds: [
      new EmbedBuilder()
        .title(tr("commands.instance.confirmDeleteTitle"))
        .description(tr("commands.instance.confirmDeleteBody", { name: displayName(row), id: row.id }))
        .colour("#EF4444")
        .footer(brandFooter(tr)),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`sanad:inst:confirm-delete:${row.id}`)
          .setLabel(tr("commands.instance.btnConfirmDelete").slice(0, 80))
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`sanad:inst:open:${row.id}`)
          .setLabel(tr("commands.instance.btnCancel").slice(0, 80))
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
    ephemeral: true,
  };
}

async function deny(i, tr) {
  return i.reply({ content: tr("commands.instance.ownerOnly"), ephemeral: true });
}

async function safeUpdate(i, payload) {
  const data = { ...payload };
  if (data.content == null) delete data.content;
  try {
    if (i.deferred || i.replied) return await i.editReply(data);
    return await i.update(data);
  } catch {
    try {
      return await i.reply({ ...data, ephemeral: true });
    } catch {
      /* ignore */
    }
  }
}

async function requireOwner(i, tr) {
  if (!isSanadOwner(uidOf(i))) {
    await deny(i, tr);
    return false;
  }
  return true;
}

export function registerInstancesPanel(client, instanceManager) {
  if (!instanceManager || client.__sanadInstPanel) return;
  client.__sanadInstPanel = true;
  client.__sanadInstanceManager = instanceManager;

  const panel = (tr, notice) => instancesPanelPayload(instanceManager, tr, notice);

  client.component("sanad:inst:refresh", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    if (!(await requireOwner(i, tr))) return;
    return safeUpdate(i, panel(tr));
  });

  client.component("sanad:inst:end", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    if (!(await requireOwner(i, tr))) return;
    return safeUpdate(i, {
      embeds: [
        new EmbedBuilder()
          .title(tr("commands.instance.listTitle"))
          .description(tr("commands.instance.closed"))
          .colour("#64748B")
          .footer(brandFooter(tr)),
      ],
      components: [],
      ephemeral: true,
    });
  });

  client.component("sanad:inst:pick", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    if (!(await requireOwner(i, tr))) return;
    const row = instanceManager.get(i.values?.[0]);
    if (!row) return safeUpdate(i, panel(tr, tr("commands.instance.notFound")));
    return safeUpdate(i, detailPayload(tr, row));
  });

  client.component("sanad:inst:open:", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    if (!(await requireOwner(i, tr))) return;
    const id = String(i.customId || "").replace("sanad:inst:open:", "");
    const row = instanceManager.get(id);
    if (!row) return safeUpdate(i, panel(tr, tr("commands.instance.notFound")));
    return safeUpdate(i, detailPayload(tr, row));
  });

  client.component("sanad:inst:pause:", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    if (!(await requireOwner(i, tr))) return;
    const id = String(i.customId || "").replace("sanad:inst:pause:", "");
    await i.deferUpdate?.().catch(() => {});
    const result = await instanceManager.pause(id);
    const row = instanceManager.get(id);
    if (!row) return safeUpdate(i, panel(tr, tr("commands.instance.notFound")));
    const notice = result.ok
      ? tr("commands.instance.pausedNamed", { name: displayName(row) })
      : tr("commands.instance.actionFail");
    return safeUpdate(i, detailPayload(tr, row, notice));
  });

  client.component("sanad:inst:start:", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    if (!(await requireOwner(i, tr))) return;
    const id = String(i.customId || "").replace("sanad:inst:start:", "");
    try {
      if (!i.deferred && !i.replied) await i.deferUpdate();
    } catch {
      /* ignore */
    }
    const result = await instanceManager.start(id);
    const row = instanceManager.get(id);
    if (!row) return safeUpdate(i, panel(tr, tr("commands.instance.notFound")));
    const notice = result.ok
      ? tr("commands.instance.startedNamed", { name: displayName(row) })
      : tr("commands.instance.startFail");
    return safeUpdate(i, detailPayload(tr, row, notice));
  });

  client.component("sanad:inst:restart:", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    if (!(await requireOwner(i, tr))) return;
    const id = String(i.customId || "").replace("sanad:inst:restart:", "");
    try {
      if (!i.deferred && !i.replied) await i.deferUpdate();
    } catch {
      /* ignore */
    }
    const result = await instanceManager.restart(id);
    const row = instanceManager.get(id);
    if (!row) return safeUpdate(i, panel(tr, tr("commands.instance.notFound")));
    const notice = result.ok
      ? tr("commands.instance.restartedNamed", { name: displayName(row) })
      : tr("commands.instance.startFail");
    return safeUpdate(i, detailPayload(tr, row, notice));
  });

  client.component("sanad:inst:delete:", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    if (!(await requireOwner(i, tr))) return;
    const id = String(i.customId || "").replace("sanad:inst:delete:", "");
    const row = instanceManager.get(id);
    if (!row) return safeUpdate(i, panel(tr, tr("commands.instance.notFound")));
    return safeUpdate(i, confirmDeletePayload(tr, row));
  });

  client.component("sanad:inst:confirm-delete:", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    if (!(await requireOwner(i, tr))) return;
    const id = String(i.customId || "").replace("sanad:inst:confirm-delete:", "");
    const before = instanceManager.get(id);
    const ok = await instanceManager.remove(id);
    const name = displayName(before) || id;
    return safeUpdate(
      i,
      panel(
        tr,
        ok ? tr("commands.instance.removedNamed", { name, id }) : tr("commands.instance.notFound"),
      ),
    );
  });

  const bulk = async (i, action) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    if (!(await requireOwner(i, tr))) return;
    try {
      if (!i.deferred && !i.replied) await i.deferUpdate();
    } catch {
      /* ignore */
    }
    let results = [];
    if (action === "pause") results = await instanceManager.pauseAll();
    else if (action === "start") results = await instanceManager.startAll();
    else if (action === "restart") results = await instanceManager.restartAll();
    const ok = results.filter((r) => r.ok).length;
    const fail = results.length - ok;
    const notice =
      fail > 0
        ? tr("commands.instance.bulkPartial", { ok, fail })
        : action === "pause"
          ? tr("commands.instance.bulkPaused")
          : action === "start"
            ? tr("commands.instance.bulkStarted")
            : tr("commands.instance.bulkRestarted");
    return safeUpdate(i, panel(tr, notice));
  };

  client.component("sanad:inst:pause-all", (i) => bulk(i, "pause"));
  client.component("sanad:inst:start-all", (i) => bulk(i, "start"));
  client.component("sanad:inst:restart-all", (i) => bulk(i, "restart"));
}
