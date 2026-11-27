# Security

## Reporting a problem

Please report security problems privately, through **Security → Report a vulnerability** on the [GitHub repository](https://github.com/z3zZ/inkd/security/advisories/new), rather than in a public issue. You should hear back within a week.

Only the latest release is supported with fixes.

## What inkd does with your data

- Notes, corrections and settings stay on your computer, in `%APPDATA%\app.inkd.desktop` and `%LOCALAPPDATA%\app.inkd.desktop`.
- There is no account, no telemetry and no crash reporting.
- inkd makes two kinds of network request, both over HTTPS:
  - the one-time download of the handwriting model from Hugging Face, pinned to one revision and checked against SHA-256 hashes;
  - a check for a newer release on GitHub at start-up, which sends nothing about you or your notes. Set `INKD_NO_UPDATE_CHECK` to turn it off.
- inkd never downloads or runs an update itself. The update notice only opens the release page in your browser.

## Checking a download

The installer is not code-signed yet, so Windows SmartScreen will warn about it. Each release lists a SHA-256 checksum (`SHA256SUMS.txt`); compare it with:

```powershell
Get-FileHash .\inkd_0.1.0_x64-setup.exe -Algorithm SHA256
```
