# LV Design Studio — UI Refinement Brief

## Objective

Update the LV Design Studio interface so it feels like polished, production-grade electrical engineering software. Improve spacing, alignment, typography, component consistency, readability, and responsive behavior without changing calculation logic or established workflows.

The interface should remain information-dense, but it must be easy to scan during long technical work sessions.

## Primary files

- `src/styles.css` — shared visual system and component styling
- `src/App.tsx` — application shell, header, ribbon, workspace, sidebars, and status areas
- `src/components/ui.tsx` — common page and status components
- `src/components/ProjectsDashboard.tsx` — project landing page
- `src/components/Ribbon.tsx` — primary application commands
- `src/components/PanelTree.tsx` — project navigation tree
- Other files under `src/components/` when a component needs local markup or accessibility improvements

## Existing visual direction

Preserve the current dark engineering-workstation appearance and blue accent color. Do not redesign the product into a marketing dashboard or increase whitespace so much that technical tables become inefficient.

The shared stylesheet already contains initial design tokens:

```css
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 24px;
--control-h: 32px;
--radius-sm: 6px;
--radius-md: 9px;
--radius-lg: 12px;
```

Use these tokens wherever practical instead of introducing arbitrary values.

## Spacing rules

Use a consistent four-pixel base grid:

- 4px: icon-to-label spacing and very small internal separation
- 8px: related controls and compact table actions
- 12px: normal component gaps
- 16px: card padding and page gutters
- 24px: separation between major page sections

Requirements:

- Use the same horizontal page gutter for page titles and page content.
- Keep labels visually attached to their related inputs.
- Separate unrelated control groups using spacing or a divider.
- Avoid stacked margins that produce inconsistent vertical gaps.
- Keep dense data grids compact; do not apply large card spacing to spreadsheet-like tables.

## Alignment rules

- Align toolbar controls vertically and use a consistent 32px control height.
- Align page titles with the left edge of the content below them.
- Keep primary actions on the right side of page headers where space allows.
- Right-align numeric values in data tables where appropriate.
- Left-align descriptive text, equipment names, project names, and remarks.
- Center only short status indicators, icons, and explicitly tabular values.
- Align icons and labels using `inline-flex` and a consistent gap.
- Prevent action columns from wrapping.
- Preserve tabular numerals for engineering values.

## Typography hierarchy

Use the following hierarchy consistently:

- Application brand: 15px, bold
- Page title: 18px, semibold or bold
- Section/card title: 13px, semibold
- Body and controls: 13px
- Supporting text: 12px
- Table headers and metadata labels: 11px, semibold, restrained uppercase

Additional requirements:

- Use sentence case for buttons, tabs, page titles, and descriptions.
- Use uppercase only for short technical labels or table headers.
- Keep units attached to their values, such as `125 A`, `4.2 kA`, and `16 mm²`.
- Use consistent engineering terminology: `Pass`, `Check`, `Fail`, `Warning`, and `Out of date`.
- Replace vague action labels with clear verbs where context is not obvious.
- Keep helper text concise and explain the result of an action rather than implementation details.

## Components

### Buttons

- Primary buttons: filled accent background and strong contrast.
- Secondary buttons: subtle panel background with visible border.
- Destructive buttons: red border/text unless the destructive action is the dialog's confirmed primary action.
- Icon-only buttons must have an accessible name through `title` or `aria-label`.
- Disabled controls must remain readable while clearly inactive.

### Forms

- Use consistent input, select, and textarea height, padding, border, and focus treatment.
- Labels must remain visible; placeholders must not be the only label.
- Place validation messages immediately below the affected field.
- Ensure focus indicators are visible on the dark background.
- Keep units adjacent to numeric inputs.

### Cards

- Use cards for summaries and grouped information, not as wrappers for every element.
- Use consistent 16px internal padding and 12px gaps.
- Keep title, value, supporting text, and action alignment consistent between cards.
- Avoid excessive shadows; borders should provide most grouping.

### Tables and engineering grids

- Preserve dense spreadsheet behavior and sticky headers.
- Use consistent header height and row height.
- Use subtle row separators and a restrained hover state.
- Keep editable cells visually distinguishable without making the whole table noisy.
- Do not uppercase user-entered content.
- Ensure warning and failure states do not rely on color alone when practical.

### Ribbon and navigation tree

- Keep ribbon groups visually distinct with separators and captions.
- Align ribbon icons and labels consistently.
- Keep selected tabs and active pages easy to identify.
- Use a minimum 30px row height in the panel tree.
- Maintain clear indentation and selection states for board hierarchy.

### Dialogs

- Use consistent 24px padding and 12px internal gaps.
- Keep dialog titles visually distinct.
- Place actions at the bottom, with the primary action last/right where appropriate.
- Ensure long dialogs remain scrollable within the viewport.

## Responsive behavior

- The application must remain usable at narrower desktop widths.
- Toolbars may wrap, but controls must not overlap.
- Tables and diagrams may scroll horizontally rather than compressing into unreadable layouts.
- At small widths, page gutters may reduce from 16px to 12px.
- Project action cards should collapse to a single column on narrow screens.
- Do not hide critical engineering values solely to make a layout fit.

## Accessibility

- Preserve keyboard navigation and visible `:focus-visible` states.
- Maintain readable contrast for primary and secondary text.
- Do not communicate pass, warning, or failure using color alone when labels or icons can be included.
- Keep interactive target sizes at least approximately 30–32px for desktop controls.
- Respect semantic elements and existing ARIA roles.

## Implementation constraints

- Do not change electrical calculations, project data structures, persistence, exports, or document-generation logic.
- Do not remove features or technical information.
- Do not add a new UI framework or component dependency.
- Reuse existing CSS variables and React components.
- Avoid one-off inline styles when a reusable class is appropriate.
- Keep changes focused and reviewable.

## Recommended process

1. Inspect the current Git diff before editing; preserve existing UI-refinement work.
2. Review the project dashboard, design workspace, ribbon, panel tree, right sidebar, one study page, one large schedule, and one dialog.
3. Identify repeated spacing, alignment, typography, and control patterns.
4. Consolidate those patterns in `src/styles.css`.
5. Change component markup only where CSS alone cannot provide correct structure or accessibility.
6. Run formatting and static checks.
7. Launch the app and visually inspect common screens at wide and narrow desktop sizes.
8. Fix overflow, wrapping, clipping, and inconsistent alignment found during visual review.

## Acceptance criteria

- Page headers, content, cards, and tables share consistent left alignment.
- Controls within the same toolbar have consistent height and vertical alignment.
- The 4/8/12/16/24px spacing scale is used throughout shared components.
- Page titles and section titles have a clear, consistent hierarchy.
- Secondary text is readable but visually subordinate.
- Primary, secondary, destructive, disabled, hover, selected, and focus states are consistent.
- Project cards, summary cards, ribbon commands, tree rows, dialogs, and tables look like one product family.
- Technical tables remain dense and readable.
- No workflow or calculation behavior changes.
- No unintended horizontal page overflow outside components designed to scroll.
- `git diff --check`, type checking, tests, and production build pass when dependencies are installed.

## Validation commands

```bash
git diff --check
npm run typecheck
npm test
npm run build
```

For visual validation, run:

```bash
npm run dev
```

Inspect at minimum:

- Projects dashboard
- System diagram workspace
- Board and feeder side panels
- Load schedule or DB schedule
- One calculations/study page
- Preferences or project-details dialog
- Approximately 1440px, 1024px, and 700px viewport widths

## Deliverable

Provide a concise summary of:

- Files changed
- Shared design-system improvements made
- Component-specific fixes
- Validation completed
- Any remaining visual or technical limitations
