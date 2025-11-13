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
}

async fn get_tasks(data: web::Data<AppState>) -> Result<HttpResponse> {
    let tasks = data.tasks.lock().unwrap();
    println!("Getting tasks: {:?}", *tasks);
    Ok(HttpResponse::Ok().json(&*tasks))
}

async fn create_task(
    data: web::Data<AppState>,
    task: web::Json<Task>,
) -> Result<HttpResponse> {
    let mut tasks = data.tasks.lock().unwrap();
    let new_task = Task {
        id: tasks.len() as u64 + 1,
        ..task.into_inner()
    };
    println!("Creating task: {:?}", new_task);
    tasks.push(new_task.clone());
    Ok(HttpResponse::Created().json(new_task))
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let app_state = web::Data::new(AppState {
        tasks: Mutex::new(Vec::new()),
    });

    HttpServer::new(move || {
        App::new()
            .wrap(Cors::permissive())
            .app_data(app_state.clone())
            .route("/tasks", web::get().to(get_tasks))
            .route("/tasks", web::post().to(create_task))
    })
    .bind("0.0.0.0:8080")?
    .run()
    .await
}