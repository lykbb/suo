#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod browser;
mod local_files;
mod external_links;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::{atomic::{AtomicBool, AtomicU64, Ordering}, mpsc, Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{menu::{Menu, MenuItem, MenuItemKind}, DragDropEvent, Emitter, Manager, State, WindowEvent};
#[cfg(unix)]
use std::os::unix::{fs::OpenOptionsExt, process::CommandExt};

type Reply = Result<Value, String>;

// Host output and lifecycle notes go to <data>/logs/bridge.log (rotated at 1 MB), so a problem in
// the packaged App can still be looked up after the fact.
struct Log { path: PathBuf, lock: Mutex<()> }
impl Log {
    fn new(data: &Path) -> Self {
        let folder = data.join("logs");
        let _ = fs::create_dir_all(&folder);
        Self { path: folder.join("bridge.log"), lock: Mutex::new(()) }
    }
    fn write(&self, line: &str) {
        eprintln!("Suo bridge: {line}");
        let _guard = self.lock.lock().unwrap();
        if fs::metadata(&self.path).map(|info| info.len() > 1024 * 1024).unwrap_or(false) {
            let _ = fs::rename(&self.path, self.path.with_extension("log.1"));
        }
        let mut options = OpenOptions::new();
        options.create(true).append(true);
        #[cfg(unix)]
        options.mode(0o600);
        if let Ok(mut file) = options.open(&self.path) { let _ = writeln!(file, "{} {line}", now()); }
    }
}
fn now() -> String {
    let seconds = SystemTime::now().duration_since(UNIX_EPOCH).map(|time| time.as_secs()).unwrap_or(0) as libc::time_t;
    let mut tm: libc::tm = unsafe { std::mem::zeroed() };
    unsafe { libc::localtime_r(&seconds, &mut tm) };
    format!("{:04}-{:02}-{:02} {:02}:{:02}:{:02}", tm.tm_year + 1900, tm.tm_mon + 1, tm.tm_mday, tm.tm_hour, tm.tm_min, tm.tm_sec)
}

// Copying large files in or emptying a big recycle bin can take longer than a click should wait.
fn timeout(method: &str) -> Duration {
    if matches!(method, "native.import" | "workspace.purge") { Duration::from_secs(600) } else { Duration::from_secs(30) }
}

// Where the Node host runs from; kept so a host that stops unexpectedly can be started again.
struct Launch { node: PathBuf, host: PathBuf, cwd: PathBuf, data: PathBuf, engine: PathBuf, skills: PathBuf }

struct Bridge {
    imports: PathBuf,
    launch: Launch,
    log: Arc<Log>,
    stdin: Mutex<Option<ChildStdin>>,
    child: Mutex<Option<Child>>,
    pending: Mutex<HashMap<String, mpsc::Sender<Reply>>>,
    sequence: AtomicU64,
    closing: AtomicBool,
    quit_requested: Mutex<Option<Instant>>,
}

impl Bridge {
    fn start(app: tauri::AppHandle) -> Result<Arc<Self>, String> {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent().ok_or("无法定位桌面源码。")?.to_path_buf();
        let resources = app.path().resource_dir().map_err(|e| e.to_string())?;
        let packaged = resources.join("runtime/node").is_file();
        let node = if packaged { resources.join("runtime/node") } else {
            PathBuf::from(std::env::var("SUO_DESKTOP_NODE")
                .unwrap_or_else(|_| "node".into()))
        };
        let host = if packaged { resources.join("bridge/host.mjs") } else { root.join("bridge/host.mjs") };
        let data = if packaged { app.path().app_data_dir().map_err(|e| e.to_string())? } else { root.join("data") };
        let engine = if packaged { resources.join("runtime/suo") } else { root.parent().ok_or("无法定位引擎。")?.to_path_buf() };
        let skills = if packaged { resources.join("skills") } else { engine.join("skills") };
        let cwd = if packaged { resources } else { root };
        let bridge = Arc::new(Self {
            imports: data.join("imports"), log: Arc::new(Log::new(&data)),
            launch: Launch { node, host, cwd, data, engine, skills },
            stdin: Mutex::new(None), child: Mutex::new(None),
            pending: Mutex::new(HashMap::new()), sequence: AtomicU64::new(0), closing: AtomicBool::new(false), quit_requested: Mutex::new(None),
        });
        let stdout = bridge.spawn()?;
        bridge.log.write("后台服务已启动");
        let supervisor = bridge.clone();
        thread::spawn(move || supervisor.supervise(app, stdout));
        Ok(bridge)
    }

    // Starts the Node host; its input and process replace the previous ones, its output is returned.
    fn spawn(&self) -> Result<ChildStdout, String> {
        let launch = &self.launch;
        let mut command = Command::new(&launch.node);
        command.arg(&launch.host).current_dir(&launch.cwd)
            .env("SUO_DESKTOP_DATA", &launch.data).env("SUO_DESKTOP_ENGINE", &launch.engine).env("SUO_DESKTOP_SKILLS", &launch.skills)
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        #[cfg(unix)]
        command.process_group(0);
        let mut child = command.spawn().map_err(|e| format!("本地桥接启动失败：{e}"))?;
        let stdin = child.stdin.take().ok_or("无法连接桥接输入。")?;
        let stdout = child.stdout.take().ok_or("无法连接桥接输出。")?;
        let stderr = child.stderr.take().ok_or("无法连接桥接诊断。")?;
        let log = self.log.clone();
        thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) { log.write(&line); }
        });
        *self.stdin.lock().unwrap() = Some(stdin);
        *self.child.lock().unwrap() = Some(child);
        Ok(stdout)
    }

    // Relays replies and events. When the host stops without being asked to, it is started again
    // after 1, 2, 4… seconds, at most 5 times in 10 minutes, and the interface is told to save again.
    fn supervise(self: Arc<Self>, app: tauri::AppHandle, mut stdout: ChildStdout) {
        let mut restarts: Vec<Instant> = Vec::new();
        loop {
            self.relay(&app, stdout);
            for (_, sender) in self.pending.lock().unwrap().drain() {
                let _ = sender.send(Err("后台服务中断，请重试。".into()));
            }
            if self.closing.load(Ordering::SeqCst) { return; }
            let exit = self.reap();
            self.log.write(&format!("后台服务意外退出（{exit}）"));
            let _ = app.emit("bridge-event", json!({"event":"bridge-error","data":{"message":"后台服务中断，正在自动恢复…","restarting":true}}));
            loop {
                restarts.retain(|at| at.elapsed() < Duration::from_secs(600));
                if restarts.len() >= 5 {
                    self.log.write("10 分钟内已自动恢复 5 次，不再重试");
                    let _ = app.emit("bridge-event", json!({"event":"bridge-error","data":{"message":"后台服务反复中断，请重新打开 Suo。"}}));
                    return;
                }
                thread::sleep(Duration::from_secs(1 << restarts.len()));
                if self.closing.load(Ordering::SeqCst) { return; }
                restarts.push(Instant::now());
                match self.spawn() {
                    Ok(next) => { stdout = next; break; },
                    Err(error) => self.log.write(&format!("自动恢复失败：{error}")),
                }
            }
            self.log.write("后台服务已自动恢复");
            let _ = app.emit("bridge-event", json!({"event":"bridge-restarted","data":{}}));
        }
    }

    fn relay(&self, app: &tauri::AppHandle, stdout: ChildStdout) {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) | Err(_) => return,
                Ok(_) => {},
            }
            if line.len() > 32 * 1024 * 1024 {
                let _ = app.emit("bridge-event", json!({"event":"bridge-error","data":{"message":"桥接消息过大。"}}));
                continue;
            }
            match serde_json::from_str::<Value>(&line) {
                Ok(record) => {
                    if let Some(id) = record.get("id").and_then(Value::as_str) {
                        if let Some(sender) = self.pending.lock().unwrap().remove(id) {
                            let reply = match record.get("error").and_then(Value::as_str) {
                                Some(error) => Err(error.to_string()),
                                None => Ok(record.get("result").cloned().unwrap_or(Value::Null)),
                            };
                            let _ = sender.send(reply);
                        }
                    } else if record.get("event").is_some() {
                        let _ = app.emit("bridge-event", record);
                    }
                },
                Err(_) => { let _ = app.emit("bridge-event", json!({"event":"bridge-error","data":{"message":"桥接返回了无效消息。"}})); },
            }
        }
    }

    // Collects the stopped host's exit status (ending it first if it only closed its output).
    fn reap(&self) -> String {
        self.stdin.lock().unwrap().take();
        let Some(mut child) = self.child.lock().unwrap().take() else { return "未知".into() };
        if child.try_wait().ok().flatten().is_none() {
            #[cfg(unix)]
            unsafe { libc::kill(-(child.id() as i32), libc::SIGKILL); }
            #[cfg(not(unix))]
            let _ = child.kill();
        }
        child.wait().map(|status| status.to_string()).unwrap_or_else(|error| error.to_string())
    }

    fn request(&self, method: &str, payload: Value) -> Reply {
        let id = format!("native-{}", self.sequence.fetch_add(1, Ordering::Relaxed));
        let (sender, receiver) = mpsc::channel();
        self.pending.lock().unwrap().insert(id.clone(), sender);
        let text = format!("{}\n", json!({"id":id,"method":method,"payload":payload}));
        let write = self.stdin.lock().unwrap().as_mut()
            .ok_or_else(|| "后台服务正在恢复，请稍后重试。".to_string())
            .and_then(|input| input.write_all(text.as_bytes()).map_err(|e| e.to_string()));
        if let Err(error) = write {
            self.pending.lock().unwrap().remove(&id);
            return Err(error);
        }
        let result = receiver.recv_timeout(timeout(method))
            .map_err(|_| "桌面操作超时，请稍后重试。".to_string());
        self.pending.lock().unwrap().remove(&id);
        result?
    }

    fn shutdown(&self) {
        self.closing.store(true, Ordering::SeqCst);
        self.stdin.lock().unwrap().take();
        if let Some(mut child) = self.child.lock().unwrap().take() {
            let deadline = Instant::now() + Duration::from_secs(5);
            while Instant::now() < deadline {
                if child.try_wait().ok().flatten().is_some() { self.log.write("后台服务已关闭"); return; }
                thread::sleep(Duration::from_millis(50));
            }
            #[cfg(unix)]
            unsafe { libc::kill(-(child.id() as i32), libc::SIGKILL); }
            #[cfg(not(unix))]
            let _ = child.kill();
            let _ = child.wait();
            self.log.write("后台服务关闭超时，已强制结束");
        }
    }
}

// 退出 Suo (⌘Q) asks the interface to save and close, like the window's close button; asking again
// within 10 seconds quits at once, so a stuck interface can never keep the App open.
fn request_quit(app: &tauri::AppHandle) {
    let bridge = app.state::<Arc<Bridge>>();
    let mut last = bridge.quit_requested.lock().unwrap();
    if last.is_some_and(|at| at.elapsed() < Duration::from_secs(10)) {
        drop(last);
        bridge.log.write("再次要求退出，未等待保存");
        bridge.shutdown();
        app.exit(0);
        return;
    }
    *last = Some(Instant::now());
    let _ = app.emit("native-close", ());
}

// The standard menu, except that its last item, the system quit (which cannot be intercepted),
// becomes 退出 Suo above.
fn menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::default(app)?;
    #[cfg(target_os = "macos")]
    if let Some(MenuItemKind::Submenu(app_menu)) = menu.items()?.into_iter().next() {
        let count = app_menu.items()?.len();
        if count > 0 { app_menu.remove_at(count - 1)?; }
        app_menu.append(&MenuItem::with_id(app, "quit", "退出 Suo", true, Some("CmdOrCtrl+Q"))?)?;
    }
    Ok(menu)
}

#[tauri::command]
async fn open_external(url: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || external_links::open(&url))
        .await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn bridge_request(method: String, payload: Value, state: State<'_, Arc<Bridge>>) -> Reply {
    // Explicit model requests only; no generic shell or arbitrary path reading.
    if !["workspace.list", "workspace.create", "workspace.load", "workspace.save", "workspace.trash", "workspace.remove", "workspace.restore", "workspace.purge", "asset.get",
        "models.list", "models.configure", "models.check", "models.discover", "prompt.send", "prompt.abort", "ui.reply", "skills.list", "skills.get", "skills.parse", "skills.save", "templates.list", "templates.get", "templates.save"].contains(&method.as_str()) {
        return Err("这个操作未向界面开放。".into());
    }
    let bridge = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || bridge.request(&method, payload))
        .await.map_err(|e| e.to_string())?
}

// Web search and page reading through the system web engine in a hidden window (see browser.rs).
#[tauri::command]
async fn browser_search(app: tauri::AppHandle, query: String, engine: Option<String>) -> Reply {
    tauri::async_runtime::spawn_blocking(move || browser::search(&app, &query, engine.as_deref().unwrap_or("bing")))
        .await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn browser_read(app: tauri::AppHandle, url: String) -> Reply {
    tauri::async_runtime::spawn_blocking(move || browser::read(&app, &url)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn choose_files(state: State<'_, Arc<Bridge>>) -> Reply {
    let bridge = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let paths = rfd::FileDialog::new().set_title("添加资料到 Suo").pick_files();
        match paths {
            Some(paths) => bridge.request("native.import", json!({"paths":paths})),
            None => Ok(json!([])),
        }
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn choose_model_config(state: State<'_, Arc<Bridge>>) -> Reply {
    let bridge = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let path = rfd::FileDialog::new().set_title("导入模型配置").add_filter("模型配置", &["json"]).pick_file();
        match path {
            Some(path) => bridge.request("native.model-config", json!({"path":path})),
            None => Ok(Value::Null),
        }
    }).await.map_err(|e| e.to_string())?
}

// Writes an exported document only where the user chooses in the save dialog.
#[tauri::command]
async fn save_text(name: String, text: String) -> Result<bool, String> {
    if text.len() > 8 * 1024 * 1024 { return Err("文档太大，无法导出。".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = rfd::FileDialog::new().set_title("导出文档").set_file_name(&name).add_filter("Markdown", &["md"]).save_file() else { return Ok(false) };
        std::fs::write(&path, text).map(|_| true).map_err(|e| format!("导出失败：{e}"))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn finish_close(app: tauri::AppHandle, state: State<'_, Arc<Bridge>>) -> Result<(), String> {
    let bridge = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || bridge.shutdown()).await.map_err(|e| e.to_string())?;
    app.exit(0);
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol("suo-file", |context, request, responder| {
            let root = context.app_handle().state::<Arc<Bridge>>().imports.clone();
            thread::spawn(move || responder.respond(local_files::serve(&root, request)));
        })
        .setup(|app| {
            let bridge = Bridge::start(app.handle().clone()).map_err(std::io::Error::other)?;
            app.manage(bridge);
            app.set_menu(menu(app.handle())?)?;
            app.on_menu_event(|app, event| if event.id() == "quit" { request_quit(app); });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![bridge_request, open_external, browser_search, browser_read, choose_files, choose_model_config, save_text, finish_close])
        .on_window_event(|window, event| match event {
            WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) => {
                let paths = paths.clone();
                let app = window.app_handle().clone();
                let _ = app.emit("native-import-start", ());
                let bridge = app.state::<Arc<Bridge>>().inner().clone();
                thread::spawn(move || match bridge.request("native.import", json!({"paths":paths})) {
                    Ok(files) => { let _ = app.emit("native-files", files); },
                    Err(message) => { let _ = app.emit("bridge-event", json!({"event":"bridge-error","data":{"message":message}})); },
                });
            },
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let app = window.app_handle().clone();
                let _ = app.emit("native-close", ());
            },
            _ => {},
        })
        .run(tauri::generate_context!())
        .expect("Suo 桌面窗口启动失败");
}
