/**
 * The wallet's stores are owner-only: the engine database, the keychain, the
 * Raven list index and submitted-proof records, and the Raven wire log. They
 * name the wallet's notes and addresses, so another local user must not read
 * them. Checked under a permissive umask, since the explicit modes must hold
 * without the one main() sets.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendWireRecord, fileStore } from "../../../src/railgun/poi/file-store";
import { saveKeychainFile } from "../../../src/railgun/wallet/wallet-cache";
import { KeychainFile } from "../../../src/models/wallet-models";

const mode = (p: string) => fs.statSync(p).mode & 0o777;
const src = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), "src", rel), "utf-8");

const inScratch = async (fn: (dir: string) => Promise<void> | void) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "twallet-modes-"));
  const cwd = process.cwd();
  const umask = process.umask(0o022);
  try {
    process.chdir(dir);
    await fn(dir);
  } finally {
    process.umask(umask);
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test("the Raven store creates its directories 700 and its records 600", async () => {
  await inScratch(async (dir) => {
    const root = path.join(dir, ".raven-poi");
    const store = fileStore(path.join(root, "0-1"));
    await store.save("index", new Uint8Array([1, 2, 3]));
    assert.equal(mode(root), 0o700);
    assert.equal(mode(path.join(root, "0-1")), 0o700);
    const [record] = fs.readdirSync(path.join(root, "0-1"));
    assert.equal(mode(path.join(root, "0-1", record)), 0o600);
    assert.deepEqual(await store.load("index"), new Uint8Array([1, 2, 3]));
  });
});

test("the keychain is written 600 in a 700 directory", async () => {
  await inScratch(() => {
    saveKeychainFile({ name: "alpha", salt: "0xsalt" } as KeychainFile, ".kc");
    assert.equal(mode(".kc"), 0o700);
    assert.equal(mode(path.join(".kc", "alpha.zKey")), 0o600);
  });
});

test("main() makes every file the process creates owner-only, before anything else", () => {
  const main = src("main.ts");
  const body = main.slice(main.indexOf("const main = async () => {"));
  const firstStatement = body.split("\n").slice(1).find((l) => l.trim() && !l.trim().startsWith("//"));
  assert.equal(firstStatement?.trim(), "process.umask(0o077);");
});

test("the engine database directory is created 700 before the database opens", () => {
  const engine = src("railgun/engine/engine.ts");
  const mkdir = engine.indexOf("fs.mkdirSync(RAILGUN_DB_PATH, { recursive: true, mode: 0o700 });");
  const open = engine.indexOf("new LevelDOWN(RAILGUN_DB_PATH)");
  assert.ok(mkdir > 0 && open > mkdir);
});

test("the Raven wire log is created 600 and the interface appends through it", async () => {
  await inScratch(() => {
    appendWireRecord("wire.jsonl", { url: "a" });
    appendWireRecord("wire.jsonl", { url: "b" });
    assert.equal(mode("wire.jsonl"), 0o600);
    assert.equal(fs.readFileSync("wire.jsonl", "utf-8"), '{"url":"a"}\n{"url":"b"}\n');
  });
  assert.match(src("railgun/poi/raven.ts"), /appendWireRecord\(wireLog, \{/);
});
