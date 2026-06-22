use std::collections::HashMap;

use serde::Serialize;
use sqlx::PgPool;

use super::UserInfo;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserStorageStats {
    pub index: usize,
    pub public_key: String,
    pub used_bytes: u64,
    /// `None` when storage is unlimited.
    pub storage_quota_mb: Option<u64>,
}

pub async fn fetch_users_storage(
    database_url: &str,
    configured_quota_mb: u64,
    users: &[UserInfo],
) -> Vec<UserStorageStats> {
    if users.is_empty() {
        return Vec::new();
    }

    let used_by_pk = match read_used_bytes(database_url, users).await {
        Ok(map) => map,
        Err(e) => {
            eprintln!("storage query failed for {database_url}: {e}");
            HashMap::new()
        }
    };

    let storage_quota_mb = configured_quota_mb_from_config(configured_quota_mb);

    users
        .iter()
        .map(|user| UserStorageStats {
            index: user.index,
            public_key: user.public_key.clone(),
            used_bytes: used_by_pk.get(&user.public_key).copied().unwrap_or(0),
            storage_quota_mb,
        })
        .collect()
}

fn configured_quota_mb_from_config(mb: u64) -> Option<u64> {
    (mb > 0).then_some(mb)
}

async fn read_used_bytes(
    database_url: &str,
    users: &[UserInfo],
) -> anyhow::Result<HashMap<String, u64>> {
    let pool = PgPool::connect(database_url).await?;
    let keys: Vec<String> = users.iter().map(|u| u.public_key.clone()).collect();
    let rows = sqlx::query_as::<_, (String, i64)>(
        "SELECT public_key, used_bytes FROM users WHERE public_key = ANY($1::text[])",
    )
    .bind(&keys)
    .fetch_all(&pool)
    .await?;

    pool.close().await;

    let map: HashMap<String, u64> = rows
        .into_iter()
        .map(|(pk, used)| (pk, used.max(0) as u64))
        .collect();

    if map.is_empty() && !keys.is_empty() {
        eprintln!(
            "storage query returned no rows for {} user(s) in {database_url}",
            keys.len()
        );
    }

    Ok(map)
}
