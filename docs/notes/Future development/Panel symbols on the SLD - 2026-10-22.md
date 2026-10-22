# Panel symbols on the SLD - proposal (2026-10-22)

The symbol library (PR #300) has six panel symbols: `p-mdb`, `p-smdb`, `p-db`, `p-edb`, `p-mcc`, `p-apfc`. Each is one 28 × 32 box with a filled header strip and the panel code. They show a downstream board as a single box, without its busbar or outgoing ways. This note says where they could go. See the decision at the end.

## Where a panel box helps

1. **Collapsed sub-boards on the SLD (main proposal).** Today every sub-board is drawn in full: busbar, incomer and all its ways. On large projects the sheet gets very wide. Add a per-board "show as one box" switch. When it is on, the feeder that serves the board ends in the panel symbol at load scale (`SYM_SCALE.load`, the same slot as a load) instead of dropping to a full busbar. The board ID, kW and Ib go underneath, in the same three text lines a load uses, and the board's own ways are left out of that sheet. The full board is still drawn on its own panel sheet (`boardSheet.ts`).
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
| Board feeding only capacitor ways / `protection.apfc` | `p-apfc` |
| MC, UPS | no panel symbol yet: keep the current drawing |

## Decision (2026-10-22)

Approved with the recommendation, and built:

- Option 1, set per board: `Board.sldBox` ("Show as one box" under **On the SLD** in the board fields, sub-boards only). Main boards, meter cabinets and UPS boards are never boxed.
- An EMDB uses `p-mdb`, because it is a main board. Its board ID still shows that it is the emergency board.
- Options 2 (riser) and 3 (the "fed from" stub on board sheets) are **still open**. They wait for a separate go-ahead.
