//! Checks GitHub for a newer release, and opens its download page.
//!
//! Notify-only: inkd never downloads or runs an update itself, so there is nothing here to
//! trust beyond a version number and a link. The check never fails loudly: no internet, a
//! GitHub hiccup or rate limiting all just mean "no update found this time".

use std::time::Duration;

use serde::Serialize;

const LATEST_RELEASE: &str = "https://api.github.com/repos/z3zZ/inkd/releases/latest";
/// The only place the app will open in a browser.
const RELEASES_PAGE: &str = "https://github.com/z3zZ/inkd/releases/";
/// Set to anything to turn the check off.
pub const DISABLE_ENV: &str = "INKD_NO_UPDATE_CHECK";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Update {
    /// "0.2.0", without the leading v.
    pub version: String,
    /// The release page, where the installer is.
    pub url: String,
}

/// "v1.2.10" -> [1, 2, 10]. Anything after a hyphen or plus (1.2.0-beta) is ignored, and
/// trailing zeros are dropped so 1.0 equals 1.0.0.
pub fn parse_version(version: &str) -> Vec<u64> {
    let core = version.trim().trim_start_matches(['v', 'V']);
    let core = core.split(['-', '+']).next().unwrap_or("");
    let mut numbers: Vec<u64> = Vec::new();
    for part in core.split('.') {
        match part.parse() {
            Ok(n) => numbers.push(n),
            Err(_) => return Vec::new(),
        }
    }
    while numbers.len() > 1 && numbers.last() == Some(&0) {
        numbers.pop();
    }
    numbers
}

pub fn is_newer(latest: &str, current: &str) -> bool {
    let latest = parse_version(latest);
    !latest.is_empty() && latest > parse_version(current)
}

/// Whether a link is a page of inkd's own releases, and plain enough to hand to the system.
pub fn is_release_url(url: &str) -> bool {
    url.strip_prefix(RELEASES_PAGE)
        .is_some_and(|rest| rest.len() <= 100 && rest.chars().all(|c| c.is_ascii_alphanumeric() || "-._/".contains(c)))
}

/// Picks the update out of GitHub's "latest release" JSON, if it is newer than `current`.
pub fn newer_release(json: &str, current: &str) -> Option<Update> {
    let release: serde_json::Value = serde_json::from_str(json).ok()?;
    let tag = release["tag_name"].as_str()?;
    if !is_newer(tag, current) {
        return None;
    }
    // A link that is not the releases page is not shown at all, rather than trusted.
    let url = release["html_url"].as_str().filter(|u| is_release_url(u))?;
    Some(Update { version: tag.trim_start_matches(['v', 'V']).to_string(), url: url.to_string() })
}

/// The newer release, if there is one. Blocks for a few seconds at most.
pub fn check(current: &str) -> Option<Update> {
    if std::env::var_os(DISABLE_ENV).is_some() {
        return None;
    }
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(5))
        .timeout(Duration::from_secs(8))
        .build();
    let body = agent
        .get(LATEST_RELEASE)
        .set("User-Agent", "inkd")
        .set("Accept", "application/vnd.github+json")
        .call()
        .ok()?
        .into_string()
        .ok()?;
    newer_release(&body, current)
}

/// Opens a release page in the default browser. Refuses anything else.
pub fn open(url: &str) -> Result<(), String> {
    if !is_release_url(url) {
        return Err("not an inkd release page".into());
    }
    #[cfg(windows)]
    {
        std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", url])
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        Err("opening links is only supported on Windows".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_compare_by_number() {
        assert_eq!(parse_version("v1.2.10"), vec![1, 2, 10]);
        assert_eq!(parse_version("1.0.0"), vec![1]);
        assert_eq!(parse_version("0.2.0-beta+7"), vec![0, 2]);
        assert!(parse_version("nightly").is_empty());
        assert!(is_newer("v0.1.10", "0.1.9"));
        assert!(is_newer("0.2", "0.1.9"));
        assert!(!is_newer("v0.1.0", "0.1.0"));
        assert!(!is_newer("0.1", "0.1.0"));
        assert!(!is_newer("v0.0.9", "0.1.0"));
        assert!(!is_newer("garbage", "0.1.0"));
    }

    #[test]
    fn only_release_pages_are_links() {
        assert!(is_release_url("https://github.com/z3zZ/inkd/releases/tag/v0.2.0"));
        assert!(is_release_url("https://github.com/z3zZ/inkd/releases/latest"));
        assert!(!is_release_url("https://github.com/someone/else/releases/tag/v9"));
        assert!(!is_release_url("https://github.com/z3zZ/inkd/releases/tag/v1 & calc"));
        assert!(!is_release_url("https://github.com/z3zZ/inkd/releases/?x=\"y\""));
        assert!(!is_release_url("file:///C:/Windows/System32/calc.exe"));
    }

    #[test]
    fn reads_the_latest_release() {
        let json = r#"{"tag_name":"v0.2.0","html_url":"https://github.com/z3zZ/inkd/releases/tag/v0.2.0"}"#;
        assert_eq!(
            newer_release(json, "0.1.0"),
            Some(Update { version: "0.2.0".into(), url: "https://github.com/z3zZ/inkd/releases/tag/v0.2.0".into() })
        );
        assert_eq!(newer_release(json, "0.2.0"), None);
        // GitHub's "not found" answer, an odd link, and something that is not JSON.
        assert_eq!(newer_release(r#"{"message":"Not Found"}"#, "0.1.0"), None);
        assert_eq!(newer_release(r#"{"tag_name":"v9","html_url":"https://example.com/"}"#, "0.1.0"), None);
        assert_eq!(newer_release("<html>", "0.1.0"), None);
    }
}
