/**
 * The Raven packages the wallet runs on.
 *
 * They install from the npm registry at pinned versions, so a clone needs no file from outside
 * the repo. The SDK takes the wallet's own engine: it names the engine as a peer, and a second
 * copy would type the SDK against an engine the wallet never starts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { installPanicHook } from "@hisoka-io/railgun-poi-node-interface";
import * as ravenWasm from "@hisoka-io/raven-inspire-client-wasm";

const ROOT = process.cwd();
const RAVEN = {
  "@hisoka-io/railgun-poi-node-interface": "0.1.0-alpha.0",
  "@hisoka-io/raven-inspire-client-wasm": "0.1.0-alpha.0",
};

const readJson = (file: string) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf-8"));

test("the Raven packages are pinned to registry versions, and nothing installs from a local file", () => {
  const { dependencies, devDependencies } = readJson("package.json");
  for (const [name, version] of Object.entries(RAVEN)) {
    assert.equal(dependencies[name], version, name);
  }
  for (const [name, spec] of Object.entries({ ...dependencies, ...devDependencies })) {
    assert.ok(!/^(file|link):|\.tgz$/.test(spec as string), `${name}: ${spec}`);
  }
});

test("the lockfile fetches each Raven package from registry.npmjs.org and checks its hash", () => {
  const { packages } = readJson("package-lock.json");
  for (const [name, version] of Object.entries(RAVEN)) {
    const entry = packages[`node_modules/${name}`];
    assert.equal(entry?.version, version, name);
    assert.equal(
      entry.resolved,
      `https://registry.npmjs.org/${name}/-/${name.split("/")[1]}-${version}.tgz`,
    );
    assert.match(entry.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/);
  }
  const local = Object.entries(packages).filter(([, e]) =>
    /^(file|link):/.test((e as { resolved?: string }).resolved ?? ""),
  );
  assert.deepEqual(local.map(([key]) => key), []);
});

test("one engine: the SDK resolves the wallet's own copy", () => {
  const { packages } = readJson("package-lock.json");
  const engines = Object.keys(packages).filter((k) =>
    k.endsWith("node_modules/@railgun-community/engine"),
  );
  assert.deepEqual(engines, ["node_modules/@railgun-community/engine"]);
  const fromRoot = createRequire(path.join(ROOT, "package.json"));
  const sdkDir = path.dirname(fromRoot.resolve("@hisoka-io/railgun-poi-node-interface/package.json"));
  const fromSdk = createRequire(path.join(sdkDir, "package.json"));
  assert.equal(
    fromSdk.resolve("@railgun-community/engine"),
    fromRoot.resolve("@railgun-community/engine"),
  );
});

test("the Node wasm exports every call the SDK makes", () => {
  const required = [
    "build_client_session",
    "build_seeded_query",
    "extract_response",
    "register_client_session",
    "client_packing_keys_versioned",
    "install_server_session_handle",
    "build_instance_params_blob",
    "serialize_client_session",
    "deserialize_client_session",
    "init_panic_hook",
  ] as const;
  const exported = ravenWasm as unknown as Record<string, unknown>;
  assert.deepEqual(required.filter((name) => typeof exported[name] !== "function"), []);
  assert.equal(installPanicHook(ravenWasm), true);
});
