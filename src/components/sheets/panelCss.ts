/** The look of the Sheets page's side panels (Link columns, My formats): tokens only, class prefix shl-. */

export const PANEL_CSS = `
.shl { box-sizing: border-box; flex: none; width: 340px; max-height: 62vh; overflow: auto; border: 1px solid var(--line); border-radius: 9px; background: var(--panel); padding: 12px; font-size: 12.5px; color: var(--tx); display: flex; flex-direction: column; gap: 8px; }
.shl-head { display: flex; align-items: center; justify-content: space-between; }
.shl h4 { margin: 0; font-size: 14px; }
.shl h5 { margin: 6px 0 0; font-size: 12px; color: var(--mut); }
.shl p { margin: 0; }
.shl-mut { color: var(--mut); }
.shl-row { display: flex; align-items: center; gap: 6px; }
.shl-row > span:first-child { flex: none; width: 110px; color: var(--mut); }
.shl select, .shl input { box-sizing: border-box; min-width: 0; height: 30px; padding: 0 8px; border-radius: 6px; border: 1px solid var(--line); background: var(--p2); color: var(--tx); font: inherit; font-size: 12.5px; }
.shl-row select { flex: 1; }
.shl input[type="number"] { width: 70px; }
.shl-btn { box-sizing: border-box; height: 30px; padding: 0 10px; border-radius: 6px; border: 1px solid var(--line); background: var(--p2); color: var(--tx); font: inherit; font-size: 12.5px; text-align: left; cursor: pointer; }
.shl-btn.shl-go { background: var(--acc); color: var(--on-acc); border-color: var(--acc); }
.shl-btn:disabled { opacity: 0.45; cursor: default; }
.shl-x { flex: none; width: 30px; padding: 0; text-align: center; }
.shl-line { display: grid; grid-template-columns: 34px 62px 1fr 30px; align-items: center; gap: 6px; }
.shl-cols .shl-line { grid-template-columns: 22px 78px 1fr; }
.shl-cap { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--mut); }
.shl-own { color: var(--res-pf); }
.shl-needs { border: 1px solid var(--line); border-radius: 6px; padding: 8px; display: flex; flex-direction: column; gap: 4px; }
.shl-need { display: flex; align-items: center; gap: 6px; }
.shl-note { font-size: 12px; color: var(--mut); }
`;
