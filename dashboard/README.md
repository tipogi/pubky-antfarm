# Antfarm Dashboard

React SPA for the running antfarm. Full docs: [../README.md](../README.md#dashboard).

## Develop

```bash
cargo run                    # from repo root — API on 127.0.0.1:6400
cd dashboard && npm install && npm run dev   # http://localhost:5173, proxies /api
```

Production build: `npm run build` → `dashboard/dist`, served by `cargo run`.
