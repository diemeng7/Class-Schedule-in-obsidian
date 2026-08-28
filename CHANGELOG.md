# Changelog

## 0.1.1 (2026-08-29)

- Fix review issues: description without the word "Obsidian"
- Use Obsidian's `getLanguage()` for auto language detection (drop `localStorage`)
- Persist grid zoom in plugin data instead of `localStorage`
- Use `window.clearTimeout()` for popout compatibility
- Clean up unused code; recognized GPL-3.0 license file

## 0.1.0 (2026-08-28)

- Initial release: week grid with 第 N 周 / today highlight / now line
- Week rules: ranges, odd/even weeks, tap-to-select weeks
- Credits, custom lesson duration & break, compact mode
- Day overrides: 放假 (multi-day) and 补课 by specific date
- One-off events and per-date 停课
- Unscheduled courses (课程设计 18-19 周)
- Next-class bar, weekly stats, clash warnings
- Drag to move/copy courses (desktop)
- Agenda view (mobile), grid zoom (per device)
- iCal export
- Multiple semesters, bilingual UI (中文/English)
