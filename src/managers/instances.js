import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";

mkdirSync(config.dataDir, { recursive: true });
const file = join(config.dataDir, "instances.json");

function read() {
  if (!existsSync(file)) return { items: [] };
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { items: [] };
  }
}

function write(data) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  renameSync(tmp, file);
}

export function maskToken(token) {
  if (!token || token.length < 10) return "***";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

export function listInstances() {
  return read().items.map(({ token, ...rest }) => ({
    ...rest,
    tokenMasked: maskToken(token),
  }));
}

export function getInstanceRecords() {
  return read().items;
}

export function addInstanceRecord({ label, token, botUserId, username }) {
  const data = read();
  const id = createHash("sha256").update(token).digest("hex").slice(0, 10);
  data.items = data.items.filter((i) => i.id !== id && i.token !== token);
  data.items.push({
    id,
    label: label || username || id,
    token,
    botUserId,
    username,
    createdAt: new Date().toISOString(),
    nonce: randomBytes(8).toString("hex"),
  });
  write(data);
  return data.items.find((i) => i.id === id);
}

export function removeInstanceRecord(id) {
  const data = read();
  const before = data.items.length;
  data.items = data.items.filter((i) => i.id !== id);
  write(data);
  return before !== data.items.length;
}
