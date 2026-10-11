use tauri::Url;

pub fn validated(url: &str) -> Result<Url, String> {
    if url.len() > 8192 || url.chars().any(char::is_control) {
        return Err("来源网址格式不正确。".into());
    }
    let value = Url::parse(url).map_err(|_| "来源网址格式不正确。".to_string())?;
    if !matches!(value.scheme(), "http" | "https") || value.host_str().is_none()
        || !value.username().is_empty() || value.password().is_some() {
        return Err("只支持打开不含账号密码的网页来源。".into());
    }
    Ok(value)
}

pub fn open(url: &str) -> Result<(), String> {
    let value = validated(url)?;
    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("/usr/bin/open")
            .arg(value.as_str()).status().map_err(|_| "无法打开来源网址，请复制链接后重试。".to_string())?;
        if !status.success() { return Err("无法打开来源网址，请复制链接后重试。".into()); }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = value;
        Err("当前桌面系统暂不支持打开外部来源，请复制链接。".into())
    }
}

#[cfg(test)]
mod tests {
    use super::validated;
    #[test]
    fn accepts_sources_and_rejects_commands_and_credentials() {
        for value in ["https://example.com/report?q=product#facts", "http://example.com/"] {
            assert!(validated(value).is_ok());
        }
        for value in ["file:///etc/passwd", "javascript:alert(1)", "https://user:secret@example.com", "https://example.com/\n", "--args", "https://"] {
            assert!(validated(value).is_err(), "{value}");
        }
    }
}
