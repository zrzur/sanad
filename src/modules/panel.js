/**
 * Server guidelines / welcome panel — Zrzur layout blocks
 * (container, text, section, separator, gallery) + buttons.
 *
 * Callers: src/core/createBot.js → registerPanel(client) + panelCommands()
 * in syncCommands. No existing module posts a full guidelines layout panel
 * (tickets.js only has a simple ticket embed+button).
 * Schema: guilds.json → guild.panel { title, subtitle, about, rules, roles,
 * services, order, info, bannerUrl, accent } via getGuild/updateGuild.
 * User: "حاول تعتمد عليها وتبني عليها لا شوف اعتمد عليها وابني بالكامل عليها لا شوف."
 */
import { EmbedBuilder, Permissions, SlashCommandBuilder } from "@zrzur/sdk/bot";
import { BRAND } from "../brand.js";
import { getGuild, updateGuild } from "../db/store.js";
import { guildT } from "../util/locale.js";
import { actorHas } from "../util/permissions.js";

export function defaultPanelConfig() {
  return {
    title: null,
    subtitle: null,
    about: null,
    rules: null,
    roles: null,
    services: null,
    order: null,
    info: null,
    bannerUrl: null,
    accent: null,
  };
}

export function ensurePanel(cfg) {
  if (!cfg.panel || typeof cfg.panel !== "object") cfg.panel = defaultPanelConfig();
  return cfg.panel;
}

function panelText(p, key, fallback) {
  const v = p?.[key];
  return v && String(v).trim() ? String(v).trim() : fallback;
}

/** Zrzur layout-block panel (container + sections + buttons). */
export function buildPanelLayout(cfg, tr) {
  const p = ensurePanel(cfg);
  const title = panelText(p, "title", tr("commands.panel.defaultTitle"));
  const subtitle = panelText(p, "subtitle", tr("commands.panel.defaultSubtitle"));
  const about = panelText(p, "about", tr("commands.panel.defaultAbout"));
  const order = panelText(p, "order", tr("commands.panel.defaultOrder"));
  const info = panelText(p, "info", tr("commands.panel.defaultInfo"));
  const accent = p.accent || BRAND.colour.primary;

  const inner = [{ type: "text", content: `## ${title}\n${subtitle}` }];

  if (p.bannerUrl && /^https?:\/\//i.test(p.bannerUrl)) {
    inner.push({ type: "gallery", items: [p.bannerUrl] });
  }

  inner.push(
    { type: "separator" },
    {
      type: "text",
      content: `### ${tr("commands.panel.aboutHeading")}\n${about}`,
    },
    { type: "separator" },
    {
      type: "section",
      text: `### ${tr("commands.panel.orderHeading")}\n${order}`,
      button: {
        type: "button",
        style: "primary",
        label: tr("commands.panel.openTicket").slice(0, 80),
        customId: "sanad:ticket:open",
      },
    },
    { type: "separator" },
    {
      type: "text",
      content: `### ${tr("commands.panel.infoHeading")}\n${info}`,
    },
    {
      type: "button",
      style: "secondary",
      label: tr("commands.panel.btnRules").slice(0, 80),
      customId: "sanad:panel:rules",
    },
    {
      type: "button",
      style: "secondary",
      label: tr("commands.panel.btnRoles").slice(0, 80),
      customId: "sanad:panel:roles",
    },
    {
      type: "button",
      style: "secondary",
      label: tr("commands.panel.btnServices").slice(0, 80),
      customId: "sanad:panel:services",
    },
  );

  return {
    components: [
      {
        type: "container",
        accent,
        components: inner,
      },
    ],
  };
}

/** Classic embed + buttons if layout blocks are rejected. */
export function buildPanelFallback(cfg, tr) {
  const p = ensurePanel(cfg);
  const title = panelText(p, "title", tr("commands.panel.defaultTitle"));
  const subtitle = panelText(p, "subtitle", tr("commands.panel.defaultSubtitle"));
  const about = panelText(p, "about", tr("commands.panel.defaultAbout"));
  const order = panelText(p, "order", tr("commands.panel.defaultOrder"));
  const info = panelText(p, "info", tr("commands.panel.defaultInfo"));

  const embed = new EmbedBuilder()
    .title(title)
    .description(
      [
        subtitle,
        "",
        `**${tr("commands.panel.aboutHeading")}**`,
        about,
        "",
        `**${tr("commands.panel.orderHeading")}**`,
        order,
        "",
        `**${tr("commands.panel.infoHeading")}**`,
        info,
      ].join("\n"),
    )
    .colour(p.accent || BRAND.colour.primary)
    .footer(tr("brand.name"))
    .timestamp();

  if (p.bannerUrl && /^https?:\/\//i.test(p.bannerUrl)) {
    embed.image(p.bannerUrl);
  }

  return {
    embeds: [embed],
    components: [
      {
        type: "button",
        style: "primary",
        label: tr("commands.panel.openTicket").slice(0, 80),
        customId: "sanad:ticket:open",
      },
      {
        type: "button",
        style: "secondary",
        label: tr("commands.panel.btnRules").slice(0, 80),
        customId: "sanad:panel:rules",
      },
      {
        type: "button",
        style: "secondary",
        label: tr("commands.panel.btnRoles").slice(0, 80),
        customId: "sanad:panel:roles",
      },
      {
        type: "button",
        style: "secondary",
        label: tr("commands.panel.btnServices").slice(0, 80),
        customId: "sanad:panel:services",
      },
    ],
  };
}

export async function postPanel(client, channelId, cfg, tr) {
  try {
    return await client.send(channelId, buildPanelLayout(cfg, tr));
  } catch (error) {
    console.warn("[sanad:panel] layout send:", error?.message || error?.type || error);
    return client.send(channelId, buildPanelFallback(cfg, tr));
  }
}

function infoEmbed(tr, title, body) {
  return new EmbedBuilder()
    .title(title)
    .description(String(body || tr("common.none")).slice(0, 4000))
    .colour(BRAND.colour.info)
    .footer(tr("brand.name"))
    .timestamp();
}

export function panelCommands() {
  return [
    new SlashCommandBuilder("panel", "Post server guidelines panel")
      .describe({
        en: "Post server guidelines panel",
        ar: "نشر لوحة قواعد وتعريف السيرفر",
      })
      .subcommand("post", "Post the panel in this channel")
      .subcommand("set", "Configure panel text", (s) =>
        s
          .string("title", "Panel title", {
            maxLength: 120,
            descriptions: { en: "Panel title", ar: "عنوان اللوحة" },
          })
          .string("subtitle", "Short subtitle", {
            maxLength: 200,
            descriptions: { en: "Short subtitle", ar: "وصف قصير" },
          })
          .string("about", "About section", {
            maxLength: 1000,
            descriptions: { en: "About section", ar: "قسم من نحن" },
          })
          .string("rules", "Rules text (button)", {
            maxLength: 2000,
            descriptions: { en: "Rules text", ar: "نص القواعد" },
          })
          .string("roles", "Roles info (button)", {
            maxLength: 2000,
            descriptions: { en: "Roles info", ar: "معلومات الأدوار" },
          })
          .string("services", "Services text (button)", {
            maxLength: 2000,
            descriptions: { en: "Services text", ar: "نص الخدمات" },
          })
          .string("order", "How to order / open ticket blurb", {
            maxLength: 500,
            descriptions: { en: "Order blurb", ar: "نص طلب التذكرة" },
          })
          .string("banner", "Banner image URL", {
            maxLength: 300,
            descriptions: { en: "Banner image URL", ar: "رابط صورة البانر" },
          })
          .string("accent", "Accent colour hex e.g. #E0195F", {
            maxLength: 9,
            descriptions: { en: "Accent colour", ar: "لون الشريط" },
          }),
      )
      .permissions(Permissions.ManageServer),
  ];
}

export function registerPanel(client) {
  client.command("panel", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    if (!actorHas(i, Permissions.ManageServer)) {
      return i.reply({ content: tr("common.noPermission"), ephemeral: true });
    }

    const sub = i.subcommand || "post";
    const cfg = getGuild(i.serverId);
    ensurePanel(cfg);

    if (sub === "set") {
      updateGuild(i.serverId, (c) => {
        const p = ensurePanel(c);
        for (const key of ["title", "subtitle", "about", "rules", "roles", "services", "order"]) {
          const v = i.option(key);
          if (v != null && String(v).trim()) p[key] = String(v).trim();
        }
        const banner = i.option("banner");
        if (banner != null && String(banner).trim()) {
          p.bannerUrl = String(banner).trim();
        }
        const accent = i.option("accent");
        if (accent && /^#?[0-9A-Fa-f]{6}$/.test(String(accent).trim())) {
          const hex = String(accent).trim();
          p.accent = hex.startsWith("#") ? hex : `#${hex}`;
        }
      });
      return i.reply({ content: tr("commands.panel.saved"), ephemeral: true });
    }

    await i.defer({ ephemeral: true });
    try {
      await postPanel(client, i.channelId, getGuild(i.serverId), tr);
      await i.editReply(tr("commands.panel.posted"));
    } catch (error) {
      console.warn("[sanad:panel] post:", error?.message || error);
      await i.editReply(tr("commands.panel.fail"));
    }
  });

  const showSection = async (i, field, titleKey, defaultKey) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const p = ensurePanel(getGuild(i.serverId));
    const body = panelText(p, field, tr(defaultKey));
    await i.reply({
      embeds: [infoEmbed(tr, tr(titleKey), body)],
      ephemeral: true,
    });
  };

  client.component("sanad:panel:rules", (i) =>
    showSection(i, "rules", "commands.panel.btnRules", "commands.panel.defaultRules"),
  );
  client.component("sanad:panel:roles", (i) =>
    showSection(i, "roles", "commands.panel.btnRoles", "commands.panel.defaultRoles"),
  );
  client.component("sanad:panel:services", (i) =>
    showSection(i, "services", "commands.panel.btnServices", "commands.panel.defaultServices"),
  );
}
