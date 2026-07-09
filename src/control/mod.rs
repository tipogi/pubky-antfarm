pub mod client;
pub mod server;

use serde::{Deserialize, Serialize};
use tokio::sync::oneshot;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Create,
    Seed,
    Stop,
    User,
    /// Re-register an existing deterministic user key on another homeserver.
    ChangeHomeserver,
    Follow,
    Tag,
    Batch,
    /// Create a mention, repost, or combined short post.
    SocialPost,
    /// Toggle/set a homeserver's island (isolation) mode.
    Island,
    /// Stop the homeserver process (metadata and DB preserved).
    Down,
    /// Start a previously stopped homeserver process.
    Up,
}

#[derive(Debug, Clone)]
pub struct SocialPostPayload {
    pub kind: String,
    pub from: String,
    pub mention_key: Option<String>,
    pub post_uri: Option<String>,
}

pub struct Cmd {
    pub action: Action,
    pub index: Option<u8>,
    pub hs: Option<u8>,
    pub profile: bool,
    /// User index performing a follow or tag action.
    pub from: Option<usize>,
    pub target: Option<String>,
    pub label: Option<String>,
    /// Manual batch: number of posts to create (0 = skip).
    pub batch_posts: u32,
    /// Manual batch: number of tags to create (0 = skip).
    pub batch_tags: u32,
    /// Island mode. For `Create`, the initial state (default `false`). For
    /// `Island`, the desired state — `None` toggles the current value.
    pub island: Option<bool>,
    pub social_post: Option<SocialPostPayload>,
    pub reply: oneshot::Sender<Reply>,
}

pub enum Reply {
    Ok {
        label: String,
        public_key: Option<String>,
        http_url: Option<String>,
        message: String,
    },
    Err(String),
}

#[derive(Deserialize)]
pub(crate) struct Request {
    pub action: String,
    #[serde(default)]
    pub index: Option<u8>,
    #[serde(default)]
    pub hs: Option<u8>,
    #[serde(default)]
    pub profile: Option<bool>,
    #[serde(default)]
    pub island: Option<bool>,
}

#[derive(Serialize, Deserialize)]
pub(crate) struct Response {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub public_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub http_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl From<Reply> for Response {
    fn from(reply: Reply) -> Self {
        match reply {
            Reply::Ok {
                label,
                public_key,
                http_url,
                message,
            } => Response {
                ok: true,
                label: Some(label),
                public_key,
                http_url,
                message: Some(message),
                error: None,
            },
            Reply::Err(msg) => Response {
                ok: false,
                label: None,
                public_key: None,
                http_url: None,
                message: None,
                error: Some(msg),
            },
        }
    }
}
