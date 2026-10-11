/**
 * Raven: POI status read on the device from a Raven node's list index, and POI merkle proofs
 * fetched from it by PIR, so neither read names a note to the Raven node. Proof submission and the
 * engine's txid reads still go to the PPOI aggregator, as they do without Raven.
 *
 * Installed once, right after startRailgunEngine, in front of the stock interface: chains listed
 * under `raven.chains` go to Raven, every other chain to the stock interface unchanged. With
 * `raven.enabled` off nothing here runs.
 */
import path from "path";
import { POI } from "@railgun-community/engine";
import {
  NETWORK_CONFIG,
  NetworkName,
  POI_REQUIRED_LISTS,
} from "@railgun-community/shared-models";
import {
  LEAVES_PER_PPOI_BLOCK,
  PIN_TAIL_WINDOW,
  PerChainPOINodeInterface,
  RavenPOINodeInterface,
  UpstreamPinResolver,
  fetchInstanceParams,
  installPanicHook,
  loadClientPirContext,
  type RavenInspireWasm,
} from "@hisoka-io/railgun-poi-node-interface";
import configDefaults from "../../config/config-defaults";
import {
  loadAppConfig,
  type RavenAppConfig,
  type RavenChainConfig,
} from "../../config/config-manager";
import { emitCoreEvent } from "../../core/events";
import { createLogger } from "../../platform/logger";
import { appendWireRecord, fileStore } from "./file-store";

const log = createLogger("raven");

const TXID_VERSION = "V2_PoseidonMerkle";

interface ServedChain {
  readonly network: NetworkName;
  readonly chain: { type: number; id: number };
  readonly config: RavenChainConfig;
  readonly listKey: string;
  readonly contextKey: string;
  readonly labels: ReadonlyMap<string, string>;
  readonly raven: RavenPOINodeInterface;
  readonly fetchImpl: typeof fetch;
}

let served: ServedChain[] = [];
let installedRouter: PerChainPOINodeInterface | undefined;

const settings = (): RavenAppConfig | undefined => {
  const { raven } = loadAppConfig();
  return raven?.enabled === true ? raven : undefined;
};

const trimSlash = (url: string) => url.replace(/\/+$/, "");

/**
 * The engine's POI URLs. `poiNodeUrls` in config wins; otherwise the remote config's list. An
 * empty list makes the stock request loop retry forever, so with Raven on it falls back to the
 * configured aggregators instead.
 */
export const resolvePoiNodeUrls = (remote: string[]): string[] => {
  const configured = loadAppConfig().poiNodeUrls;
  if (Array.isArray(configured) && configured.length > 0) {
    return configured;
  }
  const raven = settings();
  if (remote.length > 0 || raven === undefined) {
    return remote;
  }
  const aggregators = [...new Set((raven.chains ?? []).map((c) => trimSlash(c.aggregator)))];
  if (aggregators.length > 0) {
    log.warn(
      `remote config lists no PPOI aggregator; using the configured one(s): ${aggregators.join(", ")}`,
    );
  }
  return aggregators;
};

const storeDir = (raven: RavenAppConfig): string =>
  raven.storeDir ??
  path.join(path.dirname(configDefaults.engine.databasePath), ".raven-poi");

const urlOf = (input: Parameters<typeof fetch>[0]): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

/** Undefined for a body that cannot be read without consuming it; the SDK sends none. */
const bodyBytes = async (body: RequestInit["body"]): Promise<Uint8Array | undefined> => {
  if (body === undefined || body === null) return new Uint8Array();
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  }
  return undefined;
};

const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

/**
 * Every request the Raven interface sends, reported as it completes: one status line per request,
 * and, for the node, the full request in the wire log, so anyone can check that no request to the
 * node names a note. A request that fails is reported the same way,
 * then rethrown.
 */
export const activityFetch = (
  network: NetworkName,
  endpoint: string,
  wireLog: string | undefined,
): typeof fetch => {
  const nodeOrigin = new URL(endpoint).origin;
  return async (input, init) => {
    const url = urlOf(input);
    const read = await bodyBytes(init?.body);
    if (read === undefined) {
      log.warn(`Raven wire log: a request body to ${url} could not be recorded`);
    }
    const sent = read ?? new Uint8Array();
    const toNode = new URL(url).origin === nodeOrigin;
    let what: string;
    if (toNode) {
      const route = new URL(url).pathname.split("/").pop() ?? "";
      what = `Raven ${route}`;
    } else {
      let method = "request";
      try {
        method = JSON.parse(new TextDecoder().decode(sent)).method ?? method;
      } catch {
        // not JSON-RPC; keep the generic label
      }
      what = `PPOI aggregator ${method}`;
    }
    const startedAt = Date.now();
    // Durations from the monotonic clock: a wall-clock step mid-request printed -1001 ms.
    const started = performance.now();
    const report = (
      outcome: string,
      status: number | null,
      down: number,
      error?: string,
    ) => {
      const ms = Math.round(performance.now() - started);
      const text = `${what} (${network}): ${outcome}, ${kb(sent.length)} up, ${kb(down)} down, ${ms} ms`;
      if (error === undefined) log.info(text);
      else log.warn(text);
      emitCoreEvent({ type: "status:message", text, durationMs: 8000, replace: true });
      if (wireLog !== undefined && toNode) {
        appendWireRecord(wireLog, {
          t: new Date(startedAt).toISOString(),
          method: init?.method ?? "GET",
          url,
          status,
          up: sent.length,
          down,
          ms,
          bodyB64: read === undefined ? null : Buffer.from(sent).toString("base64"),
          ...(error === undefined ? {} : { error }),
        });
      }
    };
    let response: Response;
    let payload: Uint8Array | null;
    try {
      response = await fetch(input, init);
      payload = NULL_BODY_STATUSES.has(response.status)
        ? null
        : new Uint8Array(await response.arrayBuffer());
    } catch (err) {
      const error =
        err instanceof Error ? `${err.name}: ${err.message}` : `${typeof err}: ${String(err)}`;
      report(`failed, ${error}`, null, 0, error);
      throw err;
    }
    report(String(response.status), response.status, payload?.length ?? 0);
    return new Response(payload, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
};

const networkFor = (name: string): NetworkName => {
  const network = (NetworkName as Record<string, NetworkName>)[name];
  if (network === undefined || NETWORK_CONFIG[network] === undefined) {
    throw new Error(`raven.chains: unknown network "${name}"`);
  }
  return network;
};

const serveChain = async (
  config: RavenChainConfig,
  raven: RavenAppConfig,
  wasm: RavenInspireWasm,
): Promise<ServedChain> => {
  const network = networkFor(config.network);
  const { chain } = NETWORK_CONFIG[network];
  const listKey = (config.listKey ?? POI_REQUIRED_LISTS[0].key).toLowerCase();
  if (!POI_REQUIRED_LISTS.some((l) => l.key.toLowerCase() === listKey)) {
    // The engine never asks about another list, so its notes would stay pending.
    throw new Error(`raven.chains[${config.network}]: list ${listKey.slice(0, 8)} is not a list the wallet runs`);
  }
  if (!Array.isArray(config.pathInstances) || config.pathInstances.length === 0) {
    throw new Error(`raven.chains[${config.network}]: pathInstances names no block`);
  }
  if (!config.aggregator) {
    // Without it every path Raven serves is refused, and no error says why.
    throw new Error(`raven.chains[${config.network}]: aggregator is required`);
  }
  const endpoint = trimSlash(config.endpoint);
  const fetchImpl = activityFetch(network, endpoint, raven.wireLog);

  // One context decodes every block of a node that set its blocks up together; the selftest
  // proves it per block.
  const params = await fetchInstanceParams({
    endpoint,
    instanceId: config.pathInstances[0],
    bearerToken: config.bearerToken,
    fetchImpl,
  });
  const { context } = await loadClientPirContext({
    wasm,
    instanceId: config.pathInstances[0],
    crsBincode: params.crsBincode,
    shardConfigBincode: params.shardConfigBincode,
    inspireParamsBincode: params.inspireParamsBincode,
    entrySize: params.entrySize,
  });
  const contextKey = `t2Path:${chain.id}:${listKey}`;
  const labels = new Map(
    config.pathInstances.map((id, block) => [`${contextKey}:${block}`, id] as const),
  );
  const store = fileStore(path.join(storeDir(raven), `${chain.type}-${chain.id}`));
  const ravenInterface = new RavenPOINodeInterface({
    endpoint,
    chainId: chain.id,
    chainType: chain.type,
    bearerToken: config.bearerToken,
    upstreamFallbackEndpoint: trimSlash(config.aggregator),
    clientPirContexts: new Map([[contextKey, context]]),
    clientPirInstanceLabels: labels,
    poiListIndexStore: store,
    submittedProofStore: store,
    fetchImpl,
  });
  return {
    network,
    chain,
    config,
    listKey,
    contextKey,
    labels,
    raven: ravenInterface,
    fetchImpl,
  };
};

/**
 * Called once, after startRailgunEngine and before any provider loads. With Raven on, a node
 * that cannot be reached stops the boot: running on as stock would look the same on screen.
 */
export const installRavenPOI = async (): Promise<void> => {
  const raven = settings();
  if (raven === undefined) {
    return;
  }
  const chains = raven.chains ?? [];
  if (chains.length === 0) {
    throw new Error("raven.enabled is set but raven.chains is empty");
  }
  try {
    // Loaded here, not at module scope: the module reads and compiles its .wasm as it loads,
    // and a wallet with Raven off has no use for either.
    const wasm: RavenInspireWasm = await import("@hisoka-io/raven-inspire-client-wasm");
    installPanicHook(wasm);
    served = await Promise.all(chains.map((c) => serveChain(c, raven, wasm)));
    installedRouter = PerChainPOINodeInterface.install(
      POI,
      [...POI_REQUIRED_LISTS],
      served.map((s) => s.raven),
    );
  } catch (err) {
    served = [];
    throw new Error(
      `Raven POI failed to start: ${(err as Error).message}. Set raven.enabled to false in ` +
        "twallet.config.json to run on the stock POI node.",
      { cause: err },
    );
  }
  for (const s of served) {
    log.info(
      `Raven POI installed for ${s.network}: ${s.config.endpoint}, ` +
        `${s.labels.size} path blocks, aggregator ${s.config.aggregator}`,
    );
    // Warm the index now so the first balance refresh reads it locally.
    s.raven
      .syncPoiListIndex(s.listKey)
      .then((index) => log.info(`Raven list index for ${s.network}: ${index.total} rows`))
      .catch((err: unknown) => log.error(`Raven list index sync failed for ${s.network}`, err));
  }
};

/** The blinded commitment at one list row, read from the aggregator: a public row, not one of the wallet's notes. */
const aggregatorCommitmentAt = async (s: ServedChain, row: number): Promise<string> => {
  const response = await s.fetchImpl(trimSlash(s.config.aggregator), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "ppoi_poi_events",
      params: {
        chainType: String(s.chain.type),
        chainID: String(s.chain.id),
        txidVersion: TXID_VERSION,
        listKey: s.listKey,
        startIndex: row,
        endIndex: row,
      },
    }),
  });
  const decoded = (await response.json()) as {
    result?: { signedPOIEvent?: { index?: number; blindedCommitment?: string } }[];
  };
  const event = decoded.result?.[0]?.signedPOIEvent;
  if (event?.index !== row || typeof event.blindedCommitment !== "string") {
    throw new Error(`the aggregator has no list row ${row}`);
  }
  const bc = event.blindedCommitment.replace(/^0x/i, "");
  return `0x${bc}`;
};

const check = (ok: boolean, message: string) => {
  if (!ok) throw new Error(message);
};

/**
 * Every way the Raven glue can fail without an error, checked at once: each of them otherwise
 * shows a balance that never becomes spendable.
 */
export const ravenSelftest = async (poiNodeURLs: string[]): Promise<string> => {
  const raven = settings();
  if (raven === undefined) {
    const held = (POI as unknown as { nodeInterface?: object }).nodeInterface;
    // The release bundle names a class that refers to itself `_Name`.
    const name = held?.constructor.name.replace(/^_/, "");
    return `off: engine holds ${name ?? "no POI interface"} for every chain`;
  }
  check(poiNodeURLs.length > 0, "the engine has no PPOI aggregator URL; its txid reads would retry forever");
  const router = installedRouter;
  if (router === undefined || served.length === 0) {
    throw new Error("Raven is on but was never installed");
  }
  const held = (POI as unknown as { nodeInterface?: unknown }).nodeInterface;
  check(held === router, "engine's POI interface is not the Raven router");

  const requiredKeys = POI_REQUIRED_LISTS.map((l) => l.key);
  const lines: string[] = [];
  for (const s of served) {
    const name = `${s.network} (chain ${s.chain.id})`;
    check(POI.isActiveForChain(s.chain), `${name}: engine reports POI inactive`);
    const index = await s.raven.syncPoiListIndex(s.listKey);
    check(index.total > 0, `${name}: the node's list is empty`);
    // A list with no PIR context answers {} for every note, which engine reads as "no news".
    const probe = `0x${"00".repeat(32)}`;
    const answer = (await router.getPOIsPerList(
      TXID_VERSION as never,
      s.chain,
      requiredKeys,
      [{ blindedCommitment: probe, type: "Shield" as never }],
    )) as Record<string, Record<string, string> | undefined>;
    for (const key of requiredKeys) {
      check(
        typeof answer[probe]?.[key] === "string",
        `${name}: Raven does not answer list ${key.slice(0, 8)}; its notes would stay pending with no error`,
      );
    }
    const lastBlock = Math.floor((index.total - 1) / LEAVES_PER_PPOI_BLOCK);
    for (let block = 0; block <= lastBlock; block += 1) {
      check(
        s.labels.has(`${s.contextKey}:${block}`),
        `${name}: the list has rows in block ${block} but pathInstances stops at block ${s.labels.size - 1}`,
      );
    }
    const pins = await new UpstreamPinResolver({
      endpoint: trimSlash(s.config.aggregator),
      fetchImpl: s.fetchImpl,
      chainType: s.chain.type,
      chainId: s.chain.id,
      txidVersion: TXID_VERSION,
    }).resolve(s.listKey, lastBlock);
    const upstreamRows = pins.window.frozen ? index.total : pins.window.endIndex + 1;
    const lag = upstreamRows - index.total;
    check(
      lag <= PIN_TAIL_WINDOW,
      `${name}: the node is ${lag} rows behind the aggregator; past ${PIN_TAIL_WINDOW} every proof in block ${lastBlock} is refused`,
    );
    check(pins.roots.size > 0, `${name}: the aggregator reports no root for block ${lastBlock}`);
    // One PIR context serves every block, which holds only if the node set all of them up under
    // one CRS seed. A block that was not fails every proof on it, and nothing reports why, so
    // fetch a real row's path from each block; the interface folds it against the aggregator.
    for (let block = 0; block <= lastBlock; block += 1) {
      const row = Math.min((block + 1) * LEAVES_PER_PPOI_BLOCK, index.total) - 1;
      const bc = await aggregatorCommitmentAt(s, row);
      try {
        await router.getPOIMerkleProofs(TXID_VERSION as never, s.chain, s.listKey, [bc]);
      } catch (err) {
        throw new Error(
          `${name}: no verified path from ${s.labels.get(`${s.contextKey}:${block}`)} ` +
            `(block ${block}, row ${row}): ${(err as Error).message}`,
        );
      }
    }
    lines.push(
      `Raven serves ${name}: ${index.total} rows in ${lastBlock + 1} block(s), ` +
        `${s.labels.size} path instances, PIR context for list ${s.listKey.slice(0, 8)}, ` +
        `aggregator ${new URL(s.config.aggregator).host} lag ${lag}`,
    );
  }
  return lines.join("; ");
};
