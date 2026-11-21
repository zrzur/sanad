import { config } from "./config.js";

/** هوية سند البصرية — النصوص الديناميكية من i18n */
export const BRAND = {
  name: config.brand.name,
  nameEn: config.brand.nameEn,
  taglineKey: "brand.tagline",
  colour: {
    primary: config.brand.colour,
    success: "#14B8A6",
    warning: "#F59E0B",
    danger: "#EF4444",
    info: "#3B82F6",
    mute: "#64748B",
    level: "#8B5CF6",
    ticket: "#0EA5E9",
    giveaway: "#EC4899",
    star: "#EAB308",
  },
};

export function mentionUser(id) {
  return `<@${id}>`;
}

export function mentionRole(id) {
  return `<%${id}>`;
}

export function mentionChannel(id) {
  return `<#${id}>`;
}

/** Zrzur user id helper (`id` alias or `_id`) */
export function userId(user) {
  return user?.id ?? user?._id;
}
