import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";

const lockPath = join(config.dataDir, "sanad.pid");

/** Ensure only one Sanad main process runs (prevents double replies / panels). */
export function acquirePidLock() {
  if (existsSync(lockPath)) {
    try {
      const old = Number(readFileSync(lockPath, "utf8").trim());
      if (old && old !== process.pid) {
        try {
          process.kill(old, 0);
          // Called from src/index.js → acquirePidLock() before createBot.
          // No other single-instance guard exists. Writes data/sanad.pid.
          // User: stale bots kept old slash/buttons alive after restart — replace prior pid.
          try {
            process.kill(old, "SIGTERM");
          } catch {
            try {
              process.kill(old);
            } catch {
              /* ignore */
            }
          }
          const until = Date.now() + 2500;
          while (Date.now() < until) {
            try {
              process.kill(old, 0);
            } catch {
              break;
            }
            const start = Date.now();
            while (Date.now() - start < 100) {
              /* spin */
            }
          }
          try {
            process.kill(old, 0);
            process.kill(old, "SIGKILL");
          } catch {
            /* gone */
          }
          console.warn(`[sanad] replaced previous instance (pid ${old})`);
        } catch {
          /* stale lock */
        }
      }
    } catch {
      /* ignore */
    }
  }
  writeFileSync(lockPath, String(process.pid), "utf8");
  const clear = () => {
    try {
      if (existsSync(lockPath) && readFileSync(lockPath, "utf8").trim() === String(process.pid)) {
        unlinkSync(lockPath);
      }
    } catch {
      /* ignore */
    }
  };
  process.on("exit", clear);
  process.on("SIGINT", () => {
    clear();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    clear();
    process.exit(0);
  });
}
