---
name: pubky-testnet-expert
description: Expert knowledge on pubky-core testnet architecture, multi-homeserver setups, DHT resolution and external service integration. Use when working with StaticTestnet homeserver configuration, pkarr DHT resolution, or connecting external services like Nexus to a local testnet.
---

# Pubky Testnet Expert

Rust engineering and architecture guidance for the `pubky-testnet` crate.

## Architecture Overview

The Pubky testnet creates an **isolated, self-contained** version of the Pubky infrastructure locally. The stack:

```
External Service (e.g. Nexus)
        |
        | PubkyHttpClient::builder().testnet_with_host("127.0.0.1").build()
        v
  DHT Bootstrap (port 6881, UDP)
        |
        v
  2 In-Memory DHT Nodes (pkarr::mainline::Testnet)
        |
   +---------+---------+
   |         |         |
   v         v         v
  HS 1      HS 2      HS 3     (each publishes pkarr SignedPacket to DHT)
   |
   v
  Pkarr Relay (port 15411, HTTP bridge for browsers)
  HTTP Relay  (port 15412, auth rendezvous)
```

## Three Testnet Types

| Type | Ports | Use Case |
|------|-------|----------|
| `Testnet` | Ephemeral (random) | Low-level building block, manual component creation |
| `EphemeralTestnet` | Ephemeral (random) | Rust integration tests, auto-creates homeserver + relay |
| `StaticTestnet` | Fixed (6881, 15411, 15412, 6286-6288) | CLI binary, Docker, browser dev, external process integration |

### StaticTestnet Fixed Ports

| Component | Port | Protocol | Bound by |
|-----------|------|----------|----------|
| DHT bootstrap | 6881 | UDP (Mainline DHT) | `run_fixed_bootstrap_node()` via `Dht::builder().port(6881).server_mode()` |
| Pkarr relay | 15411 | HTTP (TCP) | `StaticTestnet` |
| HTTP relay | 15412 | HTTP (TCP) | `StaticTestnet` |
| Homeserver ICANN HTTP | 6286 | HTTP (TCP) | Homeserver |
| Homeserver Pubky TLS | 6287 | Custom TLS (TCP) | Homeserver |
| Admin API | 6288 | HTTP (TCP) | Homeserver |

Port 6881 is **UDP only** — the DHT bootstrap node. All other ports are TCP. See [Port 6881 Collision Behavior](#port-6881-collision-behavior-critical) for why this matters.

Default homeserver keypair: `Keypair::from_secret(&[0; 32])` producing pubkey `8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo`.

## Startup Flow (StaticTestnet)

1. `pkarr::mainline::Testnet::new_async(2)` — 2 isolated in-memory DHT nodes
2. Fixed bootstrap node on port 6881, linked to those 2 nodes
3. Pkarr relay on port 15411, bootstrapped to local DHT (HTTP bridge for browsers)
4. HTTP relay on port 15412 (auth flow rendezvous: GET/POST `/link/{id}`)
5. Homeserver on ports 6286/6287/6288
6. `HomeserverKeyRepublisher` publishes SVCB/HTTPS DNS records to DHT (immediate + every 60min)
7. Process parks on `Ctrl+C`, then drops all components

## DHT Lifecycle (Critical)

The local DHT is **ephemeral and in-memory**. It does NOT persist across runs:

- Each `cargo run` creates a brand new, empty DHT network
- When the process exits (Ctrl+C), the entire DHT disappears
- User pkarr packets published in run N do not exist in run N+1
- The `UserKeysRepublisher` (60s initial delay, then every 4h) tries to re-announce all user keys from the database to the DHT. If the database has users from a previous run, their packets won't be found on the fresh DHT, producing `WARN` logs: "The packet can't be resolved on the DHT and therefore can't be republished"
- **Consequence**: databases MUST be reset each run to avoid stale user data causing warnings and potential hangs. 

In production, the DHT is the real global Mainline DHT (same one BitTorrent uses) which persists across nodes. In local testnet, it's throwaway.

## Multi-Homeserver Setup

Each homeserver gets its own keypair, publishes its own pkarr packet, and is independently discoverable. All share the same DHT.

### Random Keypairs (Simple)

```rust
use pubky_testnet::StaticTestnet;

let mut testnet = StaticTestnet::start().await?;

// HS 1 is the built-in homeserver (deterministic key [0;32], fixed ports 6286/6287)
let hs1_pk = testnet.homeserver_app().public_key();
let hs1_url = testnet.homeserver_app().icann_http_url();

testnet.create_random_homeserver().await?;  // HS 2 (random key, ephemeral ports)
testnet.create_random_homeserver().await?;  // HS 3 (random key, ephemeral ports)

// Iterate all homeservers via the inner Testnet field
for (i, hs) in testnet.testnet.homeservers.iter().enumerate() {
    println!("HS {}: {} at {}", i+1, hs.public_key().z32(), hs.icann_http_url());
}
```

### Fixed Keypairs (Deterministic pubkeys across runs)

Access `create_homeserver_app_with_mock` via `testnet.testnet` (the inner `pub` field). It accepts a `MockDataDir` with a specific keypair. Same seed = same public key every run.

```rust
use pubky_testnet::pubky::Keypair;
use pubky_testnet::pubky_homeserver::{ConfigToml, ConnectionString, MockDataDir};

let mut config = ConfigToml::default_test_config();
config.general.database_url = ConnectionString::new("postgres://localhost:5432/my_db")?;
let mock_dir = MockDataDir::new(config, Some(Keypair::from_secret(&seed)))?;
let hs = testnet.testnet.create_homeserver_app_with_mock(mock_dir).await?;
```

Use a named database **without** `?pubky-test=true` to avoid random DB creation. Seed `[0;32]` is already taken by `StaticTestnet`'s built-in hs1.

### With `EphemeralTestnet` and low-level `Testnet`

```rust
let mut testnet = EphemeralTestnet::start().await?;
testnet.create_random_homeserver().await?;

let mut testnet = Testnet::new().await?;
testnet.create_pkarr_relay().await?;
testnet.create_random_homeserver().await?;
```

## Database Management

### How `?pubky-test=true` works

The `ConnectionString` query parameter `?pubky-test=true` controls ephemeral DB creation:

| Connection String | Behavior |
|---|---|
| `postgres://...?pubky-test=true` | `SqlDb::connect()` creates a new `pubky_test_{uuid}` database (random name each time) |
| `postgres://.../my_db` (no flag) | `SqlDb::connect()` connects directly to `my_db` |

The check is in `SqlDb::connect()`:
```rust
if con_string.is_test_db() {
    return Self::test_postgres_db(Some(con_string.clone())).await;  // Creates pubky_test_{uuid}
}
Self::connect_inner(con_string).await  // Connects directly
```

### Fixed database names

To use predictable database names instead of random UUIDs:

1. Create the databases yourself (via `sqlx` or `CREATE DATABASE`)
2. Set `config.general.database_url` to a `ConnectionString` **without** `?pubky-test=true`
3. The homeserver auto-runs migrations on startup via `Migrator::new(&sql_db).run().await`

```rust
let mut config = ConfigToml::default_test_config();
config.general.database_url = ConnectionString::new("postgres://postgres:postgres@localhost:5432/pubky_antfarm_hs2")?;
```

### Database reset requirement

Databases **must** be dropped and recreated each run because:
- The DHT is ephemeral (see DHT Lifecycle above)
- Old user records reference pkarr packets that don't exist on the new DHT
- The `UserKeysRepublisher` will hang for ~20s per stale user trying to resolve missing packets
- Stale sessions/tokens are invalid against the new network

### StaticTestnet's built-in hs1 caveat

`StaticTestnet::start()` always creates hs1 internally with `default_test_config()` which uses `?pubky-test=true`. This means hs1 always gets a fresh random `pubky_test_{uuid}` database -- you cannot control its name through the public API. To use a fixed DB for hs1, pass a config file via `StaticTestnet::start_with_homeserver_config(path)`.

## Port 6881 Collision Behavior (Critical)

### Mainline DHT default port behavior

The `mainline` crate's `KrpcSocket::new()` has a **try-6881-first** default when no explicit port is set:

```rust
// mainline/src/rpc/socket.rs (both v5.4.0 and v6.1.1)
pub const DEFAULT_PORT: u16 = 6881;

let socket = if let Some(port) = port {
    // Explicit .port(N): hard fail if taken
    UdpSocket::bind(SocketAddr::from((bind_addr, port)))?
} else {
    // No .port() call: try 6881 first, silently fall back to ephemeral
    match UdpSocket::bind(SocketAddr::from((bind_addr, DEFAULT_PORT))) {
        Ok(socket) => Ok(socket),
        Err(_) => UdpSocket::bind(SocketAddr::from((bind_addr, 0))),
    }?
};
```

This creates two different failure modes:

| Path | Triggered by | If port 6881 taken |
|------|-------------|-------------------|
| Explicit `.port(6881)` | `StaticTestnet::run_fixed_bootstrap_node()` | **Hard fail**: `"Address already in use (os error 48)"` |
| Default (no `.port()`) | `PubkyHttpClient::builder().testnet_with_host()` | **Silent fallback** to random ephemeral port |

### What `testnet_with_host` actually does

When an external service (e.g. Nexus) calls `PubkyHttpClient::builder().testnet_with_host("localhost").build()`:

1. `testnet_with_host` sets `bootstrap = ["localhost:6881"]` and `relays = ["http://localhost:15411"]`
2. `.build()` creates a pkarr client → internally creates a `mainline::Dht` node
3. **No `.port()` is set** → the mainline library tries to bind `0.0.0.0:6881` first
4. If 6881 is free → the external service's DHT node **grabs port 6881**
5. If 6881 is taken → silently falls back to an ephemeral port (e.g. 52341)

The external service is NOT just "connecting to" 6881 as a remote bootstrap peer — its own local DHT node also **tries to bind** to 6881.

### Startup order matters

| Order | What happens | Result |
|-------|-------------|--------|
| **StaticTestnet first, then external service** | StaticTestnet binds UDP 6881 via explicit `.port(6881)`. External service tries 6881, fails, silently falls back to ephemeral port, then bootstraps from `localhost:6881`. | **Works correctly** |
| **External service first, then StaticTestnet** | External service grabs UDP 6881 (default behavior). StaticTestnet's `run_fixed_bootstrap_node(.port(6881))` fails hard. | **Crashes**: `"Failed to run bootstrap node on port 6881: Address already in use (os error 48)"` |

**Rule: Always start StaticTestnet (pubky-antfarm) BEFORE any external service that uses `testnet_with_host`.**

### Diagnosing port 6881 conflicts

```bash
# Check who holds UDP port 6881
lsof -i UDP:6881

# Example output when Nexus grabbed it first:
# COMMAND   PID   USER   FD   TYPE  DEVICE SIZE/OFF NODE NAME
# nexusd  63508 redfox   13u  IPv4  ...     0t0  UDP *:6881
```

If you see an unexpected process holding 6881, kill it and restart in the correct order.

## External Service Connecting to Testnet

An external process (e.g. Nexus) connects to a running `StaticTestnet` by pointing at the bootstrap node.

**Important**: The StaticTestnet must be running BEFORE starting the external service. See [Port 6881 Collision Behavior](#port-6881-collision-behavior-critical) for why.

### Using PubkyHttpClient (recommended)

```rust
let client = PubkyHttpClient::builder()
    .testnet_with_host("127.0.0.1")  // sets bootstrap=["127.0.0.1:6881"], relay=["http://127.0.0.1:15411"]
    .build()?;
// Internally: creates a mainline DHT node on an ephemeral port (6881 is taken by StaticTestnet),
// then bootstraps its routing table from 127.0.0.1:6881.

let events = client.get("pubky://8pinx...ewo/events/").await?;
```

### Using pkarr client directly

```rust
let mut builder = pkarr::Client::builder();
builder.no_default_network();
builder.bootstrap(&["localhost:6881"]);
let client = builder.build()?;

let packet = client.resolve(&homeserver_public_key).await;
let endpoint = client.resolve_https_endpoint("8pinx...ewo").await;
```

### Resolution flow

```
External Service           DHT (localhost:6881)         Homeserver
  |  resolve("HS_PUBLIC_KEY")   |                          |
  |---------------------------->|                          |
  |  SignedPacket {             |                          |
  |    SVCB: 127.0.0.1:54322    |                          |
  |  }                          |                          |
  |<----------------------------|                          |
  |  GET https://127.0.0.1:54322/events/                   |
  |------------------------------------------------------->|
  |  events data                                           |
  |<-------------------------------------------------------|
```

The client never hardcodes homeserver ports. It resolves them dynamically through the DHT using the homeserver's public key.

## Homeserver API Endpoints

### Client API (ICANN HTTP + Pubky TLS)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Root |
| POST | `/signup` | Create account (AuthToken body) |
| POST | `/session` | Sign in (AuthToken body) |
| GET | `/session` | Get session (tenant-scoped) |
| DELETE | `/session` | Sign out (tenant-scoped) |
| GET | `/events/` | Historical events (cursor-based) |
| GET | `/events-stream` | SSE live event stream |
| GET | `/{*path}` | Read file/listing (tenant-scoped) |
| HEAD | `/{*path}` | File metadata (tenant-scoped) |
| PUT | `/{*path}` | Write file (tenant-scoped, auth required) |
| DELETE | `/{*path}` | Delete file (tenant-scoped, auth required) |

Tenant scoping: `PubkyHostLayer` extracts homeserver pubkey from `Host` header, `pubky-host` header, or `pubky-host` query param.

### Admin API (port 6288, `X-Admin-Password` header)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/info` | Server info |
| GET | `/generate_signup_token` | Generate signup token |
| DELETE | `/webdav/{*entry_path}` | Delete entry |
| POST | `/users/{pubkey}/disable` | Disable user |
| POST | `/users/{pubkey}/enable` | Enable user |
| ANY | `/dav{*path}` | WebDAV admin |

### Pkarr Relay (port 15411)

| Method | Path | Description |
|--------|------|-------------|
| PUT | `/{z32_key}` | Publish signed packet |
| GET | `/{z32_key}` | Resolve signed packet |

### HTTP Relay (port 15412)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/link/{id}` | Consumer long-poll |
| POST | `/link/{id}` | Producer sends data |

## SDK Methods

```rust
let sdk = testnet.sdk()?;
let signer = sdk.signer(keypair);

// Auth — signup returns a Session bound to the homeserver
let session = signer.signup(&hs_pubkey, None).await?;
// signin resolves the homeserver from the signer's prior signup
let session = signer.signin().await?;
signer.signout(&hs_pubkey).await?;

// Data ops go through SessionStorage
let storage = session.storage();
storage.put(path, json).await?;
storage.get(path).await?;
storage.delete(path).await?;
storage.list(path).await?;
```

## Logging Configuration

Recommended tracing filter for local development (suppresses noisy DHT/republisher output):

```rust
tracing_subscriber::fmt()
    .with_env_filter(
        tracing_subscriber::EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| "info,pubky_homeserver=debug,pubky=debug,pkarr_republisher=error,mainline=warn".parse().unwrap()),
    )
    .init();
```

| Module | Recommended Level | Why |
|--------|------------------|-----|
| `pubky_homeserver` | `debug` | See homeserver operations |
| `pubky` | `debug` | See SDK operations |
| `pkarr_republisher` | `error` | Suppress "Failed to republish" warnings (expected in local testnet) |
| `mainline` | `warn` | Suppress flood of "Mainline DHT listening" info lines |

Override with `RUST_LOG=debug` env var for full output.

## Postgres Requirement

Postgres is a **hard external dependency**. No embedded Postgres exists.

```bash
docker run --name postgres \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=pubky_homeserver -p 127.0.0.1:5432:5432 \
  -d postgres:18-alpine
```

Environment variable: `TEST_PUBKY_CONNECTION_STRING` (defaults to `postgres://postgres:postgres@localhost:5432/postgres`).

## Key Design Constraints

- `StaticTestnet` always creates an **isolated, in-memory** DHT. It cannot join an external DHT network. The DHT does NOT persist across runs.
- `StaticTestnet` fixed-port bootstrap (6881) exists so **external processes** can connect to the testnet's DHT.
- **Port 6881 is contested**: The `mainline` crate defaults ALL DHT nodes to port 6881 (try first, fall back to ephemeral). `StaticTestnet` uses explicit `.port(6881)` which hard-fails if taken. External services using `testnet_with_host` get the default path which silently falls back. This asymmetry means **StaticTestnet must start first**.
- Additional homeservers (via `create_random_homeserver()`) get **ephemeral ports**, but are discoverable via DHT by public key.
- Each `Testnet::new()` call creates an independent DHT. Two testnets never share state.
- `HomeserverKeyRepublisher` publishes SVCB DNS records to DHT at startup + every 60 minutes.
- `UserKeysRepublisher` republishes user keys every 4 hours (60s initial delay). Stale users from previous runs produce "missing" warnings.
- `StaticTestnet.testnet` is a `pub` field, giving access to the inner `Testnet` for `create_homeserver_app_with_mock` and direct homeserver list access.
- `ConnectionString` is re-exported from `pubky_homeserver` (also accessible via `pubky_testnet::pubky_homeserver::ConnectionString`).

## Source Files Reference

| File | Purpose |
|------|---------|
| `pubky-testnet/src/testnet.rs` | Core `Testnet` struct, homeserver/relay creation, client builders |
| `pubky-testnet/src/static_testnet.rs` | `StaticTestnet` with fixed ports, `run_fixed_bootstrap_node()` |
| `pubky-testnet/src/ephemeral_testnet.rs` | `EphemeralTestnet` builder pattern |
| `pubky-testnet/src/main.rs` | Binary entry point |
| `mainline/src/rpc/socket.rs` | `KrpcSocket::new()` — UDP socket binding with `DEFAULT_PORT=6881` try-first logic |
| `mainline/src/rpc/config.rs` | `Config` struct — `port: Option<u16>` defaults to `None` |
| `mainline/src/dht.rs` | `DhtBuilder` — `.port()`, `.bootstrap()`, `.server_mode()` builder methods |
| `pubky-homeserver/src/republishers/key_republisher.rs` | DHT registration logic |
| `pubky-homeserver/src/republishers/user_keys_republisher.rs` | User key republishing |
| `pubky-homeserver/src/data_directory/config_toml.rs` | Homeserver configuration |
| `pubky-homeserver/src/persistence/sql/connection_string.rs` | `ConnectionString` type, `?pubky-test=true` check |
| `pubky-homeserver/src/persistence/sql/sql_db.rs` | `SqlDb::connect()`, ephemeral DB creation logic |
| `pubky-homeserver/src/persistence/sql/migrator.rs` | Auto-migration on startup |
| `pubky-homeserver/src/app_context.rs` | `AppContext` init, DB connection + migration orchestration |
