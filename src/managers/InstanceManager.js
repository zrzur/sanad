import {
  addInstanceRecord,
  getInstanceRecord,
  getInstanceRecords,
  listInstances,
  removeInstanceRecord,
  updateInstanceRecord,
} from "./instances.js";

/**
 * Spawns / pauses / restarts / removes child Sanad runtimes from bot tokens.
 */
export class InstanceManager {
  #createBot;
  #running = new Map();

  constructor(createBotFn) {
    this.#createBot = createBotFn;
  }

  list() {
    return listInstances().map((row) => {
      const online = this.#running.has(row.id);
      return {
        ...row,
        online,
        paused: !online && Boolean(row.paused),
      };
    });
  }

  get(id) {
    return this.list().find((r) => r.id === id) || null;
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
    updateInstanceRecord(rec.id, { paused: false, username, botUserId });
    return {
      ...rec,
      token: undefined,
      online: true,
      paused: false,
      tokenMasked: listInstances().find((i) => i.id === rec.id)?.tokenMasked,
    };
  }

  /** Soft-stop: disconnect but keep the bot in the list for later start. */
  async pause(id) {
    const row = getInstanceRecord(id);
    if (!row) return { ok: false, reason: "missing" };
    const client = this.#running.get(id);
    if (client) {
      try {
        if (typeof client.destroy === "function") await Promise.resolve(client.destroy());
        else if (typeof client.logout === "function") await Promise.resolve(client.logout());
      } catch (error) {
        console.warn(`[sanad:instance] pause destroy ${id}:`, error?.message || error);
      }
      this.#running.delete(id);
    }
    updateInstanceRecord(id, { paused: true, pausedAt: new Date().toISOString() });
    console.log(`[sanad:instance] paused ${row.username || row.label || id}`);
    return { ok: true, already: !client };
  }

  /** Start a paused / offline instance from stored token. */
  async start(id) {
    const row = getInstanceRecord(id);
    if (!row?.token) return { ok: false, reason: "missing" };
    if (this.#running.has(id)) return { ok: true, already: true, username: row.username };

    try {
      const client = await this.#createBot({
        token: row.token,
        label: row.label || row.id,
        syncCommands: true,
        instanceManager: this,
      });
      this.#running.set(id, client);
      const username = client.user?.username || row.username;
      const botUserId = client.user?.id || client.user?._id || row.botUserId;
      updateInstanceRecord(id, {
        paused: false,
        pausedAt: null,
        username,
        botUserId,
        lastStartedAt: new Date().toISOString(),
      });
      return { ok: true, username };
    } catch (error) {
      console.error(`[sanad:instance] start ${id}:`, error?.message || error);
      updateInstanceRecord(id, { paused: true });
      return { ok: false, reason: "start_failed", error };
    }
  }

  async restart(id) {
    const row = getInstanceRecord(id);
    if (!row) return { ok: false, reason: "missing" };
    await this.pause(id);
    return this.start(id);
  }

  /** Permanent remove: disconnect + delete from disk. */
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

  async pauseAll() {
    const results = [];
    for (const row of getInstanceRecords()) {
      results.push({ id: row.id, ...(await this.pause(row.id)) });
    }
    return results;
  }

  async startAll() {
    const results = [];
    for (const row of getInstanceRecords()) {
      if (this.#running.has(row.id)) {
        results.push({ id: row.id, ok: true, already: true });
        continue;
      }
      results.push({ id: row.id, ...(await this.start(row.id)) });
    }
    return results;
  }

  async restartAll() {
    const results = [];
    for (const row of getInstanceRecords()) {
      results.push({ id: row.id, ...(await this.restart(row.id)) });
    }
    return results;
  }

  async restoreAll() {
    for (const row of getInstanceRecords()) {
      if (row.paused) {
        console.log(`[sanad:instance] skip paused ${row.label || row.id}`);
        continue;
      }
      if (this.#running.has(row.id)) continue;
      try {
        const client = await this.#createBot({
          token: row.token,
          label: row.label || row.id,
          syncCommands: true,
          instanceManager: this,
        });
        this.#running.set(row.id, client);
        updateInstanceRecord(row.id, {
          username: client.user?.username || row.username,
          botUserId: client.user?.id || client.user?._id || row.botUserId,
          paused: false,
        });
        console.log(`[sanad:instance] restored ${row.label} as ${client.user?.username}`);
      } catch (error) {
        console.error(`[sanad:instance] failed ${row.id}`, error?.message || error);
        updateInstanceRecord(row.id, { paused: true });
      }
    }
  }
}
