use serde_json::{json, Value};
use std::{
    net::{IpAddr, ToSocketAddrs},
    sync::{atomic::{AtomicU64, Ordering}, mpsc},
    time::Duration,
};
use tauri::{
    webview::{NewWindowResponse, PageLoadEvent},
    AppHandle, Url, WebviewUrl, WebviewWindowBuilder,
};

// Searching and reading pages with the system web engine in a hidden window, so it works on every
// Mac without another browser or a search API key. The window keeps no cookies or logins, can only
// read pages, and never reaches this computer or the local network.

static SEQUENCE: AtomicU64 = AtomicU64::new(0);
const SAFARI: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

// The injected scripts hand their result back by navigating to suoresult://done/<base64url JSON>,
// which the window intercepts and cancels.
const SEND: &str = "const __send = value => { const bytes = new TextEncoder().encode(JSON.stringify(value)); let text = ''; for (const byte of bytes) text += String.fromCharCode(byte); location.href = 'suoresult://done/' + btoa(text).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, ''); };";
const SEARCH: &str = r#"(() => {
  const bing = location.hostname.endsWith('bing.com'), results = [];
  const items = document.querySelectorAll(bing ? '#b_results > li.b_algo' : '#content_left .result, #content_left .c-container');
  for (const item of items) {
    const link = item.querySelector('h2 a, h3 a');
    if (!link || !link.href) continue;
    // Baidu's paid results: a baidu.php link, a tuiguang marker or a 广告 label.
    if (!bing && (/\/baidu\.php\?/.test(link.href) || /tuiguang/i.test(item.outerHTML) || [...item.querySelectorAll('span, a')].some(label => label.innerText.trim() === '广告'))) continue;
    let url = link.href;
    try { const target = new URL(url), encoded = target.searchParams.get('u'); if (bing && target.pathname.startsWith('/ck/') && encoded && encoded.startsWith('a1')) url = atob(encoded.slice(2).replace(/-/g, '+').replace(/_/g, '/')); } catch {}
    // A known summary element first; otherwise the result's own text without its title, which
    // survives page redesigns and keeps the source and date.
    const known = item.querySelector('.b_caption p, [class*="b_lineclamp"], .c-abstract');
    const title = link.innerText.trim();
    if (!bing && /百度图片|百度视频|智能分身/.test(title)) continue;
    const raw = known && known.innerText.trim() ? known.innerText : (item.innerText || '').replace(title, '');
    results.push({ title, url, snippet: raw.replace(/\s+/g, ' ').trim().slice(0, 240) });
    if (results.length >= 10) break;
  }
  const page = (document.title + ' ' + (document.body ? document.body.innerText : '').slice(0, 3000));
  __send({ results, blocked: !results.length && /captcha|unusual traffic|verify you are|人机验证|安全验证|验证码/i.test(page) });
})();"#;
const READ: &str = r#"setTimeout(() => {
  const text = (document.body ? document.body.innerText : '').replace(/\n{3,}/g, '\n\n').trim();
  __send({ title: document.title, url: location.href, text: text.slice(0, 60000) });
}, 1500);"#;

fn private(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let octets = v4.octets();
            v4.is_loopback() || v4.is_private() || v4.is_link_local() || v4.is_unspecified() || v4.is_broadcast()
                || octets[0] == 0 || (octets[0] == 100 && (64..=127).contains(&octets[1]))
        },
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() { return private(IpAddr::V4(v4)); }
            let first = v6.segments()[0];
            v6.is_loopback() || v6.is_unspecified() || (first & 0xfe00) == 0xfc00 || (first & 0xffc0) == 0xfe80
        },
    }
}

// Public http(s) pages only, checked for the first page and every navigation in the window.
fn public(url: &Url) -> bool {
    if !matches!(url.scheme(), "http" | "https") || !url.username().is_empty() || url.password().is_some() { return false; }
    let Some(host) = url.host_str() else { return false };
    let host = host.trim_start_matches('[').trim_end_matches(']');
    if host == "localhost" || [".localhost", ".local", ".internal"].iter().any(|suffix| host.ends_with(suffix)) { return false; }
    match (host, url.port_or_known_default().unwrap_or(443)).to_socket_addrs() {
        Ok(addresses) => { let addresses: Vec<_> = addresses.collect(); !addresses.is_empty() && addresses.iter().all(|address| !private(address.ip())) },
        Err(_) => false,
    }
}

fn base64url(text: &str) -> Option<Vec<u8>> {
    let mut bits = 0u32;
    let mut count = 0;
    let mut bytes = Vec::with_capacity(text.len() * 3 / 4);
    for ch in text.bytes() {
        let value = match ch { b'A'..=b'Z' => ch - b'A', b'a'..=b'z' => ch - b'a' + 26, b'0'..=b'9' => ch - b'0' + 52, b'-' => 62, b'_' => 63, _ => return None };
        bits = (bits << 6) | value as u32;
        count += 6;
        if count >= 8 { count -= 8; bytes.push((bits >> count) as u8); }
    }
    Some(bytes)
}

fn report(url: &Url) -> Result<Value, String> {
    let bytes = base64url(url.path().trim_start_matches('/')).ok_or("网页返回的内容无法识别。")?;
    serde_json::from_slice(&bytes).map_err(|_| "网页返回的内容无法识别。".to_string())
}

// Opens `url` hidden, runs `script` when the page has loaded and returns what it reports.
fn browse(app: &AppHandle, url: Url, script: &str) -> Result<Value, String> {
    if !public(&url) { return Err("出于安全考虑，只能打开公开网页，不能打开本机或局域网地址。".into()); }
    let label = format!("suo-browse-{}", SEQUENCE.fetch_add(1, Ordering::Relaxed));
    let (sender, receiver) = mpsc::channel();
    let code = format!("{SEND}\n{script}");
    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(url))
        .title("Suo 联网").visible(false).focused(false).incognito(true).user_agent(SAFARI)
        .on_navigation(move |target| {
            if target.scheme() == "suoresult" { let _ = sender.send(report(target)); return false; }
            public(target)
        })
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .on_download(|_, _| false)
        .on_page_load(move |window, payload| { if payload.event() == PageLoadEvent::Finished { let _ = window.eval(&code); } })
        .build().map_err(|error| format!("无法打开联网窗口：{error}"))?;
    let result = receiver.recv_timeout(Duration::from_secs(15)).unwrap_or_else(|_| Err("网页在 15 秒内没有打开，请稍后重试。".into()));
    let _ = window.destroy();
    result
}

pub fn search(app: &AppHandle, query: &str, engine: &str) -> Result<Value, String> {
    let query = query.trim();
    if query.is_empty() || query.chars().count() > 200 { return Err("请提供 200 字以内的搜索词。".into()); }
    let url = if engine == "baidu" { Url::parse_with_params("https://www.baidu.com/s", &[("wd", query)]) }
        else { Url::parse_with_params("https://cn.bing.com/search", &[("q", query), ("setlang", "zh-Hans")]) };
    let found = browse(app, url.map_err(|e| e.to_string())?, SEARCH)?;
    if found.get("blocked").and_then(Value::as_bool) == Some(true) {
        return Err("搜索引擎要求人工验证，这次没能搜索。请稍后再试，或在设置里换一个搜索引擎。".into());
    }
    Ok(json!({ "engine": if engine == "baidu" { "百度" } else { "必应" }, "results": found.get("results").cloned().unwrap_or(json!([])) }))
}

pub fn read(app: &AppHandle, url: &str) -> Result<Value, String> {
    browse(app, Url::parse(url).map_err(|_| "网址格式不正确。".to_string())?, READ)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_and_private_addresses_are_refused() {
        for url in ["http://localhost:1420/", "http://127.0.0.1/", "http://[::1]/", "http://10.1.2.3/", "http://192.168.1.1/", "http://172.20.0.1/",
            "http://100.101.225.50/", "http://169.254.1.1/", "http://[::ffff:127.0.0.1]/", "http://[fd00::1]/", "file:///etc/hosts", "http://user:pass@93.184.216.34/", "http://printer.local/"] {
            assert!(!public(&Url::parse(url).unwrap()), "{url}");
        }
        assert!(public(&Url::parse("http://93.184.216.34/").unwrap()));
    }

    #[test]
    fn results_come_back_as_base64url_json() {
        let url = Url::parse("suoresult://done/eyJ0aXRsZSI6IuWlvSJ9").unwrap();
        assert_eq!(report(&url).unwrap(), json!({ "title": "好" }));
        assert!(report(&Url::parse("suoresult://done/%%%").unwrap()).is_err());
    }
}
