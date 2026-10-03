## Tooling

- Use Node.js 16.x
- Use Rust (required for building executable)

### Install Node Dependencies

##### (_Required_)

- Use `npm install --legacy-peer-deps` to install dependencies.

<hr>

## How to Run:

1. Download Release [link]
2. Run From Source
3. Build From Source

#### Release Downloads:

- linux
- macosx
- windows

<br>
<hr>

# Run from Source:

##### Compile the Project:

- Use `npm run build`

##### Run Source:

- Use `npm run start`
<br>

<hr>

# Build Executable from Source:

#### 1. Install Rust Dependencies

- Use `cargo install nj-cli` to install compilation dependencies.

#### 2. Build Executable

- Use `npm run ship`

#### 3. Run Executable

- Use `cd build`
- Use `./terminal-wallet-cli` (_might need to chmod+x_)
<br>

<hr>

# Verify Releases & Source:
Each Release will include the sha256 hashes of the binary archives. As well as a GPG signed certificate of the verification hashes. Also included are GPG signed certs. of the included Source Code as well.
**./PUBLICSIGNER.asc contains the signer GPG public key**
**Please import this key into your gpg keychain if you wish to verify signed messages**

Navigate to the directory in which you downloaded the releases.

##### Specific Downloads:
- Open SHA256SUMS.sha, copy the line(s) for the release(s) you've downloaded.
- Use `echo "<copied hash & filename>" | sha256sum --check`
<br>

###### Example: 
```sh
---SHA256SUMS.sha---
84a5fafd21fa21f8b3ef8bd10a18a8f1c7bbcabb67477d8d6dc5d609c84b4187  release-1.0.0-linux.tar.gz
ce93915c196698a15d957a27df586b7cdf72d499eb597b19136a9148fa1eaab7  release-1.0.0-macos.tar.gz
c697d422472ebd78b388a6f3389a4659eb3f3af9a2c0380ee73c2194c1e816cf  release-1.0.0-win.tar.gz

``` 
***(These hashes will be out of date. DO NOT use these examples. They are purely for visual representation. Refer to the hashes found within the SHA256SUMS.sha provided with each release.)***

```sh
#User: Downloaded Linux Version.
#User: Validates Singular Hash
echo "84a5fafd21fa21f8b3ef8bd10a18a8f1c7bbcabb67477d8d6dc5d609c84b4187  release-1.0.0-linux.tar.gz" | sha256sum --check
#Console Output: 
release-1.0.0-linux.tar.gz: OK
```
<br>

##### All Files:
- Use `sha256sum --check SHA256SUMS.sha`

<hr>

# Raven POI (optional)

An optional POI node interface backed by [Raven](https://github.com/hisoka-io/raven): the wallet answers
POI status on the device and fetches POI merkle proofs from a Raven node by PIR (private information
retrieval). It is off by default; off or absent, the wallet runs the stock POI node interface.

To try it, build as in [docs/raven-poi.md](docs/raven-poi.md#build), then start from an example config and run
the selftest:

```sh
cp twallet.config.mainnet.example.json twallet.config.json   # or twallet.config.sepolia.example.json
node dist/main.js --selftest
```

A pass ends with `5/5 checks passed`. Configuration, request routing and the wire log are in
[docs/raven-poi.md](docs/raven-poi.md).
