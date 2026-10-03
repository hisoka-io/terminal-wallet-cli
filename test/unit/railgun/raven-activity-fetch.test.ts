/**
 * The Raven request reporter: one status line per request, and for the node one wire-log
 * entry, whether the request succeeds or throws. Durations come from the monotonic clock, so a
 * wall-clock step mid-request cannot print a negative time.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NetworkName } from "@railgun-community/shared-models";
import { onCoreEvent } from "../../../src/core/events";
import { activityFetch } from "../../../src/railgun/poi/raven";

const NODE = "https://raven.example";

const run = async (
  fakeFetch: typeof fetch,
  body: (reporter: typeof fetch) => Promise<void>,
): Promise<{ lines: string[]; wire: Record<string, unknown>[] }> => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "twallet-activity-"));
  const wireLog = path.join(dir, "wire.jsonl");
  const lines: string[] = [];
  const off = onCoreEvent((e) => {
    if (e.type === "status:message") lines.push(e.text);
  });
  const realFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch;
  try {
    await body(activityFetch(NetworkName.EthereumSepolia, NODE, wireLog));
    const wire = fs.existsSync(wireLog)
      ? fs.readFileSync(wireLog, "utf-8").trim().split("\n").map((l) => JSON.parse(l))
      : [];
    return { lines, wire };
  } finally {
    globalThis.fetch = realFetch;
    off();
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test("a wall-clock step back mid-request still reports a non-negative duration", async (t) => {
  let wall = 1_800_000_000_000;
  t.mock.method(Date, "now", () => (wall -= 1001));
  const { lines, wire } = await run(
    async () => new Response(new Uint8Array(4), { status: 200 }),
    async (reporter) => {
      await reporter(`${NODE}/query`, { method: "POST", body: new Uint8Array(2) });
    },
  );
  assert.equal(lines.length, 1);
  const ms = Number(/, (-?\d+) ms$/.exec(lines[0])?.[1]);
  assert.ok(ms >= 0, lines[0]);
  assert.equal(wire.length, 1);
  assert.ok((wire[0].ms as number) >= 0);
});

test("a request that throws prints one status line and one wire entry naming the error, then rethrows", async () => {
  const thrown = new TypeError("fetch failed");
  let caught: unknown;
  const { lines, wire } = await run(
    async () => {
      throw thrown;
    },
    async (reporter) => {
      try {
        await reporter(`${NODE}/query`, { method: "POST", body: new Uint8Array(3) });
      } catch (err) {
        caught = err;
      }
    },
  );
  assert.equal(caught, thrown);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^Raven query \(Ethereum_Sepolia\): failed, TypeError: fetch failed, 3 B up, 0 B down, \d+ ms$/);
  assert.equal(wire.length, 1);
  assert.equal(wire[0].error, "TypeError: fetch failed");
  assert.equal(wire[0].status, null);
  assert.equal(wire[0].down, 0);
  assert.equal(wire[0].url, `${NODE}/query`);
});
