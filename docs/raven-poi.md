# Raven POI

An optional POI node interface backed by [Raven](https://github.com/hisoka-io/raven). With `raven.enabled`
set to `true`, the wallet answers POI status on the device from a list index it syncs from a Raven node, and
fetches POI merkle proofs from that node by PIR (private information retrieval), so no request to the node
names a note. It is off by default. Off or absent, the wallet builds the stock POI node interface and never
contacts a Raven node.

It uses two npm packages, pinned in `package.json`: `@hisoka-io/railgun-poi-node-interface` (the
interface) and `@hisoka-io/raven-inspire-client-wasm` (its Node PIR client), both `0.1.0-alpha.0`.

## Build

Node 22 (and `jq` for the two inspection commands below), from the repository root:

```sh
DONT_COMPILE_NODE_ADDON=@railgun-community/curve25519-scalarmult-rsjs,@railgun-community/poseidon-hash-rsjs npm ci --legacy-peer-deps
npm run build
```

`DONT_COMPILE_NODE_ADDON` skips the two Rust addons, which only `npm run ship` uses. Without it,
`npm ci` builds them and needs `nj-cli`.

## Configure

The wallet reads `twallet.config.json` from the directory it runs in. Start from an example:

```sh
cp twallet.config.mainnet.example.json twallet.config.json
```

or `twallet.config.sepolia.example.json` for Sepolia. The examples point at the hosted Raven nodes:

| Network | Raven node | Path instances |
|---|---|---|
| Ethereum | `https://raven-mainnet-production.up.railway.app` | `ppoi-paths-ofac-0` to `-6` |
| Sepolia | `https://raven-sepolia-production.up.railway.app` | `ppoi-paths-ofac-0`, `-1` |

A node lists its path instances at `/v1/status`; when it lists a new one, add it to `pathInstances`:

```sh
curl -s https://raven-mainnet-production.up.railway.app/v1/status | jq -r '.instances[].id'
```

Add an RPC of your own to `providers`; the listed ones are public. Many free RPCs cap
`eth_getLogs` below the 10,001-block range the ephemeral recovery scan reads.

| Field | What it does |
|---|---|
| `defaultNetwork` | The network the diagnostics (`--selftest`, `--status`, `--export-commitments`) check, and the one a keychain with no network yet boots on. |
| `providers.<network>` | RPC URLs for that network, in place of the built-in public ones. |
| `poiNodeUrls` | The engine's PPOI aggregator URLs, in place of the remote config's list. The engine's txid reads go here, Raven on or off. |
| `raven.enabled` | `true` routes the chains in `raven.chains` through Raven. `false` or absent: stock. |
| `raven.wireLog` | Appends every request sent to the Raven node, body included, to this JSONL file (mode 600). |
| `raven.storeDir` | Where the synced list index and submitted-proof records persist. Default `.raven-poi/`. |
| `raven.chains[].network` | The chain Raven serves, e.g. `Ethereum`. Other chains stay on the stock interface. |
| `raven.chains[].endpoint` | The Raven node. |
| `raven.chains[].aggregator` | The PPOI aggregator: where proofs are submitted and merkleroots validated, and where the wallet reads the roots it checks every served path against. |
| `raven.chains[].pathInstances` | The node's path instances, in the order `/v1/status` lists them. |
| `raven.chains[].listKey` | Optional. Defaults to the first required POI list. |
| `raven.chains[].bearerToken` | Optional, for a node that gates reads. Sent only to `endpoint`. |

## Check it

```sh
node dist/main.js --selftest
```

A pass on Sepolia, with the `terminal-wallet:info:raven` request lines between the checks left out:

```
terminal-wallet v2.0.2 — selftest (Ethereum_Sepolia)
  [ ok ] remote config — resolved · 0x key present
  [ ok ] railgun engine — db .railgun.db
  [ ok ] raven poi — Raven serves Ethereum_Sepolia (chain 11155111): 10696 rows in 1 block(s), 2 path instances, PIR context for list efc6ddb5, aggregator ppoi.fdi.network lag 0
  [ ok ] artifact store — .artifacts-2.5
  [ ok ] rpc providers — Ethereum_Sepolia

5/5 checks passed
```

The exit code is 0 on a pass. The `raven poi` check needs no wallet: it confirms the engine holds
the Raven interface, syncs the list index, checks the configured path instances and that the node
is caught up with the aggregator, then fetches real paths by PIR and checks each against a root
read from the aggregator.

## What goes where

| Request | Goes to |
|---|---|
| POI status of the wallet's notes | Answered on the device from the list index, synced from Raven with `GET /v1/poi/:listKey/bc-prefixes`. |
| POI merkle proofs | Raven, by PIR: `GET /v1/instance/:id/params` once, then `POST /v1/instance/:id/session` and `/batch`. The query is encrypted, and the node computes its answer without decrypting it. |
| Roots each served path is checked against | The aggregator: `ppoi_poi_events` and `ppoi_node_status`. |
| Merkleroot validation | The aggregator. |
| Proof submission | The aggregator. |
| The engine's txid reads | The aggregator (`poiNodeUrls`). |
| Chains not in `raven.chains` | The stock interface. |

## See it

The wallet prints one line per request the Raven interface sends, to the node or the aggregator.
The wire log holds each request sent to the Raven node:

```sh
jq -c '{method, url, status, up, down}' raven-wire.jsonl
```

After the Sepolia selftest above:

```
{"method":"GET","url":"https://raven-sepolia-production.up.railway.app/v1/instance/ppoi-paths-ofac-0/params","status":200,"up":0,"down":358}
{"method":"GET","url":"https://raven-sepolia-production.up.railway.app/v1/poi/efc6ddb59c098a13fb2b618fdae94c1c3a807abc8fb1837c93620c9143ee9e88/bc-prefixes?since=0","status":200,"up":0,"down":64176}
{"method":"GET","url":"https://raven-sepolia-production.up.railway.app/v1/poi/efc6ddb59c098a13fb2b618fdae94c1c3a807abc8fb1837c93620c9143ee9e88/bc-prefixes?since=10240","status":200,"up":0,"down":2736}
{"method":"GET","url":"https://raven-sepolia-production.up.railway.app/v1/poi/efc6ddb59c098a13fb2b618fdae94c1c3a807abc8fb1837c93620c9143ee9e88/bc-prefixes?since=10240","status":200,"up":0,"down":2736}
{"method":"GET","url":"https://raven-sepolia-production.up.railway.app/v1/poi/efc6ddb59c098a13fb2b618fdae94c1c3a807abc8fb1837c93620c9143ee9e88/bc-prefixes?since=10240","status":200,"up":0,"down":2736}
{"method":"POST","url":"https://raven-sepolia-production.up.railway.app/v1/instance/ppoi-paths-ofac-0/session","status":200,"up":46254,"down":49}
{"method":"POST","url":"https://raven-sepolia-production.up.railway.app/v1/instance/ppoi-paths-ofac-0/batch","status":200,"up":15501,"down":10624}
```

`bodyB64` in each record is the request body as sent, for checking that none carries a commitment.
A request that fails is recorded with `status` null and `error` naming the error.

## Switch it off

Set `raven.enabled` to `false`. The wallet runs the stock POI node interface, writes no wire log,
and the selftest reports:

```
  [ ok ] raven poi — off: engine holds WalletPOINodeInterface for every chain
```
