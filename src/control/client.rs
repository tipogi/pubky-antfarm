use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;

use super::Response;

pub async fn send(addr: &str, action: &str, index: u8) -> anyhow::Result<Response> {
    let request = serde_json::json!({ "action": action, "index": index });
    send_raw(addr, &request).await
}

pub async fn send_user(
    addr: &str,
    index: Option<u8>,
    hs: u8,
    profile: bool,
) -> anyhow::Result<Response> {
    let mut request = serde_json::json!({
        "action": "user",
        "hs": hs,
        "profile": profile,
    });
    if let Some(idx) = index {
        request["index"] = serde_json::json!(idx);
    }
    send_raw(addr, &request).await
}

async fn send_raw(addr: &str, payload: &serde_json::Value) -> anyhow::Result<Response> {
    let stream = TcpStream::connect(addr).await.map_err(|e| {
        anyhow::anyhow!("could not connect to antfarm at {addr}: {e}")
    })?;

    let (reader, mut writer) = stream.into_split();
    let mut reader = BufReader::new(reader);

    let mut request = serde_json::to_string(payload)?;
    request.push('\n');
    writer.write_all(request.as_bytes()).await?;

    let mut line = String::new();
    reader.read_line(&mut line).await?;

    let resp: Response = serde_json::from_str(line.trim())?;
    Ok(resp)
}
