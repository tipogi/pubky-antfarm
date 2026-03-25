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
}

pub struct Cmd {
    pub action: Action,
    pub index: Option<u8>,
    pub hs: Option<u8>,
    pub profile: bool,
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
