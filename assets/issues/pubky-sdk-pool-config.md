# Expose connection-pool config on `PubkyHttpClientBuilder` (e.g. `pool_max_idle_per_host`)

## Summary

`PubkyHttpClient` builds its underlying `reqwest::Client` internally and never exposes
reqwest's connection-pool knobs. In long-running, many-identity scenarios (especially a
single-process testnet like `pubky-testnet` with many users), the native **PubkyTLS**
request path causes the process to accumulate **one idle keep-alive socket per distinct
pubky host** and eventually exhaust the OS file-descriptor limit. There is currently
**no way for a downstream consumer to cap or disable idle pooling** — the underlying
`reqwest::Client`s are private and cannot be configured or replaced. This is a
configurability gap, not "wrong" default behavior.

Request: add an opt-in builder method (at minimum `pool_max_idle_per_host`, ideally also
`pool_idle_timeout`) that is forwarded to both the pubky `http` client and the
`icann_http` client.

## Root cause

Reqwest pools idle connections by URL origin (`scheme://host:port`), not by the resolved
IP/port. On the native PubkyTLS path, `pubky-sdk` keeps the pubky public key in the URL
host and relies on pkarr underneath reqwest for DNS/TLS. That means every distinct pubky
host gets its own pool entry, even when all of those hosts resolve to the same local
homeserver endpoint.

In the current published crate (`pubky` 0.9.3 on crates.io, from `pubky-core`), native
routing resolves pubky hosts to either `PubkyTls` or an ICANN fallback. The fd growth is
on the `PubkyTls` branch, which keeps the original pubky host in the URL and sends it
through `self.http`:

```rust
// pubky-sdk/src/client/http_targets/native.rs
match transport {
    ResolvedTransport::PubkyTls => Ok(self.http.request(method, url.as_str())),
    ResolvedTransport::Icann { domain, port } => {
        let mut icann_url = url.clone();
        icann_url.set_host(Some(domain))?;
        // ...
        Ok(self.icann_http.request(method, icann_url.as_str())
            .header("pubky-host", pk))
    }
}
```

`self.http` is built from the pkarr client, which configures reqwest with pkarr as a custom
DNS resolver plus PubkyTLS:

```rust
// pkarr/src/extra/reqwest.rs
::reqwest::ClientBuilder::new()
    .dns_resolver(std::sync::Arc::new(client.clone()))
    .use_preconfigured_tls(rustls::ClientConfig::from(client))
```

Concrete effect:

```
https://alice-pubky/pub/file.txt -> pool key https://alice-pubky:443 -> 127.0.0.1:6287
https://bob-pubky/pub/file.txt   -> pool key https://bob-pubky:443   -> 127.0.0.1:6287
```

Those are two idle sockets, not one, because the pool keys differ. Repeated requests to the
same pubky reuse the same pool entry; ICANN fallback requests rewrite the URL to the
resolved domain and pool under that domain instead.

In a single-process loopback testnet, the direct PubkyTLS endpoint is reachable, so the
transport resolver selects `PubkyTls` rather than the ICANN fallback.

Reqwest's defaults make this visible in high-cardinality workloads:
`pool_max_idle_per_host = usize::MAX` (effectively unbounded per origin) and
`pool_idle_timeout = 90s`. If each identity is touched again within 90s, its idle timer
keeps resetting and the socket stays warm. In a single-process loopback testnet, both ends
of each TCP connection live in the same process, so one logical connection consumes about
two fds.

The SDK builder offers no way to influence this:

```rust
// pubky-sdk/src/client/core.rs (build())
let mut http_builder =
    reqwest::ClientBuilder::from(pkarr.clone()).user_agent(user_agent.as_ref());
let mut icann_http_builder =
    reqwest::Client::builder()
        .user_agent(user_agent.as_ref())
        .tls_backend_preconfigured(icann_tls_config_without_revocation_check());
// ... no pool config is applied, and no custom reqwest::Client can be injected
```

There is also no `Pubky::with_client(custom_reqwest_client)` escape hatch — `with_client`
takes a fully-built `PubkyHttpClient`, whose `http` / `icann_http` fields are private.

## Why this should be opt-in

The default is reasonable for typical apps: different pubkeys usually live on different
homeservers, and connection reuse is useful. The missing piece is a resource-control knob
for high-cardinality workloads - testnets, simulators, load generators, and indexers like
Nexus - where many pubkey origins stay warm against a small number of hosts.

## Proposed fix

Add an optional, non-breaking pool setting to `PubkyHttpClientBuilder` and forward it to
both reqwest clients in `build()`.

```rust
#[derive(Default)]
pub struct PubkyHttpClientBuilder {
    pkarr: pkarr::ClientBuilder,
    http_request_timeout: Option<Duration>,
    user_agent_extra: Option<String>,
    pool_max_idle_per_host: Option<usize>, // NEW
    // ...
}

impl PubkyHttpClientBuilder {
    /// Maximum number of idle (keep-alive) connections kept per host.
    ///
    /// Defaults to reqwest's behavior (effectively unbounded per origin) when unset. Set
    /// to `0` to disable idle pooling entirely so no idle connections are retained after
    /// responses. This is useful for long-running, high-identity-count, or single-process
    /// (testnet) deployments where one idle socket per pubky host would otherwise exhaust
    /// file descriptors.
    pub fn pool_max_idle_per_host(&mut self, max: usize) -> &mut Self {
        self.pool_max_idle_per_host = Some(max);
        self
    }
}

// Apply in build(), to both internally-owned clients.
if let Some(max) = self.pool_max_idle_per_host {
    http_builder = http_builder.pool_max_idle_per_host(max);
    icann_http_builder = icann_http_builder.pool_max_idle_per_host(max);
}
```

(Optionally also expose `pool_idle_timeout(Duration)` the same way.)

### Out of scope (separate discussion)

One could also have `testnet()` / `testnet_with_host()` default `pool_max_idle_per_host`
to a small value (or `0`), since the single-process testnet is exactly the environment
where unbounded idle pooling is harmful. That would fix every testnet consumer with no
downstream code change - but it is a **behavior change** for existing testnet users and
should be decided separately from simply exposing the knob. This issue only asks for the
opt-in setter; the testnet default can be its own follow-up.
