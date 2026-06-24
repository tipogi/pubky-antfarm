use axum::extract::{Path, State};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::routing::{get, post};
use axum::{Json, Router};
use colored::Colorize;
use futures_util::stream::Stream;
use serde::Deserialize;
use std::convert::Infallible;
use std::time::Duration;
use tokio::sync::{broadcast, mpsc, oneshot, watch};
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};

use crate::control;

/// Built dashboard SPA, resolved at compile time so it works no matter what
/// directory `cargo run` is launched from.
const DASHBOARD_DIST: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/dashboard/dist");

use super::{storage, DashboardState, TickEvent};

#[derive(Clone)]
struct AppState {
    state: watch::Receiver<DashboardState>,
    activity: broadcast::Sender<TickEvent>,
    ctrl_tx: mpsc::Sender<control::Cmd>,
}

/// Serve the dashboard HTTP API:
/// - `GET  /api/homeservers` — JSON snapshot
/// - `GET  /api/events` — SSE stream of the full state on every change
/// - `GET  /api/activity` — SSE stream of per-tick simulator deltas
/// - `POST /api/homeserver/{create,seed,stop}` — control a homeserver
/// - `POST /api/user` — create a user on a homeserver
/// - `POST /api/follow` — user follows a target pubky
/// - `POST /api/tag` — user tags a target URI with a label
/// - `POST /api/batch` — create many posts and/or tags at once
pub async fn serve(
    addr: String,
    state: watch::Receiver<DashboardState>,
    activity: broadcast::Sender<TickEvent>,
    ctrl_tx: mpsc::Sender<control::Cmd>,
) {
    // Serve the built SPA for any non-API path; unknown routes fall back to
    // index.html so client-side navigation works.
    let index_html = format!("{DASHBOARD_DIST}/index.html");
    let spa = ServeDir::new(DASHBOARD_DIST).not_found_service(ServeFile::new(index_html));

    let app = Router::new()
        .route("/api/homeservers", get(snapshot))
        .route("/api/events", get(events))
        .route("/api/activity", get(activity_stream))
        .route("/api/homeserver/create", post(create_homeserver))
        .route("/api/homeserver/seed", post(seed_homeserver))
        .route("/api/homeserver/stop", post(stop_homeserver))
        .route("/api/homeserver/:seed/users/storage", get(user_storage))
        .route("/api/user", post(create_user))
        .route("/api/follow", post(create_follow))
        .route("/api/tag", post(create_tag))
        .route("/api/batch", post(create_batch))
        .fallback_service(spa)
        .layer(CorsLayer::permissive())
        .with_state(AppState {
            state,
            activity,
            ctrl_tx,
        });

    let listener = match tokio::net::TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("  dashboard API failed to bind {addr}: {e}");
            return;
        }
    };

    println!(
        "  {}  {}",
        "Dashboard:".white().bold(),
        format!("http://{addr}").underline()
    );

    if let Err(e) = axum::serve(listener, app).await {
        eprintln!("  dashboard API error: {e}");
    }
}

async fn snapshot(State(app): State<AppState>) -> Json<DashboardState> {
    Json(app.state.borrow().clone())
}

async fn events(
    State(app): State<AppState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let mut rx = app.state;
    let stream = async_stream::stream! {
        // Emit the current state immediately on connect, then on every change.
        {
            let data = serde_json::to_string(&*rx.borrow_and_update())
                .unwrap_or_else(|_| "{}".to_string());
            yield Ok(Event::default().event("state").data(data));
        }
        while rx.changed().await.is_ok() {
            let data = serde_json::to_string(&*rx.borrow_and_update())
                .unwrap_or_else(|_| "{}".to_string());
            yield Ok(Event::default().event("state").data(data));
        }
    };

    Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
}

async fn activity_stream(
    State(app): State<AppState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let mut rx = app.activity.subscribe();
    let stream = async_stream::stream! {
        loop {
            match rx.recv().await {
                Ok(ev) => {
                    let data = serde_json::to_string(&ev).unwrap_or_else(|_| "{}".to_string());
                    yield Ok(Event::default().event("tick").data(data));
                }
                // Slow consumer dropped some events; keep streaming the rest.
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    };

    Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
}

#[derive(Deserialize)]
struct IndexReq {
    index: u8,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UserReq {
    hs: u8,
    #[serde(default)]
    profile: bool,
    #[serde(default)]
    index: Option<u8>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FollowReq {
    from: usize,
    target: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TagReq {
    from: usize,
    target: String,
    label: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BatchReq {
    from: usize,
    #[serde(default)]
    posts: u32,
    #[serde(default)]
    tags: u32,
}

async fn create_homeserver(
    State(app): State<AppState>,
    Json(req): Json<IndexReq>,
) -> Json<control::Response> {
    Json(send_cmd(
        &app.ctrl_tx,
        control::Action::Create,
        None,
        Some(req.index),
        false,
        None,
        None,
        None,
        0,
        0,
    )
    .await)
}

async fn seed_homeserver(
    State(app): State<AppState>,
    Json(req): Json<IndexReq>,
) -> Json<control::Response> {
    Json(send_cmd(
        &app.ctrl_tx,
        control::Action::Seed,
        None,
        Some(req.index),
        false,
        None,
        None,
        None,
        0,
        0,
    )
    .await)
}

async fn stop_homeserver(
    State(app): State<AppState>,
    Json(req): Json<IndexReq>,
) -> Json<control::Response> {
    Json(send_cmd(
        &app.ctrl_tx,
        control::Action::Stop,
        None,
        Some(req.index),
        false,
        None,
        None,
        None,
        0,
        0,
    )
    .await)
}

async fn user_storage(
    State(app): State<AppState>,
    Path(seed): Path<u8>,
) -> Json<Vec<storage::UserStorageStats>> {
    let (database_url, configured_quota_mb, users) = {
        let state = app.state.borrow();
        let Some(hs) = state.homeservers.iter().find(|hs| hs.seed == seed) else {
            return Json(Vec::new());
        };
        (
            hs.database_url.clone(),
            hs.storage_quota_mb.unwrap_or(0),
            hs.users.clone(),
        )
    };
    Json(
        storage::fetch_users_storage(&database_url, configured_quota_mb, &users).await,
    )
}

async fn create_user(
    State(app): State<AppState>,
    Json(req): Json<UserReq>,
) -> Json<control::Response> {
    Json(
        send_cmd(
            &app.ctrl_tx,
            control::Action::User,
            Some(req.hs),
            req.index,
            req.profile,
            None,
            None,
            None,
            0,
            0,
        )
        .await,
    )
}

async fn create_follow(
    State(app): State<AppState>,
    Json(req): Json<FollowReq>,
) -> Json<control::Response> {
    Json(
        send_cmd(
            &app.ctrl_tx,
            control::Action::Follow,
            None,
            None,
            false,
            Some(req.from),
            Some(req.target),
            None,
            0,
            0,
        )
        .await,
    )
}

async fn create_tag(
    State(app): State<AppState>,
    Json(req): Json<TagReq>,
) -> Json<control::Response> {
    Json(
        send_cmd(
            &app.ctrl_tx,
            control::Action::Tag,
            None,
            None,
            false,
            Some(req.from),
            Some(req.target),
            Some(req.label),
            0,
            0,
        )
        .await,
    )
}

async fn create_batch(
    State(app): State<AppState>,
    Json(req): Json<BatchReq>,
) -> Json<control::Response> {
    Json(
        send_cmd(
            &app.ctrl_tx,
            control::Action::Batch,
            None,
            None,
            false,
            Some(req.from),
            None,
            None,
            req.posts,
            req.tags,
        )
        .await,
    )
}

/// Dispatch a command on the runtime's control channel and await its reply.
async fn send_cmd(
    tx: &mpsc::Sender<control::Cmd>,
    action: control::Action,
    hs: Option<u8>,
    index: Option<u8>,
    profile: bool,
    from: Option<usize>,
    target: Option<String>,
    label: Option<String>,
    batch_posts: u32,
    batch_tags: u32,
) -> control::Response {
    let (reply_tx, reply_rx) = oneshot::channel();
    let cmd = control::Cmd {
        action,
        index,
        hs,
        profile,
        from,
        target,
        label,
        batch_posts,
        batch_tags,
        reply: reply_tx,
    };

    if tx.send(cmd).await.is_err() {
        return control::Response::from(control::Reply::Err("antfarm shutting down".into()));
    }

    match reply_rx.await {
        Ok(reply) => control::Response::from(reply),
        Err(_) => control::Response::from(control::Reply::Err("command handler dropped".into())),
    }
}
