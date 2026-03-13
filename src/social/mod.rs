mod common;
mod file;
mod follow;
mod identity;
mod post;
mod profile;
mod tag;

use colored::Colorize;
use futures_util::StreamExt;
use pubky_testnet::pubky::{Pubky, PublicKey};

pub use identity::UserKeys;
pub(crate) use follow::create as create_follow;
pub(crate) use post::create as create_post;
pub(crate) use post::random_content;
pub(crate) use profile::signup_and_write;
pub(crate) use tag::create as create_tag;
pub(crate) use tag::random_label as random_tag_label;

// TODO: Might be deleted
pub async fn read_events(sdk: &Pubky, label: &str, user_pk: &PublicKey, hs_pk: &PublicKey) {
    let tag = format!("[{label}]").magenta().bold();
    let hs_z32 = hs_pk.z32();

    let stream = match sdk
        .event_stream()
        .add_user(user_pk, None)
        .map(|b| b.limit(50))
    {
        Ok(builder) => match builder.subscribe().await {
            Ok(s) => s,
            Err(e) => {
                println!("  {tag} {} {e}", "error subscribing:".red());
                return;
            }
        },
        Err(e) => {
            println!("  {tag} {} {e}", "error building stream:".red());
            return;
        }
    };

    let events: Vec<_> = stream.filter_map(|r| async { r.ok() }).collect().await;

    if events.is_empty() {
        println!(
            "  {tag} {} {}",
            "no events".dimmed(),
            format!("(hs: {})", hs_z32).dimmed()
        );
    } else {
        println!(
            "  {tag} {} event(s) {}:",
            events.len().to_string().white().bold(),
            format!("(hs: {})", hs_z32).dimmed()
        );
        let user_z32 = user_pk.z32();
        for event in &events {
            let full_uri = format!("pubky://{}{}", user_z32, event.resource.path.as_str());
            println!(
                "    {} {} {}",
                event.event_type.to_string().yellow(),
                full_uri.dimmed(),
                format!("(cursor: {})", event.cursor).dimmed()
            );
        }
    }
}
