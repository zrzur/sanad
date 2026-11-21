import {
  addInstanceRecord,
  getInstanceRecords,
  listInstances,
  removeInstanceRecord,
} from "./instances.js";

/**
 * Spawns child Sanad runtimes from other bots' tokens.
 * Same command set — public name comes from each bot account.
 */
export class InstanceManager {
  #createBot;
  #running = new Map();

  constructor(createBotFn) {
    this.#createBot = createBotFn;
  }

  list() {
    return listInstances().map((row) => ({
      ...row,
      online: this.#running.has(row.id),
    }));
  }

  async add(token, label) {
    const client = await this.#createBot({
      token: String(token).trim(),
      label: label || "child",
      syncCommands: true,
      instanceManager: this,
    });
    const botUserId = client.user?.id || client.user?._id;
    const username = client.user?.username;
    const rec = addInstanceRecord({
      label: label || username,
      token: String(token).trim(),
      botUserId,
      username,
    });
    this.#running.set(rec.id, client);
    return {
      ...rec,
      token: undefined,
      tokenMasked: listInstances().find((i) => i.id === rec.id)?.tokenMasked,
    };
  }

  async remove(id) {
    const client = this.#running.get(id);
    if (client) {
      try {
        client.destroy();
      } catch {
        /* ignore */
      }
      this.#running.delete(id);
    }
    return removeInstanceRecord(id);
  }

  async restoreAll() {
    for (const row of getInstanceRecords()) {
      if (this.#running.has(row.id)) continue;
      try {
        const client = await this.#createBot({
          token: row.token,
          label: row.label || row.id,
          syncCommands: true,
          instanceManager: this,
        });
        this.#running.set(row.id, client);
        console.log(`[sanad:instance] restored ${row.label} as ${client.user?.username}`);
      } catch (error) {
        console.error(`[sanad:instance] failed ${row.id}`, error?.message || error);
      }
    }
  }
}
