#!/usr/bin/env python3
"""Create visual user manuals for Load Schedule and SLD.

The manuals use committed repository screenshots only. They do not launch or
capture the application. All PDF content is grayscale to match project rules.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Iterable, Sequence

from PIL import Image
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "pdf"
TMP = ROOT / "tmp" / "pdfs"
PAGE = landscape(A4)
PW, PH = PAGE

BLACK = (0.06, 0.06, 0.06)
DARK = (0.18, 0.18, 0.18)
MID = (0.42, 0.42, 0.42)
LINE = (0.72, 0.72, 0.72)
PALE = (0.94, 0.94, 0.94)
WHITE = (1, 1, 1)

SCREEN_LOAD = ROOT / "docs" / "screenshots" / "02-load-schedule.png"
SCREEN_SLD = ROOT / "docs" / "screenshots" / "01-single-line-diagram.png"
OUTPUT_LOAD = ROOT / "docs" / "mockups" / "load-schedule-revised-mockup.png"


def set_fill(c: canvas.Canvas, color: tuple[float, float, float]) -> None:
    c.setFillColorRGB(*color)


def set_stroke(c: canvas.Canvas, color: tuple[float, float, float]) -> None:
    c.setStrokeColorRGB(*color)


def rounded(c: canvas.Canvas, x: float, y: float, w: float, h: float,
            fill: tuple[float, float, float] = WHITE,
            stroke: tuple[float, float, float] = LINE, radius: float = 6) -> None:
    set_fill(c, fill)
    set_stroke(c, stroke)
    c.setLineWidth(0.7)
    c.roundRect(x, y, w, h, radius, fill=1, stroke=1)


def wrap(text: str, font: str, size: float, width: float) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        trial = f"{current} {word}".strip()
        if not current or stringWidth(trial, font, size) <= width:
            current = trial
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def paragraph(c: canvas.Canvas, text: str, x: float, y: float, width: float,
              size: float = 9.2, leading: float = 12, font: str = "Helvetica",
              color: tuple[float, float, float] = DARK, max_lines: int | None = None) -> float:
    set_fill(c, color)
    c.setFont(font, size)
    lines = wrap(text, font, size, width)
    if max_lines is not None:
        lines = lines[:max_lines]
    for line in lines:
        c.drawString(x, y, line)
        y -= leading
    return y


def bullets(c: canvas.Canvas, items: Iterable[str], x: float, y: float, width: float,
            size: float = 9, leading: float = 11.5, gap: float = 4) -> float:
    for item in items:
        lines = wrap(item, "Helvetica", size, width - 13)
        set_fill(c, BLACK)
        c.circle(x + 3, y + 2.5, 1.5, fill=1, stroke=0)
        set_fill(c, DARK)
        c.setFont("Helvetica", size)
        for i, line in enumerate(lines):
            c.drawString(x + 11, y - i * leading, line)
        y -= len(lines) * leading + gap
    return y


def header(c: canvas.Canvas, section: str, title: str, page: int, total: int) -> None:
    set_fill(c, BLACK)
    c.rect(0, PH - 38, PW, 38, fill=1, stroke=0)
    set_fill(c, WHITE)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(26, PH - 23, "LV DESIGN STUDIO")
    c.setFont("Helvetica", 8.5)
    c.drawRightString(PW - 26, PH - 23, f"{section}  |  {title}")
    set_fill(c, MID)
    c.setFont("Helvetica", 7.5)
    c.drawString(26, 15, "Visual user manual - interface may vary slightly by version")
    c.drawRightString(PW - 26, 15, f"{page} / {total}")


def section_title(c: canvas.Canvas, kicker: str, title: str, subtitle: str = "") -> None:
    set_fill(c, MID)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(30, PH - 62, kicker.upper())
    set_fill(c, BLACK)
    c.setFont("Helvetica-Bold", 22)
    c.drawString(30, PH - 88, title)
    if subtitle:
        paragraph(c, subtitle, 30, PH - 106, PW - 60, size=9, leading=11, color=MID)


def step_card(c: canvas.Canvas, number: int, title: str, body: str,
              x: float, y: float, w: float, h: float) -> None:
    rounded(c, x, y, w, h, fill=PALE)
    set_fill(c, BLACK)
    c.circle(x + 19, y + h - 20, 10, fill=1, stroke=0)
    set_fill(c, WHITE)
    c.setFont("Helvetica-Bold", 9)
    c.drawCentredString(x + 19, y + h - 23, str(number))
    set_fill(c, BLACK)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(x + 36, y + h - 23, title)
    paragraph(c, body, x + 13, y + h - 42, w - 26, size=8.3, leading=10.5, color=DARK)


def grayscale(path: Path) -> Path:
    TMP.mkdir(parents=True, exist_ok=True)
    out = TMP / f"{path.stem}-gray.png"
    if not out.exists() or out.stat().st_mtime < path.stat().st_mtime:
        with Image.open(path) as im:
            im.convert("L").convert("RGB").save(out, optimize=True)
    return out


def image_fit(c: canvas.Canvas, path: Path, x: float, y: float, w: float, h: float,
              border: bool = True) -> tuple[float, float, float, float]:
    with Image.open(path) as im:
        iw, ih = im.size
    scale = min(w / iw, h / ih)
    dw, dh = iw * scale, ih * scale
    dx, dy = x + (w - dw) / 2, y + (h - dh) / 2
    c.drawImage(ImageReader(str(path)), dx, dy, dw, dh, preserveAspectRatio=True, mask="auto")
    if border:
        set_stroke(c, LINE)
        c.setLineWidth(0.8)
        c.rect(dx, dy, dw, dh, fill=0, stroke=1)
    return dx, dy, dw, dh


def callout(c: canvas.Canvas, image_box: tuple[float, float, float, float],
            nx: float, ny: float, number: int) -> None:
    x, y, w, h = image_box
    px = x + nx * w
    py = y + (1 - ny) * h
    set_fill(c, WHITE)
    set_stroke(c, BLACK)
    c.setLineWidth(1.4)
    c.circle(px, py, 8.5, fill=1, stroke=1)
    set_fill(c, BLACK)
    c.setFont("Helvetica-Bold", 8.5)
    c.drawCentredString(px, py - 3, str(number))


def mini_legend(c: canvas.Canvas, items: Sequence[tuple[int, str]], x: float, y: float,
                width: float, columns: int = 4) -> None:
    col_w = width / columns
    row_h = 24
    for i, (number, label) in enumerate(items):
        col = i % columns
        row = i // columns
        bx = x + col * col_w
        by = y - row * row_h
        set_fill(c, BLACK)
        c.circle(bx + 8, by + 5, 7, fill=1, stroke=0)
        set_fill(c, WHITE)
        c.setFont("Helvetica-Bold", 7.5)
        c.drawCentredString(bx + 8, by + 2.5, str(number))
        paragraph(c, label, bx + 19, by + 9, col_w - 23, size=7.4, leading=8.5, max_lines=2)


def cover(c: canvas.Canvas, manual: str, subtitle: str, image: Path,
          outcomes: Sequence[str], doc_id: str) -> None:
    set_fill(c, BLACK)
    c.rect(0, 0, PW, PH, fill=1, stroke=0)
    set_fill(c, WHITE)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(34, PH - 44, "LV DESIGN STUDIO")
    c.setFont("Helvetica-Bold", 31)
    c.drawString(34, PH - 92, manual)
    c.setFont("Helvetica", 13)
    c.drawString(34, PH - 116, subtitle)
    box = image_fit(c, image, 34, 91, PW - 68, PH - 230, border=False)
    set_stroke(c, WHITE)
    c.rect(*box, fill=0, stroke=1)
    y = 66
    item_w = (PW - 68 - 18) / 4
    for i, text in enumerate(outcomes[:4]):
        x = 34 + i * (item_w + 6)
        set_fill(c, (0.15, 0.15, 0.15))
        c.roundRect(x, y - 35, item_w, 35, 4, fill=1, stroke=0)
        set_fill(c, WHITE)
        c.setFont("Helvetica-Bold", 8)
        c.drawString(x + 8, y - 12, f"{i + 1:02d}")
        for j, line in enumerate(wrap(text, "Helvetica", 7.4, item_w - 30)[:2]):
            c.setFont("Helvetica", 7.4)
            c.drawString(x + 26, y - 12 - j * 9, line)
    c.setFont("Helvetica", 7)
    c.drawRightString(PW - 34, 18, f"{doc_id}  |  24 October 2026")


def draw_tabs(c: canvas.Canvas, labels: Sequence[str], active: int,
              x: float, y: float, widths: Sequence[float]) -> None:
    for i, (label, w) in enumerate(zip(labels, widths)):
        fill = BLACK if i == active else WHITE
        rounded(c, x, y, w, 25, fill=fill, stroke=BLACK, radius=3)
        set_fill(c, WHITE if i == active else DARK)
        c.setFont("Helvetica-Bold" if i == active else "Helvetica", 8)
        c.drawCentredString(x + w / 2, y + 8, label)
        x += w + 3


def draw_schedule_grid(c: canvas.Canvas, x: float, y: float, w: float, h: float) -> None:
    set_stroke(c, MID)
    set_fill(c, WHITE)
    c.rect(x, y, w, h, fill=1, stroke=1)
    cols = [0.08, 0.06, 0.08, 0.08, 0.10, 0.17, 0.25, 0.06, 0.06, 0.06]
    cx = x
    for frac in cols[:-1]:
        cx += w * frac
        c.line(cx, y, cx, y + h)
    rows = 7
    for r in range(1, rows):
        c.line(x, y + h * r / rows, x + w, y + h * r / rows)
    heads = ["ELCB", "Sl.", "Circuit", "MCB", "Wire", "Room / area", "Connected loads / points", "R", "Y", "B"]
    cx = x
    for label, frac in zip(heads, cols):
        c.setFont("Helvetica-Bold", 6.5)
        set_fill(c, BLACK)
        c.drawCentredString(cx + w * frac / 2, y + h - 14, label)
        cx += w * frac
    rows_data = [
        ("ELCB-1", "1", "R1", "10", "2.5", "Living lighting", "12 LTG", "1200", "", ""),
        ("", "2", "Y1", "10", "2.5", "Majlis lighting", "10 LTG", "", "1000", ""),
        ("", "3", "B1", "16", "4", "Split A/C", "1 SAC", "", "", "2500"),
        ("ELCB-2", "4", "R2", "20", "4", "Water heater", "1 WH", "3000", "", ""),
        ("", "5", "Y2", "16", "4", "Sockets", "6 x 13A", "", "1500", ""),
    ]
    row_h = h / rows
    for r, data in enumerate(rows_data, start=1):
        cy = y + h - (r + 1) * row_h + row_h / 2 - 2
        cx = x
        for value, frac in zip(data, cols):
            c.setFont("Helvetica", 6.5)
            set_fill(c, DARK)
            c.drawCentredString(cx + w * frac / 2, cy, value)
            cx += w * frac


def draw_sld_tree(c: canvas.Canvas, x: float, y: float, w: float, h: float) -> None:
    rounded(c, x, y, w, h, fill=WHITE)
    items = [("MDB-1", 0), ("SMDB-GF", 1), ("DB-GF1", 2), ("SMDB-FF", 1), ("MCC-1", 1)]
    c.setFont("Helvetica-Bold", 9)
    set_fill(c, BLACK)
    c.drawString(x + 12, y + h - 20, "Panels")
    yy = y + h - 45
    for label, level in items:
        px = x + 15 + level * 17
        set_fill(c, BLACK)
        c.circle(px, yy + 3, 2.5, fill=1, stroke=0)
        c.setFont("Helvetica", 8)
        c.drawString(px + 8, yy, label)
        if level:
            set_stroke(c, LINE)
            c.line(px - 8, yy + 3, px - 2, yy + 3)
        yy -= 23


def arrow(c: canvas.Canvas, x1: float, y1: float, x2: float, y2: float) -> None:
    set_stroke(c, BLACK)
    c.setLineWidth(1.5)
    c.line(x1, y1, x2, y2)
    c.line(x2, y2, x2 - 6, y2 + 4)
    c.line(x2, y2, x2 - 6, y2 - 4)


def load_manual(path: Path) -> None:
    total = 6
    c = canvas.Canvas(str(path), pagesize=PAGE, pageCompression=1)
    c.setTitle("LV Design Studio - Load Schedule visual user manual")
    c.setAuthor("LV Design Studio")

    cover(
        c,
        "Load Schedule",
        "Visual user manual - enter circuits, balance phases, review demand, and export",
        grayscale(SCREEN_LOAD),
        ["Open the correct panel", "Complete the DB schedule", "Review MD and phase balance", "Export submission forms"],
        "MAN-LS-001",
    )
    c.showPage()

    header(c, "LOAD SCHEDULE", "Interface tour", 2, total)
    section_title(c, "Start here", "Know the screen before entering data",
                  "The numbered markers identify the controls used most often.")
    box = image_fit(c, grayscale(SCREEN_LOAD), 28, 83, PW - 56, PH - 205)
    for nx, ny, n in [(0.30, 0.11, 1), (0.08, 0.31, 2), (0.60, 0.18, 3), (0.33, 0.30, 4), (0.86, 0.18, 5), (0.59, 0.69, 6)]:
        callout(c, box, nx, ny, n)
    mini_legend(c, [
        (1, "Schedule button in Detailed design"),
        (2, "Panel tree - choose the board"),
        (3, "Panel selector and current form"),
        (4, "Form groups and panel tabs"),
        (5, "Excel, PDF, and submission exports"),
        (6, "Editable schedule or MD grid"),
    ], 34, 65, PW - 68, columns=3)
    c.showPage()

    header(c, "LOAD SCHEDULE", "Choose the correct form", 3, total)
    section_title(c, "Step 1", "Open the panel and form you intend to edit",
                  "Do not type a downstream panel load into its parent form. Edit the source schedule instead.")
    step_card(c, 1, "Select a board", "Click a board in the panel tree, use the board selector, or right-click the board and choose Load schedule.", 30, 330, 240, 92)
    step_card(c, 2, "Choose the form group", "Use TCL summary, MDB, SMDB, DB, MCC, or Busbar riser. An exclamation mark means the form is not filled yet.", 300, 330, 240, 92)
    step_card(c, 3, "Choose Load schedule or MD", "DB final circuits belong in Load schedule. Panel incomers and outgoing feeders belong in Connected load & MD.", 570, 330, 240, 92)
    draw_tabs(c, ["TCL summary", "MDB (1)", "SMDB (2)", "DB (4)", "MCC (1)"], 3, 95, 276, [88, 70, 80, 70, 68])
    draw_tabs(c, ["DB-GF1", "DB-FF1", "DB-FF2", "DB-LAB"], 0, 95, 232, [78, 78, 78, 78])
    rounded(c, 95, 86, 650, 122, fill=PALE)
    set_fill(c, BLACK)
    c.setFont("Helvetica-Bold", 13)
    c.drawString(116, 176, "Quick decision")
    bullets(c, [
        "Final lighting, socket, A/C, water-heater, and equipment circuits: use the DB Load schedule.",
        "MDB/SMDB/MCC incomer and outgoing feeders: use Connected load & MD.",
        "Transformer roll-up: use TCL summary. High-rise tap-offs: use Busbar riser.",
        "If a feeder supplies another panel, edit that panel or its DB schedules; the totals roll up automatically.",
    ], 116, 155, 610, size=9, leading=12)
    c.showPage()

    header(c, "LOAD SCHEDULE", "Complete a DB schedule", 4, total)
    section_title(c, "Steps 2-5", "Enter points, circuits, protection, and length",
                  "The grid below is an interface illustration using the same fields as the app.")
    rounded(c, 30, 92, 782, 340, fill=PALE)
    set_fill(c, BLACK)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(48, 405, "DB-GF1 - Load distribution schedule")
    c.setFont("Helvetica", 8)
    c.drawRightString(792, 405, "ELCB per: 6 circuits   Sensitivity: Auto")
    set_fill(c, WHITE)
    set_stroke(c, MID)
    c.rect(48, 362, 744, 28, fill=1, stroke=1)
    c.setFont("Helvetica-Bold", 7)
    set_fill(c, BLACK)
    c.drawString(57, 373, "WATT / UNIT")
    for i, label in enumerate(["LTG 100", "FAN 40", "13A 250", "WH 3000", "SAC 2500", "PUMP 750"]):
        c.drawString(178 + i * 92, 373, label)
    draw_schedule_grid(c, 48, 143, 744, 207)
    for px, py, n in [(104, 375, 1), (572, 375, 2), (55, 337, 3), (387, 290, 4), (742, 185, 5)]:
        set_fill(c, WHITE)
        set_stroke(c, BLACK)
        c.circle(px, py, 9, fill=1, stroke=1)
        set_fill(c, BLACK)
        c.setFont("Helvetica-Bold", 8)
        c.drawCentredString(px, py - 3, str(n))
    mini_legend(c, [
        (1, "Enter WATT / UNIT for every point type used"),
        (2, "Use a library item when a standard load is available"),
        (3, "Add circuit or Add 3-phase circuit"),
        (4, "Enter room and point quantities"),
        (5, "Enter length and review Check"),
    ], 48, 116, 744, columns=5)
    c.showPage()

    header(c, "LOAD SCHEDULE", "Edit and check", 5, total)
    section_title(c, "Steps 6-8", "Finish the circuit details and review the board",
                  "Double-click a circuit row for the detailed editor. Use Balance phases only after the circuit list is ready.")
    rounded(c, 30, 110, 380, 315, fill=WHITE)
    set_fill(c, BLACK)
    c.setFont("Helvetica-Bold", 13)
    c.drawString(48, 398, "Edit circuit: R1")
    paragraph(c, "DB-GF1 - phase R - changes apply on Save", 48, 381, 330, size=8, color=MID)
    labels = [("Room / area", "Living room"), ("Length (m) - calc only", "22"), ("Lighting points", "12"), ("Socket points", "0"), ("MCB (A)", "10 - automatic"), ("CCT wire mm2", "2.5 - automatic")]
    yy = 348
    for label, value in labels:
        c.setFont("Helvetica-Bold", 7)
        set_fill(c, MID)
        c.drawString(48, yy + 18, label)
        rounded(c, 48, yy - 2, 150, 18, fill=PALE, radius=2)
        c.setFont("Helvetica", 8)
        set_fill(c, DARK)
        c.drawString(55, yy + 4, value)
        yy -= 39
    bullets(c, [
        "Use load items when one circuit contains mixed wattages.",
        "Clear Sized by hand to return MCB, wire, and ECC to automatic sizing.",
        "Add Spare for a fitted breaker; add Space for an empty future way.",
    ], 222, 343, 165, size=8.2, leading=10.5)
    rounded(c, 435, 110, 377, 315, fill=PALE)
    set_fill(c, BLACK)
    c.setFont("Helvetica-Bold", 13)
    c.drawString(455, 398, "Board review")
    step_card(c, 1, "Balance phases", "Spreads circuits across R/Y/B, groups lighting before power, renumbers circuits, and moves spares to free slots.", 455, 310, 337, 72)
    step_card(c, 2, "Read phase totals", "Review R, Y, and B watts and the imbalance percentage. Values above 20% are highlighted for checking.", 455, 222, 337, 72)
    step_card(c, 3, "Resolve checks", "Fix missing watts, wire below minimum, mixed ELCB groups, invalid lengths, and other rejected edits.", 455, 134, 337, 72)
    c.showPage()

    header(c, "LOAD SCHEDULE", "Export and handover", 6, total)
    section_title(c, "Finish", "Review the output, then export the right file",
                  "The example below is an illustrative schedule-output mockup, not a live app capture.")
    box = image_fit(c, grayscale(OUTPUT_LOAD), 30, 160, 510, 260)
    rounded(c, 565, 160, 247, 260, fill=PALE)
    set_fill(c, BLACK)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(585, 395, "Before export")
    bullets(c, [
        "No missing WATT / UNIT warnings",
        "No incomplete-panel exclamation marks",
        "R/Y/B balance reviewed",
        "Circuit Check column reviewed",
        "Project and submission details complete",
        "Calculations run with F5",
        "Project saved",
    ], 585, 371, 205, size=8.5, leading=10.5)
    set_fill(c, BLACK)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(585, 252, "Choose an export")
    bullets(c, [
        "Export Excel - current form",
        "Export PDF - current form",
        "Export CSV - current DB grid",
        "Submission pack (Excel) - all forms",
    ], 585, 232, 205, size=8.5, leading=10.5)
    set_fill(c, MID)
    c.setFont("Helvetica", 7.5)
    c.drawString(box[0], 146, "Illustrative load distribution schedule output")
    c.save()


def sld_manual(path: Path) -> None:
    total = 6
    c = canvas.Canvas(str(path), pagesize=PAGE, pageCompression=1)
    c.setTitle("LV Design Studio - SLD visual user manual")
    c.setAuthor("LV Design Studio")

    cover(
        c,
        "Single Line Diagram (SLD)",
        "Visual user manual - build the network, check calculations, and create drawing sheets",
        grayscale(SCREEN_SLD),
        ["Build the panel hierarchy", "Add and edit feeders", "Run and review checks", "Create and export sheets"],
        "MAN-SLD-001",
    )
    c.showPage()

    header(c, "SLD", "Interface tour", 2, total)
    section_title(c, "Start here", "Know the SLD work area",
                  "The numbered markers identify the controls used to build and check the network.")
    box = image_fit(c, grayscale(SCREEN_SLD), 28, 83, PW - 56, PH - 205)
    for nx, ny, n in [(0.08, 0.12, 1), (0.08, 0.38, 2), (0.27, 0.20, 3), (0.62, 0.34, 4), (0.50, 0.62, 5), (0.91, 0.42, 6), (0.49, 0.94, 7), (0.56, 0.22, 8)]:
        callout(c, box, nx, ny, n)
    mini_legend(c, [
        (1, "SLD and selection controls"), (2, "Panel tree"),
        (3, "System, board, earthing, and riser views"), (4, "Drawing display tools"),
        (5, "Interactive SLD canvas"), (6, "Board properties or circuit results"),
        (7, "System, bus, and feeder results"), (8, "Export and drawing sheets"),
    ], 34, 65, PW - 68, columns=4)
    c.showPage()

    header(c, "SLD", "Build the network", 3, total)
    section_title(c, "Steps 1-3", "Create the supply hierarchy before adding final loads",
                  "Start at the main board and work downstream. Every board needs an incomer feeder.")
    draw_sld_tree(c, 35, 150, 190, 265)
    rounded(c, 260, 150, 552, 265, fill=PALE)
    step_card(c, 1, "Select the parent board", "Choose the board that will supply the new board. The selected board is highlighted in the panel tree and on the SLD.", 280, 323, 240, 72)
    step_card(c, 2, "Add the downstream board", "Select Boards. Enter board ID, name, type, rating, source, incomer ID, cable, and breaker details.", 550, 323, 240, 72)
    step_card(c, 3, "Repeat or build in batches", "Add boards one by one, or use Build hierarchy when creating several panels and connections together.", 280, 231, 240, 72)
    step_card(c, 4, "Check the supply chain", "Open the board Supply tab. Confirm transformer, parent panels, incomer cable, fault level, and cumulative voltage drop.", 550, 231, 240, 72)
    set_fill(c, BLACK)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(280, 196, "Move an existing board")
    paragraph(c, "Drag a downstream board onto its new parent in the panel tree. Confirm the move, then check the incomer cable length.", 280, 181, 500, size=8.5, leading=10.5)
    c.showPage()

    header(c, "SLD", "Add and edit feeders", 4, total)
    section_title(c, "Steps 4-6", "Add equipment, then complete cable and protection data",
                  "The feeder dialog gives a live summary of current, cable, breaker, and total voltage drop.")
    stages = [
        ("General & load", ["Unique circuit ID and name", "Load type and connected kW", "Demand factor and power factor", "Essential, existing, or generation"]),
        ("Cable", ["Length and cores", "Cable size and parallel runs", "Installation and cable type", "Protective conductor", "Suggest cable size"]),
        ("Protection", ["Breaker rating, Icu, and type", "Instantaneous setting", "Circuit purpose", "RCD/ELCB and isolator"]),
        ("Metering", ["Direct or CT-operated kWh meter"]),
    ]
    x = 35
    for i, (title, items) in enumerate(stages):
        w = 185 if i < 3 else 180
        rounded(c, x, 175, w, 230, fill=WHITE)
        set_fill(c, BLACK)
        c.setFont("Helvetica-Bold", 11)
        c.drawString(x + 14, 378, title)
        bullets(c, items, x + 14, 350, w - 28, size=8.3, leading=11)
        if i < 3:
            arrow(c, x + w + 3, 290, x + w + 20, 290)
        x += w + 23
    rounded(c, 35, 100, 777, 55, fill=PALE)
    set_fill(c, BLACK)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(50, 134, "Fast editing on the SLD")
    paragraph(c, "Click to select. Double-click or press F2 to edit. Drag a board, load, or incomer to reconnect it. Delete removes the selected item. Ctrl/Command+C and Ctrl/Command+V copy and paste a board branch.", 50, 118, 735, size=8.4, leading=10)
    c.showPage()

    header(c, "SLD", "Run and review calculations", 5, total)
    section_title(c, "Steps 7-8", "Run calculations after every design change",
                  "Live totals update immediately, but network study results can become stale until F5 is run.")
    flow = [
        ("EDIT", "Board, feeder, cable, breaker, or load"),
        ("RUN", "Select Run or press F5"),
        ("REVIEW", "System summary, buses, and feeders"),
        ("CORRECT", "Fix failures and warnings"),
        ("RUN AGAIN", "Confirm all results are current"),
    ]
    x = 34
    for i, (title, body) in enumerate(flow):
        w = 139
        rounded(c, x, 290, w, 100, fill=PALE)
        set_fill(c, BLACK)
        c.setFont("Helvetica-Bold", 10)
        c.drawCentredString(x + w / 2, 364, title)
        lines = wrap(body, "Helvetica", 8, w - 20)
        c.setFont("Helvetica", 8)
        for j, line in enumerate(lines):
            c.drawCentredString(x + w / 2, 340 - j * 10, line)
        if i < len(flow) - 1:
            arrow(c, x + w + 4, 340, x + w + 20, 340)
        x += 160
    rounded(c, 70, 128, 702, 125, fill=WHITE)
    set_fill(c, BLACK)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(90, 226, "Checks to review")
    items = [
        "Design current <= breaker <= cable capacity",
        "Total voltage drop within the project limit",
        "Breaker Icu above the calculated fault level",
        "Earth-fault loop and disconnection time acceptable",
        "Board loading and phase loading acceptable",
        "No stale-results notice before export",
    ]
    bullets(c, items[:3], 90, 204, 300, size=8.7, leading=11)
    bullets(c, items[3:], 430, 204, 300, size=8.7, leading=11)
    c.showPage()

    header(c, "SLD", "Drawing sheets and export", 6, total)
    section_title(c, "Finish", "Turn the working SLD into controlled drawing sheets",
                  "Design is the full editable canvas. Sheet tabs are the pages prepared for issue.")
    draw_tabs(c, ["Design", "E-SLD-001", "E-SLD-002", "+"], 0, 46, 372, [80, 95, 95, 34])
    rounded(c, 46, 244, 750, 105, fill=PALE)
    steps = [
        (1, "Select a panel", "Choose the branch for the new sheet."),
        (2, "Add a sheet", "Use +, then Selected panel and its branch, Empty sheet, or Split all panels."),
        (3, "Set controls", "Check paper size, title, panels, cable labels, result layers, status, and revision."),
        (4, "Preview", "Use Reports > Drawings to review every sheet before issue."),
    ]
    xx = 60
    for n, title, body in steps:
        set_fill(c, BLACK)
        c.circle(xx + 8, 323, 8, fill=1, stroke=0)
        set_fill(c, WHITE)
        c.setFont("Helvetica-Bold", 8)
        c.drawCentredString(xx + 8, 320, str(n))
        set_fill(c, BLACK)
        c.setFont("Helvetica-Bold", 8.5)
        c.drawString(xx + 23, 320, title)
        paragraph(c, body, xx, 299, 165, size=7.6, leading=9)
        xx += 182
    rounded(c, 46, 98, 360, 122, fill=WHITE)
    rounded(c, 436, 98, 360, 122, fill=WHITE)
    set_fill(c, BLACK)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(64, 194, "Quick SLD export")
    bullets(c, ["Open the system diagram", "Run F5 if result labels are shown", "Select Export", "Complete title-block details", "Export SVG, DXF, or PDF"], 64, 175, 320, size=8.3, leading=10.5)
    c.setFont("Helvetica-Bold", 10)
    set_fill(c, BLACK)
    c.drawString(454, 194, "Drawing-set export")
    bullets(c, ["Open Reports > Drawings", "Preview sheets", "Export one combined PDF", "Or export PDF/DXF per sheet", "Optionally include the drawing register"], 454, 175, 320, size=8.3, leading=10.5)
    c.save()


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    TMP.mkdir(parents=True, exist_ok=True)
    load_manual(OUT / "LV-Design-Studio-Load-Schedule-Visual-User-Manual.pdf")
    sld_manual(OUT / "LV-Design-Studio-SLD-Visual-User-Manual.pdf")


if __name__ == "__main__":
    main()
