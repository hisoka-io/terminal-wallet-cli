/**
 * --export-commitments writes the watch list a wire observer loads: the
 * wallets' blinded commitments, one per line, and nothing else from the wallet.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NetworkName } from "@railgun-community/shared-models";
import type { TXOsSpentPOIStatusInfo } from "@railgun-community/engine";

const A = `0x${"ab".repeat(32)}`;
const B = `0x00${"cd".repeat(31)}`;

const inScratch = async (config: object, fn: (dir: string) => Promise<void>) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "twallet-export-"));
  const cwd = process.cwd();
  try {
    fs.writeFileSync(path.join(dir, "twallet.config.json"), JSON.stringify(config));
    process.chdir(dir);
    await fn(dir);
  } finally {
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

// The config path is fixed at the first import, so every import happens in the one scratch dir.
test("the export", async (t) => {
  await inScratch({ raven: { enabled: false } }, async (dir) => {
    const mod = await import("../../../src/diagnostic/commitments.js");
    const { loadAppConfig } = await import("../../../src/config/config-manager.js");

    await t.test("normalises, drops what is not a commitment, and lists each once", () => {
      assert.deepEqual(
        mod.blindedCommitmentLines([A.toUpperCase().replace("0X", "0x"), "Unavailable", undefined, B.slice(4), A, "0xzz"]),
        [B, A],
      );
    });

    await t.test("writes only commitment lines, owner-only, and never over a file", () => {
      const file = path.join(dir, "notes.txt");
      assert.equal(mod.writeCommitmentFile(file, [A, "Unavailable", B]), 2);
      const text = fs.readFileSync(file, "utf-8");
      assert.equal(text, `${B}\n${A}\n`);
      assert.ok(text.split("\n").filter(Boolean).every((l) => /^0x[0-9a-f]{64}$/.test(l)));
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
      assert.throws(() => mod.writeCommitmentFile(file, [A]), /already exists/);
    });

    await t.test("lists what each transaction sent: its outputs and its unshields", () => {
      const C = `0x${"ef".repeat(32)}`;
      const txid = "12".repeat(32);
      const spent = [
        { strings: { sentCommitmentsBlinded: `${A}, Unavailable`, unshieldEventsBlinded: "" } },
        { strings: { sentCommitmentsBlinded: C, unshieldEventsBlinded: txid } },
      ] as unknown as TXOsSpentPOIStatusInfo[];
      assert.deepEqual(mod.blindedCommitmentLines(mod.sentCommitmentValues(spent)), [
        `0x${txid}`,
        A,
        C,
      ]);
    });

    await t.test("runs only on a network Raven serves", () => {
      const sepolia = NetworkName.EthereumSepolia;
      const refusal = /needs raven\.enabled and a raven\.chains entry for Ethereum_Sepolia/;
      assert.match(mod.exportRefusal(sepolia) ?? "", refusal);
      const config = loadAppConfig();
      config.raven = { enabled: true, chains: [{ network: "Ethereum" } as never] };
      assert.match(mod.exportRefusal(sepolia) ?? "", refusal);
      config.raven = { enabled: true, chains: [{ network: "EthereumSepolia" } as never] };
      assert.equal(mod.exportRefusal(sepolia), undefined);
      config.raven = { enabled: false, chains: [{ network: "EthereumSepolia" } as never] };
      assert.match(mod.exportRefusal(sepolia) ?? "", refusal);
    });
  });
});

test("the entry routes the flag, and refuses before the boot", () => {
  const src = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), "src", rel), "utf-8");
  assert.match(src("main.ts"), /\["--selftest", "--status", "--export-commitments"\]\.some/);
  const report = src("diagnostic/report.ts");
  const branch = report.slice(report.indexOf('argv.indexOf("--export-commitments")'));
  const refused = branch.indexOf("exportRefusal(network)");
  const booted = branch.indexOf("await bootWallet(network)");
  const exported = branch.indexOf("exportWalletCommitments(network, file)");
  assert.ok(refused > 0 && booted > refused && exported > booted);
  assert.match(src("diagnostic/commitments.ts"), /\.\.\.sentCommitmentValues\(spent\.flat\(\)\)/);
});
