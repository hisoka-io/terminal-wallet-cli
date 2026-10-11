/**
 * A fresh keychain boots on the configured default network.
 *
 * It used to boot on mainnet whatever `defaultNetwork` said, while the deck showed the configured
 * network: a Sepolia config scanned, signed and read balances on mainnet.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NetworkName } from "@railgun-community/shared-models";
import type { KeychainFile } from "../../../../src/models/wallet-models";

test("a fresh keychain boots on defaultNetwork; one that switched keeps its network", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "twallet-boot-"));
  const cwd = process.cwd();
  try {
    fs.writeFileSync(
      path.join(dir, "twallet.config.json"),
      JSON.stringify({ defaultNetwork: "EthereumSepolia" }),
    );
    // The config path is fixed at import, so the import happens inside the scratch dir.
    process.chdir(dir);
    const { bootNetwork } = await import("../../../../src/railgun/wallet/wallet-init.js");

    const fresh: KeychainFile = { name: ".plasma_0", salt: "0x00" };
    assert.equal(bootNetwork(fresh), NetworkName.EthereumSepolia);
    assert.equal(fresh.currentNetwork, NetworkName.EthereumSepolia);

    const switched: KeychainFile = {
      name: ".plasma_0",
      salt: "0x00",
      currentNetwork: NetworkName.Ethereum,
    };
    assert.equal(bootNetwork(switched), NetworkName.Ethereum);
  } finally {
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Booting the engine is not unit-testable, so this pins the call site: an inline mainnet fallback
// there would bypass bootNetwork and keep the test above green.
test("initializeWalletSystems takes its network from bootNetwork", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "src/railgun/wallet/wallet-init.ts"),
    "utf-8",
  );
  const start = source.indexOf("export const initializeWalletSystems");
  assert.ok(start >= 0);
  const next = source.indexOf("\nexport ", start + 1);
  const body = source.slice(start, next < 0 ? undefined : next);
  assert.match(body, /const currentNetwork = bootNetwork\(walletManager\.keyChain\);/);
  assert.doesNotMatch(body, /currentNetwork\s*\?\?\s*NetworkName\./);
});
