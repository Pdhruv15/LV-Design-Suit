# LV scripts for OpenCADStudio

Small Python scripts that run **inside OpenCADStudio** and work with the links LV Design Studio puts on floor plans
(extended data `LVDS`). They work without LV Design Studio running, so a CAD operator can use them on their own.

**Get them:** in LV Design Studio, command palette → *Copy LV scripts for OpenCADStudio…* → choose a folder.
**Run one:** in OpenCADStudio, ribbon *Python Scripting* → **Run Script…** → pick the script (or type
`PY_RUN <folder>/lv_summary.py` on the command line). The result is printed on the command line.

| Script | Select first | What it does |
|---|---|---|
| `lv_summary.py` | — | Lists every cable route, tray run and board linked by LV Design Studio, with measured plan lengths, and adds the list as a table in the drawing (a new run replaces it). |
| `lv_room_areas.py` | — | Labels every closed room outline (layers with ROOM, RM, SPACE or AREA) with its area in m² and prints the total. Zones around other rooms are left out; a room drawn twice counts once; a new run replaces the labels. |
| `lv_tag_trays.py` | tray runs **and** one label ("TRAY A", "CT-2", "B") | Links the runs to that tray route (`tray:A`), like *Link selection* in Tray routes from CAD floor plan. |
| `lv_board_check.py` | — | Lists the board symbols LV Design Studio will find (TAG / BOARD / PANEL attribute, or linked by hand) and points out boards found twice or empty attributes. Changes nothing. |
| `lv_untag.py` | the objects | Removes route, tray and board links from them (tags on exported SLD sheets are left alone). |

Notes

- **2D plan only.** Lengths and areas assume a drawing in millimetres; for other units change `UNITS_TO_M` at the
  top of `lv_summary.py` and `lv_room_areas.py`.
- Each run is one undo step in OpenCADStudio.
- OpenCADStudio runs scripts in a sandbox (no files, no network), so a script cannot ask for typed input — that is
  why `lv_tag_trays.py` takes the tray name from a selected label. Linking cable routes to feeders, and pulling
  lengths, rooms, loads and board locations into the design, stays in LV Design Studio (*… from CAD floor plan*).
- Needs OpenCADStudio with its bundled *Python Scripting* plugin (tested with 2026.42).
