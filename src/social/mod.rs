mod common;
mod file;
mod follow;
mod identity;
mod mention;
mod post;
mod profile;
mod session;
mod social_post;
mod tag;

pub(crate) use follow::create as create_follow;
pub(crate) use identity::user_name;
pub use identity::UserKeys;
pub(crate) use mention::create as create_mention;
pub(crate) use post::create as create_post;
pub(crate) use post::random_content;
pub(crate) use profile::signup;
pub(crate) use profile::signup_and_write;
pub(crate) use profile::write_profile;
pub(crate) use session::{SessionCache, UserSession};
pub(crate) use social_post::create as create_social_post;
pub(crate) use social_post::Variant as SocialPostVariant;
pub(crate) use tag::create as create_tag;
pub(crate) use tag::create_for_app as create_tag_for_app;
pub(crate) use tag::random_label as random_tag_label;

/// Extract the public-key segment from a `pubky://<pk>/…` URI.
fn pubky_uri_key(uri: &str) -> Option<&str> {
    uri.strip_prefix("pubky://")?.split('/').next()
}

/// Normalize a follow target to a z32 public key.
pub(crate) fn normalize_follow_target(target: &str) -> anyhow::Result<String> {
    let trimmed = target.trim();
    if trimmed.is_empty() {
        anyhow::bail!("target pubky is required");
    }
    if let Some(pk) = pubky_uri_key(trimmed) {
        return Ok(pk.to_string());
    }
    Ok(trimmed.to_string())
}

/// Normalize a tag target to a profile URI from a bare z32 public key.
pub(crate) fn normalize_tag_target(target: &str) -> anyhow::Result<String> {
    let trimmed = target.trim();
    if trimmed.is_empty() {
        anyhow::bail!("target key is required");
    }
    if trimmed.contains("://") || trimmed.contains('/') {
        anyhow::bail!("target must be a pubky key, not a URI");
    }
    Ok(format!("pubky://{}/pub/pubky.app/profile.json", trimmed))
}
