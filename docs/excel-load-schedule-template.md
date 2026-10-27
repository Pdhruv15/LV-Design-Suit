# Your own Excel load schedule template

Lay out the load schedule in Excel the way your company or authority wants: headings, borders, column widths and print setup (images such as logos are not copied yet). Put placeholders where the app should write values. The app fills one copy of the sheet for every DB that has schedule circuits.

```bash
lvds schedule-xlsx "My project" --template "Company schedule.xlsx"
lvds schedule-xlsx "My project" --template "Company schedule.xlsx" --export --approvedBy "A. Engineer"
```

The template is a path or a file name in the projects folder. MCP and the local API only read templates inside the projects folder. The first command previews; the second writes the file to `Exports/<project>/<date>/`.

## How the sheet is filled

- **The repeated row:** the first row with a `{{row.…}}` placeholder is copied for every circuit and spare, in way order. The copy keeps its font, borders, fill, row height and merged cells.
- **Cells that span the rows:** in the repeated row, a cell holding only board placeholders (for example `{{board.incomer}}`) is merged down over all the rows. A cell holding only `{{row.elcb}}` is merged over each ELCB group, as on the DEWA form.
- **Below the row:** rows below move down. Formulas move with them, and a range over the repeated row is stretched over all the rows. For example, `SUM(H8:H8)` becomes `SUM(H8:H31)`.
- **Numbers:** a cell that holds only one placeholder gets a number where the value is one, so Excel formulas can use it.
- **Other sheets:** a cover or notes sheet is kept and gets the `project.…` fields and `date`.
- **Mistakes:** an unknown placeholder is left in the cell and named in the export result.

## Placeholders

| Placeholder | Value |
|---|---|
| `{{project.name}}` | Project name |
| `{{project.voltage}}`, `{{project.frequency}}` | System voltage (V) and frequency (Hz) |
| `{{project.revision}}` | Revision stamp |
| `{{project.reference}}` | Design reference applied, e.g. DEWA (Dubai) v1 |
| `{{date}}` | Export date, dd/mm/yyyy |
| `{{board.id}}`, `{{board.name}}` | DB number and name |
| `{{board.location}}`, `{{board.fedFrom}}` | Location, and the board it is fed from |
| `{{board.incomer}}`, `{{board.incomerCable}}` | Incomer (e.g. 63 A ISOLATOR TP+N) and incoming cable line |
| `{{total.R}}`, `{{total.Y}}`, `{{total.B}}`, `{{total.all}}` | Connected load, W |
| `{{md.R}}`, `{{md.Y}}`, `{{md.B}}`, `{{md.all}}` | Maximum demand after demand factors, W |
| `{{imbalance}}` | Phase imbalance, % |
| `{{label.ltg}}`, `{{wattUnit.ltg}}` | Heading and WATT / UNIT of a point column (any point type: ltg, cfan, exfan, shaver, s13, wh, hd, cooker, s15, wac, sac, pump …) |
| `{{row.sl}}`, `{{row.ref}}` | Serial number and circuit reference (R1, Y1 …) |
| `{{row.mcb}}`, `{{row.wire}}`, `{{row.ecc}}` | MCB (A), circuit wire and earth wire (mm²) |
| `{{row.room}}` | Room / area; SPARE or SPACE for spares |
| `{{row.points.ltg}}` … | Number of points of that type |
| `{{row.R}}`, `{{row.Y}}`, `{{row.B}}`, `{{row.watts}}` | Load per phase and circuit load, W |
| `{{row.elcb}}`, `{{row.elcbGroup}}` | ELCB label: first row of its group only, or every row |
| `{{row.remarks}}` | Remarks and mixed load items |
| `{{row.status}}` | "check" or "fails check" where the circuit needs attention |

Values are the app's own calculated ones, the same as the PDF and the DEWA forms workbook.
