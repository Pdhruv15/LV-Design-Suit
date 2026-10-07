# Electrical Design Report Enhancement

## Master Implementation Plan — 5 Phases

> [!IMPORTANT]  
> This document is the **source of truth** for enhancing the Electrical Design Report module.
> 
> Claude must:
> 
> - Read this entire document before starting.
>     
> - Inspect the existing project architecture and current Design Report implementation.
>     
> - Work **one phase at a time**.
>     
> - Do NOT start the next phase automatically.
>     
> - After completing each phase, test the implementation and provide a completion report.
>     
> - Wait for user approval before proceeding to the next phase.
>     
> - Preserve all working calculation logic unless a change is specifically required.
>     
> - Reuse existing components wherever practical.
>     
> - Keep the **engineering calculation engine** separate from the **report-generation engine**.
>     
> - Never invent missing engineering values.
>     
> - Clearly flag unavailable or incomplete data.
>     

---

# Overall Objective

Enhance the existing Electrical Design Report into a professional engineering document suitable for:

- Internal engineering review
    
- Consultant submission
    
- Client submission
    
- Authority submission
    
- Calculation documentation
    
- PDF/print export
    

The final report should follow this general structure:

```
Cover Page
    ↓
Document Control
    ↓
Table of Contents
    ↓
Executive Summary
    ↓
Project Scope
    ↓
System Description
    ↓
Codes & Standards
    ↓
Design Criteria
    ↓
Load Assessment
    ↓
Equipment Sizing
    ↓
Cable Sizing
    ↓
Voltage Drop
    ↓
Short Circuit
    ↓
Protection
    ↓
Earthing
    ↓
Other Design Studies
    ↓
Results Summary
    ↓
Compliance Summary
    ↓
Conclusions
    ↓
Appendices
```

---

# Core Architecture Principle

The system should maintain separation between:

```
PROJECT DATA
     ↓
CALCULATION ENGINE
     ↓
CALCULATION RESULTS
     ↓
REPORT DATA / VIEW MODEL
     ↓
REPORT COMPONENTS
     ↓
REPORT GENERATOR
     ↓
PREVIEW / PDF / PRINT
```

Do not place engineering calculation formulas directly inside presentation/report components.

---

# PHASE 1 — Report Foundation & Document Structure

## Objective

Create the professional foundation and overall hierarchy of the Design Report.

## Scope

Implement:

### 1. Cover Page

Include available information such as:

- Project name
    
- Project number
    
- Client
    
- Consultant
    
- Contractor
    
- Report title
    
- Document number
    
- Revision
    
- Date
    
- Prepared by
    
- Checked by
    
- Approved by
    

Use placeholders or clearly indicate missing information.

Never invent project information.

### 2. Document Control

Create:

- Document information
    
- Revision history
    
- Prepared/Checked/Approved information
    
- Issue status
    

### 3. Table of Contents

Provide a structure capable of supporting automatic section numbering.

Example:

```
1. Executive Summary
2. Project Scope
3. System Description
4. Codes and Standards
5. Design Criteria
6. Load Assessment
7. Transformer Sizing
...
```

### 4. Header & Footer

Provide consistent:

- Project name
    
- Document title
    
- Document number
    
- Revision
    
- Page number
    

### 5. Report Typography

Standardize:

- H1
    
- H2
    
- H3
    
- Body text
    
- Table headings
    
- Notes
    
- Engineering warnings
    
- Captions
    

### 6. Layout

Ensure:

- Consistent margins
    
- Proper spacing
    
- Controlled page breaks
    
- Print-friendly tables
    
- Professional engineering-document appearance
    

## Phase 1 Restrictions

Do NOT:

- Modify engineering calculations.
    
- Build new calculation methods.
    
- Change existing electrical results.
    
- Implement Phase 2 functionality.
    

## Phase 1 Completion Requirements

Claude must report:

- Files inspected
    
- Files created
    
- Files modified
    
- Components created
    
- Architecture decisions
    
- Tests performed
    
- Existing functionality affected
    
- Known issues
    
- Recommendations before Phase 2
    

STOP after Phase 1.

Wait for approval.

---

# PHASE 2 — Executive Summary & Design Basis

## Objective

Make the beginning of the report understandable without requiring the reviewer to inspect detailed calculations.

## Sections

### Executive Summary

Where available, summarize:

- Connected load
    
- Maximum demand
    
- Demand/diversity
    
- Transformer requirement
    
- Generator requirement
    
- Main LV distribution arrangement
    
- Major design findings
    

### Project Scope

Explain:

- Electrical systems included
    
- Electrical systems excluded
    
- Design boundaries
    

### Electrical System Description

Include:

- Incoming supply
    
- MV/LV arrangement
    
- Transformer arrangement
    
- Main LV distribution
    
- Emergency supply
    
- UPS where applicable
    

### Codes & Standards

Provide project-defined standards such as applicable:

- Local authority requirements
    
- IEC
    
- BS
    
- NFPA
    
- Other project specifications
    

Do not automatically assume standards that are not configured for the project.

### Design Criteria

Create a structured Design Criteria table.

Possible parameters:

|Parameter|Design Value|Source|
|---|---|---|
|System Voltage|Project Data|Project Settings|
|Frequency|Project Data|Project Settings|
|Power Factor|Project Data|Design Criteria|
|Voltage Drop Limit|Project Data|Design Criteria|
|Ambient Temperature|Project Data|Project Settings|
|Diversity Factor|Calculation Data|Load Assessment|

Values must come from existing project data where available.

## Phase 2 Restrictions

Do not invent unavailable criteria.

Use:

`Not Defined`

or an equivalent warning.

STOP after completing and testing Phase 2.

Wait for approval.

---

# PHASE 3 — Engineering Calculation Report Sections

## Objective

Standardize how engineering calculations appear throughout the report.

Every calculation module should preferably follow:

```
INPUT
  ↓
DESIGN CRITERIA
  ↓
CALCULATION / METHOD
  ↓
CALCULATED RESULT
  ↓
EQUIPMENT SELECTION
  ↓
VERIFICATION
  ↓
PASS / WARNING / FAIL
```

## Main Sections

Implement report support for existing calculation modules such as:

### Load Assessment

Show:

- Connected load
    
- Diversity
    
- Demand load
    
- Maximum demand
    
- Spare/future allowance
    
- Final design load
    

### Transformer Sizing

Show:

- Calculated demand
    
- Required capacity
    
- Selected capacity
    
- Loading percentage
    
- Spare capacity
    

### Generator Sizing

Where available:

- Emergency loads
    
- Generator demand
    
- Selected rating
    
- Loading
    
- Spare capacity
    

### LV Distribution

Show:

- MDB
    
- SMDB
    
- DB
    
- Major feeders
    
- Bus ratings
    

### Cable Sizing

Standard output example:

```
Feeder: MDB → SMDB-01

Design Current       : 285 A
Protective Device    : 320 A
Selected Cable       : 4C × 185 mm² Cu XLPE
Derated Capacity     : 347 A
Voltage Drop         : 1.72 %
Short-Circuit Check  : PASS

Overall Status       : PASS
```

### Voltage Drop

Show:

- Circuit
    
- Calculated voltage drop
    
- Allowable limit
    
- Margin
    
- Status
    

### Short Circuit

Show:

- Location
    
- Calculated fault current
    
- Equipment breaking capacity
    
- Margin
    
- Status
    

### Protection

Where supported:

- Protective device
    
- Rating
    
- Trip characteristics/settings
    
- Protection verification
    
- Coordination/selectivity information
    

### Earthing

Where supported:

- Earthing arrangement
    
- Earth conductor sizing
    
- Fault current
    
- Disconnection requirements
    
- Result
    

## Important

Detailed calculations should not overwhelm the main report.

Keep the main report focused on:

**Requirement → Result → Selection → Verification**

Move lengthy calculation details to appendices where appropriate.

STOP after Phase 3.

Wait for approval.

---

# PHASE 4 — Results, Compliance & Visual Presentation

## Objective

Create a professional engineering review layer.

The reviewer should be able to determine the overall design status quickly.

## Equipment Summary

Create summary tables for applicable equipment:

- Transformers
    
- Generators
    
- MDB
    
- SMDB
    
- Major DBs
    
- Major feeders
    
- UPS
    
- Capacitor banks
    

## Load Summary

Provide:

- Connected load
    
- Maximum demand
    
- Transformer loading
    
- Generator loading
    
- Spare capacity
    

## Cable Summary

Include:

- From
    
- To
    
- Load
    
- Current
    
- Cable
    
- Protective device
    
- Voltage drop
    
- Status
    

## Compliance Summary

Create a master table similar to:

|Design Check|Calculated|Requirement / Selected|Margin|Status|
|---|---|---|---|---|
|Transformer Loading|1420 kVA|1600 kVA|180 kVA|PASS|
|Fault Level|38.5 kA|50 kA|11.5 kA|PASS|
|Voltage Drop|2.8%|4.0%|1.2%|PASS|
|Cable Capacity|365 A|415 A|50 A|PASS|

## Status System

Standardize:

- PASS
    
- WARNING
    
- FAIL
    
- NOT CHECKED
    
- DATA REQUIRED
    

The same status terminology should be used throughout the application and report.

## Visuals

Use charts only where they provide engineering value.

Possible examples:

- Connected Load vs Maximum Demand
    
- Transformer Capacity vs Demand
    
- System loading
    
- Distribution of load categories
    

Avoid decorative charts.

STOP after Phase 4.

Wait for approval.

---

# PHASE 5 — Final Report Generator, Export & QA

## Objective

Integrate all completed phases into the final Design Report Generator.

## Report Configuration

Allow users to enable/disable applicable sections.

Possible report types:

### Full Design Report

Complete engineering report.

### Calculation Report

Detailed calculations.

### Load Assessment Report

Load-focused report.

### Cable Sizing Report

Cable calculations and results.

### Short-Circuit Report

Fault-level calculations.

### Authority Submission Report

Concise submission-oriented output.

## Report Preview

Provide a preview before final export.

Users should be able to verify:

- Sections
    
- Tables
    
- Results
    
- Project information
    
- Revision
    
- Warnings
    

## Automatic Numbering

Support:

```
1.
1.1
1.1.1
```

Also support:

- Table numbering
    
- Figure numbering
    
- Appendix numbering
    

## Appendices

Possible appendices:

```
Appendix A — Detailed Load Schedule
Appendix B — Cable Calculations
Appendix C — Short-Circuit Calculations
Appendix D — Equipment Data
Appendix E — Single Line Diagram
Appendix F — Reference Documents
```

Only include applicable appendices.

## PDF / Print

Verify:

- Page size
    
- Margins
    
- Header/footer
    
- Page numbering
    
- Page breaks
    
- Tables across pages
    
- Long table handling
    
- Landscape pages where necessary
    
- Print readability
    

## Pre-Export Validation

Before generating the final report, check:

- Missing project data
    
- Missing design criteria
    
- Calculation errors
    
- Failed calculations
    
- Warning conditions
    
- Undefined equipment
    
- Inconsistent units
    
- Invalid results
    
- Empty report sections
    
- Broken tables
    
- Missing references
    

Do not silently hide errors.

Present them to the user.

---

# Final Acceptance Criteria

The Design Report should ultimately be:

- Professional
    
- Consistent
    
- Traceable
    
- Easy to review
    
- Engineering-focused
    
- Suitable for PDF
    
- Suitable for consultant review
    
- Suitable for authority submission where project requirements permit
    
- Modular
    
- Maintainable
    
- Expandable for future electrical modules
    

Future modules should be able to connect to the report system without redesigning the entire report architecture.

---

# Claude Working Protocol

Claude must follow this procedure for EVERY phase.

## Step 1 — Read

Read:

1. This Obsidian specification.
    
2. Existing project architecture.
    
3. Existing Design Report implementation.
    
4. Relevant calculation modules.
    
5. Existing shared UI/report components.
    

## Step 2 — Analyze

Before modifying code, report:

```
PHASE:
Current implementation:
Relevant files:
Reusable components:
Problems identified:
Proposed changes:
Files expected to change:
Risks:
```

## Step 3 — Implement

Implement **only the current approved phase**.

Do not perform unrelated refactoring.

Do not automatically start future phases.

## Step 4 — Verify

Check:

- Build
    
- Existing functionality
    
- Report rendering
    
- Data mapping
    
- Missing data
    
- Edge cases
    
- Print/PDF behavior where applicable
    

## Step 5 — Completion Report

Return:

```
PHASE COMPLETION REPORT

Phase:
Status:

Files Created:
-

Files Modified:
-

Features Completed:
-

Tests Performed:
-

Issues Found:
-

Remaining Issues:
-

Technical Debt:
-

Recommended Next Step:
-
```

## Step 6 — STOP

At the end say:

**Phase X is complete and ready for review. I will not start Phase X+1 until you approve it.**

---

# Critical Development Rules

> [!CAUTION]  
> These rules apply to all five phases.

1. Do not change verified electrical formulas merely to improve the report.
    
2. Do not duplicate calculation logic inside report components.
    
3. Do not invent missing electrical/project data.
    
4. Reuse existing calculation outputs.
    
5. Keep calculation, data transformation and presentation layers separated.
    
6. Preserve backward compatibility wherever practical.
    
7. Use reusable report components.
    
8. Maintain consistent engineering units.
    
9. Keep calculation precision separate from display precision where appropriate.
    
10. Every PASS/FAIL result must be traceable to a calculation or defined design criterion.
    
11. Missing data must never automatically become zero unless zero is technically the correct value.
    
12. Report-generation failure must not corrupt project calculation data.
    
13. Keep future MV/LV expansion in mind.
    
14. Do not start another phase without explicit approval.
    

---

# Current Progress

- Phase 1 — Report Foundation
    
- Phase 2 — Executive Summary & Design Basis
    
- Phase 3 — Engineering Calculations
    
- Phase 4 — Results & Compliance
    
- Phase 5 — Report Generator & QA
    

## Current Approved Phase

**Phase 1**