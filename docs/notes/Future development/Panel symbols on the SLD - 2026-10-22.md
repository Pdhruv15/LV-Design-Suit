# Panel symbols on the SLD - proposal (2026-10-22)

The symbol library (PR #300) has six panel symbols: `p-mdb`, `p-smdb`, `p-db`, `p-edb`, `p-mcc`, `p-apfc`. Each is one 28 × 32 box with a filled header strip and the panel code. They show a downstream board as a single box, without its busbar or outgoing ways. This note says where they could go. See the decision at the end.

## Where a panel box helps

1. **Collapsed sub-boards on the SLD (main proposal).** Today every sub-board is drawn in full: busbar, incomer and all its ways. On large projects the sheet gets very wide. When a board is at the end of the tree, the feeder that serves the board ends in the panel symbol at load scale (`SYM_SCALE.load`, the same slot as a load) instead of dropping to a full busbar. The board ID, kW and Ib go underneath, in the same three text lines a load uses, and the board's own ways are left out of that sheet. The full board is still drawn on its own panel sheet (`boardSheet.ts`).
2. **Riser diagram (`RiserDiagram.tsx`, `FeederRiserDiagram.tsx`).** The riser already shows boards as boxes. The panel symbol could replace the plain box so the riser and SLD look alike. Text and sizes would stay the same.
3. **Board sheets: the "fed from" stub.** At the top of a panel sheet, the upstream board could be drawn as its panel symbol with the feeder ID.

## Which symbol for which board

`roleOf(project, board)` in `src/model/emergency.ts` gives the panel role, then:

| Role / `Board.kind` | Symbol |
|---|---|
| MDB, LV-MDB, EMDB | `p-mdb` |
| SMDB, ESMDB | `p-smdb` |
| DB | `p-db` |
| EDB | `p-edb` |
| MCC, EMCC | `p-mcc` |
| Board whose every way is a capacitor bank | `p-apfc` |
| MC, UPS | no panel symbol yet: keep the current drawing |

## Decision (2026-10-22)

Built as option 1, then changed on review. There is **no per-board switch**: the panel symbol is used **automatically for end boards only**.

- An end board is a sub-board with no ways of its own on the SLD. Its final circuits stay on its load schedule. An APFC panel also counts, because its capacitor steps are inside it. It is drawn as its panel symbol in a load's slot under its feeder, with its ID, name and demand. Double-click the box to open its load schedule.
- A feeder panel (one feeding ways or other boards, such as SMDB-FF with its loads) keeps its busbar. Main boards, mains/generator changeovers, meter cabinets and UPS boards are never boxed.
- An EMDB uses `p-mdb`, because it is a main board.
- Options 2 and 3 approved 2026-10-23 and built:
  - **Riser diagram:** every board box is now its panel symbol.
  - **Feeder riser schematic:** each end board is its panel symbol. Panels that feed ways keep their enclosure with a busbar.
  - Both risers draw the symbol at the legend scale, about the old box's height, so row spacing is unchanged. UPS boards and meter cabinets keep their old boxes. Each legend lists the panel symbols in use.
  - **Board sheets:** the "FROM" stub at the top draws the board above as its panel symbol, black on white.
