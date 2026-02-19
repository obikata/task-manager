use actix_web::{web, App, HttpServer, HttpResponse, Result};
use actix_cors::Cors;
use serde::{Deserialize, Serialize};
use sqlx::{sqlite::{SqliteConnectOptions, SqlitePoolOptions}, SqlitePool};
use std::path::Path;

const XAI_API_URL: &str = "https://api.x.ai/v1/chat/completions";
const XAI_MODEL: &str = "grok-3-mini";

const VALID_STATUSES: [&str; 4] = ["todo", "in_progress", "done", "blocked"];

#[derive(Serialize, Deserialize, Clone, Debug)]
struct Task {
    #[serde(default)]
    id: i64,
    title: String,
    description: String,
    tags: Vec<String>,
    deadline: Option<String>,
    project: String,
    assignee: String,
    #[serde(default = "default_status")]
    status: String,
    #[serde(default)]
    in_sprint: bool,
    #[serde(default)]
    notes: Option<String>,
}

fn default_status() -> String {
    "todo".to_string()
}

struct AppState {
    pool: SqlitePool,
}

async fn init_db(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS assignees (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            tags TEXT NOT NULL,
            deadline TEXT,
            project TEXT NOT NULL,
            assignee TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'todo',
            in_sprint INTEGER NOT NULL DEFAULT 0,
            notes TEXT DEFAULT ''
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query("INSERT OR IGNORE INTO projects (id, name) VALUES (1, 'General')")
        .execute(pool)
        .await?;
    sqlx::query("INSERT OR IGNORE INTO assignees (id, name) VALUES (1, 'Unassigned')")
        .execute(pool)
        .await?;
    sqlx::query("INSERT OR IGNORE INTO projects (name) SELECT DISTINCT trim(project) FROM tasks WHERE trim(project) != ''")
        .execute(pool)
        .await?;
    sqlx::query("INSERT OR IGNORE INTO assignees (name) SELECT DISTINCT trim(assignee) FROM tasks WHERE trim(assignee) != ''")
        .execute(pool)
        .await?;

    sqlx::query("PRAGMA journal_mode=WAL")
        .execute(pool)
        .await?;

    sqlx::query("PRAGMA busy_timeout=5000")
        .execute(pool)
        .await?;

    let _ = sqlx::query("ALTER TABLE tasks ADD COLUMN notes TEXT DEFAULT ''")
        .execute(pool)
        .await;

    Ok(())
}

#[derive(Serialize, Deserialize, Clone, Debug, sqlx::FromRow)]
struct Project {
    id: i64,
    name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, sqlx::FromRow)]
struct Assignee {
    id: i64,
    name: String,
}

async fn get_projects(data: web::Data<AppState>) -> Result<HttpResponse> {
    let projects = sqlx::query_as::<_, Project>("SELECT id, name FROM projects ORDER BY name")
        .fetch_all(&data.pool)
        .await
        .map_err(actix_web::error::ErrorInternalServerError)?;
    Ok(HttpResponse::Ok().json(projects))
}

#[derive(Deserialize)]
struct CreateProjectRequest {
    name: String,
}

async fn create_project(
    data: web::Data<AppState>,
    body: web::Json<CreateProjectRequest>,
) -> Result<HttpResponse> {
    let name = body.name.trim();
    if name.is_empty() {
        return Ok(HttpResponse::BadRequest().json(serde_json::json!({ "error": "name must not be empty" })));
    }
    let id = sqlx::query_scalar::<_, i64>("INSERT INTO projects (name) VALUES (?) RETURNING id")
        .bind(name)
        .fetch_one(&data.pool)
        .await
        .map_err(|e| {
            if let sqlx::Error::Database(db) = &e {
                if db.message().contains("UNIQUE") {
                    return actix_web::error::ErrorBadRequest("project already exists");
                }
            }
            actix_web::error::ErrorInternalServerError(e)
        })?;
    let project = Project {
        id,
        name: name.to_string(),
    };
    Ok(HttpResponse::Created().json(project))
}

async fn delete_project(
    data: web::Data<AppState>,
    path: web::Path<i64>,
) -> Result<HttpResponse> {
    let id = path.into_inner();
    if id == 1 {
        return Ok(HttpResponse::BadRequest().json(serde_json::json!({ "error": "cannot delete default project 'General'" })));
    }
    let result = sqlx::query("DELETE FROM projects WHERE id=?")
        .bind(id)
        .execute(&data.pool)
        .await
        .map_err(actix_web::error::ErrorInternalServerError)?;
    if result.rows_affected() == 0 {
        return Ok(HttpResponse::NotFound().json(serde_json::json!({ "error": "project not found" })));
    }
    Ok(HttpResponse::NoContent().finish())
}

async fn get_assignees(data: web::Data<AppState>) -> Result<HttpResponse> {
    let assignees = sqlx::query_as::<_, Assignee>("SELECT id, name FROM assignees ORDER BY name")
        .fetch_all(&data.pool)
        .await
        .map_err(actix_web::error::ErrorInternalServerError)?;
    Ok(HttpResponse::Ok().json(assignees))
}

#[derive(Deserialize)]
struct CreateAssigneeRequest {
    name: String,
}

async fn create_assignee(
    data: web::Data<AppState>,
    body: web::Json<CreateAssigneeRequest>,
) -> Result<HttpResponse> {
    let name = body.name.trim();
    if name.is_empty() {
        return Ok(HttpResponse::BadRequest().json(serde_json::json!({ "error": "name must not be empty" })));
    }
    let id = sqlx::query_scalar::<_, i64>("INSERT INTO assignees (name) VALUES (?) RETURNING id")
        .bind(name)
        .fetch_one(&data.pool)
        .await
        .map_err(|e| {
            if let sqlx::Error::Database(db) = &e {
                if db.message().contains("UNIQUE") {
                    return actix_web::error::ErrorBadRequest("assignee already exists");
                }
            }
            actix_web::error::ErrorInternalServerError(e)
        })?;
    let assignee = Assignee {
        id,
        name: name.to_string(),
    };
    Ok(HttpResponse::Created().json(assignee))
}

async fn delete_assignee(
    data: web::Data<AppState>,
    path: web::Path<i64>,
) -> Result<HttpResponse> {
    let id = path.into_inner();
    if id == 1 {
        return Ok(HttpResponse::BadRequest().json(serde_json::json!({ "error": "cannot delete default assignee 'Unassigned'" })));
    }
    let result = sqlx::query("DELETE FROM assignees WHERE id=?")
        .bind(id)
        .execute(&data.pool)
        .await
        .map_err(actix_web::error::ErrorInternalServerError)?;
    if result.rows_affected() == 0 {
        return Ok(HttpResponse::NotFound().json(serde_json::json!({ "error": "assignee not found" })));
    }
    Ok(HttpResponse::NoContent().finish())
}

fn validate_task(task: &Task) -> Option<&'static str> {
    if task.title.trim().is_empty() {
        return Some("title must not be empty");
    }
    if task.title.len() > 500 {
        return Some("title must be at most 500 characters");
    }
    if task.description.len() > 10000 {
        return Some("description must be at most 10000 characters");
    }
    if task.tags.len() > 50 {
        return Some("tags must be at most 50 items");
    }
    for tag in &task.tags {
        if tag.len() > 100 {
            return Some("each tag must be at most 100 characters");
        }
    }
    if !VALID_STATUSES.contains(&task.status.as_str()) {
        return Some("status must be one of: todo, in_progress, done, blocked");
    }
    if task.project.trim().is_empty() {
        return Some("project must not be empty");
    }
    if task.assignee.trim().is_empty() {
        return Some("assignee must not be empty");
    }
    if let Some(ref notes) = task.notes {
        if notes.len() > 2000 {
            return Some("notes must be at most 2000 characters");
        }
    }
    None
}

async fn project_exists(pool: &SqlitePool, name: &str) -> Result<bool, sqlx::Error> {
    let row: Option<(i64,)> = sqlx::query_as("SELECT 1 FROM projects WHERE name = ?")
        .bind(name)
        .fetch_optional(pool)
        .await?;
    Ok(row.is_some())
}

async fn assignee_exists(pool: &SqlitePool, name: &str) -> Result<bool, sqlx::Error> {
    let row: Option<(i64,)> = sqlx::query_as("SELECT 1 FROM assignees WHERE name = ?")
        .bind(name)
        .fetch_optional(pool)
        .await?;
    Ok(row.is_some())
}

async fn get_tasks(data: web::Data<AppState>) -> Result<HttpResponse> {
    let rows = sqlx::query_as::<_, TaskRow>(
        "SELECT id, title, description, tags, deadline, project, assignee, status, in_sprint, notes FROM tasks ORDER BY id",
    )
    .fetch_all(&data.pool)
    .await
    .map_err(actix_web::error::ErrorInternalServerError)?;

    let tasks: Vec<Task> = rows
        .into_iter()
        .map(|r| r.into_task())
        .collect::<Result<Vec<_>, _>>()
        .map_err(actix_web::error::ErrorInternalServerError)?;

    Ok(HttpResponse::Ok().json(tasks))
}

#[derive(sqlx::FromRow)]
struct TaskRow {
    id: i64,
    title: String,
    description: String,
    tags: String,
    deadline: Option<String>,
    project: String,
    assignee: String,
    status: String,
    in_sprint: i32,
    notes: Option<String>,
}

impl TaskRow {
    fn into_task(self) -> Result<Task, serde_json::Error> {
        let tags: Vec<String> = if self.tags.is_empty() {
            Vec::new()
        } else {
            serde_json::from_str(&self.tags)?
        };
        Ok(Task {
            id: self.id,
            title: self.title,
            description: self.description,
            tags,
            deadline: self.deadline,
            project: self.project,
            assignee: self.assignee,
            status: self.status,
            in_sprint: self.in_sprint != 0,
            notes: self.notes.filter(|s| !s.is_empty()),
        })
    }
}

async fn create_task(
    data: web::Data<AppState>,
    task: web::Json<Task>,
) -> Result<HttpResponse> {
    let mut task_inner = task.into_inner();
    task_inner.id = 0;
    if task_inner.status.is_empty() || !VALID_STATUSES.contains(&task_inner.status.as_str()) {
        task_inner.status = "todo".to_string();
    }
    task_inner.in_sprint = false;
    if let Some(msg) = validate_task(&task_inner) {
        return Ok(HttpResponse::BadRequest().json(serde_json::json!({ "error": msg })));
    }
    if !project_exists(&data.pool, &task_inner.project)
        .await
        .map_err(actix_web::error::ErrorInternalServerError)?
    {
        return Ok(HttpResponse::BadRequest().json(serde_json::json!({ "error": "project does not exist" })));
    }
    if !assignee_exists(&data.pool, &task_inner.assignee)
        .await
        .map_err(actix_web::error::ErrorInternalServerError)?
    {
        return Ok(HttpResponse::BadRequest().json(serde_json::json!({ "error": "assignee does not exist" })));
    }

    let tags_json = serde_json::to_string(&task_inner.tags)
        .map_err(actix_web::error::ErrorInternalServerError)?;

    let notes = task_inner.notes.as_deref().unwrap_or("").trim();
    let notes_opt = if notes.is_empty() { None } else { Some(notes.to_string()) };

    let id = sqlx::query_scalar::<_, i64>(
        r#"
        INSERT INTO tasks (title, description, tags, deadline, project, assignee, status, in_sprint, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
        RETURNING id
        "#,
    )
    .bind(&task_inner.title)
    .bind(&task_inner.description)
    .bind(&tags_json)
    .bind(&task_inner.deadline)
    .bind(&task_inner.project)
    .bind(&task_inner.assignee)
    .bind(&task_inner.status)
    .bind(notes_opt.as_deref().unwrap_or(""))
    .fetch_one(&data.pool)
    .await
    .map_err(actix_web::error::ErrorInternalServerError)?;

    let new_task = Task {
        id,
        ..task_inner
    };
    Ok(HttpResponse::Created().json(new_task))
}

async fn update_task(
    data: web::Data<AppState>,
    path: web::Path<i64>,
    task: web::Json<Task>,
) -> Result<HttpResponse> {
    let id = path.into_inner();
    if let Some(msg) = validate_task(&task) {
        return Ok(HttpResponse::BadRequest().json(serde_json::json!({ "error": msg })));
    }
    if !project_exists(&data.pool, &task.project)
        .await
        .map_err(actix_web::error::ErrorInternalServerError)?
    {
        return Ok(HttpResponse::BadRequest().json(serde_json::json!({ "error": "project does not exist" })));
    }
    if !assignee_exists(&data.pool, &task.assignee)
        .await
        .map_err(actix_web::error::ErrorInternalServerError)?
    {
        return Ok(HttpResponse::BadRequest().json(serde_json::json!({ "error": "assignee does not exist" })));
    }

    let tags_json = serde_json::to_string(&task.tags)
        .map_err(actix_web::error::ErrorInternalServerError)?;

    let notes = task.notes.as_deref().unwrap_or("").trim();
    let notes_val = if notes.is_empty() { "" } else { notes };

    let result = sqlx::query(
        r#"
        UPDATE tasks SET title=?, description=?, tags=?, deadline=?, project=?, assignee=?, status=?, in_sprint=?, notes=?
        WHERE id=?
        "#,
    )
    .bind(&task.title)
    .bind(&task.description)
    .bind(&tags_json)
    .bind(&task.deadline)
    .bind(&task.project)
    .bind(&task.assignee)
    .bind(&task.status)
    .bind(if task.in_sprint { 1 } else { 0 })
    .bind(notes_val)
    .bind(id)
    .execute(&data.pool)
    .await
    .map_err(actix_web::error::ErrorInternalServerError)?;

    if result.rows_affected() == 0 {
        return Ok(HttpResponse::NotFound().json(serde_json::json!({ "error": "task not found" })));
    }

    let updated = Task {
        id,
        ..task.into_inner()
    };
    Ok(HttpResponse::Ok().json(updated))
}

#[derive(Deserialize)]
struct UpdateSprintRequest {
    in_sprint: bool,
}

async fn update_task_sprint(
    data: web::Data<AppState>,
    path: web::Path<i64>,
    body: web::Json<UpdateSprintRequest>,
) -> Result<HttpResponse> {
    let id = path.into_inner();
    let result = sqlx::query("UPDATE tasks SET in_sprint=? WHERE id=?")
        .bind(if body.in_sprint { 1 } else { 0 })
        .bind(id)
        .execute(&data.pool)
        .await
        .map_err(actix_web::error::ErrorInternalServerError)?;

    if result.rows_affected() == 0 {
        return Ok(HttpResponse::NotFound().json(serde_json::json!({ "error": "task not found" })));
    }

    let row = sqlx::query_as::<_, TaskRow>("SELECT id, title, description, tags, deadline, project, assignee, status, in_sprint, notes FROM tasks WHERE id=?")
        .bind(id)
        .fetch_one(&data.pool)
        .await
        .map_err(actix_web::error::ErrorInternalServerError)?;

    let task = row.into_task().map_err(actix_web::error::ErrorInternalServerError)?;
    Ok(HttpResponse::Ok().json(task))
}

#[derive(Deserialize)]
struct UpdateStatusRequest {
    status: String,
}

async fn update_task_status(
    data: web::Data<AppState>,
    path: web::Path<i64>,
    body: web::Json<UpdateStatusRequest>,
) -> Result<HttpResponse> {
    let id = path.into_inner();
    if !VALID_STATUSES.contains(&body.status.as_str()) {
        return Ok(HttpResponse::BadRequest().json(serde_json::json!({ "error": "invalid status" })));
    }

    let result = sqlx::query("UPDATE tasks SET status=? WHERE id=?")
        .bind(&body.status)
        .bind(id)
        .execute(&data.pool)
        .await
        .map_err(actix_web::error::ErrorInternalServerError)?;

    if result.rows_affected() == 0 {
        return Ok(HttpResponse::NotFound().json(serde_json::json!({ "error": "task not found" })));
    }

    let row = sqlx::query_as::<_, TaskRow>("SELECT id, title, description, tags, deadline, project, assignee, status, in_sprint, notes FROM tasks WHERE id=?")
        .bind(id)
        .fetch_one(&data.pool)
        .await
        .map_err(actix_web::error::ErrorInternalServerError)?;

    let task = row.into_task().map_err(actix_web::error::ErrorInternalServerError)?;
    Ok(HttpResponse::Ok().json(task))
}

async fn delete_task(
    data: web::Data<AppState>,
    path: web::Path<i64>,
) -> Result<HttpResponse> {
    let id = path.into_inner();
    let result = sqlx::query("DELETE FROM tasks WHERE id=?")
        .bind(id)
        .execute(&data.pool)
        .await
        .map_err(actix_web::error::ErrorInternalServerError)?;

    if result.rows_affected() == 0 {
        return Ok(HttpResponse::NotFound().json(serde_json::json!({ "error": "task not found" })));
    }
    Ok(HttpResponse::NoContent().finish())
}

#[derive(Deserialize)]
struct GenerateTasksRequest {
    meeting_notes: String,
}

#[derive(Serialize)]
struct XaiMessage {
    role: String,
    content: String,
}

#[derive(Serialize)]
struct XaiChatRequest {
    model: &'static str,
    messages: Vec<XaiMessage>,
}

#[derive(Deserialize)]
struct XaiChoice {
    message: XaiChoiceMessage,
}

#[derive(Deserialize)]
struct XaiChoiceMessage {
    content: Option<String>,
}

#[derive(Deserialize)]
struct XaiChatResponse {
    choices: Option<Vec<XaiChoice>>,
    error: Option<XaiError>,
}

#[derive(Deserialize)]
struct XaiError {
    message: String,
}

fn extract_json_from_response(text: &str) -> Option<&str> {
    let text = text.trim();
    if let Some(start) = text.find("```json") {
        let content_start = text[start..].find('\n').map(|i| start + i + 1).unwrap_or(start + 7);
        if let Some(end) = text[content_start..].find("```") {
            return Some(text[content_start..content_start + end].trim());
        }
    }
    if let Some(start) = text.find("```") {
        let content_start = text[start..].find('\n').map(|i| start + i + 1).unwrap_or(start + 3);
        if let Some(end) = text[content_start..].find("```") {
            return Some(text[content_start..content_start + end].trim());
        }
    }
    if text.starts_with('[') {
        return Some(text);
    }
    None
}

async fn generate_tasks_from_ai(
    data: web::Data<AppState>,
    body: web::Json<GenerateTasksRequest>,
) -> Result<HttpResponse> {
    let api_key = std::env::var("XAI_API_KEY").unwrap_or_default();
    if api_key.is_empty() {
        return Ok(HttpResponse::ServiceUnavailable().json(serde_json::json!({
            "error": "XAI_API_KEY is not configured. Please set the environment variable."
        })));
    }

    let notes = body.meeting_notes.trim();
    if notes.is_empty() {
        return Ok(HttpResponse::BadRequest().json(serde_json::json!({
            "error": "meeting_notes must not be empty"
        })));
    }

    let system_prompt = r#"You are a task extraction assistant. Given meeting notes or any text, extract actionable tasks.

Return ONLY a valid JSON array of task objects. Each task must have:
- "title": string (required, concise task title)
- "description": string (required, detailed description)
- "tags": array of strings (e.g. ["meeting", "urgent"])
- "deadline": string or null (YYYY-MM-DD format if date is mentioned, otherwise null)
- "project": string (default "General")
- "assignee": string (default "Unassigned" if not specified)
- "status": string (one of "todo", "in_progress", "done", "blocked"; default "todo")

Example output:
[{"title":"Review PR #123","description":"Code review for authentication module","tags":["review","urgent"],"deadline":"2025-02-25","project":"Backend","assignee":"Unassigned","status":"todo"}]"#;

    let user_prompt = format!("Extract tasks from these meeting notes:\n\n{}", notes);

    let client = reqwest::Client::new();
    let xai_req = XaiChatRequest {
        model: XAI_MODEL,
        messages: vec![
            XaiMessage {
                role: "system".to_string(),
                content: system_prompt.to_string(),
            },
            XaiMessage {
                role: "user".to_string(),
                content: user_prompt,
            },
        ],
    };

    let resp = client
        .post(XAI_API_URL)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&xai_req)
        .send()
        .await
        .map_err(|e| {
            actix_web::error::ErrorInternalServerError(format!("xAI API request failed: {}", e))
        })?;

    let status = resp.status();
    let body_text = resp.text().await.map_err(actix_web::error::ErrorInternalServerError)?;

    let xai_resp: XaiChatResponse = serde_json::from_str(&body_text).unwrap_or(XaiChatResponse {
        choices: None,
        error: Some(XaiError {
            message: body_text.clone(),
        }),
    });

    if !status.is_success() {
        let err_msg = xai_resp
            .error
            .map(|e| e.message)
            .unwrap_or_else(|| format!("xAI API error: {} - {}", status, body_text));
        return Ok(HttpResponse::BadGateway().json(serde_json::json!({
            "error": err_msg
        })));
    }

    let content = xai_resp
        .choices
        .and_then(|c| c.into_iter().next())
        .and_then(|c| c.message.content)
        .ok_or_else(|| {
            actix_web::error::ErrorInternalServerError("No content in xAI response")
        })?;

    let json_str = extract_json_from_response(&content).unwrap_or(content.as_str());
    let generated: Vec<serde_json::Value> = serde_json::from_str(json_str).map_err(|e| {
        actix_web::error::ErrorInternalServerError(format!(
            "Failed to parse AI response as JSON: {}. Raw: {}",
            e, json_str
        ))
    })?;

    let mut created = Vec::new();
    for item in generated {
        let title = item
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("Untitled")
            .to_string();
        let description = item
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let tags: Vec<String> = item
            .get("tags")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_else(|| vec!["ai-generated".to_string()]);
        let deadline = item
            .get("deadline")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(String::from);
        let project_raw = item
            .get("project")
            .and_then(|v| v.as_str())
            .unwrap_or("General")
            .to_string();
        let assignee_raw = item
            .get("assignee")
            .and_then(|v| v.as_str())
            .unwrap_or("Unassigned")
            .to_string();
        let project = if project_exists(&data.pool, &project_raw).await.unwrap_or(false) {
            project_raw.clone()
        } else {
            "General".to_string()
        };
        let assignee = if assignee_exists(&data.pool, &assignee_raw).await.unwrap_or(false) {
            assignee_raw.clone()
        } else {
            "Unassigned".to_string()
        };
        let status = item
            .get("status")
            .and_then(|v| v.as_str())
            .filter(|s| VALID_STATUSES.contains(s))
            .unwrap_or("todo")
            .to_string();

        let task = Task {
            id: 0,
            title: title.clone(),
            description: description.clone(),
            tags: tags.clone(),
            deadline: deadline.clone(),
            project: project.clone(),
            assignee: assignee.clone(),
            status: status.clone(),
            in_sprint: false,
            notes: None,
        };

        if validate_task(&task).is_none() {
            let tags_json = serde_json::to_string(&tags)
                .map_err(actix_web::error::ErrorInternalServerError)?;
            let id = sqlx::query_scalar::<_, i64>(
                r#"
                INSERT INTO tasks (title, description, tags, deadline, project, assignee, status, in_sprint, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
                RETURNING id
                "#,
            )
            .bind(&title)
            .bind(&description)
            .bind(&tags_json)
            .bind(&deadline)
            .bind(&project)
            .bind(&assignee)
            .bind(&status)
            .bind("")
            .fetch_one(&data.pool)
            .await
            .map_err(actix_web::error::ErrorInternalServerError)?;

            created.push(Task {
                id,
                title,
                description,
                tags,
                deadline,
                project,
                assignee,
                status,
                in_sprint: false,
                notes: None,
            });
        }
    }

    Ok(HttpResponse::Created().json(created))
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let pool = match std::env::var("DATABASE_URL") {
        Ok(url) => SqlitePoolOptions::new()
            .max_connections(5)
            .connect(&url)
            .await
            .unwrap_or_else(|e| panic!("Failed to connect to database: {}", e)),
        Err(_) => {
            let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
            let data_dir = manifest_dir.join("data");
            std::fs::create_dir_all(&data_dir)
                .unwrap_or_else(|e| panic!("Failed to create data directory: {}", e));
            let db_file = data_dir.join("tasks.db");
            let connect_opts = SqliteConnectOptions::new()
                .filename(&db_file)
                .create_if_missing(true);
            SqlitePoolOptions::new()
                .max_connections(5)
                .connect_with(connect_opts)
                .await
                .unwrap_or_else(|e| panic!("Failed to connect to database: {}", e))
        }
    };

    init_db(&pool).await.expect("Failed to initialize database");

    let app_state = web::Data::new(AppState { pool });

    HttpServer::new(move || {
        let cors = Cors::default()
            .allowed_origin("http://localhost:3000")
            .allowed_origin("http://127.0.0.1:3000")
            .allowed_origin_fn(|origin, _req_head| {
                origin.as_bytes().starts_with(b"http://localhost")
                    || origin.as_bytes().starts_with(b"http://127.0.0.1")
                    || origin.as_bytes().starts_with(b"http://172.")
                    || origin.as_bytes().starts_with(b"https://172.")
                    || origin.as_bytes().starts_with(b"http://192.168.")
                    || origin.as_bytes().starts_with(b"https://192.168.")
            })
            .allowed_methods(vec!["GET", "POST", "PUT", "DELETE", "OPTIONS"])
            .allowed_headers(vec![actix_web::http::header::CONTENT_TYPE]);
        App::new()
            .wrap(cors)
            .app_data(app_state.clone())
            .route("/projects", web::get().to(get_projects))
            .route("/projects", web::post().to(create_project))
            .route("/projects/{id}", web::delete().to(delete_project))
            .route("/assignees", web::get().to(get_assignees))
            .route("/assignees", web::post().to(create_assignee))
            .route("/assignees/{id}", web::delete().to(delete_assignee))
            .route("/tasks", web::get().to(get_tasks))
            .route("/tasks", web::post().to(create_task))
            .route("/tasks/generate", web::post().to(generate_tasks_from_ai))
            .route("/tasks/{id}", web::put().to(update_task))
            .route("/tasks/{id}/status", web::put().to(update_task_status))
            .route("/tasks/{id}/sprint", web::put().to(update_task_sprint))
            .route("/tasks/{id}", web::delete().to(delete_task))
    })
    .bind("0.0.0.0:8080")?
    .run()
    .await
}
