use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use pubky_testnet::pubky::{Pubky, PublicKey, SessionStorage};
use tokio::sync::OnceCell;

use super::UserKeys;

/// A signed-in session for a single user, paired with its public key so writers
/// can build `pubky://…` paths and log without re-deriving the keypair.
#[derive(Clone)]
pub struct UserSession {
    pub public_key: PublicKey,
    pub storage: SessionStorage,
}

/// Caches one signed-in session per user index.
///
/// `signin()` performs a session exchange plus a (background) DHT republish on
/// every call. The simulator and dashboard write for the same users repeatedly,
/// so signing in once and reusing the resulting `SessionStorage` removes a
/// DHT-resolve + republish from the vast majority of writes.
///
/// Cloning is cheap: the map is shared behind an `Arc`. Each entry is an
/// `OnceCell` so concurrent callers for the same index share a single sign-in
/// instead of racing to create duplicates.
#[derive(Clone, Default)]
pub struct SessionCache {
    inner: Arc<Mutex<HashMap<usize, Arc<OnceCell<UserSession>>>>>,
}

impl SessionCache {
    /// Return the cached session for `index`, signing in exactly once if needed.
    pub async fn get(&self, sdk: &Pubky, index: usize) -> anyhow::Result<UserSession> {
        // Take (or create) the per-index cell, releasing the lock before any
        // `.await` so a slow sign-in never blocks other indices.
        let cell = {
            let mut map = self.inner.lock().unwrap();
            map.entry(index).or_default().clone()
        };

        let session = cell
            .get_or_try_init(|| async {
                let keypair = UserKeys::keypair_at(index);
                let public_key = keypair.public_key();
                let session = sdk.signer(keypair).signin().await?;
                anyhow::Ok(UserSession {
                    public_key,
                    storage: session.storage(),
                })
            })
            .await?;

        Ok(session.clone())
    }

    /// Pre-seed the cache with a session obtained elsewhere (e.g. the one
    /// returned by signup), so the user's first write reuses it instead of
    /// signing in again.
    pub fn insert(&self, index: usize, session: UserSession) {
        let cell = Arc::new(OnceCell::new());
        let _ = cell.set(session);
        self.inner.lock().unwrap().insert(index, cell);
    }

    /// Drop a cached session so the next `get` signs in afresh. Wired into the
    /// write error path so an expired/invalid session self-heals.
    pub fn invalidate(&self, index: usize) {
        self.inner.lock().unwrap().remove(&index);
    }
}
