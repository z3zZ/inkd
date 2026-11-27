# Changelog

What changed in each release of inkd. Newest first.

## 0.2.0 - 2026-11-27

### Added
- **Update notice.** When a newer release is on GitHub, a link appears in the toolbar and opens its download page. inkd never downloads or installs anything by itself. Set `INKD_NO_UPDATE_CHECK`, or `"noUpdateCheck": true` in `settings.json`, to turn the check off.
- **Marks beside lines that need a look.** A small `?` appears next to a line that could not be read, was read but has no answer, or was read with less than 80% confidence. Hover to see what was read and why; click to try again or correct the reading.
- **Degrees.** A degree sign is understood (`sin(30°)`), and View has a radians/degrees choice for sin, cos and tan.
- **Scrolling without a mouse wheel.** A scrollbar the pen can drag, PgUp/PgDn/Home and the arrow keys, and finger scrolling on touchscreens (ignored while the pen is in use).
- **More in the View menu:** the version, what recognition runs on, Force CPU, a switch for keeping corrections, and a button that opens the notes folder.
- `inkd.log` records problems such as the model failing to load. It never contains what you wrote.
- The window reopens at the size and place it was last left.
- MIT licence, and full third-party notices in the installed `licenses` folder.

### Fixed
- Closing the window right after writing no longer loses the last stroke.
- Two lines joined by a stray stroke separate again when that stroke is erased or undone.
- `2` beside a fraction such as x/3 is a product, not the mixed number 2 + x/3. Mixed numbers still work for whole fractions (2½).
- Ink stays sharp when the window is moved to a monitor with a different scale.
- The toolbar wraps instead of being cut off in a narrow window.
- A line the model cannot make sense of no longer holds up the others for several seconds.
- Very large and very small answers show as a power of ten (1.27 × 10³⁰) instead of `1.27e+30`.

### Changed
- The self-test and baseline tools are no longer active in installed copies.
- Updated `url` and `cookie` for security advisories.

## 0.1.0 - 2026-11-21

First release.

- Live solving of handwritten lines ending in `=`.
- Variables and functions shared down the page.
- Graphing of every curve on the page.
- Pressure ink, pen eraser end, scratch-to-erase, undo and redo.
- Notes that save themselves; copy as LaTeX or as an image.
- Answers as decimals, fractions or mixed numbers; light and dark themes; plain, grid, lined or dot paper.
- Correcting misread lines.
- Windows installer, with the handwriting model downloaded on first run.
