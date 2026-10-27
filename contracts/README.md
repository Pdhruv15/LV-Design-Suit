# Exchange contracts

JSON Schema files for the packages LV Design Studio exchanges with other programs (contract `lvds.exchange`, version 1):

| File | Package |
| --- | --- |
| `exchange-package.schema.json` | Any package (one of the three below) |
| `rooms.schema.json` | Room schedule from CAD / IFC, or LV rooms for ELV design |
| `fixtures.schema.json` | Luminaire schedule (DIALux) |
| `loads.schema.json` | ELV upstream AC loads |

They are generated from `src/exchange/contracts.ts`; do not edit them by hand. After changing a contract:

```bash
UPDATE_CONTRACTS=1 npx vitest run src/exchange/contracts.test.ts
```

Rules: SI units (m², W, kW, V); every package names its source program and file; `sha256` (optional) is the SHA-256 of
the package without that field, keys sorted at every depth. A package is a proposal until the engineer accepts it.
Examples: `tests/fixtures/exchange/`.
