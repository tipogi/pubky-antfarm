# Antfarm Dashboard

A localhost web dashboard for a running `pubky-antfarm`. It shows all homeservers
(active + dormant) and updates live over Server-Sent Events.

## Develop

Start the antfarm (serves the dashboard API on `127.0.0.1:6400` by default):

```bash
cargo run        # from the repo root
```

Then start the dashboard dev server (proxies `/api` to the antfarm):

```bash
cd dashboard
npm install
npm run dev      # http://localhost:5173
```

## Data source

- `GET /api/homeservers` — one-shot JSON snapshot
- `GET /api/events` — SSE stream emitting a `state` event with the full snapshot
  on connect and on every homeserver topology change

The API address is configurable via `dashboard_addr` in `config.toml`, and can be
disabled with `dashboard_enabled = false`.
