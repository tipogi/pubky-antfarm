use bip39::Mnemonic;
use colored::Colorize;
use pubky_testnet::pubky::Keypair;
use sha2::{Digest, Sha256};

/// Derive 128 bits of deterministic entropy from an index by hashing it with SHA-256.
fn entropy_from_index(index: usize) -> [u8; 16] {
    let hash = Sha256::digest(index.to_le_bytes());
    let mut entropy = [0u8; 16];
    entropy.copy_from_slice(&hash[..16]);
    entropy
}

/// Derive a BIP39 mnemonic and pubky `Keypair` from a user index.
///
/// The same index always produces the same mnemonic and keypair.
pub fn keypair_from_index(index: usize) -> (Mnemonic, Keypair) {
    let entropy = entropy_from_index(index);
    let mnemonic = Mnemonic::from_entropy(&entropy).expect("16 bytes is valid BIP39 entropy");

    let seed_64 = mnemonic.to_seed_normalized("");
    let mut secret = [0u8; 32];
    secret.copy_from_slice(&seed_64[..32]);
    let keypair = Keypair::from_secret(&secret);

    (mnemonic, keypair)
}

pub fn print_keygen(index: usize) {
    let (mnemonic, keypair) = keypair_from_index(index);
    let pk = keypair.public_key();

    println!("\n{}", "▸ Keygen".cyan().bold());
    println!("  {} {}", "Index:".white().bold(), index);
    println!(
        "  {}  {}",
        "Mnemonic:".white().bold(),
        mnemonic.words().collect::<Vec<_>>().join(" ")
    );
    println!("  {} {}", "Public key:".white().bold(), pk.z32());
}
