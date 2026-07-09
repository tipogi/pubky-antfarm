<p align="center">
  <img src="assets/antfarm-logo.svg" alt="pubky-antfarm logo" width="120" />
</p>

# pubky-antfarm

Local testnet with simulated social activity for testing Pubky services. Spins up an isolated DHT with multiple homeservers and a continuous simulator — designed for testing Nexus and other services against realistic cross-homeserver activity.

## Quick start

**Prerequisites:** Rust (stable), Node.js 18+, PostgreSQL.

```bash
cp config.default.toml config.toml
cp .env-sample .env && docker compose up -d postgres   # optional; or point config at your own Postgres
cd dashboard && npm install && npm run build && cd ..
cargo run
```

Open **http://127.0.0.1:6400**. Rebuild the dashboard (`npm run build`) after frontend changes.

> The dashboard fetches profiles, avatars, and tags from homeservers in the browser and loads the Outfit font from Google Fonts — outbound internet access is expected.

**Run options:**

```bash
TEST_PUBKY_CONNECTION_STRING=postgres://… cargo run   # overrides [postgres] url
cargo run -- --config my-config.toml
RUST_LOG=debug cargo run
cargo run -- --listen-only                            # network only, no simulator
```

## CLI

All control commands talk to the running antfarm over TCP `127.0.0.1:6300` (`control_addr`).

| Command | Purpose |
|---------|---------|
| `keygen --index N` | Deterministic keypair + 12-word mnemonic for user index N |
| `list` | Print homeservers and users |
| `homeserver create --index N` | Create `hs{N+1}` (dormant, joins DHT) |
| `homeserver seed --index N` | Add to simulator rotation |
| `homeserver stop --index N` | Remove from simulator (still reachable) |
| `homeserver down --index N` | Stop HTTP process (DB preserved; hs1 blocked) |
| `homeserver up --index N` | Restart stopped HTTP process |
| `seed user [--index N] --hs N [--profile]` | Create user on a homeserver |
| `seed follow --from N --to N` | Cross-homeserver follow (indices ≥ `max_homeservers`) |
| `seed tag --from N --to N [--label L]` | Tag a user's profile (default label: `interesting`) |
| `seed mention --from N --to N,N` | Post mentioning users |
| `seed tag-resource --from N --target URI --label L --app A` | Tag any URI under `/pub/{app}/tags/` |

`create --index 0` is blocked (hs1 is built-in). Max index: `max_homeservers - 1`.

## Configuration

Copy `config.default.toml` → `config.toml`. `TEST_PUBKY_CONNECTION_STRING` overrides `[postgres] url`.

| Key | Default | Description |
|-----|---------|-------------|
| `tracing` | `true` | Tracing subscriber (`RUST_LOG` when enabled) |
| `max_homeservers` | `24` | Max HS slots; also first user key index |
| `user_storage_quota_mb` | `0` | Per-user storage cap on all HS (`0` = unlimited) |
| `control_addr` | `127.0.0.1:6300` | TCP admin socket |
| `dashboard_addr` | `127.0.0.1:6400` | Dashboard SPA + API |
| `dashboard_enabled` | `true` | Set `false` to disable dashboard |
| `[postgres] url` | see `config.default.toml` | Postgres connection string |
| `[main_homeserver]` | active, mainland | hs1 simulator state (seed always `[0;32]`) |
| `[[homeservers]]` | hs2, hs3 — active, mainland | Swarm HS beyond hs1 |
| `[simulator] interval_secs` | `20` | Tick interval |
| `[simulator] max_users_per_homeserver` | `10` in default config (`0` = unlimited) | Cap users per HS; overflow → extra events |
| `[simulator] users/posts/tags/follows_per_tick` | `[0,5]` / `[0,10]` / `[0,10]` / `[0,5]` | Min/max per tick |
| `[simulator] concurrency` | `4` | Max concurrent data-plane ops |

**Homeserver flags:** **active** = in simulator rotation; **dormant** = reachable but no new activity until seeded; **mainland** = can be referenced cross-HS; **island** = can author activity but excluded as follow/tag/mention targets.

Startup HS are configured in `[[homeservers]]` (label → DB name `pubky_antfarm_{label}`, seed → deterministic keypair). Runtime changes via CLI or dashboard.

## Architecture

`StaticTestnet` (pubky-testnet): isolated in-memory DHT, pkarr relay, multiple homeservers.

```
                   DHT Bootstrap (UDP :6881)
                          |
          +---------------+---------------+
          |               |               |
        hs1             hs2             hs3
   seed [0;32]      seed [1;32]      seed [2;32]
   fixed :6286      ephemeral*        ephemeral*
          |
   Pkarr Relay (HTTP :15411)
   HTTP Relay  (HTTP :15412)
```

Each homeserver publishes a pkarr `SignedPacket` to the DHT so any client can discover it by public key alone.

\* hs2+ get ephemeral ports on first boot; after down → up (or any restart while antfarm is running), the same ports are reused from stored metadata.

| Component | Address |
|-----------|---------|
| DHT bootstrap | `localhost:6881` (UDP) |
| Pkarr relay | `http://localhost:15411` |
| HTTP relay / inbox / link | `http://localhost:15412` (+ `/inbox`, `/link`) |
| Admin socket | `127.0.0.1:6300` |
| Dashboard | `http://127.0.0.1:6400` |
| hs1 HTTP | `http://localhost:6286` (fixed) |
| hs2+ HTTP | ephemeral first boot; same ports reused on down/up (discover via DHT) |

| Homeserver | Seed | Database |
|------------|------|----------|
| hs1 | `[0; 32]` | `pubky_test_{uuid}` (auto, each run) |
| hs2+ | `[seed; 32]` | `pubky_antfarm_{label}` |

Same seeds → same pubkeys every run. On each start, all `pubky_test_*` and `pubky_antfarm_*` databases are dropped and recreated (DHT is ephemeral).

## Simulator

Bootstraps one user + profile + post + tag per active HS, then ticks every `interval_secs` creating random users, posts, tags, and follows. Dormant HS are skipped; island HS are excluded as cross-HS targets. At user cap, signup slots become extra posts/tags/follows. Tick ops and dashboard actions run concurrently (bounded by `concurrency`).

Avatars: robohash (`https://robohash.org/{index}.jpg`), cached in `static/avatars/`.

## Dashboard

Built SPA served by antfarm at `dashboard_addr`. Live state via SSE (`GET /api/events`); tick deltas via `GET /api/activity`.

**Views:** **Homeservers** — card grid, drawer with active/dormant, island, process up/down, user table (follow, tag, batch, social posts, change HS, keys); **Graph** — HS hubs, users, infra nodes (bootstrap, DHT, relays), cross-HS follows; **Search** — browse a user's timeline by pubkey (sign in via recovery file or mnemonic); **Stats** — network info, simulator settings, activity analytics.

**API** (POST unless noted; all bridge to the control channel):

| Route | Purpose |
|-------|---------|
| `GET /api/homeservers` | Snapshot |
| `GET /api/events` | SSE full state |
| `GET /api/activity` | SSE tick deltas |
| `POST /api/homeserver/{create,seed,stop,down,up,island}` | HS control (`create` accepts `{ index, island? }`) |
| `GET /api/homeserver/:seed/users/storage` | Per-user storage usage |
| `POST /api/user` | Create user `{ hs, profile?, index? }` |
| `GET /api/user/:index/keys` | Pubkey + mnemonic |
| `POST /api/user/change-homeserver` | Re-register user on another HS |
| `POST /api/follow` | Follow by pubky key `{ from, target }` |
| `POST /api/tag` | Tag URI `{ from, target, label }` |
| `POST /api/batch` | Bulk posts/tags `{ from, posts, tags }` |
| `POST /api/post/social` | Short post, mention, repost, repost+mention |

Graph/search profiles and tags are fetched in-browser via [`@synonymdev/pubky`](https://www.npmjs.com/package/@synonymdev/pubky) through the pkarr relay.

**Dev mode:** `cargo run` + `cd dashboard && npm run dev` → http://localhost:5173 (proxies `/api` to 6400). See `dashboard/README.md`.
