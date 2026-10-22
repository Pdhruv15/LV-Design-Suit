# Symbol library redesign (IEC 60617) — proposal, 2026-10-22

Status: awaiting approval. Mockup: `docs/mockups/symbol-library-mockup.html`.

## Approach
- Draw every symbol ourselves as SVG on a 2.5 mm module grid (IEC 81714-2), connection points top/bottom.
- Shapes follow IEC 60617 conventions; no artwork copied from QElectroTech, KiCad or vendor libraries, so no licence issue.
- One size for every symbol: main body fits a 28 × 32 unit box on the line axis, accessories (CT, toroid, drawout marks) 12 units, labels start at one fixed point right of the axis.
- One definition feeds screen, SVG/DXF export and PDF; black-and-white only.
- Re-check each IEC 60617 reference number against the IEC online database before implementing.

## Redraw (exists in `src/diagram/IecSymbols.tsx` / `SystemDiagram.tsx`)
Circuit breaker, withdrawable ACB, isolator, transformer, PV + inverter, CT, kWh meter, busbar, motor, lighting, socket, capacitor bank, equipment box.

## New
Switch-disconnector, contactor, fuse, fuse switch-disconnector, RCBO, changeover/ATS, generator, authority incomer, SPD, earth, protective earth, distribution board, existing-equipment (dashed) style.

Panels (one box, no downstream detail): MDB, SMDB, DB, EDB, MCC, APFC panel.

Metering, monitoring & interfaces: VT, voltmeter, ammeter, PMU (RS485), BMS interface, fire alarm interface module (FAIM), breaker shunt trip, earth leakage relay + CBCT, indication lamps R-Y-B. Dashed line = signal/comms link.

Motor starters & relays: DOL starter, star-delta starter, soft starter, VFD, thermal overload relay, undervoltage relay (U<), phase failure relay. Also RCCB/ELCB (residual current, no overcurrent).
