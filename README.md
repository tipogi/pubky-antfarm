# pubky-antfarm

Local testnet with simulated social activity for testing Pubky services. Spins up an isolated DHT network with multiple homeservers and a continuous simulator generating users, posts, and tags -- designed for testing Nexus against a decentralized environment with realistic cross-homeserver activity.

## Usage

```bash
cargo run
```

Use a custom config file:

```bash
cargo run -- --config my-config.toml
```

Override the tracing filter directly:

```bash
RUST_LOG=debug cargo run
```

Start the network without writing any data or running the simulator:

```bash
cargo run -- --listen-only
```

## Commands

### `keygen`

Generate a deterministic keypair and 12-word mnemonic from a user index. The same index always produces the same mnemonic and public key, which is useful for hardcoding known pubkeys in external services during development.

```bash
cargo run -- keygen --index 24
```

### `list`

Print all homeservers and their signed-up users by querying a running antfarm:

```bash
cargo run -- list
```

### `homeserver`

Create, seed, or stop homeservers on a running antfarm -- no restart needed.

```bash
cargo run -- homeserver create --index 3   # create hs4 (dormant, no events)
cargo run -- homeserver seed   --index 3   # add hs4 to simulator rotation
cargo run -- homeserver stop   --index 3   # remove hs4 from simulator
cargo run -- homeserver seed   --index 3   # resume hs4 in simulator
```

**create** creates `hs{index+1}` (seed `[index; 32]`) with database `pubky_antfarm_hs{index+1}` and joins the DHT. The homeserver is reachable but the simulator does not write to it yet.

**seed** adds a created homeserver to the simulator rotation. The simulator begins placing users, posts, tags, and follows on it. Can also resume a stopped homeserver.

**stop** removes the homeserver from the simulator rotation. It stays running and its users remain reachable via DHT -- it just stops receiving new simulated activity.

The index must be 1-23 (0 is reserved for the built-in hs1, max is `max_homeservers - 1`). Commands communicate with the running antfarm via a TCP admin socket on `127.0.0.1:6300`.

### `seed`

Create specific users or cross-homeserver social references against a running antfarm.

#### `seed user`

Create a user on a specific homeserver via the control socket. The simulator registry is updated so subsequent ticks know about the user.

```bash
cargo run -- seed user --hs 0                          # auto-assign index, signup only on hs1
cargo run -- seed user --hs 3 --profile                # auto-assign index, signup + profile on hs4
cargo run -- seed user --index 24 --hs 3 --profile     # explicit index 24, signup + profile on hs4
```

When `--index` is omitted, the server auto-assigns the next available user index from the simulator registry. When provided, the given index is used (useful for deterministic keypairs via `keygen`).

Without `--profile`, only the signup is performed. With `--profile`, a `profile.json` (with avatar) is also written to the homeserver.

#### `seed follow` / `seed tag` / `seed mention`

Create cross-homeserver social references. User indices must be `>= max_homeservers` (default 24).

```bash
cargo run -- seed follow  --from 24 --to 25
cargo run -- seed tag     --from 24 --to 25 --label cool
cargo run -- seed mention --from 24 --to 25,26
```

#### `seed tag-resource`

Tag an arbitrary URI under a custom app namespace. All four flags are required.

```bash
cargo run -- seed tag-resource --from 24 --target "https://example.com/article?q=test" --label example --app sandbox
```

This writes a `PubkyAppTag` to `/pub/{app}/tags/{tag_id}` on the tagger's homeserver, where `tag_id` is derived from the target URI and label. The target can be any valid URI (HTTP URLs, pubky URIs, etc.).

```bash
cargo run -- seed tag-resource --from 25 --target "https://en.wikipedia.org/wiki/Bitcoin" --label reference --app wiki
cargo run -- seed tag-resource --from 26 --target "https://github.com/pubky/pubky-core" --label opensource --app github
```

## Configuration

A `config.toml` is required. Copy the default to get started:

```bash
cp config.default.toml config.toml
```

| Key | Default | Description |
|-----|---------|-------------|
| `tracing` | `true` | Enable tracing subscriber. When `true`, logs are controlled by `RUST_LOG` or a built-in default filter |
| `max_homeservers` | `24` | Maximum homeserver slots and the starting index for user key derivation |
| `[postgres] url` | `postgres://…localhost:5432/postgres` | Postgres connection string |
| `[[homeservers]]` | hs2 (seed 1), hs3 (seed 2) | Swarm homeservers beyond the built-in hs1 |
| `[simulator] interval_secs` | `20` | Seconds between simulator ticks |
| `[simulator] users_per_tick` | `[0, 5]` | Min/max new users per tick |
| `[simulator] posts_per_tick` | `[0, 10]` | Min/max new posts per tick |
| `[simulator] tags_per_tick` | `[0, 10]` | Min/max new tags per tick |
| `[simulator] follows_per_tick` | `[0, 5]` | Min/max new follows per tick |

The env var `TEST_PUBKY_CONNECTION_STRING` overrides `postgres.url` if set.

| Environment Variable | Description |
|----------------------|-------------|
| `TEST_PUBKY_CONNECTION_STRING` | Overrides `postgres.url` from config |
| `RUST_LOG` | Override the tracing filter (standard `EnvFilter` syntax) |

## Architecture

The antfarm spins up a `StaticTestnet` (from `pubky-testnet`) with homeservers sharing an isolated, in-memory DHT.

```
                   DHT Bootstrap (UDP :6881)
                          |
          +---------------+---------------+
          |               |               |
        hs1             hs2             hs3
   seed [0;32]      seed [1;32]      seed [2;32]
   fixed :6286      ephemeral         ephemeral
          |
   Pkarr Relay (HTTP :15411)
```

Each homeserver publishes a pkarr `SignedPacket` to the DHT so any client can discover it by public key alone.

### Network Endpoints

| Component | Address | Protocol |
|-----------|---------|----------|
| DHT bootstrap | `localhost:6881` | UDP (Mainline DHT) |
| Pkarr relay | `http://localhost:15411` | HTTP |
| Admin socket | `127.0.0.1:6300` | TCP (JSON-line) |
| hs1 HTTP | `http://localhost:6286` | HTTP (fixed) |
| hs2 / hs3 HTTP | ephemeral ports | HTTP (discover via DHT) |

### Homeserver Keys

| Homeserver | Seed | Database |
|------------|------|----------|
| hs1 | `[0; 32]` (StaticTestnet default) | auto-created `pubky_test_{uuid}` |
| hs2 | `[1; 32]` | `pubky_antfarm_hs2` |
| hs3 | `[2; 32]` | `pubky_antfarm_hs3` |

Same seeds produce the same public keys every run, so external services can hardcode the z32 pubkeys for development.

### Adding Homeservers

**At startup** -- append an entry to the `[[homeservers]]` array in `config.toml`:

```toml
[[homeservers]]
label = "hs4"
seed = 3
```

The label drives the database name (`pubky_antfarm_hs4`) and the seed produces a deterministic keypair. Everything else -- database creation, pkarr publishing, DHT registration -- happens automatically.

**At runtime** -- use the `homeserver` command to create and control homeservers on a running antfarm:

```bash
cargo run -- homeserver create --index 3   # create hs4 (dormant)
cargo run -- homeserver seed   --index 3   # start simulator activity
cargo run -- homeserver stop   --index 3   # pause simulator activity
```

See the [`homeserver` command](#homeserver) for details.

## Database Lifecycle

On each `cargo run`:

1. All stale `pubky_test_*` and `pubky_antfarm_*` databases are dropped.
2. Swarm databases are created fresh (one per `[[homeservers]]` entry).
3. `hs1` gets a new `pubky_test_{uuid}` database automatically (via `?pubky-test=true`).

Databases must be reset every run because the DHT is ephemeral -- old user records reference pkarr packets that no longer exist on the fresh DHT.

## Simulator

After the initial setup (one user + profile + post + tag per homeserver), the simulator runs in a loop creating random activity:

- **Users**: 0-5 new signups per tick, assigned to a random homeserver
- **Posts**: 0-10 new posts per tick from existing users
- **Tags**: 0-10 new tags per tick, targeting random users or posts
- **Follows**: 0-5 new follows per tick between random users (self-follows are skipped)

All ranges and the tick interval are configurable in `[simulator]` in `config.toml`.

### Avatars

Each new user gets a robohash avatar fetched from `https://robohash.org/{index}.jpg`. Downloaded images are cached in `static/avatars/` so subsequent runs don't re-fetch. The avatar is uploaded as a `PubkyAppBlob` + `PubkyAppFile` and linked in the user's profile.
