/**
 * The Raven stores on disk: one file per key, owner-only, because the submitted-proof record
 * names the wallet's own notes. The wire log is owner-only too: it records every Raven request.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import type {
  PoiListIndexStore,
  SubmittedProofStore,
} from "@hisoka-io/railgun-poi-node-interface";

/** Replaced atomically, so a crash mid-write leaves the previous record. */
export const fileStore = (dir: string): PoiListIndexStore & SubmittedProofStore => {
  const fileFor = (key: string) =>
    path.join(dir, `${crypto.createHash("sha256").update(key).digest("hex").slice(0, 32)}.bin`);
  return {
    async load(key) {
      try {
        return new Uint8Array(await fs.promises.readFile(fileFor(key)));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw err;
      }
    },
    async save(key, record) {
      await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
      const file = fileFor(key);
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.promises.writeFile(tmp, record, { mode: 0o600 });
      await fs.promises.rename(tmp, file);
    },
  };
};

/** One JSON line, in a file created 600. */
export const appendWireRecord = (file: string, record: object): void => {
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, { mode: 0o600 });
};
