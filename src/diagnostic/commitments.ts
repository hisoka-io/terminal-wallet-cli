/**
 * --export-commitments <file>: the blinded commitment of every note each wallet
 * in the keychain has received, spent or not, and of every output and unshield it
 * has sent, one per line. It is the watch list a wire observer needs to see which
 * requests name one of these notes. The file holds nothing but commitment lines.
 */
import {
  NetworkName,
  TXIDVersion,
  isDefined,
} from "@railgun-community/shared-models";
import type { TXOsSpentPOIStatusInfo } from "@railgun-community/engine";
import {
  getTXOsReceivedPOIStatusInfoForWallet,
  getTXOsSpentPOIStatusInfoForWallet,
  loadWalletByID,
  refreshBalances,
} from "@railgun-community/wallet";
import { loadAppConfig } from "../config/config-manager";
import { getChainForName } from "../railgun/network/network-util";
import { walletManager } from "../railgun/wallet/wallet-manager";
import { writeResultFile } from "../platform/output";

/** 0x and 64 lowercase hex digits, each once, sorted. The engine's "Unavailable" is dropped. */
export const blindedCommitmentLines = (values: readonly (string | undefined)[]): string[] => {
  const lines = new Set<string>();
  for (const value of values) {
    const hex = value?.trim().toLowerCase().replace(/^0x/, "");
    if (hex !== undefined && /^[0-9a-f]{1,64}$/.test(hex)) {
      lines.add(`0x${hex.padStart(64, "0")}`);
    }
  }
  return [...lines].sort();
};

/** Owner-only, and never over an existing file. Returns how many commitments it wrote. */
export const writeCommitmentFile = (file: string, values: readonly (string | undefined)[]): number => {
  const lines = blindedCommitmentLines(values);
  const written = writeResultFile(file, lines.map((l) => `${l}\n`).join(""));
  if (!written.ok) {
    throw new Error(written.error);
  }
  return lines.length;
};

/** The engine joins a transaction's sent outputs and unshields into ", "-separated strings. */
export const sentCommitmentValues = (infos: readonly TXOsSpentPOIStatusInfo[]): string[] =>
  infos.flatMap(({ strings }) =>
    [strings.sentCommitmentsBlinded, strings.unshieldEventsBlinded].flatMap((joined) =>
      joined.split(","),
    ),
  );

/**
 * Checked before the boot. Chains not under raven.chains keep the stock interface, whose scan
 * sends the aggregator a status read for each note not yet Valid.
 */
export const exportRefusal = (network: NetworkName): string | undefined => {
  const { raven } = loadAppConfig();
  const served =
    raven?.enabled === true &&
    (raven.chains ?? []).some(
      (c) => (NetworkName as Record<string, NetworkName>)[c.network] === network,
    );
  return served
    ? undefined
    : `--export-commitments needs raven.enabled and a raven.chains entry for ${network} in ` +
        "twallet.config.json: on the stock POI interface, the scan sends the aggregator a " +
        "status read for each note not yet Valid";
};

/** Loads every wallet in the keychain, waits for a scan of `network`, and writes their notes. */
export const exportWalletCommitments = async (
  network: NetworkName,
  file: string,
): Promise<string> => {
  const password = walletManager.hashedPassword;
  if (!isDefined(password)) {
    throw new Error("the wallet is not unlocked");
  }
  const walletIDs = Object.values(walletManager.keyChain.wallets ?? {}).map(
    (w) => w.railgunWalletID,
  );
  if (walletIDs.length === 0) {
    throw new Error("the keychain holds no wallet");
  }
  for (const id of walletIDs) {
    await loadWalletByID(password, id, false);
  }
  await refreshBalances(getChainForName(network), walletIDs);
  const received = await Promise.all(
    walletIDs.map((id) =>
      getTXOsReceivedPOIStatusInfoForWallet(TXIDVersion.V2_PoseidonMerkle, network, id),
    ),
  );
  const spent = await Promise.all(
    walletIDs.map((id) =>
      getTXOsSpentPOIStatusInfoForWallet(TXIDVersion.V2_PoseidonMerkle, network, id),
    ),
  );
  const count = writeCommitmentFile(file, [
    ...received.flat().map((info) => info.strings.blindedCommitment),
    ...sentCommitmentValues(spent.flat()),
  ]);
  return `${count} blinded commitments from ${walletIDs.length} wallet(s) written to ${file}`;
};
