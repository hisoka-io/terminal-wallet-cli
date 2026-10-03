/**
 * The shipped Sepolia run config.
 *
 * If the mainnet remote-config read fails, the built-in fallback lists no PPOI
 * aggregator, and an engine with no POI URL retries its txid reads forever. The
 * template pins the aggregator itself, so a run keeps one with Raven on or off. It ships in the repo, so it carries no
 * credential.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NETWORK_CONFIG, NetworkName } from "@railgun-community/shared-models";
import type { AppConfig } from "../../../src/config/config-manager";

const TEMPLATE = path.resolve(process.cwd(), "twallet.config.sepolia.example.json");
const template = (): AppConfig => JSON.parse(fs.readFileSync(TEMPLATE, "utf-8")) as AppConfig;

const urls = (config: AppConfig): string[] => [
  ...Object.values(config.providers ?? {}).flat(),
  ...(config.poiNodeUrls ?? []),
  ...(config.raven?.chains ?? []).flatMap((c) => [c.endpoint, c.aggregator]),
];

test("it runs Sepolia, with Raven serving the chain it runs", () => {
  const config = template();
  const network = (NetworkName as Record<string, NetworkName>)[config.defaultNetwork ?? ""];
  assert.equal(network, NetworkName.EthereumSepolia);
  assert.equal(NETWORK_CONFIG[network].isTestnet, true);
  assert.deepEqual(config.raven?.chains?.map((c) => c.network), ["EthereumSepolia"]);
  assert.ok((config.providers?.EthereumSepolia ?? []).length > 0);
});

test("it pins the PPOI aggregator for the engine and for Raven", () => {
  const config = template();
  assert.deepEqual(config.poiNodeUrls, ["https://ppoi.fdi.network"]);
  for (const chain of config.raven?.chains ?? []) {
    assert.equal(chain.aggregator, "https://ppoi.fdi.network");
    assert.ok(chain.pathInstances.length > 0);
  }
});

test("it carries no credential", () => {
  const config = template();
  assert.ok(config.raven?.chains?.every((c) => c.bearerToken === undefined));
  assert.equal(config.remoteConfigRpc, undefined);
  for (const raw of urls(config)) {
    const url = new URL(raw);
    assert.equal(url.username + url.password + url.search, "", raw);
    for (const segment of url.pathname.split("/")) {
      assert.ok(!/^[A-Za-z0-9_-]{20,}$/.test(segment), `${raw} carries a key-shaped path segment`);
    }
  }
});

test("with the remote config's empty fallback, the engine still gets an aggregator in the stock run", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "twallet-template-"));
  const cwd = process.cwd();
  try {
    const stock = template();
    stock.raven = { ...stock.raven, enabled: false };
    fs.writeFileSync(path.join(dir, "twallet.config.json"), JSON.stringify(stock));
    process.chdir(dir);
    const { resolvePoiNodeUrls } = await import("../../../src/railgun/poi/raven.js");
    assert.deepEqual(resolvePoiNodeUrls([]), ["https://ppoi.fdi.network"]);
  } finally {
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
