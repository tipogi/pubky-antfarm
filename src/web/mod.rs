pub mod server;
pub mod storage;

use std::collections::HashMap;

use serde::Serialize;

use crate::config::{AntfarmConfig, SimulatorConfig};
use crate::homeservers::Homeserver;
use crate::simulator::Registry;

/// DHT bootstrap node address (StaticTestnet default).
pub const BOOTSTRAP_ADDR: &str = "localhost:6881";
/// Pkarr relay URL (StaticTestnet default).
pub const PKARR_RELAY_URL: &str = "http://localhost:15411";

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum HomeserverStatus {
    /// In the simulator rotation (receiving activity).
    Active,
    /// Created but paused (still reachable, no simulator activity).
    Dormant,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserInfo {
    pub index: usize,
    pub name: String,
    pub public_key: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeserverInfo {
    pub label: String,
    pub seed: u8,
    pub public_key: String,
    pub http_url: String,
    pub status: HomeserverStatus,
    pub user_count: usize,
    pub users: Vec<UserInfo>,
    /// Per-user storage quota in MB. Omitted when unlimited (`0`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub storage_quota_mb: Option<u64>,
    /// When `true`, no one may reference this homeserver's users (isolated island).
    pub island: bool,
    #[serde(skip_serializing)]
    pub admin_url: String,
    #[serde(skip_serializing)]
    pub database_url: String,
}

impl HomeserverInfo {
    pub fn from_homeserver(
        hs: &Homeserver,
        status: HomeserverStatus,
        users: Vec<UserInfo>,
    ) -> Self {
        Self {
            label: hs.label.clone(),
            seed: hs.seed,
            public_key: hs.public_key.z32(),
            http_url: hs.http_url.clone(),
            status,
            user_count: users.len(),
            users,
            storage_quota_mb: (hs.storage_quota_mb > 0).then_some(hs.storage_quota_mb),
            island: hs.island,
            admin_url: hs.admin_url.clone(),
            database_url: hs.database_url.clone(),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkInfo {
    pub bootstrap: String,
    pub pkarr_relay: String,
}

impl Default for NetworkInfo {
    fn default() -> Self {
        Self {
            bootstrap: BOOTSTRAP_ADDR.to_string(),
            pkarr_relay: PKARR_RELAY_URL.to_string(),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimulatorInfo {
    pub interval_secs: u64,
    pub max_users_per_homeserver: u32,
    pub users_per_tick: [u32; 2],
    pub posts_per_tick: [u32; 2],
    pub tags_per_tick: [u32; 2],
    pub follows_per_tick: [u32; 2],
}

impl From<&SimulatorConfig> for SimulatorInfo {
    fn from(s: &SimulatorConfig) -> Self {
        Self {
            interval_secs: s.interval_secs,
            max_users_per_homeserver: s.max_users_per_homeserver,
            users_per_tick: s.users_per_tick,
            posts_per_tick: s.posts_per_tick,
            tags_per_tick: s.tags_per_tick,
            follows_per_tick: s.follows_per_tick,
        }
    }
}

/// Cumulative simulator counts since the antfarm started.
#[derive(Clone, Copy, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ActivityTotals {
    pub ticks: u64,
    pub users: u64,
    pub posts: u64,
    pub tags: u64,
    pub follows: u64,
}

/// A single simulator tick's deltas, streamed live over SSE.
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TickEvent {
    pub tick: u64,
    pub users: u32,
    pub posts: u32,
    pub tags: u32,
    pub follows: u32,
}

/// A directed, weighted edge between two homeservers, aggregated from the
/// follow relationships of the users living on each side.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EdgeInfo {
    pub from: String,
    pub to: String,
    pub follows: u32,
}

/// A single user-to-user follow, by user index. Used by the graph view to draw
/// person-to-person edges between clusters.
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FollowEdge {
    pub from: usize,
    pub to: usize,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardState {
    pub network: NetworkInfo,
    pub simulator: SimulatorInfo,
    pub activity: ActivityTotals,
    pub homeservers: Vec<HomeserverInfo>,
    pub edges: Vec<EdgeInfo>,
    pub follows: Vec<FollowEdge>,
}

impl DashboardState {
    /// Build a snapshot from the runtime's active + dormant homeservers,
    /// ordered by seed so the dashboard renders them consistently.
    pub fn build(
        active: &[Homeserver],
        dormant: &HashMap<u8, Homeserver>,
        config: &AntfarmConfig,
        registry: Option<&Registry>,
        activity: ActivityTotals,
    ) -> Self {
        let mut users_by_hs: HashMap<String, Vec<UserInfo>> = HashMap::new();
        if let Some(reg) = registry {
            for (index, pk) in reg.user_keys.all() {
                if let Some(label) = reg.assignments.get(&index) {
                    users_by_hs.entry(label.clone()).or_default().push(UserInfo {
                        index,
                        name: crate::social::user_name(index),
                        public_key: pk.z32(),
                    });
                }
            }
            for users in users_by_hs.values_mut() {
                users.sort_by_key(|u| u.index);
            }
        }

        let take = |label: &str| users_by_hs.get(label).cloned().unwrap_or_default();

        let mut homeservers: Vec<HomeserverInfo> = active
            .iter()
            .map(|hs| HomeserverInfo::from_homeserver(hs, HomeserverStatus::Active, take(&hs.label)))
            .chain(dormant.values().map(|hs| {
                HomeserverInfo::from_homeserver(hs, HomeserverStatus::Dormant, take(&hs.label))
            }))
            .collect();
        homeservers.sort_by(|a, b| a.seed.cmp(&b.seed));

        let edges = Self::build_edges(registry);
        let follows = Self::build_user_follows(registry);

        Self {
            network: NetworkInfo::default(),
            simulator: SimulatorInfo::from(&config.simulator),
            activity,
            homeservers,
            edges,
            follows,
        }
    }

    /// Deduplicated user-to-user follows that cross homeserver boundaries.
    /// Intra-homeserver follows are dropped to keep the graph's cluster spokes
    /// (membership) visually distinct from cross-cluster relationships.
    fn build_user_follows(registry: Option<&Registry>) -> Vec<FollowEdge> {
        let Some(reg) = registry else {
            return Vec::new();
        };

        let mut seen: std::collections::HashSet<(usize, usize)> = std::collections::HashSet::new();
        let mut follows = Vec::new();
        for &(from, to) in &reg.follows {
            let (Some(from_hs), Some(to_hs)) =
                (reg.assignments.get(&from), reg.assignments.get(&to))
            else {
                continue;
            };
            if from_hs == to_hs {
                continue;
            }
            if seen.insert((from, to)) {
                follows.push(FollowEdge { from, to });
            }
        }
        follows
    }

    /// Aggregate user-level follows into directed homeserver→homeserver edges.
    /// Only cross-homeserver follows are kept (self-loops are dropped), and the
    /// result is sorted for stable rendering on the client.
    fn build_edges(registry: Option<&Registry>) -> Vec<EdgeInfo> {
        let Some(reg) = registry else {
            return Vec::new();
        };

        let mut counts: HashMap<(String, String), u32> = HashMap::new();
        for &(follower, followee) in &reg.follows {
            let (Some(from), Some(to)) = (
                reg.assignments.get(&follower),
                reg.assignments.get(&followee),
            ) else {
                continue;
            };
            if from == to {
                continue;
            }
            *counts.entry((from.clone(), to.clone())).or_insert(0) += 1;
        }

        let mut edges: Vec<EdgeInfo> = counts
            .into_iter()
            .map(|((from, to), follows)| EdgeInfo { from, to, follows })
            .collect();
        edges.sort_by(|a, b| a.from.cmp(&b.from).then(a.to.cmp(&b.to)));
        edges
    }
}
