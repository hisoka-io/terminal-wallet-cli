/**
 * --selftest and --status check the network twallet.config.json names.
 *
 * They used to check the build default (Ethereum) whatever the config said, so
 * a Sepolia config had no pre-flight check at all.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NetworkName } from "@railgun-community/shared-models";

test("the diagnostic network follows the configured default network", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "twallet-diag-"));
  const cwd = process.cwd();
  try {
    fs.writeFileSync(
      path.join(dir, "twallet.config.json"),
      JSON.stringify({ defaultNetwork: "EthereumSepolia" }),
    );
    // The config path is fixed at import, so the import happens inside the scratch dir.
    process.chdir(dir);
    const { diagnosticNetwork } = await import("../../../src/diagnostic/report.js");
    assert.equal(diagnosticNetwork(), NetworkName.EthereumSepolia);
  } finally {
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
