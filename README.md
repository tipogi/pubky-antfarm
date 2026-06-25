<p align="center">
  <img src="assets/antfarm-logo.svg" alt="pubky-antfarm logo" width="120" />
</p>

# pubky-antfarm

Local testnet with simulated social activity for testing Pubky services. Spins up an isolated DHT network with multiple homeservers and a continuous simulator generating users, posts, and tags -- designed for testing Nexus against a decentralized environment with realistic cross-homeserver activity.

## Quick start

Prerequisites:

- **Rust** (stable) + Cargo
- **Node.js** 18+ and npm (to build the dashboard)
- A running **PostgreSQL** instance reachable by the connection string in your config

```bash
# 1. Create your config
cp config.default.toml config.toml
# edit [postgres] url to match your Postgres, or export TEST_PUBKY_CONNECTION_STRING

# 2. Build the dashboard (one-time, and after any frontend change)
cd dashboard && npm install && npm run build && cd ..

# 3. Run the antfarm (DHT + homeservers + simulator + dashboard)
cargo run
```

Then open the dashboard at **http://127.0.0.1:6400**.

> The dashboard fetches user profiles, avatars, and tags directly from the
> homeservers in the browser, and loads the Outfit font from Google Fonts, so it
> expects normal outbound internet access.

## Run options

`cargo run` (see [Quick start](#quick-start)) accepts a few variations:

```bash
# Override the Postgres connection without editing config.toml (takes precedence)
TEST_PUBKY_CONNECTION_STRING=postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${POSTGRES_PORT}/${POSTGRES_DB}?pubky-test=true cargo run

# Use a custom config file
cargo run -- --config my-config.toml

# Override the tracing filter
RUST_LOG=debug cargo run

# Start the network without writing data or running the simulator
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
| `[simulator] max_users_per_homeserver` | `0` | Cap users per homeserver (`0` = unlimited). When full, user slots become extra posts/tags/follows |
| `[simulator] users_per_tick` | `[0, 5]` | Min/max new users per tick |
| `[simulator] posts_per_tick` | `[0, 10]` | Min/max new posts per tick |
| `[simulator] tags_per_tick` | `[0, 10]` | Min/max new tags per tick |
| `[simulator] follows_per_tick` | `[0, 5]` | Min/max new follows per tick |
| `[simulator] concurrency` | `4` | Max data-plane ops (tick ops + dashboard actions) in flight at once; bounds in-flight connections |

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
| Dashboard (UI + API) | `http://127.0.0.1:6400` | SPA + HTTP + SSE |
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

## Dashboard

A localhost web dashboard (in `dashboard/`) shows all homeservers and updates live
as they are created, seeded, or stopped. The antfarm process serves the data over
HTTP + Server-Sent Events on `dashboard_addr` (default `127.0.0.1:6400`):

- `GET /api/homeservers` — one-shot JSON snapshot
- `GET /api/events` — SSE stream pushing the full snapshot on connect and on every
  homeserver topology change
- `GET /api/activity` — SSE stream of per-tick simulator deltas
- `POST /api/homeserver/create` · `seed` · `stop` — control a homeserver (body `{ "index": N }`)
- `POST /api/user` — create a user (body `{ "hs": N, "profile": bool }`)

These POST routes bridge directly to the same control channel used by the
`homeserver` / `seed user` CLI commands, so the dashboard can create, start, stop,
and add users interactively.

The dashboard has three views, selectable from the left icon rail:

- **Graph** (default) — an interactive network graph. Each homeserver is a hub and
  each of its users is a node (rendered as a key). Hovering a user shows a card with
  their avatar, name, public key, and tags; clicking a user reveals their follow
  relationships. Includes pan, zoom, fit-to-view, and an inline create-homeserver
  control.
- **Homeservers** — a card grid of every homeserver (active + dormant). Click one to
  open a drawer where you can toggle it between **active** and **dormant**, add
  users, and copy its keys/URL.
- **Stats** — network info, simulator settings, and live activity totals + feed.

Profiles, avatars, and tags shown in the graph are fetched live from each
homeserver in the browser via the
[`@synonymdev/pubky`](https://www.npmjs.com/package/@synonymdev/pubky) client
(through the pkarr relay), independently of the antfarm API above.

### Single-process (recommended)

The antfarm serves the **built** dashboard from the same port, so it's one process:

```bash
cd dashboard && npm install && npm run build   # produces dashboard/dist
cd .. && cargo run                              # open http://127.0.0.1:6400
```

`cargo run` serves the SPA at `dashboard_addr` and the API under `/api`. Rebuild the
dashboard (`npm run build`) whenever you change the frontend.

### Dev mode (hot reload)

For frontend work, run Vite separately with hot module reload:

```bash
cd dashboard
npm run dev   # http://localhost:5173 (proxies /api to the antfarm)
```

Set `dashboard_enabled = false` in `config.toml` to turn the dashboard off.

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

All ranges and the tick interval are configurable in `[simulator]` in `config.toml`. When `max_users_per_homeserver` is set and a homeserver reaches that cap, the simulator stops signing up new users there and redirects those tick slots as extra posts, tags, or follows.

Each tick runs its operations concurrently (up to `[simulator] concurrency`, default 4), and dashboard/CLI actions (create user, follow, tag, batch) run on their own tasks rather than the runtime loop. This means a click returns as soon as its own work finishes instead of waiting behind the current tick, and several actions can run in parallel. The shared simulation state is held behind a lock that is only taken for brief reads and commits — never across a network call — and the same `concurrency` limit bounds how many connections are open at once.

### Avatars

Each new user gets a robohash avatar fetched from `https://robohash.org/{index}.jpg`. Downloaded images are cached in `static/avatars/` so subsequent runs don't re-fetch. The avatar is uploaded as a `PubkyAppBlob` + `PubkyAppFile` and linked in the user's profile.
