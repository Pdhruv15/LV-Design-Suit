# DEWA submission output: review and proposals (2026-10-23)

This review checks the Gemini proposal against the app's current PDF and Excel output. The proposal is the uncommitted "DEWA submission format" section in `UI UX proposals - 2026-10-22.md`, with its mockups in `docs/mockups/dewa-*`. The review then lists what would make the SLD and load schedule a cleaner authority submission.

**Nothing is built yet. Each item needs your approval, and any new report layout needs a mockup first. Reports stay black and white.**

## Verdict on the Gemini proposal

About half of it is **already in the app**. Several items are genuine gaps worth doing. The mockup should **not be used as is**:

- **Arithmetic errors** in its load schedule (`dewa-load-schedule-form3.png`):
  - The phase B total reads 7,500 W, but its own rows add up to 6,500 W.
  - The per-phase currents ignore the 0.9 power factor it says it uses: R shows 37.2 A instead of 41.4 A.
  - It prints "Phase current unbalance 3.6 % (complies with DEWA ≤ 10 %)", but its own currents (37.2 / 16.5 / 26.1 A) give about 40 %, which would **fail** a 10 % check.
  - The spare count says "15 ways: 10 connected + 3 spares + 2 spaces", but the table shows 13 rows (10 + 2 + 1).
- **Invented references and compliance claims:** "DEWA Electrical Regulation Clause 4.2" (for a 0.80 diversity factor), "DEWA SUBMISSION FORM 3 — COMPLIANT WITH DEWA REGULATIONS", "Meets DEWA ≥ 20 % min", plus made-up Makani and DEWA premise numbers. A design tool should not print compliance claims it cannot prove.
- **Colour:** blue, yellow and green highlights break our black-and-white report rule.
- **Regulation figures not verified.** The official DEWA 2017 Regulations PDF refused automated download (HTTP 403), and the only public sources found were secondary. Treat these as "check with DEWA" until they are confirmed against the regulation text:
  - nominal 400/230 V;
  - RCD tiers of 30 / 100 / 300 mA;
  - 20 % spare ways;
  - earth electrode ≤ 1 Ω;
  - a 2.5 % sub-main / 4 % total voltage-drop split.
  - It also conflicts with the app's own general note, which says 30 mA for socket outlets and 100 mA for lighting, while Gemini gives 30 mA for lighting.

## Item by item: Gemini proposal vs the app today

| # | Gemini item | In the app today | Verdict |
|---|---|---|---|
| SLD 1 | 11 kV intake / RMU, transformer vector group, DEWA CT metering cabinet (CT ratio, class 0.5S, 15 VA, test block) | RMU field; transformer drawn with kVA, Z %, vector group (Dyn11) and 11/0.415 kV; meter cabinet with CT ratio (`CTM 1600/5`), fed from DEWA | **Mostly done.** Gap: CT class / VA / test-block text. Only add these if DEWA's metering spec asks for them on the consultant's SLD; DEWA usually supplies the metering. |
| SLD 2 | Main ACB: 4P draw-out, LSIG trip unit, 50 kA/1 s, shunt trip, UVR | Incomer lines `1600A / 4P, 50KA, SET@0.8 / ACB (DOT)`; Icu turns red below the board's Isc; UVR and shunt-trip symbols are in the library | **Partly done.** Gap: trip-unit type (LSI / LSIG) and incomer accessories (shunt trip, UVR) as board fields printed on the SLD. |
| SLD 3 | Instrument compartment: R-Y-B lamps with fuses, multifunction meter (MFM), SPD Type 1+2 | Ammeter and voltmeter with S/S and R-Y-B lamps (library symbols, #306); PMU to BMS; SPD type on the busbar | **Mostly done.** Gaps: an MFM option as an alternative to A + V meters; lamp fuse rating in the text. |
| SLD 4 | Busbar `TPN Cu · 50 kA/1 s · 100 % neutral · earth bar 50×6`; earth pit < 1 Ω | `1600 A TPN+E Cu BUSBAR` (the way count and full wording are in the tooltip); earth pit detail with pit count, conductor and electrode; the busbar study calculates Icw | **Partly done.** Gap: print the busbar short-time rating (kA / 1 s, from the busbar study) and an earth-bar size on the SLD. Don't print a resistance target until it is verified. |
| SLD 5 | Feeder calling boxes: TCL, DF, MD kW/kVA, Ib, Vd, kWh meter category | DEWA panel box with LOC, TCL, DF and MDL; feeder TCL; kWh meter (1-PH / 3-PH / CT) on the SLD; Ib / Vd / fault result layers; the MD workbook has per-board TCL, DF, MDL and meters | **Mostly done.** Gap: MD in kVA and the incoming feeder Vd in the panel box. |
| SLD 6 | Life-safety feeders, fire-rated cable notation | FR cable marking and fire note; fire pump `M FP`; emergency boards (EMDB / ESMDB / EDB) automatically need fire-rated cables | **Done.** |
| SLD 7 | DEWA general notes, Makani / plot / locality, "FOR DEWA APPROVAL" stamp | 10 editable DEWA general notes; title block with revision history; plot no. and area in project info; sheet status from the issue workflow (e.g. FOR APPROVAL) | **Mostly done.** Gaps: Makani no. and DEWA premise / application no. fields, printed in the title block and the schedule headers. |
| LS 1 | Header: plot, Makani, locality; `3-phase, 4-wire, 400/230 V, 50 Hz, TPN` | `PROJECT: VILLA / BUILDING`, DB no., fed from, location, `(3-Phase, 415 V)` | **Gap.** Also a wording bug: "VILLA" is hard-coded for every project type. Add plot / Makani, write "3-phase 4-wire, {V}, 50 Hz", and add mounting / IP. |
| LS 2 | ELCB tiers 30 / 100 / 300 mA by load type | ELCB groups by block of circuits (default 6 = 2 ways × R/Y/B); rating sized from load; mA and poles in the label | **Partly done.** Gap: group by sensitivity and purpose (sockets / wet areas, heaters and cookers, A/C), with the purpose printed in the ELCB cell. The mA values per load type should be project settings, not hard-coded DEWA claims. |
| LS 3 | Four summary rows: TCL per phase, DF, MD kW + kVA, current per phase with unbalance check | Two rows: TOTAL CONNECTED (W) per phase, MAXIMUM DEMAND (W) per phase with imbalance % | **Gap, worth doing.** Add the DF row, MD in kVA and the demand current per phase (A), calculated correctly with PF. Keep the unbalance as calculated, against the app's 10 % check setting. |
| LS 4 | 20 % spare ways counter | Spares and spaces are listed in their slots; no counter | **Gap.** Add `Ways: n · connected · spares · spaces (x %)`, information only. Only add a pass/fail mark if a verified rule exists. |
| LS 5 | Incoming feeder and earthing details, feeder Vd, furthest-circuit Vd | `CABLE SIZE: 4C 35 mm² … , 30 m` | **Gap.** Add the incomer device and Icu, ECC, feeder Vd, worst final-circuit Vd, and the board earth path (the app already calculates all of these). |
| — | Per-circuit Vd in remarks | Remarks plus "(check)" flags | **Good idea.** Add a Vd % column, or Vd in remarks. |

## Further enhancements (beyond the Gemini list)

Suggested order: highest value, lowest risk first.

### A. Load distribution schedule

1. **Fix the header wording:**
   - drop the hard-coded "VILLA";
   - use the project type, or just `PROJECT`;
   - add plot no., Makani no., DB mounting and IP, form / enclosure;
   - write `3-phase 4-wire, {V}, 50 Hz, TN-S`.
2. **Summary block of four rows, black and white:**
   - TCL per phase (W);
   - DF;
   - MD per phase (kW) with the total in kW and kVA;
   - demand current per phase (A) with Ib max and unbalance %.
3. **Ways counter and spare percentage** (information).
4. **Per-circuit columns:**
   - MCB type / curve (B / C / D) and breaking capacity (kA);
   - RCD type (AC / A);
   - Vd %.

   These come from data the app already holds; they may need a second header row to fit A4 landscape.
5. **Footer block:**
   - incoming cable with ECC and length;
   - incomer device and Icu against the board Isc;
   - feeder Vd and worst final-circuit Vd;
   - earth path and conductor;
   - abbreviations.
6. **ELCB groups by sensitivity and purpose,** with the mA per load type set in Standards (default: the app's current note, until DEWA figures are verified).

### B. SLD sheet

1. **Busbar short-time rating** (kA / 1 s) from the busbar study, plus neutral size, in the busbar label.
2. **Incomer trip unit:** LSI / LSIG, with shunt trip / UVR as board fields; printed in the incomer lines and drawn with the library symbols.
3. **Panel summary box:** add MD in kVA and the incomer Vd (the box already has LOC, TCL, DF and MDL).
4. **Title block fields:** Makani no. and DEWA application / premise no.; the "FOR APPROVAL" stamp already comes from the issue status.
5. **MFM option** for a board's instruments (as an alternative to A + V meters with selector switch).

### C. Submission package

1. **A one-click DEWA submission set** in the Export centre. In order:
   - cover / drawing register;
   - SLD sheets;
   - load distribution schedules (one per DB);
   - connected load / MD and kWh metering form;
   - cable schedule;
   - earthing schematic;
   - calculation summary.

   Each sheet carries the same title-block data and revision. Most pieces already exist; this is ordering and one PDF.
2. **A pre-submission check list** in the app, not printed as compliance claims: missing plot / Makani / owner, boards without a location, circuits with no phase, unbalance above the check, Icu below Isc, Vd above the limit, no spare ways. The dashboard already finds most of these.
3. **Authority profile:** keep DEWA-specific wording, notes and limits in one profile (see `International authority profiles - review - 2026-10-04.md`), so DM / ADDC / SEWA variants don't need code changes.

## Decisions needed

1. Which items to build first. Suggested: A1–A3 and A5 (load schedule header, summary rows, ways counter, footer), then B1–B3.
2. The project's nominal voltage default and wording: keep the 415 V project setting, or change sample / default text to 400/230 V once confirmed against DEWA's current regulation.
3. RCD sensitivity per load type: keep the current note (30 mA sockets, 100 mA lighting) or change it after checking the DEWA text.
4. What to do with the Gemini section and mockups in the main folder (uncommitted): keep as reference, or discard once this review is accepted.

A black-and-white mockup of the revised load schedule (A1–A5) comes before any code, as the project rules require.
