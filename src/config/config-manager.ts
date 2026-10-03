/**
 * App config manager — replaces startup ENV vars with a persisted, editable
 * config file (twallet.config.json at the run dir, gitignored). Drives the
 * default boot network, the remote-config RPC, and per-network RPC overrides.
 *
 * Shape (all optional):
 * {
 *   "defaultNetwork": "EthereumSepolia",
 *   "remoteConfigRpc": "https://eth-mainnet.../v2/KEY",
 *   "providers": { "EthereumSepolia": ["https://eth-sepolia.../v2/KEY"] },
 *   "poiNodeUrls": ["https://ppoi.fdi.network"],
 *   "raven": { "enabled": true, "chains": [{ "network": "Ethereum", ... }] }
 * }
 */
import fs from "fs";
import path from "path";
import { NetworkName } from "@railgun-community/shared-models";
import configDefaults from "./config-defaults";
import { getProviderObjectFromURL } from "../models/network-models";

export interface RavenChainConfig {
  /** A NetworkName key, e.g. "Ethereum" or "EthereumSepolia". */
  network: string;
  /** The Raven node, e.g. "http://127.0.0.1:8080". */
  endpoint: string;
  /**
   * The PPOI aggregator: where proofs are submitted, where block roots are read to check every
   * path Raven serves, and the engine's POI URL when the remote config lists none.
   */
  aggregator: string;
  /** The node's path instance ids, one per 65,536-row PPOI block, in block order. */
  pathInstances: string[];
  /** Defaults to the one list the wallet runs, the first of POI_REQUIRED_LISTS. */
  listKey?: string;
  /** Only for a node that gates reads. */
  bearerToken?: string;
}

export interface RavenAppConfig {
  /** Off or absent: the stock POI node interface, unchanged. */
  enabled?: boolean;
  chains?: RavenChainConfig[];
  /** Where the list index and submitted-proof records persist. Defaults to .raven-poi/. */
  storeDir?: string;
  /** Appends every request sent to a Raven node, body included, to this JSONL file. */
  wireLog?: string;
}

export interface AppConfig {
  defaultNetwork?: string;
  remoteConfigRpc?: string;
  providers?: Record<string, string[]>;
  /**
   * Simulation mode: inject demo balances and run tx flows up to (not including)
   * proof generation / broadcast, so the pipeline is testable without funds.
   */
  simulate?: boolean;
  /**
   * PPOI aggregator URLs for the engine. Unset, the remote config's list is used as before. The
   * engine also sends its txid validation reads here, which no POI interface replaces.
   */
  poiNodeUrls?: string[];
  /** Answer POI status and merkle proofs for the listed chains from a Raven node. */
  raven?: RavenAppConfig;
}

const CONFIG_PATH = path.join(process.cwd(), "twallet.config.json");

let cache: AppConfig | undefined;

export const loadAppConfig = (): AppConfig => {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as AppConfig;
  } catch {
    cache = {};
  }
  return cache;
};

const asNetworkName = (key?: string): NetworkName | undefined => {
  if (!key) return undefined;
  const value = (NetworkName as Record<string, NetworkName>)[key];
  return value;
};

/** The network a keychain that holds none boots on; a keychain that has switched keeps its own. */
export const configuredDefaultNetwork = (): NetworkName | undefined =>
  asNetworkName(loadAppConfig().defaultNetwork);

/** Configured mainnet RPC for fetching the remote-config contract, if set. */
export const configuredRemoteConfigRpc = (): string | undefined =>
  loadAppConfig().remoteConfigRpc;

/** Apply per-network RPC provider overrides into configDefaults. */
export const applyProviderOverrides = (): void => {
  const { providers } = loadAppConfig();
  if (!providers) return;
  for (const [key, urls] of Object.entries(providers)) {
    const network = asNetworkName(key);
    if (!network || !Array.isArray(urls) || urls.length === 0) continue;
    const entry = configDefaults.networkConfig[network];
    if (entry) entry.providers = urls.map(getProviderObjectFromURL);
  }
};
