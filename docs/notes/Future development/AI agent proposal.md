# Proposal: AI Agent for LV Design Studio

**Goal:** let an AI assistant (Claude, or a free local model on the Mac) build and check a full building electrical design *inside* LV Design Studio, with the engineer approving the result.

---

## 1. The big picture

```mermaid
flowchart LR
    E["👷 Engineer<br/>gives the brief"] --> A["🤖 AI agent<br/>(Claude or local LLM)"]
    A -->|"calls tools"| T["🔌 Agent door<br/>(MCP tool list)"]
    T --> S["⚙️ LV Design Studio<br/>existing calculations"]
    S -->|"short results"| A
    A --> R["📋 Draft design<br/>+ failure list"]
    R --> E2{"👷 Engineer<br/>approves?"}
    E2 -->|Yes| X["📦 Export reports<br/>/ issue package"]
    E2 -->|"No, change"| A
```

- The **app already has the engineering** (sizing, voltage drop, fault level, reports).
- What we add is the **agent door**: a short list of safe tools the AI is allowed to use.
- **The engineer always has the final say** — nothing is exported without approval.

---

## 2. How the agent builds a G+10 building

```mermaid
flowchart TD
    B1["1. Building data<br/>G+10, floor heights, riser"] --> B2["2. Quick create panels<br/>MDB → SMDB per floor → DBs"]
    B2 --> B3["3. Emergency<br/>EMDB + ATS + generator"]
    B3 --> B4["4. Loads<br/>from room schedule / typical floor"]
    B4 --> B5["5. Repeat typical floor<br/>L1 → L2…L10"]
    B5 --> B6["6. Run all calculations"]
    B6 --> C{"Any failures?"}
    C -->|"Yes"| F["7. Fix<br/>upsize cable / breaker"]
    F --> B6
    C -->|"No"| B8["8. Naming check<br/>and renumber"]
    B8 --> B9["9. Engineer review"]
    B9 --> B10["10. Export reports"]
```

Each box is **one or a few tool calls**, not thousands of clicks. That is what keeps it fast and cheap.

---

## 3. The tool list (about 15–20 tools)

| Group | Tools | Uses what already exists |
|---|---|---|
| Read | `get_project_summary`, `list_panels`, `get_panel` | Project JSON |
| Build | `set_building`, `quick_create_panels`, `add_emergency`, `repeat_branch` | Quick create, emergency plan, branch copy |
| Loads | `import_load_schedule`, `generate_dbs_from_rooms`, `set_loads` | Schedule import, room DB generator |
| Edit | `set_level`, `set_fed_from`, `rename_panels` | Panel list, Naming tab |
| Check | `run_calculations`, `list_failures` | Calc engine (returns *short* summary) |
| Fix | `size_feeder`, `fix_failing_circuits` | Auto-sizing |
| Finish | `size_enclosures`, `export_reports` *(needs approval)* | Enclosure sizing, report export |

---

## 4. Safety rules

```mermaid
flowchart LR
    T["AI asks to<br/>run a tool"] --> V{"Valid input?"}
    V -->|No| N["❌ Rejected,<br/>reason sent back"]
    V -->|Yes| P["Preview<br/>(same checks as UI)"]
    P --> U["Apply as<br/>ONE undo step"]
    U --> L["📝 Logged in<br/>project history"]
    L --> Q{"Export or<br/>delete?"}
    Q -->|Yes| H["👷 Engineer<br/>must approve"]
    Q -->|No| D["Done"]
```

1. Every change goes through the **same checks** the screens use.
2. Every change is **one undo step** — the engineer can roll back anything.
3. **No export, delete or overwrite** without engineer approval.
4. Agent actions are **logged** so the engineer can see what it did.

---

## 5. Approximate cost — complete G+10 design

Assumed: ~200 panels, ~2,000 circuits, prompt caching on.

| How the agent works | Tool calls | Claude Opus 5.5 | Claude Sonnet 5.5 | Local LLM |
|---|---|---|---|---|
| **A. High-level tools (this proposal)** | ~150 | **≈ $8–10** | **≈ $4–5** | $0 (slower, less reliable) |
| B. One circuit at a time | ~3,000 | ≈ $100–150 | ≈ $50–75 | not practical |
| C. Clicking the screen | thousands | $200+ | $100+ | not practical |

```mermaid
flowchart LR
    X["Same G+10 design"] --> A["High-level tools<br/>≈ $5–10"]
    X --> B["Per-circuit tools<br/>≈ $50–150"]
    X --> C["Screen clicking<br/>$100+"]
```

These are planning estimates. The real figure will be **measured** on a test project once the tools exist.

---

## 6. Build stages

```mermaid
flowchart LR
    S1["Stage 1<br/>Read + Check tools<br/>(safe, read-only)"] --> S2["Stage 2<br/>Build + Edit tools<br/>with undo"]
    S2 --> S3["Stage 3<br/>Fix + Export<br/>with approval"]
    S3 --> S4["Stage 4<br/>Measure real<br/>token cost on G+10"]
```

| Stage | Result for the engineer |
|---|---|
| 1 | Ask the AI: *"What's failing on L3?"* — it reads, never changes. |
| 2 | *"Create G+10 with one SMDB per floor and 4 DBs each."* |
| 3 | *"Fix all voltage-drop failures and prepare reports."* — waits for your OK. |
| 4 | A real cost figure (tokens + $) for a G+10 test project. |

**No paid services needed in the app itself** — the user brings their own Claude key, or runs a free local model.
