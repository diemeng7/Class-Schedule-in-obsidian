# Class Schedule

一个学生向的 Obsidian 课程表插件：按周展示课表、支持单双周与指定周次、多学期切换、中英文界面。

A student-friendly timetable plugin for Obsidian: week-based course schedule with odd/even weeks, multiple semesters and a bilingual UI (中文/English).

GitHub: <https://github.com/diemeng7/Class-Schedule-in-obsidian>

## Features

- Week grid with the current week highlighted, today column and a live "now" line
- Course week rules: week ranges, odd/even weeks, or tap-to-select specific weeks
- Credits (学分) per course, summed per week and per semester
- Custom lesson duration and middle break (可开关)
- Whole-day overrides: 放假 (classes hidden) and 补课 (move a specific date's timetable)
- One-off events (临时事件) and per-date course cancellation (停课)
- Unscheduled courses (无固定时间, e.g. 课程设计 18-19 周)
- Next-class bar with live countdown, weekly stats (classes / done / left / credits)
- Drag a course to a different day/period (desktop), clash warnings
- Grid zoom (Ctrl/Cmd + wheel or settings slider, per device)
- iCal export for the current semester
- Mobile day / agenda / week modes
- Compact mode; multiple semesters; bilingual UI

## Usage

- Open the timetable from the ribbon icon or the "Open Class Schedule" command.
- Click an empty cell to add a course or a one-off event.
- Click a course block to edit it (including 停课 on that day).
- Click the calendar-off button on a day header to set 放假 / 补课.
- Export iCal from Settings (or the command palette) to get the semester into your phone's calendar.

All data lives in `data.json`, so it syncs across devices via Obsidian Sync / git / iCloud.

## Development

```bash
npm install
npm run dev      # watch build
npm run build    # production build (main.js)
npm run verify   # typecheck + svelte-check + lint + build
```

## License

GPL-3.0. A derivative of [Teacher Planner](https://github.com/NSDerred/teacher-planner-obsidian) (GPL-3.0) by Nick Smith.
