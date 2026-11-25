/**
 * Admin-only AutoMod control panel.
 * Callers: createBot.js → registerAutomodPanel + automodPanelCommands in syncCommands.
 * Complements setup.js (/config) with a live view of settings + recent hits.
 * Schema: snapshotAutomod / toggleAutomodKey / setAutomodAction from automod.js;
 * permissions: ManageServer on every interaction.
 * User: admin panel to see everything automod does + full settings + admin perms.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Permissions,
  SlashCommandBuilder,
} from "@zrzur/sdk/bot";
import { BRAND, mentionChannel, mentionRole, mentionUser } from "../brand.js";
import { baseEmbed, brandFooter } from "../util/format.js";
import { guildT } from "../util/locale.js";
import { actorHas } from "../util/permissions.js";
import {
  clearAutomodActivity,
  clearAutomodStrikes,
  setAutomodAction,
  snapshotAutomod,
  toggleAntiraidEnabled,
  toggleAutomodKey,
} from "./automod.js";

const ADMIN = Permissions.ManageServer;

function mark(on) {
  return on ? "✅" : "⬜";
}

function onOff(tr, on) {
  return on ? tr("common.enabled") : tr("common.disabled");
}

function deny(i, tr) {
  return i.reply({ content: tr("common.noPermission"), ephemeral: true });
}

function requireAdmin(i, tr) {
  if (actorHas(i, ADMIN)) return true;
  void deny(i, tr);
  return false;
}

function btn(id, label, style = ButtonStyle.Secondary) {
  return new ButtonBuilder().setCustomId(id).setLabel(String(label).slice(0, 80)).setStyle(style);
}

function tog(id, label, on) {
  return btn(id, `${mark(on)} ${label}`.slice(0, 80), on ? ButtonStyle.Success : ButtonStyle.Secondary);
}

function navRow(tr, view) {
  const active = (v) => (view === v ? ButtonStyle.Primary : ButtonStyle.Secondary);
  return new ActionRowBuilder().addComponents(
    btn("sanad:am:view:home", tr("automodPanel.nav.home"), active("home")),
    btn("sanad:am:view:filters", tr("automodPanel.nav.filters"), active("filters")),
    btn("sanad:am:view:policy", tr("automodPanel.nav.policy"), active("policy")),
    btn("sanad:am:view:activity", tr("automodPanel.nav.activity"), active("activity")),
    btn("sanad:am:view:raid", tr("automodPanel.nav.raid"), active("raid")),
  );
}

function footerRow(tr) {
  return new ActionRowBuilder().addComponents(
    btn("sanad:am:refresh", tr("automodPanel.btnRefresh"), ButtonStyle.Primary),
    btn("sanad:am:clear-activity", tr("automodPanel.btnClearLog"), ButtonStyle.Secondary),
    btn("sanad:am:clear-strikes", tr("automodPanel.btnClearStrikes"), ButtonStyle.Secondary),
    btn("sanad:am:end", tr("automodPanel.btnEnd"), ButtonStyle.Danger),
  );
}

function formatAge(ms, tr) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return tr("automodPanel.ageSec", { n: s });
  if (s < 3600) return tr("automodPanel.ageMin", { n: Math.floor(s / 60) });
  return tr("automodPanel.ageHr", { n: Math.floor(s / 3600) });
}

function buildHome(tr, snap) {
  const am = snap.automod;
  const raid = snap.antiraid;
  const hits1h = snap.activity.filter((e) => Date.now() - e.at < 3600_000).length;
  const embed = baseEmbed(am.enabled ? BRAND.colour.primary : BRAND.colour.mute, brandFooter(tr))
    .title(tr("automodPanel.title"))
    .description(tr("automodPanel.blurb"))
    .field(
      tr("automodPanel.fields.status"),
      [
        tr("automodPanel.lineMaster", { state: onOff(tr, am.enabled) }),
        tr("automodPanel.lineAction", {
          action: tr(`automod.actions.${am.action}`) || am.action,
        }),
        tr("automodPanel.lineEscalate", { state: onOff(tr, am.escalate || am.action === "escalate") }),
        tr("automodPanel.lineQuiet", { state: onOff(tr, am.quietAlerts) }),
        tr("automodPanel.lineBypass", { state: onOff(tr, am.bypassMods) }),
      ].join("\n"),
      true,
    )
    .field(
      tr("automodPanel.fields.live"),
      [
        tr("automodPanel.lineHits1h", { n: hits1h }),
        tr("automodPanel.lineHitsLog", { n: snap.activity.length }),
        tr("automodPanel.lineStrikes", { n: snap.activeStrikes }),
        tr("automodPanel.lineRaid", {
          state: onOff(tr, raid.enabled),
          lock: snap.raidLock ? tr("automodPanel.raidLocked") : tr("automodPanel.raidOpen"),
        }),
      ].join("\n"),
      true,
    )
    .field(
      tr("automodPanel.fields.thresholds"),
      [
        tr("automodPanel.thSpam", { n: am.spamCount, ms: am.spamWindowMs }),
        tr("automodPanel.thDup", { n: am.duplicateCount, ms: am.duplicateWindowMs }),
        tr("automodPanel.thMentions", { n: am.maxMentions }),
        tr("automodPanel.thCaps", { pct: am.maxCapsPercent, min: am.minCapsLength }),
        tr("automodPanel.thEmoji", { n: am.maxEmojis }),
        tr("automodPanel.thLines", { n: am.maxNewlines }),
        tr("automodPanel.thAttach", { n: am.maxAttachments, ms: am.attachmentWindowMs }),
        tr("automodPanel.thTimeout", { n: am.timeoutSeconds }),
        tr("automodPanel.thStrikes", {
          warn: am.strikeWarnAt,
          timeout: am.strikeTimeoutAt,
          window: Math.round(am.strikeWindowMs / 60000),
        }),
      ].join("\n"),
      false,
    )
    .field(
      tr("automodPanel.fields.lists"),
      [
        tr("automodPanel.listWords", {
          n: (am.badWords || []).length,
          sample: (am.badWords || []).slice(0, 5).join(", ") || tr("common.none"),
        }),
        tr("automodPanel.listDomains", {
          n: (am.allowDomains || []).length,
          sample: (am.allowDomains || []).slice(0, 5).join(", ") || tr("common.none"),
        }),
        tr("automodPanel.listRoles", {
          value: (am.ignoreRoles || []).length
            ? am.ignoreRoles.map((r) => mentionRole(r)).join(" ")
            : tr("common.none"),
        }),
        tr("automodPanel.listChannels", {
          value: (am.ignoreChannels || []).length
            ? am.ignoreChannels.map((c) => mentionChannel(c)).join(" ")
            : tr("common.none"),
        }),
      ].join("\n"),
      false,
    );

  const rows = [
    navRow(tr, "home"),
    new ActionRowBuilder().addComponents(
      tog("sanad:am:toggle:enabled", tr("automodPanel.toggle.enabled"), am.enabled),
      tog("sanad:am:toggle:escalate", tr("automodPanel.toggle.escalate"), am.escalate || am.action === "escalate"),
      tog("sanad:am:toggle:quietAlerts", tr("automodPanel.toggle.quiet"), am.quietAlerts),
      tog("sanad:am:toggle:bypassMods", tr("automodPanel.toggle.bypass"), am.bypassMods),
    ),
    footerRow(tr),
  ];
  return { embeds: [embed], components: rows };
}

function buildFilters(tr, snap) {
  const am = snap.automod;
  const line = (key, on) => `${mark(on)} **${tr(`automodPanel.filter.${key}`)}**`;
  const embed = baseEmbed(BRAND.colour.primary, brandFooter(tr))
    .title(tr("automodPanel.titleFilters"))
    .description(tr("automodPanel.blurbFilters"))
    .field(
      tr("automodPanel.fields.detectors"),
      [
        line("antiSpam", am.antiSpam),
        line("antiDuplicate", am.antiDuplicate),
        line("antiInvites", am.antiInvites),
        line("antiLinks", am.antiLinks),
        line("antiMassMention", am.antiMassMention),
        line("antiEmojiSpam", am.antiEmojiSpam),
        line("antiNewlines", am.antiNewlines),
        line("antiZalgo", am.antiZalgo),
        line("antiAttachments", am.antiAttachments),
      ].join("\n"),
      false,
    );

  const rows = [
    navRow(tr, "filters"),
    new ActionRowBuilder().addComponents(
      tog("sanad:am:toggle:antiSpam", tr("automodPanel.filter.antiSpam"), am.antiSpam),
      tog("sanad:am:toggle:antiDuplicate", tr("automodPanel.filter.antiDuplicate"), am.antiDuplicate),
      tog("sanad:am:toggle:antiInvites", tr("automodPanel.filter.antiInvites"), am.antiInvites),
      tog("sanad:am:toggle:antiLinks", tr("automodPanel.filter.antiLinks"), am.antiLinks),
      tog("sanad:am:toggle:antiMassMention", tr("automodPanel.filter.antiMassMention"), am.antiMassMention),
    ),
    new ActionRowBuilder().addComponents(
      tog("sanad:am:toggle:antiEmojiSpam", tr("automodPanel.filter.antiEmojiSpam"), am.antiEmojiSpam),
      tog("sanad:am:toggle:antiNewlines", tr("automodPanel.filter.antiNewlines"), am.antiNewlines),
      tog("sanad:am:toggle:antiZalgo", tr("automodPanel.filter.antiZalgo"), am.antiZalgo),
      tog("sanad:am:toggle:antiAttachments", tr("automodPanel.filter.antiAttachments"), am.antiAttachments),
    ),
    footerRow(tr),
  ];
  return { embeds: [embed], components: rows };
}

function buildPolicy(tr, snap) {
  const am = snap.automod;
  const embed = baseEmbed(BRAND.colour.primary, brandFooter(tr))
    .title(tr("automodPanel.titlePolicy"))
    .description(tr("automodPanel.blurbPolicy"))
    .field(
      tr("automodPanel.fields.policy"),
      [
        tr("automodPanel.lineAction", {
          action: tr(`automod.actions.${am.action}`) || am.action,
        }),
        tr("automodPanel.lineEscalate", { state: onOff(tr, am.escalate || am.action === "escalate") }),
        tr("automodPanel.thTimeout", { n: am.timeoutSeconds }),
        tr("automodPanel.thStrikes", {
          warn: am.strikeWarnAt,
          timeout: am.strikeTimeoutAt,
          window: Math.round(am.strikeWindowMs / 60000),
        }),
        tr("automodPanel.lineQuiet", { state: onOff(tr, am.quietAlerts) }),
        tr("automodPanel.alertMs", { n: am.alertDeleteMs }),
      ].join("\n"),
      false,
    )
    .field(tr("automodPanel.fields.hint"), tr("automodPanel.policyHint"), false);

  const cur = am.action || "delete";
  const act = (key) =>
    btn(
      `sanad:am:action:${key}`,
      tr(`automod.actions.${key}`),
      cur === key || (key === "escalate" && am.escalate) ? ButtonStyle.Success : ButtonStyle.Secondary,
    );

  const rows = [
    navRow(tr, "policy"),
    new ActionRowBuilder().addComponents(act("delete"), act("warn"), act("timeout"), act("escalate")),
    footerRow(tr),
  ];
  return { embeds: [embed], components: rows };
}

function buildActivity(tr, snap) {
  const lines = snap.activity.slice(0, 15).map((e, i) => {
    const reasons = (e.reasons || []).map((r) => tr(`automod.reasons.${r}`) || r).join(tr("automod.reasonSep"));
    return tr("automodPanel.activityLine", {
      i: i + 1,
      age: formatAge(Date.now() - e.at, tr),
      user: mentionUser(e.userId),
      reason: reasons || "-",
      action: tr(`automod.actions.${e.action}`) || e.action,
      strikes: e.strikes,
      channel: e.channelId ? mentionChannel(e.channelId) : "-",
    });
  });

  const embed = baseEmbed(BRAND.colour.warning, brandFooter(tr))
    .title(tr("automodPanel.titleActivity"))
    .description(tr("automodPanel.blurbActivity"))
    .field(
      tr("automodPanel.fields.activity"),
      lines.length ? lines.join("\n").slice(0, 1000) : tr("automodPanel.activityEmpty"),
      false,
    )
    .field(
      tr("automodPanel.fields.live"),
      [
        tr("automodPanel.lineHitsLog", { n: snap.activity.length }),
        tr("automodPanel.lineStrikes", { n: snap.activeStrikes }),
      ].join("\n"),
      true,
    );

  return {
    embeds: [embed],
    components: [navRow(tr, "activity"), footerRow(tr)],
  };
}

function buildRaid(tr, snap) {
  const raid = snap.antiraid;
  const embed = baseEmbed(raid.enabled ? BRAND.colour.danger : BRAND.colour.mute, brandFooter(tr))
    .title(tr("automodPanel.titleRaid"))
    .description(tr("automodPanel.blurbRaid"))
    .field(
      tr("automodPanel.fields.raid"),
      [
        tr("automodPanel.lineRaid", {
          state: onOff(tr, raid.enabled),
          lock: snap.raidLock ? tr("automodPanel.raidLocked") : tr("automodPanel.raidOpen"),
        }),
        tr("automodPanel.raidThreshold", { n: raid.joinThreshold, window: raid.joinWindowSec }),
        tr("automodPanel.raidAction", { action: raid.action }),
        tr("automodPanel.raidLockSec", { n: raid.lockSeconds }),
      ].join("\n"),
      false,
    );

  const rows = [
    navRow(tr, "raid"),
    new ActionRowBuilder().addComponents(
      tog("sanad:am:raid-toggle", tr("automodPanel.toggle.raid"), raid.enabled),
    ),
    footerRow(tr),
  ];
  return { embeds: [embed], components: rows };
}

function render(serverId, tr, view = "home") {
  const snap = snapshotAutomod(serverId);
  if (view === "filters") return buildFilters(tr, snap);
  if (view === "policy") return buildPolicy(tr, snap);
  if (view === "activity") return buildActivity(tr, snap);
  if (view === "raid") return buildRaid(tr, snap);
  return buildHome(tr, snap);
}

async function applyPanel(i, payload) {
  try {
    if (i.deferred || i.replied) return i.editReply(payload);
    return i.update(payload);
  } catch {
    return i.reply({ ...payload, ephemeral: true });
  }
}

export function automodPanelCommands() {
  return [
    new SlashCommandBuilder("automod", "Admin AutoMod control panel")
      .describe({
        en: "Admin AutoMod control panel — settings, filters, live hits",
        ar: "لوحة تحكم الأوتومود للإدارة — إعدادات وفلاتر وسجل الأحداث",
      })
      .permissions(ADMIN),
  ];
}

export function registerAutomodPanel(client) {
  client.command("automod", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    if (!requireAdmin(i, tr)) return;
    await i.defer({ ephemeral: true });
    await i.editReply(render(i.serverId, tr, "home"));
  });

  client.component("sanad:am:view:", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    if (!requireAdmin(i, tr)) return;
    const view = String(i.customId || "").replace("sanad:am:view:", "") || "home";
    await applyPanel(i, render(i.serverId, tr, view));
  });

  client.component("sanad:am:refresh", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    if (!requireAdmin(i, tr)) return;
    await applyPanel(i, render(i.serverId, tr, "home"));
  });

  client.component("sanad:am:end", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    if (!requireAdmin(i, tr)) return;
    const payload = {
      embeds: [
        baseEmbed(BRAND.colour.mute, brandFooter(tr))
          .title(tr("automodPanel.title"))
          .description(tr("automodPanel.closed")),
      ],
      components: [],
    };
    await applyPanel(i, payload);
  });

  client.component("sanad:am:clear-activity", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    if (!requireAdmin(i, tr)) return;
    clearAutomodActivity(i.serverId);
    await applyPanel(i, render(i.serverId, tr, "activity"));
  });

  client.component("sanad:am:clear-strikes", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    if (!requireAdmin(i, tr)) return;
    clearAutomodStrikes(i.serverId);
    await applyPanel(i, render(i.serverId, tr, "home"));
  });

  client.component("sanad:am:toggle:", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    if (!requireAdmin(i, tr)) return;
    const key = String(i.customId || "").replace("sanad:am:toggle:", "");
    const ok = toggleAutomodKey(i.serverId, key);
    if (ok == null) return i.reply({ content: tr("common.error"), ephemeral: true });
    const view = ["enabled", "escalate", "quietAlerts", "bypassMods"].includes(key) ? "home" : "filters";
    await applyPanel(i, render(i.serverId, tr, view));
  });

  client.component("sanad:am:action:", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    if (!requireAdmin(i, tr)) return;
    const action = String(i.customId || "").replace("sanad:am:action:", "");
    if (!setAutomodAction(i.serverId, action)) {
      return i.reply({ content: tr("common.error"), ephemeral: true });
    }
    await applyPanel(i, render(i.serverId, tr, "policy"));
  });

  client.component("sanad:am:raid-toggle", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    if (!requireAdmin(i, tr)) return;
    toggleAntiraidEnabled(i.serverId);
    await applyPanel(i, render(i.serverId, tr, "raid"));
  });
}

export function renderAutomodPanel(serverId, tr, view = "home") {
  return render(serverId, tr, view);
}