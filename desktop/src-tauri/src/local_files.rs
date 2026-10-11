use std::{fs::File, io::{Read, Seek, SeekFrom}, path::Path};
use tauri::http::{Request, Response};
use serde_json::Value;
const MAX_BYTES: u64 = 200 * 1024 * 1024;

fn response(status: u16) -> Response<Vec<u8>> {
    Response::builder().status(status).header("Access-Control-Allow-Origin", "*").body(Vec::new()).unwrap()
}
fn valid_id(id: &str) -> bool {
    id.len() == 36 && id.bytes().enumerate().all(|(i, ch)| {
        if [8, 13, 18, 23].contains(&i) { ch == b'-' } else { ch.is_ascii_hexdigit() }
    })
}
fn byte_range(header: Option<&str>, size: u64) -> Result<Option<(u64, u64)>, ()> {
    let Some(value) = header else { return Ok(None); };
    let (start, end) = value.strip_prefix("bytes=").ok_or(())?.split_once('-').ok_or(())?;
    if size == 0 || value.contains(',') { return Err(()); }
    if start.is_empty() {
        let suffix = end.parse::<u64>().map_err(|_| ())?;
        if suffix == 0 { return Err(()); }
        return Ok(Some((size.saturating_sub(suffix), size - 1)));
    }
    let start = start.parse::<u64>().map_err(|_| ())?;
    if start >= size { return Err(()); }
    let end = if end.is_empty() { (start.saturating_add(4 * 1024 * 1024 - 1)).min(size - 1) }
        else { end.parse::<u64>().map_err(|_| ())?.min(size - 1) };
    if end < start { return Err(()); }
    Ok(Some((start, end)))
}
pub fn serve(root: &Path, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    if request.method() == "OPTIONS" {
        return Response::builder().status(204).header("Access-Control-Allow-Origin", "*")
            .header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS").header("Access-Control-Allow-Headers", "Range").body(Vec::new()).unwrap();
    }
    if request.method() != "GET" && request.method() != "HEAD" { return response(405); }
    let id = request.uri().path().strip_prefix('/').unwrap_or("");
    if !valid_id(id) { return response(404); }
    let Ok(metadata) = std::fs::read(root.join(format!("{id}.json"))) else { return response(404); };
    let Ok(metadata) = serde_json::from_slice::<Value>(&metadata) else { return response(404); };
    let name = metadata.get("name").and_then(Value::as_str).unwrap_or("").to_lowercase();
    let mime = match name.rsplit('.').next().unwrap_or("") {
        "pdf" => "application/pdf", "png" => "image/png", "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp", "gif" => "image/gif", "avif" => "image/avif",
        "mp4" | "m4v" => "video/mp4", "mov" => "video/quicktime", "webm" => "video/webm", "ogv" => "video/ogg",
        "mp3" => "audio/mpeg", "m4a" => "audio/mp4", "wav" => "audio/wav", "aac" => "audio/aac", "flac" => "audio/flac", "ogg" => "audio/ogg",
        _ => return response(415),
    };
    let Ok(mut file) = File::open(root.join(format!("{id}.bin"))) else { return response(404); };
    let Ok(info) = file.metadata() else { return response(404); };
    let size = info.len();
    if size > MAX_BYTES { return response(413); }
    let range = match byte_range(request.headers().get("range").and_then(|value| value.to_str().ok()), size) {
        Ok(range) => range,
        Err(()) => return Response::builder().status(416).header("Content-Range", format!("bytes */{size}")).header("Access-Control-Allow-Origin", "*").body(Vec::new()).unwrap(),
    };
    let (start, length) = range.map(|(start, end)| (start, end - start + 1)).unwrap_or((0, size));
    let mut bytes = Vec::new();
    if request.method() != "HEAD" {
        if file.seek(SeekFrom::Start(start)).is_err() || file.take(length).read_to_end(&mut bytes).is_err() || bytes.len() as u64 != length { return response(500); }
    }
    let mut result = Response::builder().status(if range.is_some() { 206 } else { 200 })
        .header("Content-Type", mime).header("Content-Length", length.to_string()).header("Accept-Ranges", "bytes")
        .header("Access-Control-Allow-Origin", "*").header("Access-Control-Expose-Headers", "Accept-Ranges, Content-Length, Content-Range")
        .header("X-Content-Type-Options", "nosniff").header("Cache-Control", "private, max-age=86400");
    if let Some((start, end)) = range { result = result.header("Content-Range", format!("bytes {start}-{end}/{size}")); }
    result.body(bytes).unwrap()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn rejects_traversal_and_invalid_ids() {
        assert!(!valid_id("../agent/auth.json")); assert!(!valid_id("00000000/0000-0000-0000-000000000000"));
        assert!(valid_id("abcdef00-0000-0000-0000-000000000001"));
    }
    #[test] fn serves_closed_open_and_suffix_ranges() {
        assert_eq!(byte_range(Some("bytes=10-19"), 100), Ok(Some((10, 19))));
        assert_eq!(byte_range(Some("bytes=95-"), 100), Ok(Some((95, 99))));
        assert_eq!(byte_range(Some("bytes=-10"), 100), Ok(Some((90, 99))));
        assert_eq!(byte_range(None, 100), Ok(None));
    }
    #[test] fn rejects_unsatisfiable_or_multiple_ranges() {
        for value in ["bytes=100-", "bytes=8-3", "bytes=0-1,5-6", "bytes=-0", "bytes=bad-", "items=0-1"] { assert!(byte_range(Some(value), 100).is_err()); }
        assert!(byte_range(Some("bytes=0-1"), 0).is_err());
    }
    #[test] fn media_requests_read_exact_bytes_and_legacy_metadata() {
        let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("test-results")
            .join(format!("protocol-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir_all(&root).unwrap();
        let id = "abcdef00-0000-0000-0000-000000000001";
        std::fs::write(root.join(format!("{id}.json")), r#"{"name":"旧视频.MP4","mime":"application/octet-stream","kind":"binary"}"#).unwrap();
        std::fs::write(root.join(format!("{id}.bin")), b"0123456789").unwrap();
        let response = serve(&root, Request::builder().uri(format!("suo-file://localhost/{id}")).header("Range","bytes=3-6").body(Vec::new()).unwrap());
        assert_eq!(response.status(), 206); assert_eq!(response.body(), b"3456");
        assert_eq!(response.headers()["Content-Type"], "video/mp4"); assert_eq!(response.headers()["Content-Range"], "bytes 3-6/10");
        let head = serve(&root, Request::builder().method("HEAD").uri(format!("suo-file://localhost/{id}")).body(Vec::new()).unwrap());
        assert_eq!(head.headers()["Content-Length"], "10"); assert!(head.body().is_empty());
        let invalid = serve(&root, Request::builder().uri(format!("suo-file://localhost/{id}")).header("Range","bytes=100-").body(Vec::new()).unwrap());
        assert_eq!(invalid.status(), 416);
        let missing = serve(&root, Request::builder().uri("suo-file://localhost/../../auth.json").body(Vec::new()).unwrap());
        assert_eq!(missing.status(), 404);
        std::fs::write(root.join(format!("{id}.json")), r#"{"name":"index.html"}"#).unwrap();
        let html = serve(&root, Request::builder().uri(format!("suo-file://localhost/{id}")).body(Vec::new()).unwrap());
        assert_eq!(html.status(), 415);
    }

}
