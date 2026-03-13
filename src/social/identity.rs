use std::collections::HashMap;

use pubky_testnet::pubky::{Keypair, PublicKey};
use rand::RngExt as _;

const USER_INDEX_START: usize = 24;

const ADJECTIVES: &[&str] = &[
    "swift", "bright", "silent", "frozen", "blazing",
    "cosmic", "hidden", "rustic", "golden", "nimble",
    "feral", "lucid", "primal", "rugged", "vivid",
    "hollow", "molten", "serene", "wicked", "ancient",
    "bitter", "daring", "gentle", "jagged", "mystic",
    "roaming", "savage", "tender", "woven", "cryptic",
    "dusty", "forked", "lunar", "nested", "orbital",
    "parsed", "async", "static", "mutable", "native",
    "atomic", "binary", "cached", "dense", "elastic",
    "gifted", "hashed", "keen", "linked", "mapped",
];

const NOUNS: &[&str] = &[
    "river", "falcon", "summit", "kernel", "cipher",
    "forest", "beacon", "glacier", "pebble", "canyon",
    "temple", "harbor", "nebula", "meadow", "torrent",
    "tundra", "marsh", "valley", "aurora", "comet",
    "branch", "socket", "thread", "buffer", "vertex",
    "module", "signal", "bridge", "cursor", "daemon",
    "ledger", "shard", "block", "relay", "proxy",
    "index", "token", "stack", "queue", "router",
    "anchor", "spark", "pulse", "orbit", "storm",
    "cedar", "flint", "coral", "ridge", "ember",
];

pub(super) fn user_name() -> String {
    let mut rng = rand::rng();
    let adj = ADJECTIVES[rng.random_range(0..ADJECTIVES.len())];
    let noun = NOUNS[rng.random_range(0..NOUNS.len())];
    let num = rng.random_range(0..100u32);
    format!("+{adj}{noun}{num:02}")
}

pub struct UserKeys {
    next_index: usize,
    keys: HashMap<usize, PublicKey>,
}

impl UserKeys {
    pub fn new() -> Self {
        Self {
            next_index: USER_INDEX_START,
            keys: HashMap::new(),
        }
    }

    pub fn create_next(&mut self) -> (usize, Keypair) {
        let index = self.next_index;
        self.next_index += 1;
        let keypair = Self::keypair_at(index);
        self.keys.insert(index, keypair.public_key());
        (index, keypair)
    }

    pub fn keypair_at(index: usize) -> Keypair {
        crate::keygen::keypair_from_index(index).1
    }

    pub fn random_user(&self) -> Option<(usize, PublicKey)> {
        if self.keys.is_empty() {
            return None;
        }
        let idx = rand::rng().random_range(0..self.keys.len());
        let (&key, pk) = self.keys.iter().nth(idx)?;
        Some((key, pk.clone()))
    }
}
