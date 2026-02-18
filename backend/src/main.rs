use actix_web::{web, App, HttpServer, HttpResponse, Result};
use actix_cors::Cors;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

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
    None
}

async fn create_task(
    data: web::Data<AppState>,
    task: web::Json<Task>,
) -> Result<HttpResponse> {
    if let Some(msg) = validate_task(&task) {
        return Ok(HttpResponse::BadRequest().json(serde_json::json!({ "error": msg })));
    }
    let mut tasks = data.tasks.lock().unwrap();
    let mut next_id = data.next_id.lock().unwrap();
    let new_task = Task {
        id: *next_id,
        ..task.into_inner()
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
            .route("/tasks/{id}", web::put().to(update_task))
            .route("/tasks/{id}", web::delete().to(delete_task))
    })
    .bind("0.0.0.0:8080")?
    .run()
    .await
}