use actix_web::{web, App, HttpServer, HttpResponse, Result};
use actix_cors::Cors;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

const XAI_API_URL: &str = "https://api.x.ai/v1/chat/completions";
const XAI_MODEL: &str = "grok-3-mini";

const VALID_STATUSES: [&str; 4] = ["todo", "in_progress", "done", "blocked"];

#[derive(Serialize, Deserialize, Clone, Debug)]
struct Task {
    #[serde(default)]
    id: u64,
    title: String,
    description: String,
    tags: Vec<String>,
    deadline: Option<String>,
    project: String,
    assignee: String,
    #[serde(default = "default_status")]
    status: String,
}

fn default_status() -> String {
    "todo".to_string()
}

struct AppState {
    tasks: Mutex<Vec<Task>>,
    next_id: Mutex<u64>,
}

async fn get_tasks(data: web::Data<AppState>) -> Result<HttpResponse> {
    let tasks = data.tasks.lock().unwrap();
    println!("Getting tasks: {:?}", *tasks);
    Ok(HttpResponse::Ok().json(&*tasks))
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
    None
}

async fn create_task(
    data: web::Data<AppState>,
    task: web::Json<Task>,
) -> Result<HttpResponse> {
    let mut task_inner = task.into_inner();
    if task_inner.status.is_empty() || !VALID_STATUSES.contains(&task_inner.status.as_str()) {
        task_inner.status = "todo".to_string();
    }
    if let Some(msg) = validate_task(&task_inner) {
        return Ok(HttpResponse::BadRequest().json(serde_json::json!({ "error": msg })));
    }
    let mut tasks = data.tasks.lock().unwrap();
    let mut next_id = data.next_id.lock().unwrap();
    let new_task = Task {
        id: *next_id,
        ..task_inner
    };
    *next_id += 1;
    println!("Creating task: {:?}", new_task);
    tasks.push(new_task.clone());
    Ok(HttpResponse::Created().json(new_task))
}

async fn update_task(
    data: web::Data<AppState>,
    path: web::Path<u64>,
    task: web::Json<Task>,
) -> Result<HttpResponse> {
    let id = path.into_inner();
    if let Some(msg) = validate_task(&task) {
        return Ok(HttpResponse::BadRequest().json(serde_json::json!({ "error": msg })));
    }
    let mut tasks = data.tasks.lock().unwrap();
    if let Some(t) = tasks.iter_mut().find(|t| t.id == id) {
        t.title = task.title.clone();
        t.description = task.description.clone();
        t.tags = task.tags.clone();
        t.deadline = task.deadline.clone();
        t.project = task.project.clone();
        t.assignee = task.assignee.clone();
        t.status = task.status.clone();
        Ok(HttpResponse::Ok().json(t.clone()))
    } else {
        Ok(HttpResponse::NotFound().json(serde_json::json!({ "error": "task not found" })))
    }
}

#[derive(Deserialize)]
struct UpdateStatusRequest {
    status: String,
}

async fn update_task_status(
    data: web::Data<AppState>,
    path: web::Path<u64>,
    body: web::Json<UpdateStatusRequest>,
) -> Result<HttpResponse> {
    let id = path.into_inner();
    if !VALID_STATUSES.contains(&body.status.as_str()) {
        return Ok(HttpResponse::BadRequest().json(serde_json::json!({ "error": "invalid status" })));
    }
    let mut tasks = data.tasks.lock().unwrap();
    if let Some(t) = tasks.iter_mut().find(|t| t.id == id) {
        t.status = body.status.clone();
        Ok(HttpResponse::Ok().json(t.clone()))
    } else {
        Ok(HttpResponse::NotFound().json(serde_json::json!({ "error": "task not found" })))
    }
}

async fn delete_task(
    data: web::Data<AppState>,
    path: web::Path<u64>,
) -> Result<HttpResponse> {
    let id = path.into_inner();
    let mut tasks = data.tasks.lock().unwrap();
    if let Some(pos) = tasks.iter().position(|t| t.id == id) {
        tasks.remove(pos);
        Ok(HttpResponse::NoContent().finish())
    } else {
        Ok(HttpResponse::NotFound().json(serde_json::json!({ "error": "task not found" })))
    }
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
    let mut tasks = data.tasks.lock().unwrap();
    let mut next_id = data.next_id.lock().unwrap();

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
        let project = item
            .get("project")
            .and_then(|v| v.as_str())
            .unwrap_or("General")
            .to_string();
        let assignee = item
            .get("assignee")
            .and_then(|v| v.as_str())
            .unwrap_or("Unassigned")
            .to_string();
        let status = item
            .get("status")
            .and_then(|v| v.as_str())
            .filter(|s| VALID_STATUSES.contains(s))
            .unwrap_or("todo")
            .to_string();

        let task = Task {
            id: *next_id,
            title: title.clone(),
            description: description.clone(),
            tags: tags.clone(),
            deadline: deadline.clone(),
            project: project.clone(),
            assignee: assignee.clone(),
            status: status.clone(),
        };

        if validate_task(&task).is_none() {
            *next_id += 1;
            tasks.push(task.clone());
            created.push(task);
        }
    }

    Ok(HttpResponse::Created().json(created))
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let app_state = web::Data::new(AppState {
        tasks: Mutex::new(Vec::new()),
        next_id: Mutex::new(1),
    });

    HttpServer::new(move || {
        let cors = Cors::default()
            .allowed_origin("http://localhost:3000")
            .allowed_origin("http://127.0.0.1:3000")
            .allowed_methods(vec!["GET", "POST", "PUT", "DELETE", "OPTIONS"])
            .allowed_headers(vec![actix_web::http::header::CONTENT_TYPE]);
        App::new()
            .wrap(cors)
            .app_data(app_state.clone())
            .route("/tasks", web::get().to(get_tasks))
            .route("/tasks", web::post().to(create_task))
            .route("/tasks/generate", web::post().to(generate_tasks_from_ai))
            .route("/tasks/{id}", web::put().to(update_task))
            .route("/tasks/{id}/status", web::put().to(update_task_status))
            .route("/tasks/{id}", web::delete().to(delete_task))
    })
    .bind("0.0.0.0:8080")?
    .run()
    .await
}