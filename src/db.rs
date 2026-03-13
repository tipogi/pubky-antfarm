use colored::Colorize;
use sqlx::PgPool;

pub const DB_PREFIX: &str = "pubky_antfarm_";

async fn connect(pg_url: &str) -> anyhow::Result<PgPool> {
    Ok(PgPool::connect(pg_url).await?)
}

pub fn db_name(label: &str) -> String {
    format!("{DB_PREFIX}{label}")
}

pub fn connection_string(pg_url: &str, label: &str) -> String {
    let clean = pg_url.split('?').next().unwrap_or(pg_url);
    let base_url = clean.rsplitn(2, '/').last().unwrap_or(clean);
    format!("{}/{}", base_url, db_name(label))
}

async fn find_antfarm_databases(pool: &PgPool) -> Vec<String> {
    let pattern = format!("{DB_PREFIX}%");
    sqlx::query_scalar::<_, String>(
        "SELECT datname FROM pg_database WHERE datname LIKE $1 ORDER BY datname",
    )
    .bind(pattern)
    .fetch_all(pool)
    .await
    .unwrap_or_default()
}

async fn find_test_databases(pool: &PgPool) -> Vec<String> {
    sqlx::query_scalar::<_, String>(
        "SELECT datname FROM pg_database WHERE datname LIKE 'pubky_test_%' ORDER BY datname",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default()
}

async fn drop_databases(pool: &PgPool, dbs: &[String]) -> Vec<String> {
    let mut failed = Vec::new();
    for name in dbs {
        let q = format!("DROP DATABASE IF EXISTS \"{name}\"");
        match sqlx::query(&q).execute(pool).await {
            Ok(_) => println!("    {} {}", "dropped".red(), name.dimmed()),
            Err(e) => {
                println!("    {} {}: {}", "failed".red().bold(), name, e);
                failed.push(name.clone());
            }
        }
    }
    failed
}

async fn create_database(pool: &PgPool, name: &str) -> bool {
    let q = format!("CREATE DATABASE \"{name}\"");
    match sqlx::query(&q).execute(pool).await {
        Ok(_) => {
            println!("    {} {}", "created".green(), name);
            true
        }
        Err(e) => {
            if e.to_string().contains("already exists") {
                println!("    {} {}", "exists".dimmed(), name.dimmed());
                true
            } else {
                println!("    {} {}: {}", "failed".red().bold(), name, e);
                false
            }
        }
    }
}

pub async fn setup_databases(pg_url: &str, labels: &[&str]) -> anyhow::Result<()> {
    let pool = connect(pg_url).await?;
    let mut errors: Vec<String> = Vec::new();

    let mut stale: Vec<String> = find_test_databases(&pool).await;
    stale.extend(find_antfarm_databases(&pool).await);
    if !stale.is_empty() {
        println!(
            "  {} {} database(s) from previous run...",
            "Cleaning".yellow(),
            stale.len()
        );
        let failed = drop_databases(&pool, &stale).await;
        for db in failed {
            errors.push(format!("failed to drop database: {db}"));
        }
    }

    let expected: Vec<String> = labels.iter().map(|label| db_name(label)).collect();
    println!(
        "  {} {} antfarm database(s)...",
        "Creating".yellow(),
        expected.len()
    );
    for label in labels {
        let name = db_name(label);
        if !create_database(&pool, &name).await {
            errors.push(format!("failed to create antfarm database: {name}"));
        }
    }

    let actual = find_antfarm_databases(&pool).await;
    for name in &expected {
        if !actual.iter().any(|n| n == name) {
            errors.push(format!(
                "expected antfarm database missing after initialization: {name}"
            ));
        }
    }

    pool.close().await;
    if errors.is_empty() {
        Ok(())
    } else {
        Err(anyhow::anyhow!(
            "database initialization failed:\n- {}",
            errors.join("\n- ")
        ))
    }
}

pub async fn list_databases(pg_url: &str) -> anyhow::Result<()> {
    let pool = connect(pg_url).await?;
    let antfarm_dbs = find_antfarm_databases(&pool).await;
    let test_dbs = find_test_databases(&pool).await;
    let total = test_dbs.len() + antfarm_dbs.len();

    println!(
        "\n{} ({})",
        "  Databases".cyan().bold(),
        total.to_string().white().bold()
    );
    for name in &test_dbs {
        println!("    {} {} {}", "●".green(), name, "(hs1)".dimmed());
    }
    for name in &antfarm_dbs {
        println!("    {} {}", "●".green(), name);
    }

    pool.close().await;
    Ok(())
}
