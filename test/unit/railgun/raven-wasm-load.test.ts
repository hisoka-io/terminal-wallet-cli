/**
 * When and where the Raven PIR client's wasm loads.
 *
 * Its module reads a .wasm from its own folder as it loads. With Raven off the wallet must start
 * without it, and the release build, which bundles every module into one file, must ship that
 * .wasm where the bundled module looks for it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as esbuild from "esbuild";

const ROOT = process.cwd();
const WASM_PACKAGE = "@hisoka-io/raven-inspire-client-wasm";

const loaded = (fragment: string) =>
  Object.keys(require.cache).some((file) => file.split(path.sep).join("/").includes(fragment));

test("with Raven off, the wallet's Raven module loads and installs nothing from the wasm package", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "twallet-raven-off-"));
  try {
    fs.writeFileSync(
      path.join(dir, "twallet.config.json"),
      JSON.stringify({ raven: { enabled: false } }),
    );
    process.chdir(dir);
    const { installRavenPOI } = await import("../../../src/railgun/poi/raven.js");
    await installRavenPOI();
    // The interface package is loaded by then, so the lookup does see the wallet's dependencies.
    assert.ok(loaded("@hisoka-io/railgun-poi-node-interface/"));
    assert.ok(!loaded(`${WASM_PACKAGE}/`));
  } finally {
    process.chdir(ROOT);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("bundled as the release build bundles it, the wasm loads from a file ship.mjs keeps beside the bundle", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "twallet-raven-bundle-"));
  try {
    const bundle = path.join(dir, "bundle.js");
    await esbuild.build({
      stdin: {
        contents: `process.stdout.write(typeof require("${WASM_PACKAGE}").build_client_session);`,
        resolveDir: ROOT,
      },
      bundle: true,
      platform: "node",
      outfile: bundle,
      logLevel: "silent",
    });
    const run = () => spawnSync(process.execPath, [bundle], { encoding: "utf-8" });

    const alone = run();
    assert.notEqual(alone.status, 0);
    const wanted = /ENOENT[^\n]*open '([^']+)'/.exec(alone.stderr)?.[1];
    assert.ok(wanted !== undefined, alone.stderr);
    const name = path.basename(wanted);
    assert.equal(fs.realpathSync(path.dirname(wanted)), fs.realpathSync(dir));

    const ship = fs.readFileSync(path.join(ROOT, "ship.mjs"), "utf-8");
    assert.ok(ship.includes(`"${name}"`), `ship.mjs does not ship ${name}`);

    fs.copyFileSync(path.join(ROOT, "node_modules", WASM_PACKAGE, name), path.join(dir, name));
    const beside = run();
    assert.equal(beside.status, 0, beside.stderr);
    assert.equal(beside.stdout, "function");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
