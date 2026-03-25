use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, oneshot};

use super::{Action, Cmd, Reply, Request, Response};

pub async fn listen(addr: String, tx: mpsc::Sender<Cmd>) {
    let listener = match TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("  control socket failed to bind {addr}: {e}");
            return;
        }
    };

    println!("  control socket listening on {addr}");

    loop {
        let (stream, _addr) = match listener.accept().await {
            Ok(conn) => conn,
            Err(e) => {
                eprintln!("  control socket accept error: {e}");
                continue;
            }
        };

        let tx = tx.clone();
        tokio::spawn(async move {
            let (reader, mut writer) = stream.into_split();
            let mut reader = BufReader::new(reader);
            let mut line = String::new();

            if let Err(e) = reader.read_line(&mut line).await {
                eprintln!("  control read error: {e}");
                return;
            }

            let req: Request = match serde_json::from_str(line.trim()) {
                Ok(r) => r,
                Err(e) => {
                    let resp = Response::from(Reply::Err(format!("invalid request: {e}")));
                    let _ = writer
                        .write_all(serde_json::to_string(&resp).unwrap().as_bytes())
                        .await;
                    let _ = writer.write_all(b"\n").await;
                    return;
                }
            };

            let action = match req.action.as_str() {
                "create" => Action::Create,
                "seed" => Action::Seed,
                "stop" => Action::Stop,
                "user" => Action::User,
                other => {
                    let resp = Response::from(Reply::Err(format!(
                        "unknown action: {other} (expected \"create\", \"seed\", \"stop\", or \"user\")"
                    )));
                    let _ = writer
                        .write_all(serde_json::to_string(&resp).unwrap().as_bytes())
                        .await;
                    let _ = writer.write_all(b"\n").await;
                    return;
                }
            };

            let (reply_tx, reply_rx) = oneshot::channel();
            let cmd = Cmd {
                action,
                index: req.index,
                hs: req.hs,
                profile: req.profile.unwrap_or(false),
                reply: reply_tx,
            };

            if tx.send(cmd).await.is_err() {
                let resp = Response::from(Reply::Err("antfarm shutting down".into()));
                let _ = writer
                    .write_all(serde_json::to_string(&resp).unwrap().as_bytes())
                    .await;
                let _ = writer.write_all(b"\n").await;
                return;
            }

            let reply = match reply_rx.await {
                Ok(r) => r,
                Err(_) => Reply::Err("command handler dropped".into()),
            };

            let resp = Response::from(reply);
            let _ = writer
                .write_all(serde_json::to_string(&resp).unwrap().as_bytes())
                .await;
            let _ = writer.write_all(b"\n").await;
        });
    }
}
