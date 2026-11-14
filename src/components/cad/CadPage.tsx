import { useEffect, useMemo, useRef, useState } from 'react';
import CadCanvas, { type CadHover, type CadMarks, type CadToggles, type CanvasDevice, type CanvasWiring } from './CadCanvas';
import { NO_ACTIONS, rememberedDrawing, SAMPLE_PLANS, type CadRibbonInfo, type CadState, type CadTool } from './cadState';
import { cadCommand, type CadAction } from './cadCommands';
import { getClip, hasClip, putClip } from './cadClipboardStore';
import { hasPreviousView } from './cadViewHistory';
import { QuickSelectDialog } from './CadQuickSelect';
import { CadStatusToggles } from './CadStatusToggles';
import { CadFilePaper } from './CadFilePaper';
import { fileLayoutId, fileLayoutOf, fileLayoutTitle, paperOf } from '../../model/fileLayouts';
import { arrangeDrawingViewports, asFileLayout, drawingLayoutId, drawingLayoutOf, drawingLayoutsOf, fitDrawingViewports, newDrawingLayout, nextLayoutName, paperName, viewportScaleN, withDrawingLayouts, withPaper } from '../../model/drawingLayouts';
import type { ZoomReq } from './CadCanvas';
import type { ZoomMenuKey } from '../drawingView';
import { parseZoomScale } from '../../model/cadView';
import { selectSimilar, type SimilarOpts } from '../../model/cadQuickSelect';
import { endTowards, linesCross, nearestPiece, nearestSegment, onRound, roundOfSegments } from '../../model/cadDims';
import { clipPayload, clipText, lowerLeft, parseClip, pastedItems, withPasted, type ClipPayload } from '../../model/cadClipboard';
import CadCommandLine, { CadPromptMenu } from './CadCommandLine';
import { addSelectedTool, blankMenu, commandMenu, countLine, measureOf, shownBy, SNAP_OVERRIDES, type CtxEntry, type CtxItem, type ObjectHide } from './cadContextMenu';
import { closeRefEdit, refEditOf, startRefEdit, workingSet } from '../../model/cadRefEdit';
import { blockEditorChanged, blockEditorOf, closeBlockEditor, openBlockEditor, saveBlockEditor } from '../../model/cadBlockEditor';
import { closedToggled, findCount, findReplace, gripMenu, withVertexAdded, withVertexRemoved } from './cadDrawnMenus';
import { argOf, drawingObjectMenu, drawingPaperMenu, paperMenu, viewportMenu, xrefMenu } from './cadSheetMenus';
import { deviceMenu, devArg, devicesInRoom, luxCheckLine, roomEntry, roomLoads, trayCheckLine, type CadShow, type DeviceMore } from './cadObjectMenus';
import { isNumber, promptOptions, shortPrompt, spaceEnters, type SpaceMode } from './cadPrompt';
import CadDynInput, { type DynBox } from './CadDynInput';
import CadTextEdit from './CadTextEdit';
import CadNoteEdit from './CadNoteEdit';
import { above, sameOrder, textToFront, toBack, toFront, under, type TextKind } from '../../model/cadDrawOrder';
import { canDivide, pointsAlong, pointsEvery, pointShapeLabel, pointStyleOf } from '../../model/cadPoints';
import { askedAttdefs, attdefsOf, blockable, blockDefOf, blockDefsOf, blockNameError, defineBlock, expandInsert, explodeInsert, withBlockDef, type CadBlockDef } from '../../model/cadBlocks';
import { ATTRIBUTE_HEAD, attributeRows, attributesCsv, cleanTag } from '../../model/cadAttributes';
import { blockNameFromFile, defFromGeometry, defFromPieces, loadRecentBlocks, pushRecentBlock } from '../../model/cadBlockLibrary';
import BlocksPalette, { INSERT_DEFAULTS, type InsertSettings, type LibraryFile } from './BlocksPalette';
import { attachLabel, attachOf, noteAttached, noteBox, noteWithWidth, parseAttach, plainText, type NoteAttach, type NotePara } from '../../model/cadMtext';
import { ATT_DRAFT, AttDefDialog, AttEditDialog, AttPromptDialog, BlockDialog, DIALOG_TOOLS, DimStyleDialog, EditDialog, PointStyleDialog, TextStyleDialog, type AttDraft, type BlockDraft } from './CadDialogs';
import { currentDimStyle, currentTextStyle, dimLookOf, dimStandardAsBefore, dimStylesOf, dimStylesToStore, fullDimStyle, lookOf, textStylesOf, textStylesToStore } from '../../model/cadStyles';
import { chooseDrawing, drawingWithDevices, explodeObjects, openDrawing, readRefGeometry, reopenDrawing, sampleDrawing, type CadObject, type CadView } from '../../engines/cad/cadEngine';
import { newDrawingDxf, newDrawingName } from '../../model/cadNewDrawing';
import { boundaryOfPiece, cropItems, cropNote, cropPieces, hatchLookup, type CropBoundary, type CropSide } from '../../model/cadCrop';
import { builtInAsCustom, formatPat, parsePat, specWith, withPatterns, type CustomPattern } from '../../model/cadHatch';
import { circlePts, isAssociative, lostAssociation } from '../../model/cadHatchAssoc';
import { keepComputerPatterns, loadComputerPatterns } from '../../model/cadPatternStore';
import { erasedOf, restoredErased, shownView, withErased, type ErasedParts } from '../../model/cadErased';
import { CIRCUIT_ATTRIBUTES } from '../../model/cadLoads';
import { cableLabel, cablesOf, circuitLabel, finalCircuits, LV_PALETTE, moveItem, placedOn, placeItem, placeLvPoint, removeItem, type PaletteItem, type PlacedItem } from '../../model/cadDevices';
import { addSketch, withSketchItems, pointStyleOut, blockDefsOut, arcStartCentreEnd, arcThrough, circle2P, circleThrough, dimLabel, dimMeasure, dimOf, linearDir, nextDim, ellipseOf, polygonPts, itemAt, moved, rectangle, removeSketch, rotated, segmentsOf, shapesOut, sketchOf, snapPoints, trayLength, TRAY_LAYER, TRAY_SERVICES, TRAY_WIDTHS, typedPoint, updateSketch, withText } from '../../model/cadSketch';
import { routeSettings, sizeRoute, trayPlanOf } from '../../calc/cableTray';
import { fittingCounts, trayFittings, type TrayFitting } from '../../model/cadTrayFittings';
import type { SketchItem } from '../../types';
import { ELV_PALETTE, elvPlacedOn, elvSystemOf, moveElv, placeElv, removeElv } from '../../components/elv/elvCadDevices';
import { copyTo, coverageNote, elvLayer, fillAt, rotate as rotateElv, SYSTEM_LABEL } from '../../components/elv/elvPlan';
import { saveBinary, saveBinaryAt, savePdf, saveText } from '../../util/files';
import { angleDeg, areaOf, distance, inside, m, m2, roomAround, segmentsOn } from '../../model/cadMeasure';
import { layerMapFor, layersWith, roomsFromPlan, withLayerMap } from '../../model/cadRooms';
import { layerStatsOf, objectPath, outlinePoints, planOfView } from '../../model/cadViewPlan';
import { planDrawings, scheduleSummary, updateSchedules } from '../../model/cadPlanSchedules';
import { arcPoints, isWired, levelWiring, toggleWiring, wireBoard, wireLevel, type WiringArc } from '../../model/cadWiring';
import { buildingInfoOf, roomTypesOf } from '../../calc/building';
import { plansOf } from '../../model/cadPlans';
import type { PlanTarget } from '../../model/planTarget';
import { CAD_UNITS, planScale } from '../../model/cadUnits';
import CadLayerTable from '../CadLayerTable';
import CadTabs from './CadTabs';
import RoomLightingPanel, { lightingOf, LUX_START, type LuxSettings } from './RoomLightingPanel';
import { placeRoomLights } from '../../model/roomLights';
import EmergencyPanel, { EM_PROMPT, EM_START, emFitting, type EmSettings } from './EmergencyPanel';
import { EMPHASIS_LABEL, emergencyLayout, OPEN_AREA_M2, type EmphasisKind } from '../../calc/emergencyLighting';
import { placeEmergency } from '../../model/emergencyPlace';
import { EMERGENCY_ITEMS } from '../../model/cadDevices';
import { planLevel, setPlanLevel } from './cadFileMenu';
import { pathOfPlan, type CadExport, type DraftTab, type SavedCopy } from './cadState';
import CadDraftSettings from './CadDraftSettings';
import CadSaveAs, { CloseUnsaved } from './CadSaveAs';
import { cadFileMenu } from './cadFileMenu';
import { cursorModeOf, DRAFT_DEFAULTS, OSNAP_BITS, pickRadiusPx, type DraftSettings, type OsnapMode } from '../../model/cadDraft';
import { CABLE_HEAD, cableRows, DEVICE_HEAD, deviceRows } from '../../model/cadExports';
import { toDxf } from '../../docs/dxf';
import { changeViewports, layoutOverlay, layoutsOf, LayoutTabs, moveLayout, newLayout, patchViewport, TablePanel, ViewportPanel, vpId, type DrawingTab } from './CadLayouts';
import { patchTable, TABLE_WIDTH, tableId, tableName, tablesOf, withTables, type TableKind } from '../../model/sheetTables';
import { layoutExtent, layoutPaper, layoutRegion, layoutViewports, PLAN_LABEL, PLAN_TYPES, planLegendLabels, planScale as sheetScale } from '../../docs/planLayout';
import { drawingLayoutFromTemplate, sheetWithTemplate, templateFromPaper, templateFromSheet } from '../../model/layoutTemplates';
import { LayoutPaperDialog, LayoutTemplatesDialog, ScaleListDialog } from './CadLayoutDialogs';
import { alignView, arrangementOf, arrangeViewports, copyViewport, fitView, isFrozen, isLocked, scalesOf, toggleFrozen, vpName, vpToModel, vpWindow, withScales, type PlanViewport } from '../../model/planViewports';
import { renumber, setOf, type PlanType } from '../../model/drawingSet';
import { PublishDialog, SheetWorkspace } from '../sld/SheetWorkspace';
import type { MarkupTool } from '../sld/markupTools';
import type { SheetUi } from '../sld/sheetUi';
import type { CalcRun } from '../../calc/runs';
import { exportDrawingSet } from '../docs/sheetRender';
import { pickedRoom, putRooms, renameRoom, setRoomType } from '../../model/floorPlanActions';
import { floorLabel, floorList, type Floor } from '../../model/levels';
import type { CadLayerMap, CadLayerRole, Project } from '../../types';
import { fmtFixed, fmtUpTo } from '../../util/format';
import DeviceToolbar from './DeviceToolbar';
import { AnnoPanel, HatchPanel, type HatchOpts } from './AnnotatePanel';
import { annoOf, centreOf, hatchArea, hatchItem, hatchOutline, hatchOutlinePts, islandsIn, HATCH_START, leaderItems, northArrowItems, roomTagItems, textUnits, unitsPerPaperMm, type HatchSpec } from '../../model/cadAnnotate';
import { alignedTo, alignEdge, cased, centredAt, ISO_TEXT_MM, justLabel, keynoteItems, legendNext, nextKeynote, numberText, oriented, padOf, parseFrame, parseJust, rejustified, spaced, textBox, textWidth, untaggedRooms, withTextHeight, type AlignMode, type CaseMode, type OrientMode } from '../../model/cadText';
import { LayerPalette, layerRows, type LayerRow } from './CadLayerManager';
import { PropertiesPalette } from './CadProperties';
import { isTbFile, LOGO_BOX, logoItems, saveTitleBlockFromCad, TB_FIELDS, TB_LAYERS, tbIdOf } from '../../model/titleBlockCad';
import { LOGO_FIELD } from '../../model/titleBlock';
import { AttachDialog, RefLayersList, RefManager, useCadRefs } from './CadRefs';
import { refGeometry, refNear, type CadRef } from '../../model/cadRefs';
import { drawnLayers, effective, layerStylesOf, LINETYPES, matchedProps, styleOf, withProps, type ObjectProps } from '../../model/cadLayerStyle';
import { colourCss, colourLabel } from '../../model/cadColours';
import { applyLayerPatch, archOnOf, currentLayerOf, extentsOf, isolate, layerFileOf, layersToChange, newLayerName, newPropsOf, renameLayer, restoreState, unisolate, withCurrentLayer, withNewLayer, withNewProps, withoutLayer, withoutState, withSavedState, type LayerPatch } from '../../model/cadLayerState';
import { DrawnSelectionPanel, ED_START, EditToolPanel, kindOf, SketchToolbar, type EditSettings, type EditTool, type SketchEdit } from './SketchEditPanel';
import { arrayPolar, arrayRect, breakAt, chamfer, edgesFor, explode, extend, fillet, gripMoved, gripsOf, isPath, join, mirrored, offset, scaled, sketchInWindow, stretched, throughDistance, trim, type Edit } from '../../model/cadEdit';
import { ArrayPanel, ARL_START, MatchPanel, MATCH_START, SelectionPanel, type ArlSettings, type MatchSettings } from './DeviceEditPanel';
import { alongLine, arranged, circuitAfter, copyDevices, deleteDevices, editsFor, inWindow, matchDevice, moveDevices, onBoard, placeAlong, renameBoard, replaceDevices, replacements, toCircuit, typeOf, type DeviceEdit } from '../../model/deviceEdit';

type Pt = [number, number];
type Result =
  | { kind: 'dist'; a: Pt; b: Pt }
  | { kind: 'area'; points: Pt[]; how: 'corners' | 'object' | 'room' | 'trace'; name?: string }
  | { kind: 'object'; o: CadObject }
  | { kind: 'device'; it: PlacedItem }
  | { kind: 'sketch'; it: SketchItem };

const hex = (rgb: number) => (rgb === 0xff000007 ? 'var(--cad-ink)' : `#${rgb.toString(16).padStart(6, '0')}`);
/** The properties dock's width: default and limits (px), and where its side and width are kept. */
const DOCK_W = 280, DOCK_MIN = 220, DOCK_MAX = 480, DOCK_KEY = 'lvds.cad.dock';
/** Tools whose next point has a length and angle from the last one: the boxes of dynamic input. */
const POINT_TOOLS: CadTool[] = ['line', 'pline', 'tray', 'cable', 'dim', 'dimlin', 'move', 'copy', 'dist', 'area', 'trace', 'leader'];
const HELP = 'Commands: OPEN · CLOSE · CLOSEALL · SAVE (DXF) · SAVEDWG · ROOMS (add found rooms) · RA (click inside a room) · TR (trace a room) · PN (pick its name) · CT (cable tray run) · CR (cable route) · LR (link a line as a cable route) · SCHED (update schedules) · WC (wire circuits) · W1 (wire one) · TAGS · FILL (fill a room with an ELV device) · LUX (light a room by the lumen method) · EM (emergency lighting) · SEL (select devices: Shift-click, or a window) · QS (quick select) · SELECTSIMILAR · ARL (array on line) · MA (match) · ALIGN / ALIGNV / SPACE (the devices selected) · TRIM (TM) · EX (extend) · O (offset) · F (fillet) · CHA (chamfer) · BR (break) · J (join) · X (explode) · B (block from drawn objects: the dialog; -BLOCK on the command line) · I (the Blocks palette: this drawing, Recent, Library; -INSERT by name) · ATT (attribute definition for a block) · ATE (edit a block\'s attributes; or double-click it) · ATTEXT (the attributes as a table) · PO (point) · DIV (points at the divisions of an object) · ME (points every length along it) · PTYPE (point style) · DR (draw order: Front, Back, Above or Under an object) · TEXTTOFRONT (texts, dimensions, leaders over the rest) · MI (mirror) · SC (scale) · S (stretch) · AR (array) · CROP (BCROP, cut a block along an outline) · MP (match properties) · H (hatch) · HE (edit a hatch: pattern, spacing, angle, origin, islands; or double-click it) · BO (boundary: a closed polyline round an area) · LE (leader) · RT (room tag) · NORTH · LM (layer palette) · CLAYER (current layer) · LAYISO / LAYUNISO · RESTOREDWG (erased drawing objects back) · COV (coverage) · L (line) · PL (polyline, C closes) · REC · C (circle) · A (arc, 3 points) · T (text) · MT (notes in a box, lines wrapped to its width) · ED (edit a text or dimension in place, or double-click it) · TJ (justify texts) · TH (text height) · TA (align or space texts) · TC (text case) · TPREFIX / TSUFFIX · TOR (readable text) · TCEN (centre between two points) · TCOPY (words of another text) · TFRAME (circle, box or hexagon round texts) · TMASK (mask under texts) · TCOUNT (numbered texts) · KN (keynote with a legend) · RTALL (tag all rooms) · DIM · DRA (radius) · DDI (diameter) · DAN (angular) · ST (text style) · D (dimension style) · M (move) · CO (copy) · COPYCLIP (Ctrl+C) · COPYBASE (Ctrl+Shift+C) · PASTECLIP (Ctrl+V) · PASTEORIG · RO (rotate) · E (erase) · DI (distance) · AREA (O = object) · RA (room area) · DEV (add device) · M (move) · E (delete) · LI (inspect) · FIT (ZE) · Z (zoom: W window, P previous, S scale) · LA (layers panel) · OSNAP (F3) · GRID (F7) · ORTHO (F8) · SNAP (F9) · POLAR (F10) · OTRACK (F11) · DYN (F12) · LWT · DS (drafting settings) · LEGEND (LG) / NOTES (a legend or notes table on a layout, moved by its frame) · SAVEAS · EXPORT · PUBLISH · F2 history · Esc cancels, Enter or Space ends a step or repeats the last command.';
/** Device symbol size on the plan (radius, metres). */
const DEVICE_R_M = 0.2;
/** Bind's count in the Save line: reference lines, texts and hatches. */
const boundText = (shapes: { kind: string }[]) => {
  const n = (k: string) => shapes.filter((x) => x.kind === k).length, en = (v: number) => v.toLocaleString('en-GB');
  const [l, t, h] = [n('line'), n('text'), n('hatch')];
  return [`${en(l)} reference line${l === 1 ? '' : 's'}`, t ? `${en(t)} text${t === 1 ? '' : 's'}` : '', h ? `${en(h)} hatch${h === 1 ? '' : 'es'}` : ''].filter(Boolean).join(', ');
};
const PROMPT: Record<CadTool, string> = {
  none: 'Click an object to see what it is.',
  dist: 'DI  Specify first point:',
  area: 'AREA  Specify first corner point or [Object]:',
  room: 'ROOM  Click inside a room (its outline comes from the walls):',
  trace: 'TRACE  Specify first corner of the room:',
  name: 'NAME  Click the room name on the drawing:',
  tray: 'TRAY  Specify start point of the tray run:',
  cable: 'ROUTE  Specify start point of the cable route:',
  link: 'LINK  Click a line of the drawing: it becomes the cable route:',
  dev: 'DEV  Specify insertion point:',
  fill: 'FILL  Click inside a room: the ELV device chosen is placed at its coverage spacing:',
  lux: 'LUX  Point at a room to see its lights by the lumen method, click to keep them:',
  em: 'EM  Escape route: click its points from the far end to the exit, Enter to finish:',
  arl: 'ARL  Array on line: click the start of the line:',
  match: 'MA  Match: click the device to copy from:',
  matchprop: 'MATCHPROP  Select the source object:',
  hatch: 'HATCH  Pick an internal point (inside a closed object or a room):',
  hatchedit: 'HATCHEDIT  Select a hatch:',
  boundary: 'BOUNDARY  Pick internal point or [Islands] <Islands on>:',
  leader: 'LEADER  Specify leader arrow point:',
  rtag: 'ROOMTAG  Click inside a room:',
  tjust: 'TJUST  Select texts (click, Shift-click or a window), then Enter:',
  talign: 'TALIGN  Select texts (click, Shift-click or a window), then Enter:',
  tcase: 'TCASE  Select texts, then Enter:',
  tprefix: 'TPREFIX  Select texts, then Enter:',
  tsuffix: 'TSUFFIX  Select texts, then Enter:',
  torient: 'TORIENT  Select texts, then Enter:',
  tcen: 'TCEN  Select the text, then Enter:',
  tcopy: 'TCOPY  Select the texts to change, then Enter:',
  rtall: 'ROOMTAGALL  Tag [All rooms/Untagged only] <Untagged>:',
  tframe: 'TFRAME  Select texts, then Enter:',
  tmask: 'TMASK  Select texts, then Enter:',
  tcount: 'TCOUNT  Prefix <>:',
  keynote: 'KEYNOTE  Number (Enter: the next):',
  th: 'TXTHEIGHT  Select texts and dimensions, then Enter (Enter with none: the height for new text):',
  north: 'NORTH  Specify insertion point:',
  wire: 'WIRE  Click a device: its circuit is wired (or its wiring taken off):',
  move: 'MOVE  Select object, then specify base point:',
  copy: 'COPY  Select object, then specify base point:',
  copybase: 'COPYBASE  Specify base point:',
  paste: 'PASTECLIP  Specify insertion point:',
  zoom: 'ZOOM  [Window/Previous/Scale/Extents] <Window>:',
  zoomwin: 'ZOOM  First corner:',
  zoomscale: 'ZOOM  Scale factor (2, 0.5 or 2x):',
  pan: 'PAN  Drag to pan. Enter or Esc to end:',
  selsim: 'SELECTSIMILAR  Select objects or [Settings]:',
  rotate: 'ROTATE  Select object, then specify base point:',
  mirror: 'MIRROR  Select objects (click them), then Enter:',
  scale: 'SCALE  Select objects (click them), then Enter:',
  stretch: 'STRETCH  Drag a window (right to left) round the points to move:',
  trim: 'TRIM  Click the part to cut away (Shift-click extends):',
  extend: 'EXTEND  Click near the end to lengthen (Shift-click trims):',
  offset: 'OFFSET  Select object to offset or [Exit]:',
  fillet: 'FILLET  Select first object or [Radius/Trim]:',
  chamfer: 'CHAMFER  Select first line or [Distance/Trim]:',
  break: 'BREAK  Select the object where it breaks:',
  join: 'JOIN  Select the lines and polylines to join, then Enter:',
  explode: 'EXPLODE  Select a polyline or rectangle:',
  array: 'ARRAY  Select objects (click them), then Enter:',
  line: 'LINE  Specify first point:',
  pline: 'PLINE  Specify start point:',
  rect: 'RECTANG  Specify first corner point:',
  circle: 'CIRCLE  Specify center point or [2P/3P]:',
  circle2p: 'CIRCLE  Specify first end of the diameter:',
  circle3p: 'CIRCLE  Specify first point on the circle:',
  circled: 'CIRCLE  Specify center point (then the diameter):',
  arcsce: 'ARC  Specify start point (then the centre, then the end, anticlockwise):',
  polygon: 'POLYGON  Specify center (type a number first for the sides), or [Inscribed/Circumscribed]:',
  ellipse: 'ELLIPSE  Specify center, or [Axis end]:',
  revcloud: 'REVCLOUD  Specify first corner, or [Polygonal], or type the arc length:',
  arc: 'ARC  Specify start point:',
  text: 'TEXT  Specify start point of text:',
  mtext: 'MTEXT  First corner:',
  draworder: 'DRAWORDER  Select objects:',
  texttofront: 'TEXTTOFRONT  [Text/Dimensions/Leaders/All] <All>:',
  point: 'POINT  Specify a point:',
  divide: 'DIVIDE  Select object to divide:',
  measure: 'MEASURE  Select object to measure:',
  block: 'BLOCK  Block name:',
  blockpick: 'BLOCK  Specify base point:',
  insert: 'INSERT  Insertion point or [Scale/Rotate]:',
  attedit: 'ATTEDIT  Select a block:',
  attpick: 'ATTDEF  Specify insertion point:',
  dim: 'DIM  Specify first extension line origin:',
  dimlin: 'DIMLINEAR  Specify first extension line origin:',
  dimcont: 'DIMCONTINUE  Specify second extension line origin (from the last dimension):',
  dimbase: 'DIMBASELINE  Specify second extension line origin (from the last dimension):',
  dimrad: 'DIMRADIUS  Select arc or circle:',
  dimdia: 'DIMDIAMETER  Select arc or circle:',
  dimang: 'DIMANGULAR  Select arc, circle, line or <specify vertex>:',
  textedit: 'TEXTEDIT  Select a text or dimension:',
  xattach: 'XATTACH  Specify insertion point:',
  xclip: 'XCLIP  Click the corners of the clip outline, Enter to finish (two corners: a rectangle), or [Object] to pick a closed outline:',
  crop: 'CROP  Select a block to crop:'
};
const f2 = (s: string) => (s.trim() !== '' && Number.isFinite(Number(s)) ? Number(s).toFixed(2) : s);
/** The first prompt of a tool, with the edit tools' options and their values now (Enter takes the one in < >). */
function editPrompt(tool: CadTool, s: EditSettings): string {
  if (tool === 'offset') return `OFFSET  Specify offset distance or [Through/Erase/Layer] <${s.through ? 'Through' : f2(s.offset)}>:`;
  if (tool === 'fillet') return `FILLET  Select first object or [Radius/Trim] <R ${f2(s.radius)}${s.trim ? '' : ', No trim'}>:`;
  if (tool === 'chamfer') return `CHAMFER  Select first line or [Distance/Trim] <${f2(s.d1)}, ${f2(s.d2)}${s.trim ? '' : ', No trim'}>:`;
  return PROMPT[tool];
}
const OFFSET_SIDE = 'OFFSET  Specify point on side to offset:';
const CROP_OUTLINE = 'CROP  Click the corners of the crop outline, Enter to finish (two corners: a rectangle), or [Circle/Object]:';
const NO_PARTS: ErasedParts = { objects: [], ranges: [] };
/** CROP: the block of the drawing (or the drawn items) being cut, and where the command is. */
type CropTarget = { handle: string; label: string } | { items: string[]; label: string };
type CropState = { step: 'pick' | 'confirm' | 'outline' | 'centre' | 'radius' | 'object' | 'side'; target?: CropTarget; centre?: Pt; outline?: CropBoundary };
const arrayType = (s: EditSettings) => `ARRAY  Enter array type [Rectangular/Polar] <${s.polar ? 'Polar' : 'Rectangular'}>:`;
const mirrorAsk = (s: EditSettings) => `MIRROR  Erase source objects? [Yes/No] <${s.keep ? 'No' : 'Yes'}>:`;
/** Layer of the cable routes drawn or linked in the app. */
const CABLE_LAYER = 'E-CABLE';
/** The smallest room of a level whose outline (metres) is around a point (drawing units, `k` metres per unit). */
function roomAtPointOf(p: Project, f: { ref: { building: string; level: string } }, at: Pt, k: number) {
  return buildingInfoOf(p).rooms
    .filter((r) => r.buildingId === f.ref.building && r.levelId === f.ref.level && (r.outline?.length ?? 0) >= 3 && inside([at[0] * k, at[1] * k], r.outline!))
    .sort((a, b) => a.areaM2 - b.areaM2)[0];
}
const pathLength = (pts: Pt[]) => pts.slice(1).reduce((t, q, i) => t + distance(pts[i], q), 0);
/** Layers for what is drawn in the app (written into the DXF on save). */
const DRAW_LAYER = 'LV-SKETCH', ANNO_LAYER = 'LV-ANNO';
/** Layers of the circuit wiring and its tags (written into the DXF / DWG on save). */
const WIRING_LAYER = 'E-LV-WIRING', TAG_LAYER = 'E-LV-TAGS';
/** The edit tools on what was drawn (Draw → Edit, Mirror / Scale / Stretch in Modify), and those that work on objects
 * picked first. */
const EDIT_TOOLS: CadTool[] = ['draworder', 'texttofront', 'trim', 'extend', 'offset', 'fillet', 'chamfer', 'break', 'join', 'explode', 'mirror', 'scale', 'stretch', 'array', 'tjust', 'th', 'talign', 'tcase', 'tprefix', 'tsuffix', 'torient', 'tcen', 'tcopy', 'tframe', 'tmask'];
const PICK_FIRST: CadTool[] = ['draworder', 'join', 'mirror', 'scale', 'array', 'tjust', 'th', 'talign', 'tcase', 'tprefix', 'tsuffix', 'torient', 'tcen', 'tcopy', 'tframe', 'tmask'];
/** The text tools: on the texts picked first, then a value on the command line (TCEN and TCOPY: points or a text clicked). */
const TEXT_TOOLS: CadTool[] = ['tjust', 'th', 'talign', 'tcase', 'tprefix', 'tsuffix', 'torient', 'tcen', 'tcopy', 'tframe', 'tmask'];
const MTEXT_CORNER = 'MTEXT  Opposite corner or [Height/Justify/Width]:';
const MTEXT_JUST = (j?: NoteAttach) => `MTEXT  Justify [TL/TC/TR/ML/MC/MR/BL/BC/BR] <${j ?? 'TL'}>:`;
const MTEXT_TYPE = (isNew: boolean) => `MTEXT  Type the note (Enter starts a new line); Ctrl/⌘+Enter or OK keeps it, Esc ${isNew ? 'cancels' : 'leaves it as it was'}:`;
type DrMode = 'front' | 'back' | 'above' | 'under';
/** Where the Blocks palette's library folder is remembered on this computer. */
const LIB_KEY = 'lvds.cad.blockFolder';
const DR_OPTIONS = 'DRAWORDER  [Above objects/Under objects/Front/Back] <Back>:';
const DR_REF = 'DRAWORDER  Select reference objects:';
const TFRAME_PROMPT = 'TFRAME  Frame [Circle/Box/Hexagon/None] <Circle>:';
const TMASK_PROMPT = 'TMASK  Mask behind the text [Yes/No] <Yes>:';
const TCOUNT_PLACE = 'TCOUNT  Place text or [Select existing/Undo]:';
const TALIGN_PROMPT = 'TALIGN  Align [Left/Right/Centre/Top/Bottom/Spacing] <Left>:';
const TCASE_PROMPT = 'TCASE  Case [Upper/Lower/Title/Sentence] <Upper>:';
const TORIENT_PROMPT = 'TORIENT  Readable from [Bottom/Right/Both] <Both>:';
const TJUST_PROMPT = (now: string) => `TJUST  Justify [Left/Centre/Right/TL/TC/TR/ML/MC/MR/BL/BC/BR] <${now}>:`;
const TH_PROMPT = (mm: number, forNew: boolean) => `TXTHEIGHT  Height on paper (mm)${forNew ? ' for new text' : ''} ${ISO_TEXT_MM.join(' · ')} <${mm}>:`;
const DRAW_TOOLS: CadTool[] = ['point', 'line', 'pline', 'tray', 'cable', 'rect', 'circle', 'arc', 'text', 'dim', 'dimlin', 'dimcont', 'dimbase', 'move', 'copy', 'rotate', 'polygon', 'ellipse', 'circle2p', 'circle3p', 'circled', 'arcsce', 'revcloud'];

/** The CAD view: a DWG / DXF drawing opened natively, as a CAD program shows it — model space, crosshair, snaps, layers,
 * a command line and a status bar. Engine in Rust (WebAssembly), desktop and web alike. Measure a distance, an area (by
 * corners, a closed object, or inside a room), and click any object to see what it is. */
export default function CadPage({ cad, project, onChange, onStatus, sheetUi, run: calcRun, onSheet, draft = DRAFT_DEFAULTS, autosaveMin = 2, onPrefs, onUndo, onRedo, canUndo = false, canRedo = false, onShow }: {
  cad: CadState;
  /** Opens a board's load schedule, the SLD, the riser, the cable schedule or the ELV page (the right-click menus). */
  onShow?: (s: CadShow) => void;
  /** The project's undo and redo (UNDO, REDO and the right-click menu). */
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  /** Drafting settings (DS), and the project's recovery-copy minutes, kept in Preferences by the app. */
  draft?: DraftSettings;
  autosaveMin?: number;
  onPrefs?: (p: { draft: DraftSettings; autosaveMin: number }) => void;
  project: Project;
  onChange: (next: Project, message: string) => void;
  onStatus: (m: string) => void;
  /** The sheets' markup tools (shared with the Sheets ribbon): a layout tab's paper markups use them. */
  sheetUi?: SheetUi;
  /** The calculation run the sheets print. */
  run?: CalcRun;
  /** Page setup: the layout's sheet in Sheets. */
  onSheet?: (sheetId: string) => void;
}) {
  const paperTool = sheetUi?.setTool;
  const onPlot = (id: string) => void exportDrawingSet(project, setOf(project), calcRun, false, onStatus, [id], false);
  const { view, tool } = cad;
  // Objects of the drawing erased by CROP: the engine no longer picks or snaps to them, the canvas leaves them out, and
  // `drawn` is the drawing without them (rooms, walls, cutting edges, texts).
  const erasedKey = (view ? erasedOf(project, view.file) : []).join(',');
  const [erasedParts, setErasedParts] = useState<{ view: CadView; key: string; parts: ErasedParts } | null>(null);
  useEffect(() => {
    if (!view || (!erasedKey && erasedParts?.view !== view)) return;
    let live = true;
    void view.erase(erasedKey ? erasedKey.split(',') : []).then((parts) => { if (live) setErasedParts({ view, key: erasedKey, parts }); }, () => {});
    return () => { live = false; };
  }, [view, erasedKey]); // eslint-disable-line react-hooks/exhaustive-deps -- by value
  const hidden = erasedParts && erasedParts.view === view && erasedParts.key === erasedKey ? erasedParts.parts : NO_PARTS;
  const drawn = useMemo(() => (view && erasedKey ? shownView(view, hidden, erasedKey.split(',')) : view), [view, hidden, erasedKey]);
  const [crop, setCrop] = useState<CropState | null>(null);
  const [cursor, setCursor] = useState<{ at: Pt | null; snap?: string; pixel?: number }>({ at: null });
  const [cmd, setCmd] = useState('');
  const [busy, setBusy] = useState(false);
  const [points, setPoints] = useState<Pt[]>([]);
  const [objectMode, setObjectMode] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  // Another drawing showing (its tab, one opened or closed): what was picked or being drawn on the last one goes.
  const [pickedOn, setPickedOn] = useState(view);
  // Light room (LUX): the room kept (its lights stay previewed while the panel is edited) and the panel's settings.
  const [luxRoom, setLuxRoom] = useState<string | null>(null);
  const [luxSet, setLuxSet] = useState<LuxSettings>(LUX_START);
  // Emergency (EM): the escape routes, points of emphasis and open-area rooms marked (metres), kept until Place or Cancel.
  const [em, setEm] = useState<{ routes: Pt[][]; points: { at: Pt; kind: EmphasisKind }[]; rooms: string[] }>({ routes: [], points: [], rooms: [] });
  const [emSet, setEmSet] = useState<EmSettings>(EM_START);
  // Edit devices: several devices picked (Shift-click or a window; one device is cad.selected), the menu at the cursor
  // after a right click (canvas pixels), Array on line and Match settings, and the board being renamed.
  const [picked, setPicked] = useState<string[]>([]);
  // Options of the drawing tools: a polygon's sides and whether its corners (inscribed) or its sides' middles
  // (circumscribed) are on the circle; a revision cloud by points (Polygonal) and its arc length typed (drawing units);
  // an ellipse by the two ends of an axis; a circle by its diameter (D after the centre).
  const [polySides, setPolySides] = useState(4);
  const [polyIn, setPolyIn] = useState(true);
  const [cloudPoly, setCloudPoly] = useState(false);
  const [cloudArc, setCloudArc] = useState<number | null>(null);
  const [ellAxis, setEllAxis] = useState(false);
  const [circleDia, setCircleDia] = useState(false);
  const [menuAt, setMenuAt] = useState<Pt | null>(null);
  const [arlSet, setArlSet] = useState<ArlSettings>(ARL_START);
  const [matchFrom, setMatchFrom] = useState<string | null>(null);
  const [matchSet, setMatchSet] = useState<MatchSettings>(MATCH_START);
  const [renaming, setRenaming] = useState<string | null>(null);
  /** A room being renamed or given its type on the command line (the room's right-click menu). */
  const [roomAsk, setRoomAsk] = useState<{ id: string; step: 'name' | 'type' } | null>(null);
  /** Where the last right-click on the plan was, and the room there. */
  const ctxAt = useRef<{ at: Pt; room?: string } | null>(null);
  /** Light room… from a room's menu: the room LUX starts on. */
  const luxNext = useRef<string | null>(null);
  /** Crop… from a block's menu: the block CROP starts on. */
  const cropNext = useRef<CropState | null>(null);
  /** Move / Copy / Rotate from a grip's menu: the base point the tool starts with. */
  const pointsNext = useRef<Pt[] | null>(null);
  /** FIND on the command line: the words to find, then what replaces them. */
  const [findAsk, setFindAsk] = useState<{ step: 'what' } | { step: 'with'; what: string } | null>(null);
  /** BCLOSE with changes not saved: asked whether to save them first. */
  const [beClose, setBeClose] = useState(false);
  /** REFCLOSE without Save or Discard: asked which. */
  const [reClose, setReClose] = useState(false);
  /** The object of the opened drawing, or the reference, the last right-click was on. */
  const ctxObj = useRef<{ dw?: CadObject; ref?: string; vp?: string; fvp?: number } | null>(null);
  /** The right-click menu on a layout's paper or one of its viewports (phase 3), at a point of the paper's stage. */
  const [paperCtx, setPaperCtx] = useState<{ at: Pt; items: CtxEntry[] } | null>(null);
  const paperStage = useRef<HTMLDivElement>(null);
  // Edit tools: their settings, the first object picked (and where), objects picked first or points next, the Stretch
  // window, the grip being dragged, and a first pick set by the toolbar before the tool starts.
  const [edSet, setEdSet] = useState<EditSettings>(ED_START);
  const [edStep, setEdStep] = useState<{ id: string; at: Pt } | null>(null);
  const [edPhase, setEdPhase] = useState<'pick' | 'points'>('pick');
  const [stretchBox, setStretchBox] = useState<[Pt, Pt] | null>(null);
  const [gripIdx, setGripIdx] = useState<number | null>(null);
  /** A grip clicked (not dragged) on the object picked: hot, its right-click menu shows. */
  const [hotGrip, setHotGrip] = useState<number | null>(null);
  const preset = useRef<{ id: string; at: Pt } | null>(null);
  // The command line: the question an edit tool asks (a distance, a radius, Yes / No…), the height and rotation TEXT
  // asks after its point, the commands typed before (Up / Down), the recent commands (Enter with no tool repeats the
  // first), the taller history (F2) or the command list (F1), and the right-click menu of the prompt.
  const [edAsk, setEdAsk] = useState<'offset' | 'radius' | 'd1' | 'd2' | 'erase' | 'factor' | 'type' | null>(null);
  const [textAsk, setTextAsk] = useState<{ step: 'height' | 'rot' | null; mm: number; rot: number } | null>(null);
  /** MTEXT (S6 of the 2D gap plan): the note being typed in its box (a new one, not drawn yet, has no id), what the
   * second prompt asks (or Width… from the right-click menu), and the height and justification chosen for new notes. */
  const [edNote, setEdNote] = useState<{ id?: string; draft: SketchItem } | null>(null);
  const [mtAsk, setMtAsk] = useState<{ step: 'height' | 'just' | 'width' | 'ntwidth'; id?: string } | null>(null);
  const [mtSet, setMtSet] = useState<{ mm?: number; just?: NoteAttach }>({});
  /** DRAWORDER (S7): the order chosen before the objects (from the ribbon or the right-click menu), if any. */
  const [drMode, setDrMode] = useState<DrMode | null>(null);
  /** DIVIDE / MEASURE (S8): the object clicked and where, while its number of parts or length is typed. */
  const [divPick, setDivPick] = useState<{ it: SketchItem; at: Pt; block?: string; align?: boolean; step?: 'bname' | 'align' } | null>(null);
  /** BLOCK (S9): the Block definition dialog's draft while it is open, and the -BLOCK command-line flow's step. */
  const [blockDlg, setBlockDlg] = useState<BlockDraft | null>(null);
  const [blk, setBlk] = useState<{ step: 'name' | 'base' | 'objects'; name: string; base?: Pt } | null>(null);
  /** INSERT (S10): the block waiting at the cursor (one of the drawing's, a recent one or one from the library, added to
   * the drawing's blocks when placed), the palette's settings, what -INSERT asks, the blocks inserted lately and the
   * library folder's files. */
  const [insBlock, setInsBlock] = useState<CadBlockDef | null>(null);
  const [insSet, setInsSet] = useState<InsertSettings>(INSERT_DEFAULTS);
  const [insAsk, setInsAsk] = useState<'scale' | 'rot' | null>(null);
  const [recentBlocks, setRecentBlocks] = useState<CadBlockDef[]>(() => loadRecentBlocks());
  const [library, setLibrary] = useState<{ folder: string | null; files: LibraryFile[] }>({ folder: null, files: [] });
  /** Attributes (S11): the Attribute definition dialog's draft, the insert whose attributes are being edited, a block
   * placed whose attribute prompts are being answered (on the command line one by one, or in a dialog), and ATTEXT's
   * format question. */
  const [attDlg, setAttDlg] = useState<AttDraft | null>(null);
  const [attEdit, setAttEdit] = useState<string | null>(null);
  const [attPend, setAttPend] = useState<{ def: CadBlockDef; at: Pt; asked: SketchItem[]; i: number; values: Record<string, string>; dialog: boolean } | null>(null);
  const [attExt, setAttExt] = useState(false);
  useEffect(() => {
    // The library folder chosen last on this computer, listed again (desktop app).
    let folder: string | null = null;
    try { folder = localStorage.getItem(LIB_KEY); } catch { /* none */ }
    const list = window.lvds?.cadFile?.listFolder;
    if (folder && list) void list(folder).then((r) => { if (r) setLibrary({ folder: r.folder, files: r.files }); }, () => {});
  }, []);
  // TALIGN after its texts: the edge chosen and what it waits for (the text or point to line up with, or the gap).
  const [tAsk, setTAsk] = useState<{ mode: AlignMode | 'spacing'; step: 'ref' | 'gap' } | null>(null);
  // TCOUNT: its prefix, number, step, digits and suffix, what it asks for next, and the texts placed (for Undo).
  const [tc, setTc] = useState<{ step: 'prefix' | 'start' | 'step' | 'suffix' | 'place' | 'pick'; prefix: string; n: number; inc: number; pad: number; suffix: string; placed: string[] } | null>(null);
  // KEYNOTE: the number asked, then where it goes, its text, and (the first time) where the legend starts.
  const [kn, setKn] = useState<{ step: 'number' | 'place' | 'text' | 'legend'; n: number; at?: Pt; note?: string } | null>(null);
  const [typed, setTyped] = useState<string[]>([]);
  const [recent, setRecent] = useState<{ label: string; tool?: CadTool; text?: string }[]>([]);
  const { log, setLog } = cad;
  // Dynamic input at the cursor: what is typed in its boxes, and its options list open (with the one picked).
  const [dynVals, setDynVals] = useState<string[]>([]);
  const [dynMenu, setDynMenu] = useState<number | null>(null);
  const dynRefs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];
  // The settings dialog shown: the edit tool's, or the text or dimension styles.
  const [dlg, setDlg] = useState<'edit' | 'style' | 'dimstyle' | 'qselect' | 'ptype' | null>(null);
  /** PASTECLIP: the objects following the cursor until they are placed. */
  const [pasting, setPasting] = useState<ClipPayload | null>(null);
  const [promptMenu, setPromptMenu] = useState<{ at: Pt; items: CtxEntry[] } | null>(null);
  // ISOLATEOBJECTS / HIDEOBJECTS: the objects shown only, or hidden, on this view (not saved); Snap overrides ▸: the one
  // snap mode for the next point ('none': no snap); the values typed at prompts lately (Recent input ▸).
  const [objHide, setObjHide] = useState<ObjectHide | null>(null);
  const [snapOnce, setSnapOnce] = useState<OsnapMode | 'none' | null>(null);
  const [inputs, setInputs] = useState<string[]>([]);
  // ZOOM Window / Scale / Previous asked of the canvas (S2 of the 2D gap plan); what DIMRADIUS / DIMDIAMETER and
  // DIMANGULAR have picked so far (S4); what SELECTSIMILAR matches besides kind and layer (S3).
  const [zoomReq, setZoomReq] = useState<ZoomReq | undefined>();
  /** TEXTEDIT: the drawn text or dimension being typed over in the box on the canvas, and what is typed so far. */
  const [edText, setEdText] = useState<{ id: string; value: string } | null>(null);
  const [radPick, setRadPick] = useState<{ c: Pt; r: number } | null>(null);
  const [angPick, setAngPick] = useState<{ seg1?: [Pt, Pt]; at1?: Pt; v?: Pt; p1?: Pt; p2?: Pt; vertex?: true } | null>(null);
  const [ssOpts, setSsOpts] = useState<SimilarOpts>({ colour: false, linetype: false });
  const [ssAsk, setSsAsk] = useState(false);
  // Layer palette shown, and the object Match properties copies from.
  const [showLM, setShowLM] = useState(false);
  // The properties palette (Ctrl/Cmd+1): shown while a drawing is open, unless hidden.
  const { showProps, setShowProps } = cad;
  const [mpFrom, setMpFrom] = useState<string | null>(null);
  const [hatchSet, setHatchSet] = useState<HatchSpec>(HATCH_START);
  // HATCH: islands, associative and keeping imported patterns on this computer; the patterns kept there.
  const [hatchOpts, setHatchOpts] = useState<HatchOpts>({ islands: true, assoc: true, keep: false });
  const [computerPats, setComputerPats] = useState<CustomPattern[]>(loadComputerPatterns);
  // HATCHEDIT: the hatches being edited and what is asked of a click (the pattern's origin, islands to add or remove).
  const [heIds, setHeIds] = useState<string[]>([]);
  const [hePhase, setHePhase] = useState<null | 'origin' | 'add' | 'remove'>(null);
  const heNext = useRef<{ ids: string[]; phase: 'origin' | 'add' | 'remove' | null } | null>(null);
  // BOUNDARY: whether islands get their own polylines.
  const [boundIsl, setBoundIsl] = useState(true);
  // References: the manager shown, the reference being attached (its dialog, or a point being picked for it), the one
  // being clipped and whether its clip is a closed outline picked on the plan.
  const [showXR, setShowXR] = useState(false);
  const [xDraft, setXDraft] = useState<CadRef | null>(null);
  const [xClip, setXClip] = useState<{ name: string; outline: boolean } | null>(null);
  if (pickedOn !== view) { setPickedOn(view); setResult(null); setPoints([]); setObjectMode(false); setLuxRoom(null); setEm({ routes: [], points: [], rooms: [] }); setPicked([]); setMenuAt(null); }
  const input = useRef<HTMLInputElement>(null);
  const last = rememberedDrawing(project.id);
  const units = planScale(project, view?.file, view?.info.units);
  /** INSUNITS code of the units the drawing is worked in (for the clipboard). */
  const unitCode = CAD_UNITS.find((u) => u.id === units.unit)?.code ?? 4;
  // A title block drawing (Project → Title block → Edit in CAD): millimetres at 1 : 1, texts at their height on the TB layers.
  const tb = isTbFile(view?.file);
  const toM = (v: number) => v * units.factor;
  const toM2 = (v: number) => v * units.factor * units.factor;

  async function load(read: () => Promise<CadView | null>, missing?: string) {
    setBusy(true);
    try {
      const v = await read();
      if (v) { cad.open(v); onStatus(`${v.file} opened`); } else if (missing) cad.say(missing);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      cad.say(msg); onStatus(msg);
    } finally { setBusy(false); }
  }
  const openFile = () => void load(() => chooseDrawing());
  /** NEW: a blank drawing in millimetres, Drawing1.dxf or the next name free; Save asks where the first time. */
  const newFile = () => {
    const file = newDrawingName(project, cad.drawings.map((d) => d.file));
    void load(async () => { const v = await openDrawing(file, new TextEncoder().encode(newDrawingDxf())); cad.say(`NEW  ${file} — a blank drawing in millimetres. Save As names it the first time.`); return v; });
  };
  /** Shows the tab of a file already open, else reads it into a new one. */
  const showOrLoad = (file: string, read: () => Promise<CadView | null>, missing?: string) => {
    const tab = cad.tabOf(file);
    if (tab) cad.show(tab); else void load(read, missing);
  };
  /** A level's plan can be shown: open in a tab, a sample, or a file whose folder is known on this computer. */
  const canOpenPlan = (file: string) => !!cad.tabOf(file) || SAMPLE_PLANS.some((s) => s.file === file) || (!!pathOfPlan(project.id, file) && !!window.lvds?.cadFile?.readBytes);
  /** Shows a level's plan: its tab, else loads it; with no file yet, asks for a drawing and makes it the level's plan. */
  const openPlan = (file: string | undefined, floor: Floor) => showOrLoad(file ?? '', async () => {
    const v = !file ? await chooseDrawing() : SAMPLE_PLANS.some((s) => s.file === file) ? await sampleDrawing(file) : await reopenDrawing(pathOfPlan(project.id, file)!);
    if (v && !file) setPlanLevel(project, v.file, floor, change, v.info.units);
    return v;
  }, 'That drawing is no longer where it was. Open it from Plans.');
  // Show on plan (from the SLD): the target waits for its drawing to be the one shown, then it is picked and zoomed to.
  const [showTarget, setShowTarget] = useState<PlanTarget | null>(null);
  const showOnPlan = (t: PlanTarget) => {
    if (!canOpenPlan(t.file)) { onStatus(`${t.file}: open it from Plans (its folder is not known on this computer)`); return; }
    const floor = plansOf(project).find((x) => x.file === t.file)?.floor;
    if (!floor) return;
    setShowTarget(t);
    openPlan(t.file, floor);
  };
  // Closing drawings changed since they were saved asks first (Save / Don't save / Cancel); a Save As started from there
  // closes them once saved.
  const [closing, setClosing] = useState<CadView[] | null>(null);
  const closeAfterSave = useRef<CadView[] | null>(null);
  // The properties dock: its side and width, kept on this computer.
  const [dockState, setDockState] = useState<{ side: 'left' | 'right'; w: number }>(() => {
    try { const d = JSON.parse(localStorage.getItem(DOCK_KEY) ?? 'null') as { side?: string; w?: number } | null; return { side: d?.side === 'right' ? 'right' : 'left', w: Math.max(DOCK_MIN, Math.min(DOCK_MAX, Number(d?.w) || DOCK_W)) }; }
    catch { return { side: 'left', w: DOCK_W }; }
  });
  const setDock = (p: Partial<typeof dockState>) => setDockState((d) => { const n = { ...d, ...p }; try { localStorage.setItem(DOCK_KEY, JSON.stringify(n)); } catch { /* not kept */ } return n; });
  const dockSide = dockState.side;
  /** Dragging the dock's inner edge widens or narrows it (DOCK_MIN–DOCK_MAX px). */
  const startDockDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX, w0 = dockState.w, sign = dockSide === 'left' ? 1 : -1;
    const move = (ev: PointerEvent) => setDock({ w: Math.max(DOCK_MIN, Math.min(DOCK_MAX, Math.round(w0 + sign * (ev.clientX - x0)))) });
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const closeNow = (views?: CadView[]) => { setClosing(null); closeAfterSave.current = null; const done = cad.close(views); if (done) onStatus(done); };
  const closeDrawings = (views?: CadView[]) => {
    const going = views ?? cad.drawings;
    if (going.some((v) => cad.isDirty(v.file))) { setClosing(going); return; }
    closeNow(views);
  };

  // Until a drawing has been open (and with none to reopen), the sample villa is shown — a test aid (SAMPLE_PLANS). Once
  // closed it stays closed.
  useEffect(() => {
    if (view || cad.sampleDone.current || last || !SAMPLE_PLANS.length) return;
    cad.sampleDone.current = true;
    void load(() => sampleDrawing(SAMPLE_PLANS[0].file));
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps -- once, when the page first shows no drawing

  // A tool chosen (ribbon or command line): start it afresh and say what it asks for.
  useEffect(() => {
    const pre = preset.current;
    setPoints(pointsNext.current ?? []); pointsNext.current = null; setObjectMode(false); setLuxRoom(luxNext.current); luxNext.current = null; setMenuAt(null); if (tool !== 'match') setMatchFrom(null); cad.setTextAt(null);
    setCloudPoly(false); setEllAxis(false); setCircleDia(false);
    setEdStep(pre); preset.current = null; setStretchBox(null); setMpFrom(null);
    const first = picked.some((k) => k.startsWith('sk:')) || !!cad.selected?.startsWith('sk:');
    setEdPhase(first ? 'points' : 'pick');
    setEdAsk(tool === 'offset' && !pre ? 'offset' : tool === 'array' && first ? 'type' : null); setTextAsk(null); setTAsk(null); setPromptMenu(null); setMtAsk(null); setEdNote(null); setSnapOnce(null);
    setTc(tool === 'tcount' ? { step: 'prefix', prefix: '', n: 1, inc: 1, pad: 0, suffix: '', placed: [] } : null);
    setKn(tool === 'keynote' ? { step: 'number', n: nextKeynote(sketch) } : null);
    setDlg((d) => (DIALOG_TOOLS.includes(tool as EditTool) ? 'edit' : d === 'edit' ? null : d));
    if (tool !== 'none' && tool !== 'xattach' && tool !== 'xclip') { const label = PROMPT[tool].split(' ')[0]; setRecent((r) => [{ label, tool }, ...r.filter((x) => x.label !== label)].slice(0, 8)); }
    setCrop(tool === 'crop' ? cropNext.current ?? { step: 'pick' } : null); cropNext.current = null;
    setRadPick(null); setAngPick(null); setSsAsk(false); setEdText(null);
    // HATCHEDIT with hatches picked first: they are edited at once; BOUNDARY starts with islands on.
    const he = heNext.current; heNext.current = null;
    const preHatches = tool === 'hatchedit' ? (pickedSk.length ? pickedSk : selSketch ? [selSketch] : []).filter((x) => x.hatch).map((x) => x.id) : [];
    setHeIds(he ? he.ids : preHatches); setHePhase(he?.phase ?? null); setBoundIsl(true);
    cad.say(`Command: ${PICK_FIRST.includes(tool) && first ? (tool === 'draworder' ? (drMode === 'above' || drMode === 'under' ? DR_REF : DR_OPTIONS) : tool === 'array' ? arrayType(edSet) : TEXT_TOOLS.includes(tool) ? textToolPrompt(tool) : `${tool.toUpperCase()}  ${tool === 'mirror' ? 'Specify first point of the mirror line:' : tool === 'scale' ? 'Specify base point:' : 'Enter to join them:'}`) : pre && tool === 'offset' ? OFFSET_SIDE : tool === 'insert' && !insBlock ? 'INSERT  Block name:' : tool === 'attpick' ? PROMPT.attpick : tool === 'blockpick' && blockDlg?.picking === 'objects' ? 'BLOCK  Select objects — Enter when done:' : editPrompt(tool, edSet)}`);
    if (tool === 'hatchedit' && preHatches.length && !he) cad.say(hatchEditSay(null, preHatches.length));
    // CROP with drawn items picked first: they are what is cut.
    if (tool === 'crop' && first) { const ids = picked.length ? picked.filter((k) => k.startsWith('sk:')).map((k) => k.slice(3)) : [cad.selected!.slice(3)]; setCrop({ step: 'outline', target: { items: ids, label: `${ids.length} drawn object${ids.length === 1 ? '' : 's'}` } }); cad.say(CROP_OUTLINE); }
    // SELECTSIMILAR with drawn objects picked first: they are the pattern. ZOOM needs the model view.
    if (tool === 'selsim' && first) applySimilar();
    // DRAWORDER with objects picked first and Front or Back chosen on a menu: done at once.
    if (tool === 'draworder' && first && (drMode === 'front' || drMode === 'back')) applyDrawOrder(drMode);
    if (tool !== 'draworder') setDrMode(null);
    setDivPick(null);
    if (tool !== 'block') setBlk(null); else { setBlk({ step: 'name', name: '' }); input.current?.focus(); }
    if (tool !== 'insert') { setInsBlock(null); setInsAsk(null); setAttPend(null); } else if (!insBlock) input.current?.focus();
    // TEXTEDIT with one text or dimension picked first: its box opens at once.
    if (tool === 'textedit' && first) { const one = pickedSk.length === 1 ? pickedSk[0] : pickedSk.length ? undefined : selSketch; if (one) startTextEdit(one); }
    if ((tool === 'zoom' || tool === 'zoomwin' || tool === 'zoomscale') && zoomRefused()) cad.setTool('none');
  }, [tool]); // eslint-disable-line react-hooks/exhaustive-deps

  // Layer palette styles. The architect's layers: On as turned on or off in the app (kept in the project, so each change is
  // one undo step), else as the drawing has them; shown: on and not frozen; picked: shown and not locked (snapped to still).
  const styles = useMemo(() => layerStylesOf(project, view?.file), [project, view]);
  const archStyle = useMemo(() => (view ? view.info.layers.map((l) => styleOf(styles, l.name)) : []), [view, styles]);
  const archOn = useMemo(() => (view ? archOnOf(project, view.file, view.info.layers) : new Uint8Array()), [view, project]);
  const layersOn = useMemo(() => (archStyle.some((st) => st.freeze) ? archOn.map((v, i) => (v && !archStyle[i]?.freeze ? 1 : 0)) : archOn), [archOn, archStyle]);
  const pickOn = useMemo(() => (archStyle.some((st) => st.lock) ? layersOn.map((v, i) => (v && !archStyle[i]?.lock ? 1 : 0)) : layersOn), [layersOn, archStyle]);
  // Zoom extents leave the frozen layers out.
  const fitExtents = useMemo(() => (view && archStyle.some((st) => st.freeze) ? extentsOf(view.segs, view.segLayers, view.info.origin, (i) => !archStyle[i]?.freeze) : undefined), [view, archStyle]);
  // Layer roles (File → Layer roles): the project's, else a guess from the layer's name and what it holds.
  const layerStats = useMemo(() => (drawn ? layerStatsOf(drawn) : []), [drawn]);
  const roles = useMemo(() => layerMapFor(project, layerStats), [project, layerStats]);
  // Walls for Room area: shown layers whose role is Wall, else every shown layer.
  const walls = useMemo(() => {
    if (!view || !drawn) return [];
    const wallNames = layersWith(roles, 'wall');
    const shown = view.info.layers.map((_, i) => i).filter((i) => layersOn[i]);
    const named = shown.filter((i) => wallNames.has(view.info.layers[i].name.toLowerCase()));
    return segmentsOn(drawn.segs, drawn.segLayers, drawn.info.origin, new Set(named.length ? named : shown));
  }, [view, drawn, layersOn, roles]);

  // Devices are kept per level, in metres on its plan: the level this drawing shows, and what is placed on it.
  const floors = floorList(project.building).filter((f) => !f.ref.index);
  const { floor, set: levelSet } = planLevel(project, view?.file);
  const plans = plansOf(project);
  const placed: PlacedItem[] = useMemo(() => (floor ? [...placedOn(project, floor.ref), ...elvPlacedOn(project, floor.ref)] : []), [project, floor]);
  const palette: PaletteItem[] = [...LV_PALETTE, ...ELV_PALETTE];
  const item = palette.find((x) => x.id === cad.device) ?? palette[0];
  const circuits = useMemo(() => finalCircuits(project), [project]);
  const selectedItem = placed.find((d) => d.key === cad.selected) ?? null;
  // The devices picked: several (Shift-click or a window), else the one selected.
  const pickedItems = useMemo(() => (picked.length ? placed.filter((d) => picked.includes(d.key)) : selectedItem ? [selectedItem] : []), [picked, placed, selectedItem]);
  // What the engineer drew on this drawing (drawing units), its snap points, and the drawn object selected.
  const sketch = useMemo(() => (view ? sketchOf(project, view.file) : []), [project, view]);
  /** The drawing's own blocks, and the architect's block names (which a new block cannot take). */
  const defs = useMemo(() => (view ? blockDefsOf(project, view.file) : []), [project, view]);
  const archBlockNames = useMemo(() => (view ? [...new Set(view.blocks().map((b) => b.block))] : []), [view]);
  const hitAt = (items: SketchItem[], at: Pt, tol: number) => itemAt(items, at, tol, defs);
  // Snaps come from what shows: objects on layers that are off or frozen are not snapped to (locked ones are).
  const shown = useMemo(() => shownBy(objHide, view?.file), [objHide, view]);
  const shownSketch = useMemo(() => sketch.filter((it) => shown(`sk:${it.id}`)), [sketch, shown]);
  const shownPlaced = useMemo(() => placed.filter((d) => shown(d.key)), [placed, shown]);
  const sketchSnaps = useMemo(() => snapPoints(shownSketch.filter((it) => !effective(it, styles).hidden), defs), [shownSketch, styles, defs]);
  // Objects on locked, hidden or frozen layers cannot be picked.
  // Edit block in place (REFEDIT): the objects of the block being edited; the rest of the drawing faded and not picked.
  const re = refEditOf(project, view?.file);
  const reOthers = useMemo(() => (re ? new Set(re.others) : null), [re]);
  const reWork = useMemo(() => (re ? new Set(workingSet(project, re).map((it) => it.id)) : undefined), [project, re]);
  const pickable = useMemo(() => shownSketch.filter((it) => { const e = effective(it, styles); return !e.lock && !e.hidden && !reOthers?.has(it.id); }), [shownSketch, styles, reOthers]);
  // A drawing opened (or shown) while one of its blocks is edited in place: said once.
  useEffect(() => { if (re) cad.say(`REFEDIT  "${re.insert.block}" is being edited in place: the rest is faded and locked. REFCLOSE saves it back into the block or discards it.`); }, [view?.file]); // eslint-disable-line react-hooks/exhaustive-deps -- once per drawing shown
  // Snap overrides ▸: for the next point, object snap on with that one mode only (on what the app drew and on references
  // too), or off for 'none'.
  const snapBit = snapOnce && snapOnce !== 'none' ? OSNAP_BITS[snapOnce] : 0;
  const snapDraft = snapOnce ? { ...draft, osnap: snapBit } : draft;
  /** A click picks what is inside the pick box: half its size, in screen pixels (times `pixel` for drawing units). */
  const pickR = pickRadiusPx(draft);
  const snapToggles = snapOnce ? { ...cad.toggles, osnap: snapOnce !== 'none' } : cad.toggles;
  const snapExtra = useMemo(() => (snapOnce ? sketchSnaps.filter((q) => q.kind & snapBit) : sketchSnaps), [snapOnce, snapBit, sketchSnaps]);
  const selSketch = sketch.find((it) => `sk:${it.id}` === cad.selected) ?? null;
  // A hot grip cools when the pick, the tool or the drawing changes.
  useEffect(() => { setHotGrip(null); }, [cad.selected, tool, sketch]);
  // The drawn objects picked: several, else the one selected; and everything picked.
  const pickedSk = useMemo(() => (picked.length ? sketch.filter((it) => picked.includes(`sk:${it.id}`)) : selSketch ? [selSketch] : []), [picked, sketch, selSketch]);
  // Objects of the opened drawing picked (Shift-click, kept as `dw:<handle>` in picked), else the one clicked. Erasing
  // them only lists their handles (project.cadErased): the drawing file is never changed.
  const dwObjects = useRef(new Map<string, { file: string; o: CadObject }>());
  const pickedDw = useMemo(() => (picked.length ? picked.flatMap((k) => { const x = k.startsWith('dw:') ? dwObjects.current.get(k) : undefined; return x && x.file === view?.file ? [x.o] : []; })
    : result?.kind === 'object' ? [result.o] : []), [picked, result, view]);
  const dwHighlight = useMemo(() => pickedDw.map((o): [number, number] => [o.seg_start, o.seg_end]), [pickedDw]);
  const pickedKeys = new Set([...pickedItems.map((d) => d.key), ...pickedSk.map((it) => `sk:${it.id}`), ...pickedDw.map((o) => `dw:${o.handle}`)]);
  const many = pickedItems.length + pickedSk.length > 1;
  // The architect's lines on shown layers: cutting edges and boundaries for Trim and Extend.
  const drawingSegs = useMemo(() => (drawn && (tool === 'trim' || tool === 'extend') ? segmentsOn(drawn.segs, drawn.segLayers, drawn.info.origin, new Set(drawn.info.layers.map((_, i) => i).filter((i) => layersOn[i]))) : []), [drawn, layersOn, tool]);
  const fittings = useMemo(() => trayFittings(sketch, 0.001 / units.factor).fittings, [sketch, units.factor]);
  const cables = useMemo(() => cablesOf(project), [project]);
  // ELV: the device chosen (if an ELV one), its system for coverage and Copy to level, and the coverage / Fill preview.
  const elvItem = ELV_PALETTE.find((e) => e.id === cad.device);
  const elvSystem = elvSystemOf(elvItem?.kind.elv ?? 'smoke-detector');
  const fillRoom = tool === 'fill' && cursor.at && floor ? roomAtPointOf(project, floor, cursor.at, units.factor)?.id : undefined;
  const elv = useMemo(() => (floor && (cad.coverage || fillRoom) ? elvLayer(project, { building: floor.ref.building, level: floor.ref.level }, units.factor, {
    system: elvSystem, coverage: cad.coverage, selected: null,
    ...(fillRoom && elvItem && cursor.at ? { preview: { type: elvItem.kind.elv, at: [cursor.at[0] * units.factor, cursor.at[1] * units.factor] as Pt } } : {})
  }) : undefined), [project, floor?.key, elvSystem, cad.coverage, fillRoom, elvItem?.id, units.factor]); // eslint-disable-line react-hooks/exhaustive-deps -- the preview follows the room under the pointer, not every move
  const cableLabels = useMemo(() => Object.fromEntries(sketch.filter((it) => it.cable).map((it) => {
    const f = project.feeders.find((x) => x.id === it.cable!.feederId);
    return [it.id, f ? cableLabel(project, f).split(' · ')[0] : `${it.cable!.feederId} (removed)`];
  })), [sketch, project]);
  // Annotation text height: paper mm at the annotation scale (2.5 mm at 1:100 = 0.25 m), in drawing units.
  const anno = annoOf(project);
  const textH = textUnits(anno, units.factor);
  const rUnits = DEVICE_R_M / units.factor;
  // Light room: the room kept, else the one under the pointer, with its lights by the lumen method.
  const luxHover = tool === 'lux' && !luxRoom && cursor.at && floor ? roomAtPointOf(project, floor, cursor.at, units.factor)?.id : undefined;
  const luxOf = tool === 'lux' ? buildingInfoOf(project).rooms.find((r) => r.id === (luxRoom ?? luxHover)) : undefined;
  const lit = useMemo(() => (luxOf ? lightingOf(project, luxOf, luxSet) : undefined), [project, luxOf?.id, luxSet]); // eslint-disable-line react-hooks/exhaustive-deps -- follows the room, not every pointer move
  // Emergency: the layout of what is marked, previewed until placed.
  const emRooms = useMemo(() => buildingInfoOf(project).rooms.filter((r) => em.rooms.includes(r.id) && r.outline), [project, em.rooms]);
  const emLayout = useMemo(() => { const f = emFitting(emSet); return emergencyLayout(em.routes, em.points, emRooms.map((r) => ({ name: r.name, outline: r.outline! })), f.fitting, f.signViewM); }, [em, emRooms, emSet]);
  const emGhost = (x: number, y: number, it: { symbol: { shape: string; text: string } }, key: string): CanvasDevice => ({ key, x: x / units.factor, y: y / units.factor, r: rUnits, shape: it.symbol.shape, text: it.symbol.text, label: '', ghost: true });
  const emGhosts: CanvasDevice[] = tool !== 'em' ? [] : [
    ...emLayout.fittings.map((f, i) => emGhost(f.at[0], f.at[1], EMERGENCY_ITEMS.fitting, `emf${i}`)),
    ...emLayout.signs.map((g, i) => emGhost(g.at[0], g.at[1], EMERGENCY_ITEMS[g.kind === 'exit' ? 'exit-sign' : 'direction-sign'], `ems${i}`)),
    ...em.points.map((q, i) => emGhost(q.at[0], q.at[1], { symbol: { shape: 'square', text: 'P' } }, `emp${i}`))
  ];
  // Array on line: the line clicked (to the cursor until its end is clicked) and the devices along it (metres).
  const arlItem = palette.find((x) => x.id === arlSet.device);
  const arlLine: Pt[] = tool !== 'arl' ? [] : points.length >= 2 ? points.slice(0, 2) : points.length === 1 && cursor.at ? [points[0], cursor.at] : [];
  const arlAt: Pt[] = arlLine.length === 2 ? alongLine(arlLine[0].map((v) => v * units.factor) as Pt, arlLine[1].map((v) => v * units.factor) as Pt,
    arlSet.by === 'n' ? { count: Number(arlSet.value) || 0 } : { spacing: Number(arlSet.value) || 0 }, arlSet.ends) : [];
  const emRoutes: SketchItem[] = tool !== 'em' ? [] : em.routes.map((r, i) => ({ id: `_em${i}`, layer: '', kind: 'pline', pts: r.map(([x, y]): Pt => [x / units.factor, y / units.factor]) }));
  const ghosts: CanvasDevice[] = [
    ...(elv?.symbols ?? []).filter((x) => x.ghost).map((x, i) => ({ key: `ghost${i}`, x: x.at[0], y: x.at[1], r: rUnits, shape: x.shape, text: x.text, label: '', elv: true, ghost: true })),
    ...(lit?.result.points ?? []).map(([x, y], i) => ({ key: `lux${i}`, x: x / units.factor, y: y / units.factor, r: rUnits, shape: 'cross', text: '', label: '', ghost: true })),
    ...emGhosts,
    ...arlAt.map(([x, y], i) => ({ key: `arl${i}`, x: x / units.factor, y: y / units.factor, r: rUnits, shape: arlItem?.symbol.shape ?? 'cross', text: arlItem?.symbol.text ?? '', label: '', ghost: true }))
  ];
  const devices: CanvasDevice[] = cad.showDevices ? [...ghosts, ...placed.filter((d) => shown(d.key)).map((d) => ({
    key: d.key, x: d.x / units.factor, y: d.y / units.factor, r: d.what === 'board' ? rUnits * 2 : rUnits, shape: d.symbol.shape, text: d.symbol.text,
    label: d.what === 'lv' ? d.detail.split(' · ')[0] : d.what === 'board' ? d.label : '', selected: pickedKeys.has(d.key), elv: d.what === 'elv'
  }))] : ghosts;
  // Circuit wiring on this level (metres), and as the canvas draws it (drawing units).
  const wiring = useMemo(() => (floor ? levelWiring(project, floor.ref) : []), [project, floor]);
  const toUnits = (w: WiringArc): WiringArc => ({ a: [w.a[0] / units.factor, w.a[1] / units.factor], c: [w.c[0] / units.factor, w.c[1] / units.factor], b: [w.b[0] / units.factor, w.b[1] / units.factor] });
  const canvasWiring: CanvasWiring[] = cad.showDevices ? wiring.map((w) => ({
    arcs: w.arcs.map(toUnits), ...(w.home ? { home: toUnits(w.home) } : {}),
    tag: cad.wireTags ? { at: [w.tagAt[0] / units.factor, w.tagAt[1] / units.factor] as Pt, s: w.warning ? `${w.tag.split(' · ')[0]} · ${w.warning}` : w.tag, warn: !!w.warning } : undefined
  })) : [];
  const deviceAt = (at: Pt, pixel: number) => {
    let best: { d: PlacedItem; dist: number } | undefined;
    for (const d of placed) {
      if (!shown(d.key)) continue;
      const dist = distance(at, [d.x / units.factor, d.y / units.factor]);
      if (dist <= Math.max(rUnits * (d.what === 'board' ? 2 : 1), 8 * pixel) && (!best || dist < best.dist)) best = { d, dist };
    }
    return best?.d;
  };
  // The cursor's shape, and what a click would pick, marked before the click (what is picked already is green: it is
  // only flagged, for the − a Shift-click would take it off with).
  // Devices and drawn objects are found at once; objects of the opened drawing ask the engine once the cursor rests 40 ms.
  const cursorMode = cursorModeOf(tool, cad.history[cad.history.length - 1], gripIdx !== null);
  const [hover, setHover] = useState<CadHover | undefined>();
  useEffect(() => {
    const at = cursor.at, px = cursor.pixel;
    const keep = (h: CadHover | undefined) => setHover((was) => (was?.device === h?.device && was?.sketch === h?.sketch && was?.seg?.[0] === h?.seg?.[0] && was?.seg?.[1] === h?.seg?.[1] && was?.picked === h?.picked ? was : h));
    if (!at || !px || cursorMode === 'point' || tool === 'pan') { keep(undefined); return; }
    const d = deviceAt(at, px);
    if (d) { keep({ device: d.key, picked: pickedKeys.has(d.key), label: `${d.label}${d.detail ? ` · ${d.detail}` : ''}` }); return; }
    const sk = hitAt(pickable, at, pickR * px);
    if (sk) { keep({ sketch: sk, picked: pickedKeys.has(`sk:${sk.id}`), label: `${kindOf(sk)} · ${sk.layer}` }); return; }
    if (!view) { keep(undefined); return; }
    let live = true;
    const t = setTimeout(() => void view.pick(at[0], at[1], pickR * px, pickOn).then((o) => {
      if (live) keep(o ? { seg: [o.seg_start, o.seg_end], picked: pickedKeys.has(`dw:${o.handle}`), label: `${o.kind}${o.block ? ` ${o.block}` : ''} · ${view.info.layers[o.layer]?.name ?? '?'}` } : undefined);
    }), 40);
    return () => { live = false; clearTimeout(t); };
  }, [cursor.at, cursor.pixel, cursorMode, tool, view, pickable, pickOn, pickR, placed, pickedItems, pickedSk, pickedDw]); // eslint-disable-line react-hooks/exhaustive-deps -- deviceAt and pickedKeys follow placed and the picks
  const change = (next: Project, message: string) => {
    // A hatch that lost its boundary in this change says so.
    const lost = view ? lostAssociation(sketchOf(project, view.file), sketchOf(next, view.file)) : 0;
    const said = lost && !message.includes('No longer associative') ? `${message} · HATCH  No longer associative` : message;
    onChange(next, said); cad.say(said); if (view) cad.markDirty(view.file);
  };
  const xr = useCadRefs({ project, view, tabOf: cad.tabOf, change, say: cad.say });
  const snapRef = snapOnce ? (x: number, y: number, r: number) => { const q = xr.snap(x, y, r); return q && q.kind & snapBit ? q : undefined; } : xr.snap;

  // Layer palette (LM): the drawing's layer record (current layer, layers added, states), its rows, and the changes made
  // there — each one undo step; the architect's On stays with the drawing open.
  const layerFile = layerFileOf(project, view?.file);
  const curLayer = currentLayerOf(project, view?.file);
  const lRows = useMemo(() => (view ? layerRows({ view, layersOn: archOn, sketch, styles, added: layerFile.layers, current: curLayer, refs: xr.placed }) : []), [view, archOn, sketch, styles, layerFile.layers, curLayer, xr.placed]);
  const layerChange = (next: Project, what: string) => {
    if (!view) return;
    if (next !== project) change(next, `${what} · ⌘Z to undo`); else cad.say(what);
  };
  // The same name can be a drawn layer and one of the architect's: it counts once.
  const layerNames = (list: { name: string }[]) => { const n = new Set(list.map((r) => r.name.toLowerCase())).size; return n === 1 ? `Layer ${list[0].name}` : `${n} layers`; };
  const isolateLayers = (keep: string[]) => {
    if (!view) return;
    const r = isolate(project, view.file, lRows, keep);
    layerChange(r.project, `LAYISO  ${keep.join(', ')} kept on, ${r.off} other layer${r.off === 1 ? '' : 's'} off (LAYUNISO puts them back)`);
  };
  const unisolateLayers = () => {
    const r = view && unisolate(project, view.file, lRows);
    if (!r) cad.say('LAYUNISO  Nothing is isolated.'); else layerChange(r, 'LAYUNISO  The layers Isolate turned off are back on');
  };
  // A frozen layer cannot be current (what is drawn on it would not show): every way of setting it comes here.
  const setCurrentLayer = (name: string) => {
    if (!view) return;
    if (styleOf(styles, name).freeze) { cad.say(`CLAYER  ${name} is frozen: thaw it first to make it current.`); return; }
    change(withCurrentLayer(project, view.file, name), `CLAYER  Current layer: ${name} · ⌘Z to undo`);
  };
  const addLayer = () => {
    const name = newLayerName(lRows.map((r) => r.name));
    if (view) change(withNewLayer(project, view.file, name), `LAYER  ${name} added · ⌘Z to undo`);
    return name;
  };
  // The layers of the objects picked: the drawn objects', and the architect's object clicked.
  const pickedLayers = () => [...new Set([...pickedSk.map((it) => it.layer), ...(result?.kind === 'object' && view?.info.layers[result.o.layer] ? [view.info.layers[result.o.layer].name] : [])])];
  /** LAYOFF, LAYFRZ, LAYLCK, LAYULK: the layers of the objects picked, all at once; what goes out of sight is unpicked. */
  const layerCmd = (cmd: string, patch: Pick<LayerPatch, 'on' | 'freeze' | 'lock'>, done: string) => {
    if (!view) { cad.say(`${cmd}  Open a drawing first.`); return; }
    const names = pickedLayers();
    if (!names.length) { cad.say(`${cmd}  Pick an object on the layer first, then ${cmd}.`); return; }
    const { rows, skipped } = layersToChange(lRows, names, patch, curLayer);
    const note = skipped ? ` (${skipped} is the current layer: not frozen)` : '';
    if (!rows.length) { cad.say(`${cmd}  Nothing to change${note}.`); return; }
    layerChange(applyLayerPatch(project, view.file, rows, patch), `${cmd}  ${layerNames(rows)} ${done}${note}`);
    if (patch.on === false || patch.freeze) { setPicked([]); cad.setSelected(null); setResult(null); }
  };
  /** LAYON, LAYTHW: every layer on, every layer thawed. */
  const allLayers = (cmd: string, patch: Pick<LayerPatch, 'on' | 'freeze'>, done: string) => {
    if (!view) { cad.say(`${cmd}  Open a drawing first.`); return; }
    const rows = lRows.filter((r) => ('on' in patch ? !r.on : r.freeze));
    if (!rows.length) cad.say(`${cmd}  Every layer is ${done} already.`); else layerChange(applyLayerPatch(project, view.file, rows, patch), `${cmd}  ${layerNames(rows)} ${done}`);
  };
  // Colour, linetype and lineweight: of the drawn objects picked, or of new objects while none is (absent = ByLayer).
  const newProps = useMemo(() => newPropsOf(project, view?.file), [project, view?.file]);
  const propLabel = (patch: ObjectProps) => ('color' in patch ? colourLabel(patch.color) : 'lt' in patch ? (patch.lt ? LINETYPES[patch.lt].label : 'ByLayer') : patch.lw === undefined ? 'ByLayer' : `${patch.lw.toFixed(2)} mm`);
  const setProps = (patch: ObjectProps) => {
    if (!view) { cad.say('Open a drawing first.'); return; }
    const what = 'color' in patch ? 'Colour' : 'lt' in patch ? 'Linetype' : 'Lineweight';
    if (pickedSk.length) change(pickedSk.reduce((q, it) => updateSketch(q, view.file, withProps(it, patch)), project), `${what} ${propLabel(patch)}: ${pickedSk.length} object${pickedSk.length === 1 ? '' : 's'} · ⌘Z to undo`);
    else change(withNewProps(project, view.file, patch), `${what} of new objects: ${propLabel(patch)} · ⌘Z to undo`);
  };
  // Model and layouts (paper space, src/components/cad/CadLayouts.tsx): the level's layouts, the one showing, its
  // viewports, the one picked and the one worked in (MS).
  const [mv, setMv] = useState(false);
  const [placing, setPlacing] = useState<TableKind | null>(null); // LEGEND / NOTES: the next click on the paper places the table
  const [renamingLayout, setRenamingLayout] = useState<string | null>(null);
  const [layoutDlg, setLayoutDlg] = useState<'templates' | 'paper' | 'scales' | null>(null); // Output → Layout: templates, the paper, the scale list
  const [maxFrom, setMaxFrom] = useState<string | null>(null); // VPMAX: the layout to go back to (VPMIN)
  useEffect(() => { if (cad.layout) setMaxFrom(null); }, [cad.layout]); // back on a layout by its tab: nothing is maximised any more
  const lv = floor ? { buildingId: floor.ref.building, levelId: floor.ref.level, name: floor.name } : undefined;
  const layouts = layoutsOf(project, lv);
  const sheetL = cad.layout ? layouts.find((s) => s.id === cad.layout) : undefined;
  /** The drawing file's own layout showing (paper space as saved in the file), when that tab is picked. */
  const fileL = fileLayoutOf(view?.layouts, cad.layout);
  /** The layouts made on this drawing here (+), and the one showing; shown on paper as the file's own are. */
  const dwgLayouts = drawingLayoutsOf(project, view?.file);
  const dwgL = drawingLayoutOf(dwgLayouts, cad.layout);
  const paperL = useMemo(() => fileL ?? (dwgL ? asFileLayout(dwgL, (view?.layouts.length ?? 0) + dwgLayouts.indexOf(dwgL) + 1) : undefined), [fileL, dwgL]); // eslint-disable-line react-hooks/exhaustive-deps -- by the layout
  const layoutNames = [...(view?.layouts ?? []).map((l) => l.name), ...dwgLayouts.map((l) => l.name)];
  const setDwgLayouts = (list: typeof dwgLayouts, what: string) => { if (view) change(withDrawingLayouts(project, view.file, list), `LAYOUT  ${what} · ⌘Z to undo`); };
  /** A layout made on the drawing (+): renamed, copied, moved along the tabs or deleted (its tab's menu and its paper's). */
  const drawingTabActs: { rename: (d: DrawingTab) => void; copy: (d: DrawingTab) => void; move: (d: DrawingTab, dir: -1 | 1) => void; remove: (d: DrawingTab) => void } = {
    rename: (d) => { setRenamingLayout(d.id); cad.say(`RENAME  Type the new name of ${d.name}:`); input.current?.focus(); },
    copy: (d) => { const l = drawingLayoutOf(dwgLayouts, d.id); if (!l) return; const c = { ...l, name: nextLayoutName(layoutNames), viewports: l.viewports.map((v) => ({ ...v })) }; setDwgLayouts([...dwgLayouts, c], `${l.name} copied as ${c.name}`); cad.setLayout(drawingLayoutId(c.name)); },
    move: (d, dir) => { const i = dwgLayouts.findIndex((l) => drawingLayoutId(l.name) === d.id), j = i + dir; if (i < 0 || j < 0 || j >= dwgLayouts.length) return; const list = [...dwgLayouts]; [list[i], list[j]] = [list[j], list[i]]; setDwgLayouts(list, `${d.name} moved ${dir < 0 ? 'left' : 'right'}`); },
    remove: (d) => { setDwgLayouts(dwgLayouts.filter((l) => drawingLayoutId(l.name) !== d.id), `${d.name} deleted`); if (cad.layout === d.id) cad.setLayout(null); }
  };
  const addDrawingLayout = () => {
    if (!view) return;
    const l = newDrawingLayout(nextLayoutName(layoutNames), view.info.extents, units.factor * 1000);
    setDwgLayouts([...dwgLayouts, l], `${l.name} — A3 paper, the whole drawing in one viewport at ${fileLayoutTitle(asFileLayout(l, 0), units.factor * 1000).split(' at ')[1] ?? '1:100'} · Page setup changes the paper`);
    cad.setLayout(drawingLayoutId(l.name));
  };
  useEffect(() => { if (cad.layout && !sheetL && !fileL && !dwgL) cad.setLayout(null); }, [cad.layout, sheetL, fileL, dwgL]); // eslint-disable-line react-hooks/exhaustive-deps -- a layout gone (deleted, another level)
  useEffect(() => { if (!sheetL) { setMv(false); setPlacing(null); } }, [sheetL]);
  const vps = sheetL ? layoutViewports(project, sheetL) : [];
  const msV = vps.find((v) => v.id === cad.msVp), selV = vps.find((v) => v.id === cad.vpSel);
  // The tables placed on the layout (src/model/sheetTables.ts); a picked one shares the viewport pick.
  const tables = sheetL ? tablesOf(sheetL) : [], selT = tables.find((t) => t.id === cad.vpSel);
  const setTables = (f: (list: typeof tables) => typeof tables, what: string) => { if (sheetL) change({ ...project, drawingSet: withTables(setOf(project), sheetL.id, f(tablesOf(sheetL))) }, `${sheetL.number || 'Layout'}  ${what} · ⌘Z to undo`); };
  const legendLabels = useMemo(() => (sheetL && selT?.kind === 'legend' ? planLegendLabels(project, sheetL) : []), [project, sheetL, selT?.kind]);
  /** The viewport a command acts on: the one worked in, else the one picked, else the only one. */
  const vpTarget = msV ?? selV ?? (vps.length === 1 ? vps[0] : undefined);
  // What the ribbon shows of this drawing (Layers, Properties and the layout tools): set when it changes, cleared on leaving the page.
  const vpState = vpTarget ? { locked: isLocked(vpTarget), frame: !!vpTarget.frame } : undefined;
  const ribbonInfo = useMemo<CadRibbonInfo | null>(() => {
    if (!view) return null;
    const shared = <K extends keyof ObjectProps>(k: K): ObjectProps[K] | 'varies' => { const v = new Set(pickedSk.map((it) => it[k])); return v.size > 1 ? 'varies' : [...v][0]; };
    return {
      layers: lRows.filter((r) => r.group === 'drawn').map((r) => ({ name: r.name, color: colourCss(r.color), on: r.on, freeze: r.freeze, lock: r.lock })), current: curLayer, picked: pickedSk.length, blocks: defs.map((d) => d.name),
      props: pickedSk.length ? { color: shared('color'), lt: shared('lt'), lw: shared('lw') } : newProps,
      scales: scalesOf(project), vp: vpState
    };
  }, [view, lRows, curLayer, pickedSk, newProps, defs, project.plot?.scales, vpState?.locked, vpState?.frame]); // eslint-disable-line react-hooks/exhaustive-deps -- the scale list, not the whole project
  // Set by what it says, not by identity: the page draws on every mouse move, and the ribbon redraws with what it sets.
  const ribbonKey = JSON.stringify(ribbonInfo);
  useEffect(() => { cad.setRibbonInfo(ribbonInfo); }, [ribbonKey]); // eslint-disable-line react-hooks/exhaustive-deps -- by value
  useEffect(() => () => cad.setRibbonInfo(null), []); // eslint-disable-line react-hooks/exhaustive-deps -- on leaving the page

  const setVps = (f: (list: PlanViewport[]) => PlanViewport[], what: string) => { if (sheetL) change(changeViewports(project, sheetL, f), `${sheetL.number || 'Layout'}  ${what} · ⌘Z to undo`); };
  const patchVp = (v: PlanViewport, patch: Partial<PlanViewport>, what: string) => setVps((l) => patchViewport(l, v.id, patch), `${vpName(vps, v.id)}: ${what}`);
  const addLayout = (type: PlanType) => {
    if (!lv) { cad.say('LAYOUT  Add the building and its levels in Building information first: a layout is a plan sheet of a level.'); return; }
    const r = newLayout(setOf(project), lv, type);
    change({ ...project, drawingSet: r.set }, `LAYOUT  ${r.set.sheets.find((x) => x.id === r.id)?.number ?? ''} ${lv.name} · ${PLAN_LABEL[type]} — a new layout and plan sheet · ⌘Z to undo`);
    cad.setLayout(r.id);
  };
  const PAPER_TOOLS: Record<string, MarkupTool> = { T: 'text', TEXT: 'text', NOTE: 'text', CLOUD: 'cloud', REVCLOUD: 'cloud', LE: 'callout', LEADER: 'callout', CALLOUT: 'callout', ARROW: 'arrow', L: 'line', LINE: 'line', REC: 'rect', RECTANG: 'rect' };
  /** Layout commands (and LAYOUT / MODEL from the Model tab); true when the command was one. */
  function layoutCmd(c: string): boolean {
    const [w, arg] = c.split(' ');
    const layoutShowing = !!(sheetL || fileL || dwgL), mpu = units.factor * 1000;
    const PORTS_HELP = 'VPORTS  Type VPORTS and an arrangement: 1, 2V, 2H, 3L, 3R, 3A, 3B, 4 or KEY (Output → Layout viewports → Arrange lists them).';
    if ((w === 'LAYOUT' || w === 'LO') && (arg === 'T' || arg === 'TEMPLATE')) { if (view) setLayoutDlg('templates'); else cad.say('LAYOUT  Open a drawing first.'); return true; }
    if ((w === 'LAYOUT' || w === 'LO') && (arg === 'S' || arg === 'SAVEAS')) { if (layoutShowing) setLayoutDlg('templates'); else cad.say('LAYOUT  Open a layout tab first: a template keeps its paper, viewports and tables.'); return true; }
    if (w === 'SCALELISTEDIT') { setLayoutDlg('scales'); return true; }
    if (w === 'VPMIN') {
      const back = maxFrom && (layouts.some((x) => x.id === maxFrom) || drawingLayoutOf(dwgLayouts, maxFrom) || fileLayoutOf(view?.layouts, maxFrom)) ? maxFrom : null;
      if (back) { cad.setLayout(back); setMaxFrom(null); cad.say('VPMIN  Back on the layout.'); } else cad.say('VPMIN  No viewport is maximised (VPMAX on a layout first).');
      return true;
    }
    if (dwgL && w === 'VPORTS') {
      const a = arrangementOf(arg ?? '');
      if (!a) cad.say(PORTS_HELP);
      else setDwgLayouts(dwgLayouts.map((l) => (l === dwgL ? arrangeDrawingViewports(dwgL, a, view!.info.extents, mpu) : l)), `${dwgL.name}: viewports arranged, ${a.label.toLowerCase()}`);
      return true;
    }
    if (dwgL && w === 'VPFIT') {
      setDwgLayouts(dwgLayouts.map((l) => (l === dwgL ? fitDrawingViewports(dwgL, view!.info.extents, mpu) : l)), `${dwgL.name}: the whole drawing in ${dwgL.viewports.length} viewport${dwgL.viewports.length === 1 ? '' : 's'}`);
      return true;
    }
    if (dwgL && w === 'VPSCALE') {
      const n = Math.round(Number(/^(?:1:)?(\d+(?:\.\d+)?)$/.exec(arg ?? '')?.[1]));
      if (n > 0 && dwgL.viewports.length === 1) setDwgLayouts(dwgLayouts.map((l) => (l === dwgL ? { ...l, viewports: l.viewports.map((q) => ({ ...q, vh: (q.h * n) / mpu })) } : l)), `${dwgL.name}: viewport at 1:${n}`);
      else if (n > 0) cad.say(`VPSCALE  ${dwgL.name} has ${dwgL.viewports.length} viewports: right-click inside one for its Viewport scale.`);
      else cad.say(`VPSCALE  ${dwgL.name} is at ${dwgL.viewports.map((q) => `1:${viewportScaleN(q, mpu)}`).join(', ') || 'no viewport'}. Type VPSCALE and a scale, e.g. VPSCALE 50.`);
      return true;
    }
    if (dwgL && w === 'VPMAX') {
      const v = dwgL.viewports[0];
      if (!v || !(v.h > 0)) { cad.say(`VPMAX  ${dwgL.name} has no viewport.`); return true; }
      const vw = (v.vh * v.w) / v.h;
      setMaxFrom(cad.layout); cad.setLayout(null);
      setTimeout(() => zoomTo({ kind: 'window', a: [v.cx - vw / 2, v.cy - v.vh / 2], b: [v.cx + vw / 2, v.cy + v.vh / 2] }));
      cad.say(`VPMAX  ${dwgL.name}: the viewport's area on the Model tab. VPMIN or the layout's tab goes back to the paper.`);
      return true;
    }
    if (dwgL && w === 'PAGESETUP') { setLayoutDlg('paper'); return true; }
    if (w === 'LAYOUT' || w === 'LO') {
      // LAYOUT alone: a layout of the drawing; LAYOUT L / P / E / C: a plan sheet of the level.
      const t = arg ? PLAN_TYPES.find((x) => x.toUpperCase().startsWith(arg)) : undefined;
      if (t) addLayout(t); else addDrawingLayout();
      return true;
    }
    if (w === 'MODEL') { cad.setLayout(null); return true; }
    if (paperL && /^(MV|MVIEW|MS|MSPACE|PS|PSPACE|VPSCALE|VPLOCK|LEGEND|LG|NOTES|VPORTS|VPFIT|VPCOPY|VPALIGN|VPFRAME|VPMAX|PAGESETUP)$/.test(w)) {
      cad.say(fileL ? `${w}  ${fileL.name} is the drawing file's own layout, shown as it was saved; its viewports are not changed here yet. The project's plan sheets (right-click a tab) can be.`
        : `${w}  ${paperL.name} is a layout of the drawing: its viewports take Arrange (VPORTS), Fit (VPFIT), a scale and Page setup. ${w} works on the project's plan sheets (right-click a tab).`);
      return true;
    }
    if (!sheetL) return false;
    if (w === 'MV' || w === 'MVIEW') { cad.setMsVp(null); setMv(true); cad.say('MVIEW  Click two corners of the new viewport on the paper:'); return true; }
    if (w === 'MS' || w === 'MSPACE') { const v = vpTarget ?? vps[0]; if (v) { cad.setMsVp(v.id); cad.say(`MSPACE  Working in the model through ${vpName(vps, v.id)} (1:${v.scale}${isLocked(v) ? ', locked' : ''}). PS or a double-click outside returns to the paper.`); } return true; }
    if (w === 'PS' || w === 'PSPACE') { cad.setMsVp(null); cad.say('PSPACE  On the paper.'); return true; }
    if (w === 'VPSCALE') {
      const v = vpTarget, k = Math.round(Number(/^(?:1:)?(\d+(?:\.\d+)?)$/.exec(arg ?? '')?.[1]));
      if (!v) cad.say('VPSCALE  Pick a viewport first (click its frame).');
      else if (!(k > 0)) cad.say(`VPSCALE  ${vpName(vps, v.id)} is at 1:${v.scale}. Type VPSCALE and a scale, e.g. VPSCALE 50.`);
      else patchVp(v, { scale: k }, `scale 1:${k}`);
      return true;
    }
    if (w === 'VPLOCK') { const v = vpTarget; if (!v) cad.say('VPLOCK  Pick a viewport first (click its frame).'); else patchVp(v, isLocked(v) ? { locked: false } : { locked: undefined }, isLocked(v) ? 'unlocked: pan and zoom inside it move its view' : 'locked'); return true; }
    if (w === 'VPORTS') {
      const a = arrangementOf(arg ?? ''), region = layoutRegion(project, sheetL), ext = layoutExtent(project, sheetL);
      if (!a) cad.say(PORTS_HELP);
      else if (!region || !ext) cad.say("VPORTS  This layout's level has nothing on it yet.");
      else {
        const centre: Pt = [(ext.x0 + ext.x1) / 2, (ext.y0 + ext.y1) / 2];
        setVps((l) => arrangeViewports(l, a, region, { at: centre, scale: sheetScale(sheetL.scale) }, centre), `viewports arranged: ${a.label.toLowerCase()}`);
        cad.setVpSel(null); cad.setMsVp(null);
      }
      return true;
    }
    if (w === 'VPCOPY') {
      const v = vpTarget, area = layoutPaper(project, sheetL)?.area;
      if (!v || !area) cad.say('VPCOPY  Pick a viewport first (click its frame).');
      else { const n = vps.length + 1; setVps((l) => copyViewport(l, v.id, area), `${vpName(vps, v.id)} copied as Viewport ${n}`); cad.setVpSel(vpId(vps)); }
      return true;
    }
    if (w === 'VPFIT') {
      const v = vpTarget, ext = layoutExtent(project, sheetL);
      if (!v) cad.say('VPFIT  Pick a viewport first (click its frame).');
      else if (!ext) cad.say("VPFIT  This layout's level has nothing on it yet.");
      else { const f = fitView(v, ext, scalesOf(project)); patchVp(v, f, `the whole level at 1:${f.scale}`); }
      return true;
    }
    if (w === 'VPALIGN') {
      const v = vpTarget, dir = arg === 'H' || arg === 'V' ? (arg.toLowerCase() as 'h' | 'v') : undefined;
      if (!v) cad.say('VPALIGN  Pick a viewport first (click its frame).');
      else if (v.id === vps[0].id) cad.say('VPALIGN  Pick another viewport: the others line up with Viewport 1.');
      else if (!dir) cad.say('VPALIGN  Type VPALIGN H (side by side) or VPALIGN V (stacked).');
      else patchVp(v, { at: alignView(vps[0], v, dir) }, `lined up with Viewport 1 (${dir === 'h' ? 'side by side' : 'stacked'})`);
      return true;
    }
    if (w === 'VPFRAME') { const v = vpTarget; if (!v) cad.say('VPFRAME  Pick a viewport first (click its frame).'); else patchVp(v, { frame: v.frame ? undefined : true }, v.frame ? 'frame on screen only' : 'frame prints'); return true; }
    if (w === 'VPMAX') {
      const v = vpTarget;
      if (!v) { cad.say('VPMAX  Pick a viewport first (click its frame).'); return true; }
      const win = vpWindow(v), k = units.factor;
      setMaxFrom(sheetL.id); cad.setMsVp(null); cad.setLayout(null);
      setTimeout(() => zoomTo({ kind: 'window', a: [win.x0 / k, win.y0 / k], b: [win.x1 / k, win.y1 / k] }));
      cad.say(`VPMAX  ${vpName(vps, v.id)}: its area on the Model tab (1:${v.scale}). VPMIN or the layout's tab goes back to the paper.`);
      return true;
    }
    if (w === 'LEGEND' || w === 'LG' || w === 'NOTES') {
      const kind: TableKind = w === 'NOTES' ? 'notes' : 'legend';
      cad.setMsVp(null); setMv(false); setPlacing(kind);
      cad.say(`${w}  Click where the ${kind} table's top left corner goes on the paper${kind === 'legend' ? ' (its rows follow the plan; pick its frame for the width, rows and columns)' : ' (the sheet\'s notes go in it)'}:`);
      return true;
    }
    if (w === 'PAGESETUP') { onSheet?.(sheetL.id); return true; }
    if (w === 'PLOT') { onPlot(sheetL.id); return true; }
    if (!msV && PAPER_TOOLS[w] && !arg) {
      if (!paperTool) return false;
      paperTool(PAPER_TOOLS[w]);
      cad.say(`${w}  On the paper: drag where it goes (Esc stops).`);
      return true;
    }
    return false;
  }
  const unitName = (insunits?: number) => CAD_UNITS.find((u) => u.code === insunits)?.id;
  async function startAttach() {
    setShowXR(false);
    const d = await xr.actions.attach();
    if (d) { setXDraft(d); cad.say(`XATTACH  ${d.file}: choose where it goes, then Attach.`); }
  }
  function startClip(r: CadRef) { setShowXR(false); setXClip({ name: r.name, outline: false }); setPoints([]); cad.setTool('xclip'); }
  function finishClip(pts: Pt[]) {
    const r = xr.refs.find((x) => x.name === xClip?.name);
    if (!r) { cad.setTool('none'); return; }
    const outline = pts.length === 2 ? rectangle(pts[0], pts[1]) : pts;
    if (outline.length < 3) { cad.say('XCLIP  Click two corners (a rectangle) or three or more, then Enter:'); return; }
    xr.actions.update(r, { clip: outline }, `clipped to ${pts.length === 2 ? 'a rectangle' : `an outline of ${outline.length} corners`}`);
    setPoints([]); setXClip(null); cad.setTool('none');
  }
  /** CROP on a block of the drawing: asked first when it is on a circuit (Loads from CAD counts it), else its outline. */
  function cropOf(o: CadObject): { state: CropState; say: string } {
    const target = { handle: o.handle, label: o.block ?? 'The block' };
    const cct = Object.entries(o.attrs ?? {}).find(([k, v]) => CIRCUIT_ATTRIBUTES.includes(k.toUpperCase()) && v.trim());
    return cct ? { state: { step: 'confirm', target }, say: `CROP  ${target.label} is on circuit ${cct[1]} (counted in Loads from CAD). Cropped, it is plain geometry and no longer counts as a load. Crop it? [Yes/No] <No>:` }
      : { state: { step: 'outline', target }, say: CROP_OUTLINE };
  }
  /** CROP: a click picks the block (or a drawn item), a corner, the circle's centre or radius, or a closed object. */
  async function cropClick(at: Pt, pixel: number) {
    if (!view || !crop) return;
    if (crop.step === 'pick') {
      const sk = hitAt(pickable, at, pickR * pixel);
      if (sk) { setCrop({ step: 'outline', target: { items: [sk.id], label: '1 drawn object' } }); cad.say(CROP_OUTLINE); return; }
      const o = await view.pick(at[0], at[1], pickR * pixel, pickOn);
      if (!o || o.kind !== 'Block') { cad.say(o ? `CROP  That is a ${o.kind.toLowerCase()}, not a block (references: XCLIP). Select a block to crop:` : 'CROP  No block there. Select a block to crop:'); return; }
      const c = cropOf(o); setCrop(c.state); cad.say(c.say); return;
    }
    if (crop.step === 'outline') { setPoints((p) => [...p, at]); cad.say(`CROP  Next corner${points.length ? ', Enter to finish' : ''}:`); return; }
    if (crop.step === 'centre') { setCrop({ ...crop, step: 'radius', centre: at }); cad.say('CROP  Radius of the circle (click or type):'); return; }
    if (crop.step === 'radius' && crop.centre) { cropOutline({ kind: 'circle', c: crop.centre, r: distance(crop.centre, at) }); return; }
    if (crop.step === 'object') {
      const b = await outlineAround(at);
      if (!b) { cad.say('CROP  No closed outline around that point. Click inside one, or Esc:'); return; }
      cropOutline(b);
    }
  }
  /** CROP: what is typed — Yes / No, Enter (finish the corners), Circle, Object, a corner, a radius, Inside / Outside. */
  function cropTyped(c: string, raw: string): boolean {
    if (!crop) return false;
    if (crop.step === 'confirm') {
      if (c === 'Y' || c === 'YES') { setCrop({ ...crop, step: 'outline' }); cad.say(CROP_OUTLINE); } else { cad.say('CROP  Not cropped.'); cad.setTool('none'); }
      return true;
    }
    if (crop.step === 'outline') {
      if (c === '') {
        const outline = points.length === 2 ? rectangle(points[0], points[1]) : points;
        if (outline.length < 3) { cad.say('CROP  Click two corners (a rectangle) or three or more, then Enter:'); return true; }
        cropOutline({ kind: 'polygon', pts: outline }); return true;
      }
      if (c === 'C' || c === 'CIRCLE') { setPoints([]); setCrop({ ...crop, step: 'centre' }); cad.say('CROP  Centre of the circle:'); return true; }
      if (c === 'O' || c === 'OBJECT') { setPoints([]); setCrop({ ...crop, step: 'object' }); cad.say('CROP  Click inside a closed polyline, circle or room:'); return true; }
      const p = typedPoint(raw, points[points.length - 1], cursor.at);
      if (p) { setPoints((q) => [...q, p]); cad.say(`CROP  Next corner, Enter to finish:`); return true; }
      return false;
    }
    if (crop.step === 'radius' && crop.centre && isNumber(c) && Number(c) > 0) { cropOutline({ kind: 'circle', c: crop.centre, r: Number(c) }); return true; }
    if (crop.step === 'side') {
      if (c === '' || c === 'I' || c === 'INSIDE') { void doCrop('inside'); return true; }
      if (c === 'O' || c === 'OUTSIDE') { void doCrop('outside'); return true; }
      cad.say('CROP  [Inside/Outside] <Inside>:'); return true;
    }
    return c === '';
  }
  function cropOutline(b: CropBoundary) { setPoints([]); setCrop((q) => (q ? { ...q, step: 'side', outline: b } : q)); cad.say('CROP  [Inside/Outside] <Inside>:'); }
  /** The smallest closed outline around a point: a closed drawn item, a room, or a closed object of the drawing (its
   * arcs kept exact, from the engine). */
  async function outlineAround(at: Pt): Promise<CropBoundary | undefined> {
    if (!view || !drawn) return undefined;
    const rooms = floor ? buildingInfoOf(project).rooms.filter((q) => q.buildingId === floor.ref.building && q.levelId === floor.ref.level && (q.outline?.length ?? 0) > 2).map((q) => q.outline!.map(([x, y]): Pt => [x / units.factor, y / units.factor])) : [];
    const h = hatchOutline(pickable, at, rooms);
    const mine = h ? { a: h.circle ? Math.PI * h.circle.r ** 2 : areaOf(h.pts).area, b: (h.circle ? { kind: 'circle', ...h.circle } : { kind: 'polygon', pts: h.pts }) as CropBoundary } : undefined;
    const around = drawn.outlines().filter((o) => pickOn[o.layer] && o.area !== undefined && (!mine || o.area < mine.a) && inside(at, outlinePoints(drawn, o))).sort((p, q) => p.area! - q.area!)[0];
    if (around) {
      const { pieces } = await explodeObjects(view, [around.handle]);
      const b = pieces[around.handle]?.map(boundaryOfPiece).find(Boolean);
      if (b) return b;
    }
    if (mine) return mine.b;
    const q = roomAround(walls, at, units.factor);
    return q ? { kind: 'polygon', pts: q.points } : undefined;
  }
  /** HATCH → Import .pat…: the file's patterns join the project's (one of the same name replaced); the first is picked. */
  function importPat(text: string, name: string) {
    const { patterns, errors } = parsePat(text);
    const left = errors.length ? ` ${errors.length} problem${errors.length === 1 ? '' : 's'}: ${errors[0]}${errors.length > 1 ? ' …' : ''}` : '';
    if (!patterns.length) { cad.say(`HATCH  No patterns read from ${name}.${left}`); return; }
    const msg = `HATCH  ${patterns.length} pattern${patterns.length === 1 ? '' : 's'} imported from ${name}, kept with the project${hatchOpts.keep ? ' and on this computer' : ''}.${left} · ⌘Z to undo`;
    if (hatchOpts.keep) setComputerPats(keepComputerPatterns(patterns));
    onChange({ ...project, cadPatterns: withPatterns(project.cadPatterns, patterns) }, msg);
    cad.say(msg);
    setHatchSet(specWith(hatchSet, patterns[0]));
  }
  /** HATCH → Export .pat…: every pattern in the list (built in, this project's, those kept on this computer) as a .pat file. */
  async function exportPat() {
    const all = withPatterns(withPatterns(builtInAsCustom(), computerPats), project.cadPatterns ?? []);
    const done = await saveText('hatch-patterns.pat', formatPat(all), 'Hatch pattern file', 'pat');
    cad.say(done ? `HATCH  ${all.length} patterns exported. ${done}` : 'HATCH  Export cancelled.');
  }
  /** The room outlines of this level (drawing units). */
  const roomOutlines = (): Pt[][] => (floor ? buildingInfoOf(project).rooms.filter((r) => r.buildingId === floor.ref.building && r.levelId === floor.ref.level && (r.outline?.length ?? 0) > 2).map((r) => r.outline!.map(([x, y]): Pt => [x / units.factor, y / units.factor])) : []);
  /** The area around a point for HATCH and BOUNDARY: the smallest closed drawn object, else the smallest room, else the
   * area the walls close, else the area the drawn lines close; with its islands (closed drawn objects inside) if asked. */
  function areaAround(at: Pt, islands: boolean): NonNullable<ReturnType<typeof hatchOutline>> | undefined {
    const o = hatchOutline(pickable, at, roomOutlines(), islands);
    if (o) return o;
    const drawn = pickable.filter((it) => !it.hatch && it.kind !== 'text' && it.kind !== 'mtext' && it.kind !== 'attdef' && it.kind !== 'dim' && it.kind !== 'point').flatMap((it) => segmentsOf(it, units.factor, defs));
    const room = roomAround(walls, at, units.factor), r = room ?? roomAround([...walls, ...drawn], at, units.factor);
    if (!r) return undefined;
    const isl = islands ? islandsIn(pickable, { pts: r.points }) : { holes: [], ids: [] };
    return { pts: r.points, from: room ? 'room' : 'lines', holes: isl.holes, islandIds: isl.ids };
  }
  /** The hatch at a point: one whose edge is near it, else the smallest one it lies inside (not in an island). */
  function hatchAtPoint(at: Pt, pixel: number): SketchItem | undefined {
    const hatches = pickable.filter((x) => x.hatch);
    return itemAt(hatches, at, pickR * pixel, defs) ?? hatches.filter((x) => inside(at, hatchOutlinePts(x)) && !(x.holes ?? []).some((h) => inside(at, h))).sort((a, b) => hatchArea(a) - hatchArea(b))[0];
  }
  /** The hatches being edited (HE), as they are now. */
  const heItems = useMemo(() => sketch.filter((x) => x.hatch && heIds.includes(x.id)), [sketch, heIds]);
  /** HE on these hatches, with a click asked of the first at once (the pattern's origin, islands) when `phase` is set. */
  function startHatchEdit(items: SketchItem[], phase: 'origin' | 'add' | 'remove' | null) {
    const ids = items.filter((x) => x.hatch).map((x) => x.id);
    if (!ids.length) return;
    pick([], items.filter((x) => x.hatch));
    if (tool === 'hatchedit') { setHeIds(ids); setHePhase(phase); cad.say(hatchEditSay(phase, ids.length)); }
    else { heNext.current = { ids, phase }; cad.setTool('hatchedit'); setTimeout(() => cad.say(hatchEditSay(phase, ids.length))); }
  }
  const hatchEditSay = (phase: 'origin' | 'add' | 'remove' | null, n: number) => (phase === 'origin' ? 'HATCHEDIT  Click the pattern\'s origin:'
    : phase === 'add' ? 'HATCHEDIT  Click inside closed objects in the hatch to keep clear (Enter ends):'
    : phase === 'remove' ? 'HATCHEDIT  Click inside an island to hatch it again (Enter ends):'
    : `HATCHEDIT  ${n} hatch${n === 1 ? '' : 'es'} selected: change ${n === 1 ? 'it' : 'them'} in the panel on the right, or click another hatch (Enter ends)`);
  /** One undo step: the hatches being edited changed by `fn`. */
  function heUpdate(fn: (it: SketchItem) => SketchItem, what: string) {
    if (!view || !heItems.length) return;
    change(heItems.reduce((p, it) => updateSketch(p, fileOf(), fn(it)), project), `HATCHEDIT  ${what} · ⌘Z to undo`);
  }
  /** The panel changed the pattern, spacing or angle: only what changed goes to every hatch edited. */
  function heSpec(next: HatchSpec) {
    const base = heItems[0]?.hatch;
    if (!base) return;
    const pat = next.pattern !== base.pattern || next.custom?.name !== base.custom?.name, sc = next.scale !== base.scale;
    heUpdate((it) => {
      const { custom: _c, ...own } = it.hatch!, custom = pat ? next.custom : it.hatch!.custom;
      return { ...it, hatch: { ...own, pattern: pat ? next.pattern : own.pattern, scale: sc ? next.scale : own.scale, angle: !pat && !sc ? next.angle : own.angle, ...(custom ? { custom } : {}) } };
    }, pat ? `Pattern ${next.custom?.name ?? next.pattern.toUpperCase()}` : sc ? `Spacing ${next.scale} mm` : `Angle ${next.angle}°`);
  }
  /** A click while HATCHEDIT asks for one: the origin, an island to keep clear, or an island to hatch again. */
  function heClick(at: Pt, pixel: number) {
    const h = heItems[0];
    if (hePhase && h) {
      if (hePhase === 'origin') { heUpdate((it) => ({ ...it, hatch: { ...it.hatch!, origin: at } }), `Origin ${m(toM(at[0]))}, ${m(toM(at[1]))}`); setHePhase(null); return; }
      if (hePhase === 'add') {
        const o = hatchOutline(pickable.filter((x) => x.id !== h.id), at, [], false);
        const loop = o ? (o.circle ? circlePts(o.circle.c, o.circle.r, 32) : o.pts) : undefined, id = o?.ids?.[0];
        if (!loop || !loop.every((q) => inside(q, hatchOutlinePts(h)))) { cad.say('HATCHEDIT  No closed object inside the hatch there. Click inside one, or Enter:'); return; }
        if ((id && h.assoc?.includes(id)) || (h.holes ?? []).some((x) => x.length === loop.length && x.every((q, i) => q[0] === loop[i][0] && q[1] === loop[i][1]))) { cad.say('HATCHEDIT  That object is an island already. Click another, or Enter:'); return; }
        const follows = isAssociative(h, sketch) && !!id;
        heUpdate((it) => ({ ...it, holes: [...(it.holes ?? []), loop], ...(follows ? { assoc: [...it.assoc!, id!] } : {}) }), `Island added (${(h.holes?.length ?? 0) + 1})`);
        return;
      }
      // Remove: the smallest island around the click.
      const i = (h.holes ?? []).map((x, j) => ({ x, j })).filter(({ x }) => inside(at, x)).sort((a, b) => hatchArea({ kind: 'pline', pts: a.x }) - hatchArea({ kind: 'pline', pts: b.x }))[0]?.j;
      if (i === undefined) { cad.say('HATCHEDIT  No island there. Click inside one, or Enter:'); return; }
      const follows = isAssociative(h, sketch);
      heUpdate((it) => { const holes = it.holes!.filter((_, j) => j !== i), { holes: _h, ...rest } = it; return { ...rest, ...(holes.length ? { holes } : {}), ...(follows ? { assoc: it.assoc!.filter((_, j) => j !== i + 1) } : {}) }; }, `Island hatched again (${(h.holes?.length ?? 1) - 1} left)`);
      return;
    }
    const hit = hatchAtPoint(at, pixel);
    if (!hit) { cad.say('HATCHEDIT  Nothing there. Select a hatch:'); return; }
    startHatchEdit([hit], null);
  }
  /** CROP: cuts the block (or drawn items) along the outline; the kept pieces become drawn items, the block is erased. */
  async function doCrop(side: CropSide) {
    if (!view || !crop?.target || !crop.outline) return;
    const { target, outline } = crop, file = view.file;
    const again = (why: string) => { cad.say(`CROP  ${why}`); setCrop({ ...crop, step: 'outline', outline: undefined }); cad.say(CROP_OUTLINE); };
    try {
      if ('items' in target) {
        const its = sketch.filter((x) => target.items.includes(x.id)), r = cropItems(its, outline, side);
        if (r.error) { again(r.error); return; }
        const next = r.items!.reduce((q, x) => addSketch(q, file, x).project, its.reduce((q, x) => removeSketch(q, file, x.id), project));
        change(next, `CROP  ${cropNote(r)} · ${its.length} drawn object${its.length === 1 ? '' : 's'} replaced · ⌘Z to undo`);
      } else {
        const { pieces, truncated } = await explodeObjects(view, [target.handle]);
        // Hatches keep the drawing's pattern lines (at 1:100, as drawn hatches are spaced).
        const r = cropPieces(pieces[target.handle] ?? [], outline, side, hatchLookup(view, 0.1 / units.factor));
        if (r.error) { again(r.error); return; }
        const next = r.items!.reduce((q, x) => addSketch(q, file, x).project, withErased(project, file, [target.handle]));
        change(next, `CROP  ${cropNote(r)}${truncated ? ' (a very large array: its first 200,000 pieces)' : ''} · original block erased · ⌘Z to undo`);
      }
    } catch (e) { cad.say(`CROP  ${e instanceof Error ? e.message : String(e)}`); }
    setCrop(null); setPicked([]); cad.setSelected(null); setResult(null); cad.setTool('none');
  }
  /** What an object of the opened drawing is called in a message: "Line on A-WALL", "Block L1 on E-LIGHT". */
  const dwLabel = (o: CadObject) => `${o.kind}${o.block ? ` ${o.block}` : ''} on ${view?.info.layers[o.layer]?.name ?? '?'}`;
  function removeSelected() {
    // Objects of the opened drawing (with any devices and drawn objects picked too): erased by handle, in one change.
    if (pickedDw.length && view) {
      let next = withErased(project, view.file, pickedDw.map((o) => o.handle));
      if (pickedItems.length) next = deleteDevices(next, pickedItems);
      for (const it of pickedSk) next = removeSketch(next, view.file, it.id);
      const n = pickedDw.length + pickedItems.length + pickedSk.length;
      change(next, `${n === 1 ? dwLabel(pickedDw[0]) : `${n} objects`} erased (the drawing file is unchanged; RESTOREDWG brings erased drawing objects back)${pickedItems.length ? ' — point counts updated' : ''} · ⌘Z to undo`);
      setPicked([]); cad.setSelected(null); setResult(null); return;
    }
    if (selSketch && view) { change(removeSketch(project, view.file, selSketch.id), `${selSketch.tray ? 'Cable tray' : selSketch.cable ? 'Cable route' : selSketch.kind === 'pline' ? 'Polyline' : selSketch.kind[0].toUpperCase() + selSketch.kind.slice(1)} erased · ⌘Z to undo`); cad.setSelected(null); setResult(null); return; }
    if (many) {
      let next = pickedItems.length ? deleteDevices(project, pickedItems) : project;
      if (view) for (const it of pickedSk) next = removeSketch(next, view.file, it.id);
      change(next, `${pickedItems.length + pickedSk.length} objects erased${pickedItems.length ? ' — point counts updated' : ''} · ⌘Z to undo`);
      setPicked([]); cad.setSelected(null); setResult(null); return;
    }
    if (!selectedItem) { cad.say('ERASE  Select an object first (click it).'); return; }
    change(selectedItem.what === 'elv' ? removeElv(project, selectedItem.id) : removeItem(project, selectedItem), `${selectedItem.label} deleted${selectedItem.what === 'lv' ? ` — taken off ${selectedItem.detail.split(' · ')[0]}` : ''} · ⌘Z to undo`);
    cad.setSelected(null); setResult(null);
  }
  /** Save / Save As: the drawing as received with what was drawn, the devices placed and the wiring (as chosen), as a
   * copy — the architect's drawing is never written. `again` writes over the copy saved before (the desktop app: only a
   * file chosen in its save dialog this session); `keep` records it as where Save goes next. */
  async function writeCopy(c: SavedCopy, again: boolean, keep = true): Promise<boolean> {
    if (!view) return false;
    try {
      const out = !c.devices ? [] : placed.map((d) => ({ layer: d.what === 'lv' ? 'E-LV-POINTS' : d.what === 'elv' ? 'E-ELV-DEVICES' : 'E-BOARDS', x: d.x / units.factor, y: d.y / units.factor, r: rUnits * (d.what === 'board' ? 2 : 1), text: d.symbol.text, label: d.what === 'lv' ? d.detail.split(' · ')[0] : d.label }));
      const wired = c.wiring ? wiring : [];
      const wires = wired.flatMap((w) => [...w.arcs, ...(w.home ? [w.home] : [])].map((a) => ({ layer: WIRING_LAYER, kind: 'pline' as const, pts: arcPoints(toUnits(a)) })));
      const tags = wired.map((w) => ({ layer: TAG_LAYER, kind: 'text' as const, pts: [[w.tagAt[0] / units.factor, w.tagAt[1] / units.factor] as Pt], text: w.tag, h: textH * 0.6, rot: 0 }));
      const refLines = c.bind ? xr.bound() : [];
      const drawn = c.drawn ? sketch : [];
      const bytes = await drawingWithDevices(view, out, [...shapesOut(drawn, units.factor), ...blockDefsOut(defs, units.factor), pointStyleOut(pointStyleOf(project)), ...wires, ...tags, ...refLines], c.as, erasedKey ? erasedKey.split(',') : [], c.version);
      const over = again && c.path ? window.lvds?.files?.overwriteBinary : undefined;
      let r: { message: string; path?: string; name: string } | null;
      if (over && c.path) { await over({ file: c.path, bytes, bak: draft.keepBak }); r = { message: `Saved ${c.name}`, path: c.path, name: c.name }; }
      else r = await saveBinaryAt(c.name, bytes, c.as === 'dwg' ? 'DWG drawing' : 'DXF drawing', c.as, c.as === 'dwg' ? 'application/acad' : 'application/dxf');
      if (!r) return false;
      if (keep) { cad.saved.current.set(view.file.toLowerCase(), { ...c, name: r.name, path: r.path }); cad.markDirty(view.file, false); }
      cad.say(`SAVE  ${r.message} (${out.length} device${out.length === 1 ? '' : 's'} on E-LV-POINTS / E-ELV-DEVICES / E-BOARDS, ${drawn.length} drawn object${drawn.length === 1 ? '' : 's'} on ${DRAW_LAYER} / ${ANNO_LAYER}${refLines.length ? `, ${boundText(refLines)} bound on NAME$0$LAYER layers` : ''}${wired.length ? `, ${wired.length} circuit${wired.length === 1 ? '' : 's'} wired on ${WIRING_LAYER} / ${TAG_LAYER}` : ''})`);
      onStatus(r.message);
      return true;
    } catch (e) { const msg = e instanceof Error ? e.message : String(e); cad.say(msg); onStatus(msg); return false; }
  }
  const [saveAs, setSaveAs] = useState<SavedCopy | null>(null);
  /** What Save As starts with for this drawing: the copy saved last, else a new name in the format set (DS). */
  const copyOf = (as?: 'dwg' | 'dxf', bind = false): SavedCopy | null => {
    if (!view) return null;
    const last = cad.saved.current.get(view.file.toLowerCase());
    const own = /^DXF/i.test(view.info.format) ? 'dxf' : 'dwg';
    const fmt = as ?? last?.as ?? (draft.saveFormat === 'own' ? own : draft.saveFormat);
    const base = last ? last.name.replace(/\.(dwg|dxf)$/i, '') : `${view.file.replace(/\.(dwg|dxf)$/i, '')} - with devices${bind ? ' and references' : ''}`;
    return { ...(last ?? { drawn: true, devices: true, wiring: true }), bind: bind || !!last?.bind, path: last?.path, name: `${base}.${fmt}`, as: fmt, version: as && as !== last?.as ? '' : last?.version ?? '' };
  };
  const startSaveAs = (as?: 'dwg' | 'dxf', bind = false) => { const c = copyOf(as, bind); if (c) { setSaveAs(c); cad.say('SAVEAS  The file name, format and what goes in:'); } else cad.say('SAVEAS  Open a drawing first.'); };
  /** Save: to the copy saved last; the first time, Save As. */
  const saveNow = async () => {
    if (!view) { cad.say('SAVE  Open a drawing first.'); return false; }
    const c = cad.saved.current.get(view.file.toLowerCase());
    if (!c) { startSaveAs(); return false; }
    return writeCopy(c, true);
  };
  // File → Export: what is on screen (PDF in black and white, or PNG), the objects picked, or the lists of the plan.
  const page = useRef<HTMLElement>(null);
  /** The drawing as on screen, as a PNG data URL; `print`: black lines on white, for the PDF. */
  const viewImage = (print: boolean): string | null => {
    const c = page.current?.querySelector<HTMLCanvasElement>('canvas.cad-layer');
    if (!c || !c.width) return null;
    try {
      if (!print) return c.toDataURL('image/png');
      const o = document.createElement('canvas');
      o.width = c.width; o.height = c.height;
      const ctx = o.getContext('2d');
      if (!ctx) return null;
      const bg = c.getContext('2d')?.getImageData(0, 0, 1, 1).data;
      const dark = !bg || bg[0] + bg[1] + bg[2] < 384;
      ctx.filter = `grayscale(1)${dark ? ' invert(1)' : ''} contrast(1.4)`;
      ctx.drawImage(c, 0, 0);
      return o.toDataURL('image/png');
    } catch { return null; }
  };
  async function exportAs(kind: CadExport) {
    if (!view) { cad.say('EXPORT  Open a drawing first.'); return; }
    const base = view.file.replace(/\.(dwg|dxf)$/i, '');
    const say = (m: string | null) => { if (m) { cad.say(`EXPORT  ${m}`); onStatus(m); } };
    try {
      if (kind === 'pdfLayout') { if (sheetL) { onPlot(sheetL.id); cad.say(`EXPORT  ${sheetL.number} with its page setup`); } else cad.say('EXPORT  Open a layout tab first (PDF of this layout).'); return; }
      if (kind === 'pdfView' || kind === 'png') {
        const img = viewImage(kind === 'pdfView');
        if (!img) { cad.say('EXPORT  The view could not be read.'); return; }
        if (kind === 'png') { const bin = atob(img.split(',')[1]); say(await saveBinary(`${base}.png`, Uint8Array.from(bin, (ch) => ch.charCodeAt(0)), 'PNG image', 'png', 'image/png')); return; }
        const esc = (t: string) => t.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
        const title = `${view.file}${floor ? ` · ${floorLabel(project.building, floor)}` : ''} · ${new Date().toISOString().slice(0, 10)}`;
        say(await savePdf(`${base}.pdf`, `<!doctype html><html><head><meta charset="utf-8"><title>${esc(view.file)}</title><style>body{margin:0;font:10pt sans-serif;color:black}img{display:block;max-width:100%;max-height:180mm;margin:0 auto;border:0.3mm solid black}p{margin:2mm 0}</style></head><body><p>${esc(title)}</p><img src="${img}" alt=""></body></html>`, { pageSize: 'A3', landscape: true }));
        return;
      }
      if (kind === 'wblock') {
        const items = pickedSk.length ? pickedSk : selSketch ? [selSketch] : [];
        if (!items.length && !pickedItems.length) { cad.say('WBLOCK  Pick the drawn objects or devices first, then WBLOCK.'); return; }
        const devs = pickedItems.map((d) => ({ layer: d.what === 'lv' ? 'E-LV-POINTS' : d.what === 'elv' ? 'E-ELV-DEVICES' : 'E-BOARDS', x: d.x / units.factor, y: d.y / units.factor, r: rUnits * (d.what === 'board' ? 2 : 1), text: d.symbol.text, label: d.what === 'lv' ? d.detail.split(' · ')[0] : d.label }));
        const bytes = await drawingWithDevices({ bytes: new TextEncoder().encode(toDxf([])) }, devs, [...shapesOut(items, units.factor), ...blockDefsOut(defs, units.factor), pointStyleOut(pointStyleOf(project))], 'dxf');
        say(await saveBinary(`${base} - objects.dxf`, bytes, 'DXF drawing', 'dxf', 'application/dxf'));
        return;
      }
      const { default: ExcelJS } = await import('exceljs');
      const { workbookBytes } = await import('../../docs/formWorkbook');
      const wb = new ExcelJS.Workbook();
      // Block attributes (ATTEXT): block, tag, value, layer, place, and the feeder a CIRCUIT value names.
      if (kind === 'attributes' || kind === 'attributesCsv') {
        const rows = attributeRows(sketch, defs, units.factor, project.feeders);
        if (!rows.length) { cad.say('EXPORT  No blocks with attributes on this plan.'); return; }
        if (kind === 'attributesCsv') { say(await saveBinary(`${base} - attributes.csv`, new TextEncoder().encode(attributesCsv(rows)), 'CSV file', 'csv', 'text/csv')); return; }
        const ws = wb.addWorksheet('Attributes');
        ws.addRow([`${view.file}${floor ? ` · ${floorLabel(project.building, floor)}` : ''}`]);
        ws.addRow([...ATTRIBUTE_HEAD, 'Feeder']).font = { bold: true };
        for (const r of rows) ws.addRow([r.block, r.tag, r.value, r.layer, Math.round(r.x * 1000) / 1000, Math.round(r.y * 1000) / 1000, r.feeder ?? '']);
        ws.columns.forEach((col) => { col.width = 18; });
        say(await saveBinary(`${base} - attributes.xlsx`, await workbookBytes(wb), 'Excel workbook', 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
        return;
      }
      const ws = wb.addWorksheet(kind === 'devices' ? 'Devices' : 'Cable routes');
      ws.addRow([`${view.file}${floor ? ` · ${floorLabel(project.building, floor)}` : ''}`]);
      ws.addRow(kind === 'devices' ? DEVICE_HEAD : CABLE_HEAD).font = { bold: true };
      const rows = kind === 'devices' ? deviceRows(placed) : cableRows(sketch, (id) => cableLabels[id] ?? id, units.factor);
      for (const r of rows) ws.addRow(r);
      ws.columns.forEach((col) => { col.width = 18; });
      if (!rows.length) { cad.say(`EXPORT  No ${kind === 'devices' ? 'devices placed' : 'cable routes drawn'} on this plan.`); return; }
      say(await saveBinary(`${base} - ${kind === 'devices' ? 'devices' : 'cable routes'}.xlsx`, await workbookBytes(wb), 'Excel workbook', 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
    } catch (e) { const msg = e instanceof Error ? e.message : String(e); cad.say(msg); onStatus(msg); }
  }
  // Drafting settings (DS) open at a tab; Publish (the sheets of this drawing's layouts ticked).
  const [dsTab, setDsTab] = useState<DraftTab | null>(null);
  const [publishing, setPublishing] = useState(false)
;
  cad.actions.current = { newDrawing: newFile, save: () => void saveNow(), saveDwg: () => startSaveAs('dwg'), saveAs: () => startSaveAs(), exportAs: (k) => void exportAs(k), publish: () => setPublishing(true), settings: (t) => setDsTab(t ?? 'snap'), close: () => { if (view) closeDrawings([view]); }, closeOthers: () => { if (view) closeDrawings(cad.drawings.filter((v) => v !== view)); }, remove: removeSelected, addFound: () => addFound(), schedules: () => schedules(), copyTo: (k) => copyLevel(k), wireAll: () => wireAll(), layerManager: () => { if (view) setShowLM((v) => !v); else cad.say('LAYER  Open a drawing first.'); }, refs: () => { if (view) setShowXR(true); else cad.say('XREF  Open a drawing first.'); }, layoutCmd: (c) => { if (!layoutCmd(c)) cad.say(`${c}  Open a layout tab first.`); }, command: (t) => run(t), setProps, showOnPlan, reopen: () => { if (last) void load(() => reopenDrawing(last), 'That drawing is no longer where it was. Open it again.'); } };
  // While the page is not shown the ribbon's actions do nothing (they would work on a project as it was).
  useEffect(() => () => { cad.actions.current = NO_ACTIONS; }, []); // eslint-disable-line react-hooks/exhaustive-deps -- on leaving the page
  // Show on plan: once the target's drawing is the one shown, pick the target and zoom to it.
  useEffect(() => {
    if (!showTarget) return;
    if (view && view.file.toLowerCase() === showTarget.file.toLowerCase()) {
      setShowTarget(null);
      const items = placed.filter((d) => showTarget.keys.includes(d.key));
      setResult(items.length === 1 ? { kind: 'device', it: items[0] } : null);
      cad.setSelected(items.length === 1 ? items[0].key : showTarget.itemIds.length === 1 ? `sk:${showTarget.itemIds[0]}` : null);
      setPicked(items.length > 1 ? items.map((d) => d.key) : showTarget.itemIds.length > 1 ? showTarget.itemIds.map((id) => `sk:${id}`) : []);
      const w = showTarget.box, k = units.factor;
      if (w) zoomTo({ kind: 'window', a: [w.x0 / k, w.y0 / k], b: [w.x1 / k, w.y1 / k] });
      onStatus(showTarget.note ? `${showTarget.note}: ${showTarget.label}` : showTarget.label);
    } else if (!busy) setShowTarget(null); // the drawing could not be shown
  }, [showTarget, view, busy]); // eslint-disable-line react-hooks/exhaustive-deps -- once the target's drawing is shown
  // A ribbon command given while another page was shown runs now that the page is here.
  useEffect(() => { const fn = cad.pending.current; if (fn) { cad.pending.current = null; fn(cad.actions.current); } });

  /** Light room: places the kept room's lights on the circuit chosen. */
  function placeLux() {
    if (!floor || !luxOf || !lit) return;
    try {
      const r = placeRoomLights(project, floor.ref, luxOf.id, cad.feederId, lit.result.points, luxSet.replace, lit.luminaire);
      const f = project.feeders.find((x) => x.id === cad.feederId)!;
      change(r.project, `${r.ids.length} light${r.ids.length === 1 ? '' : 's'} placed in ${luxOf.name} on ${circuitLabel(project, f).split(' · ')[0]} — ${Math.round(lit.result.achievedLux)} lx${r.removed ? ` (${r.removed} taken off first)` : ''} · ⌘Z to undo`);
      setLuxRoom(null);
    } catch (e) { cad.say(`LUX  ${e instanceof Error ? e.message : String(e)}`); }
  }
  /** Emergency: the escape route being drawn becomes one of the routes. */
  function finishRoute() {
    if (points.length >= 2) {
      const r = points.map(([x, y]): Pt => [x * units.factor, y * units.factor]);
      setEm((e) => ({ ...e, routes: [...e.routes, r] }));
      cad.say(`EM  Escape route ${em.routes.length + 1}, ${m(pathLength(points) * units.factor)} — draw another, mark points of emphasis or open areas, then Place.`);
    } else cad.say(EM_PROMPT.route);
    setPoints([]);
  }
  /** Emergency: places the fittings and signs on the circuit chosen. */
  function placeEm() {
    if (!floor) return;
    try {
      const r = placeEmergency(project, floor.ref, cad.feederId, emLayout);
      const f = project.feeders.find((x) => x.id === cad.feederId)!;
      change(r.project, `${r.fittings} emergency light${r.fittings === 1 ? '' : 's'} and ${r.signs} sign${r.signs === 1 ? '' : 's'} placed on ${circuitLabel(project, f).split(' · ')[0]} · ⌘Z to undo`);
      setEm({ routes: [], points: [], rooms: [] }); setPoints([]);
    } catch (e) { cad.say(`EM  ${e instanceof Error ? e.message : String(e)}`); }
  }
  /** Wire circuits: every circuit with devices on this level, with a home run to its DB. */
  function wireAll() {
    if (!floor) { cad.say('WIRE  Add the building and its levels in Building information first; devices are kept per level.'); return; }
    const r = wireLevel(project, floor.ref);
    if (!r.added.length) { cad.say(wiring.length ? `WIRE  Every circuit on this level is wired (${wiring.length}).` : 'WIRE  No circuit has devices on this level: place lights or sockets on circuits first.'); return; }
    const missing = levelWiring(r.project, floor.ref).filter((w) => r.added.includes(w.feederId) && w.warning).length;
    change(r.project, `${r.added.length} circuit${r.added.length === 1 ? '' : 's'} wired on ${floorLabel(project.building, floor)}${missing ? ` (${missing} without a home run: place the DB on this level)` : ''} · Update schedules sends the lengths to the cable schedule · ⌘Z to undo`);
  }
  /** Wire one: the circuit of the device clicked, on or off. */
  function wireOne(at: Pt, pixel: number) {
    const d = deviceAt(at, pixel);
    const pt = d?.what === 'lv' ? (project.lvPoints ?? []).find((x) => x.id === d.id) : undefined;
    const f = pt && project.feeders.find((x) => x.id === pt.feederId);
    if (!f || !floor) { cad.say('WIRE  Click a light, socket or other device on a circuit:'); return; }
    const r = toggleWiring(project, f.id);
    const w = r.wired ? levelWiring(r.project, floor.ref).find((x) => x.feederId === f.id) : undefined;
    change(r.project, r.wired ? `${w?.tag ?? circuitLabel(project, f)} wired${w?.warning ? ` — ${w.warning}` : ''} · ⌘Z to undo` : `Wiring of ${circuitLabel(project, f).split(' · ')[0]} taken off · ⌘Z to undo`);
  }

  /** Copy to level: this level's devices of the chosen ELV device's system, at the same plan positions. */
  function copyLevel(key: string) {
    const to = floors.find((f) => f.key === key);
    if (!floor || !to || to.key === floor.key) return;
    const r = copyTo(project, { building: floor.ref.building, level: floor.ref.level }, { building: to.ref.building, level: to.ref.level }, elvSystem, floorLabel(project.building, to));
    if (r.next) change(r.next, r.message); else cad.say(`COPY  ${r.message}`);
  }

  /** Picks devices and drawn objects: one (it is the selected object, its details on the right), several, or none. */
  function pick(items: PlacedItem[], sks: SketchItem[] = [], dws: CadObject[] = []) {
    setMenuAt(null);
    if (dws.length === 1 && !items.length && !sks.length) { setPicked([]); cad.setSelected(null); setResult({ kind: 'object', o: dws[0] }); return; }
    if (dws.length) {
      for (const o of dws) dwObjects.current.set(`dw:${o.handle}`, { file: view?.file ?? '', o });
      setPicked([...items.map((d) => d.key), ...sks.map((it) => `sk:${it.id}`), ...dws.map((o) => `dw:${o.handle}`)]); cad.setSelected(null); setResult(null);
      return;
    }
    if (items.length + sks.length === 1) {
      setPicked([]);
      if (items.length) { cad.setSelected(items[0].key); setResult({ kind: 'device', it: items[0] }); } else { cad.setSelected(`sk:${sks[0].id}`); setResult({ kind: 'sketch', it: sks[0] }); }
      return;
    }
    setPicked([...items.map((d) => d.key), ...sks.map((it) => `sk:${it.id}`)]); cad.setSelected(null); setResult(null);
  }
  const picks = (n: number) => `${n} object${n === 1 ? '' : 's'} selected`;
  /** A window (drawing units): the devices and drawn objects in it, added to those picked with Shift. Stretch keeps it
   * as the points to move. */
  function pickWindow(a: Pt, b: Pt, crossing: boolean, add: boolean) {
    if (tool === 'zoomwin') { zoomTo({ kind: 'window', a, b }); cad.setTool('none'); return; }
    if (tool === 'stretch') { setStretchBox([a, b]); setPoints([]); cad.say('STRETCH  Specify base point:'); return; }
    const found = inWindow(placed.filter((d) => shown(d.key)), [a[0] * units.factor, a[1] * units.factor], [b[0] * units.factor, b[1] * units.factor], crossing, DEVICE_R_M);
    const foundSk = sketchInWindow(pickable, a, b, crossing, defs);
    const items = add || tool !== 'none' ? [...pickedItems, ...found.filter((d) => !pickedKeys.has(d.key))] : found;
    const sks = add || tool !== 'none' ? [...pickedSk, ...foundSk.filter((it) => !pickedKeys.has(`sk:${it.id}`))] : foundSk;
    pick(tool === 'none' ? items : [], sks);
    const n = (tool === 'none' ? items.length : 0) + sks.length;
    cad.say(n ? `SEL  ${picks(n)}${tool !== 'none' ? ' — Enter when done' : ''}` : 'SEL  Nothing in the window.');
  }
  /** TEXTEDIT (ED, a double-click on the object, Edit text on its right-click menu): the box over a drawn text or
   * dimension to type over it (S5 of the Design CAD 2D gap plan). One on a locked layer is refused. */
  function startTextEdit(it: SketchItem) {
    // A block with attributes opens its Edit attributes dialog (S11).
    if (it.kind === 'insert') {
      if (effective(it, styles).lock) { cad.say(`ATTEDIT  Block on layer ${it.layer}, which is locked: unlock it first (LAYULK).`); return; }
      if (!attdefsOf(blockDefOf(defs, it.block)).length) { cad.say(`ATTEDIT  Block "${it.block}" has no attributes to edit.`); return; }
      setMenuAt(null); cad.setSelected(`sk:${it.id}`); setResult({ kind: 'sketch', it }); setAttEdit(it.id); return;
    }
    if (it.kind !== 'text' && it.kind !== 'dim' && it.kind !== 'mtext') { cad.say(`TEXTEDIT  That is a ${kindOf(it).toLowerCase()}, not a text or dimension. Select a text or dimension:`); return; }
    if (effective(it, styles).lock) { cad.say(`TEXTEDIT  ${kindOf(it)} on layer ${it.layer}, which is locked: unlock it first (LAYULK).`); return; }
    setMenuAt(null); setPicked([]); cad.setSelected(`sk:${it.id}`); setResult({ kind: 'sketch', it });
    // A note opens its own editor (MTEXT, S6).
    if (it.kind === 'mtext') { setEdNote({ id: it.id, draft: it }); cad.say(MTEXT_TYPE(false)); return; }
    setEdText({ id: it.id, value: it.text ?? '' });
    cad.say(it.kind === 'dim' ? 'TEXTEDIT  Type the dimension\'s text (<> stands for the measured value; blank gives it back), Enter:' : 'TEXTEDIT  Type the text, Enter (Esc keeps it as it was):');
  }
  /** The box closed: Enter or a click outside keep what was typed (one undo step), Esc leaves the object as it was. */
  function endTextEdit(commit: boolean) {
    const ed = edText;
    setEdText(null);
    if (!ed) return;
    const it = sketch.find((x) => x.id === ed.id), next = it && commit ? withText(it, ed.value, units.factor) : it;
    if (it && next && next !== it) change(updateSketch(project, fileOf(), next), `TEXTEDIT  ${it.kind === 'dim' ? (next.text === undefined ? 'Dimension measured again' : `Dimension text "${next.text}"`) : `Text "${next.text}"`} · ⌘Z to undo`);
    else if (!commit) cad.say('*Cancel*');
    if (tool === 'textedit') cad.say(PROMPT.textedit);
  }
  /** A left double-click on a drawn text, dimension or note, with no tool running, opens its box. */
  function doubleClick(at: Pt, pixel: number) {
    if (!view || (tool !== 'none' && tool !== 'textedit') || edText || edNote) return;
    const it = hitAt(sketch.filter((x) => !effective(x, styles).hidden), at, pickR * pixel);
    if (it && (it.kind === 'text' || it.kind === 'dim' || it.kind === 'mtext' || it.kind === 'insert')) startTextEdit(it);
    // A hatch (its edge, or inside it): HATCHEDIT with it.
    else if (!it || it.hatch) { const h = tool === 'none' ? hatchAtPoint(at, pixel) : undefined; if (h) startHatchEdit([h], null); }
  }
  /** The height on paper (mm) a new note takes: as set with H, else the current text style's, else the annotation height. */
  const mtMm = () => mtSet.mm ?? (currentTextStyle(project).heightMm || anno.textMm);
  /** MTEXT: the box from its two corners (its top left and its width; the words set its height) opens the editor for a
   * new note, justified as chosen with J (top left by default). */
  function openNote(a: Pt, b: Pt) {
    const mm = mtMm(), h = tb ? mm : textUnits({ ...anno, textMm: mm }, units.factor), w = Math.max(2 * h, Math.abs(b[0] - a[0]));
    const base: SketchItem = { id: 'new', kind: 'mtext', layer: tb ? TB_LAYERS.text : ANNO_LAYER, pts: [[Math.min(a[0], b[0]), Math.max(a[1], b[1])]], note: [{ runs: [] }], h, w };
    setPoints([]); setMtAsk(null);
    setEdNote({ draft: mtSet.just ? noteAttached(base, mtSet.just) : base });
    cad.say(MTEXT_TYPE(true));
  }
  /** The note's editor closed: OK, Ctrl/⌘+Enter or a click outside keep the words (one undo step: a new note is drawn,
   * an old one changed, with the height, justification and width set in its bar), Esc leaves things as they were. */
  function endNoteEdit(commit: boolean, paras: NotePara[] = []) {
    const ed = edNote;
    setEdNote(null);
    if (!ed) return;
    const words = paras.some((p) => p.runs.length);
    if (!commit) cad.say('*Cancel*');
    else if (!ed.id) { const { id: _id, ...rest } = ed.draft; if (words) draw({ ...rest, note: paras }, 'Note'); else cad.say('MTEXT  Nothing typed: no note drawn.'); }
    else {
      const was = sketch.find((x) => x.id === ed.id), next = words ? { ...ed.draft, note: paras } : ed.draft;
      if (was && JSON.stringify(next) !== JSON.stringify(was)) change(updateSketch(project, fileOf(), next), 'MTEXT  Note changed · ⌘Z to undo');
      else if (!words) cad.say('MTEXT  Nothing typed: the note is as it was.');
    }
    if (tool === 'mtext') cad.setTool('none');
  }
  /** Right click: with a tool running, Enter (the command menu when the prompt has options, or with Shift: Recent
   * input, Snap overrides…); with none, the menu of edits for the device or drawn object under it (or what is picked),
   * Erase for an object of the opened drawing, else the blank-canvas menu (cadContextMenu.ts). */
  async function contextAt(at: Pt, pixel: number, screen: Pt, shift = false) {
    setPromptMenu(null);
    if (tool !== 'none') {
      const opts = promptOptions(cad.history[cad.history.length - 1] ?? '');
      if (!opts.length && !shift) { run(''); return; }
      setPromptMenu({ at: screen, items: commandMenu({ options: opts, inputs, toggles: cad.toggles, snapOnce: snapOnce === 'none' ? null : snapOnce }) });
      return;
    }
    // A grip of the object picked (phase 4): move, copy or rotate from it, and a polyline's vertices.
    if (selSketch && !many && hotGrip !== null) {
      const g = gripsOf(selSketch)[hotGrip];
      if (g) { setPromptMenu({ at: screen, items: gripMenu({ index: hotGrip, kind: g.kind, it: selSketch }) }); return; }
    }
    const d = deviceAt(at, pixel), sk = d ? undefined : hitAt(pickable, at, pickR * pixel);
    const room = floor ? roomAtPointOf(project, floor, at, units.factor) : undefined;
    ctxAt.current = { at, room: room?.id };
    if (d && !pickedKeys.has(d.key)) pick([d]);
    else if (sk && !pickedKeys.has(`sk:${sk.id}`)) pick([], [sk]);
    // Devices only (the one clicked, or those picked): the device, board or ELV menu.
    const devs = d && !pickedKeys.has(d.key) ? [d] : !sk && !pickedSk.length ? pickedItems : [];
    if (devs.length && (d || !sk)) { setPromptMenu({ at: screen, items: devMenu(devs) }); return; }
    if (!d && !sk && !pickedItems.length && !pickedSk.length) {
      // An object of the opened drawing: picked (if it was not), with Erase (run as it then stands, through the actions).
      const o = view ? await view.pick(at[0], at[1], pickR * pixel, pickOn) : null;
      if (o && !pickedKeys.has(`dw:${o.handle}`)) pick([], [], [o]);
      if (o || pickedDw.length) {
        const one = o ?? (pickedDw.length === 1 ? pickedDw[0] : undefined), n = o && !pickedKeys.has(`dw:${o.handle}`) ? 1 : pickedDw.length;
        ctxObj.current = { dw: one };
        setPromptMenu({ at: screen, items: drawingObjectMenu({ block: one?.kind === 'Block' ? one.block : undefined, picked: n }) }); return;
      }
      // A reference drawing's lines (phase 3).
      const r = refNear(xr.placed, at, pickR * pixel);
      if (r) { ctxObj.current = { ref: r.name }; setPromptMenu({ at: screen, items: xrefMenu(r) }); return; }
      const blank = blankMenu({ recent: recent.map((x) => x.label), canPaste: hasClip(), canUndo, canRedo, objectsHidden: !!objHide && objHide.file === view?.file });
      // Inside a room with an outline: the room's tools first (phase 2).
      const rt = room ? roomTypesOf(buildingInfoOf(project)).find((t) => t.id === room.type) : undefined;
      const editing = blockEditorOf(view?.file);
      const top: CtxEntry[] = editing ? [{ label: `Save block "${editing.name}"`, key: 'BSAVE', cmd: 'BSAVE' }, { label: 'Close block editor', key: 'BCLOSE', cmd: 'BCLOSE' }, '-']
        : re ? [{ label: `Save back to "${re.insert.block}"`, key: 'REFCLOSE', act: 'option', arg: 'REFCLOSE SAVE' }, { label: 'Discard changes', act: 'option', arg: 'REFCLOSE DISCARD' }, '-'] : [];
      setPromptMenu({ at: screen, items: room ? [...top, roomEntry({ room, typeLabel: rt?.label, elv: elvItem?.label }), '-', ...blank] : [...top, ...blank] });
      return;
    }
    setMenuAt(screen);
  }
  /** ISOLATEOBJECTS / HIDEOBJECTS: the drawn objects and devices picked shown alone, or hidden (more hidden join those
   * hidden already); this view only, not saved. Objects of the opened drawing stay as they are. */
  function hideObjects(mode: 'isolate' | 'hide') {
    const cmd = mode === 'isolate' ? 'ISOLATEOBJECTS' : 'HIDEOBJECTS';
    const keys = [...pickedItems.map((d) => d.key), ...pickedSk.map((it) => `sk:${it.id}`)];
    if (!view || !keys.length) { cad.say(`${cmd}  Pick the objects first.`); return; }
    const before = objHide && objHide.file === view.file ? objHide.keys : [], keep = new Set(keys);
    const all = [...placed.map((d) => d.key), ...sketch.map((it) => `sk:${it.id}`)];
    setObjHide({ file: view.file, mode, keys: [...new Set([...before, ...(mode === 'hide' ? keys : all.filter((k) => !keep.has(k)))])] });
    setPicked([]); cad.setSelected(null); setResult(null); setMenuAt(null);
    cad.say(`${cmd}  ${keys.length} object${keys.length === 1 ? '' : 's'} ${mode === 'isolate' ? 'shown alone' : 'hidden'} · UNISOLATEOBJECTS shows all again`);
  }
  /** ADDSELECTED: the tool that draws the object picked, with its layer current (a device: the same device type). */
  function addSelected() {
    if (pickedSk.length + pickedItems.length !== 1) { cad.say('ADDSELECTED  Pick one object first.'); return; }
    const d = pickedItems[0];
    if (d) {
      const t = typeOf(project, d), p = palette.find((x) => ('lv' in x.kind && x.kind.lv === t) || ('elv' in x.kind && x.kind.elv === t));
      if (!p) { cad.say(`ADDSELECTED  ${d.label}: not a device of the palette.`); return; }
      cad.setDevice(p.id); cad.setTool('dev'); return;
    }
    const it = pickedSk[0], t = addSelectedTool(it);
    if (!t) { cad.say(`ADDSELECTED  ${kindOf(it)}: nothing to draw it with.`); return; }
    if (it.layer && it.layer !== curLayer) run(`CLAYER ${it.layer}`);
    if (t === 'insert') { const def = it.block ? blockByName(it.block) : undefined; if (def) startInsert(def); else cad.say('ADDSELECTED  The block is not in this drawing.'); return; }
    cad.setTool(t);
  }
  /** The LV circuit of a placed device (none for a board or an ELV device). */
  const feederOfDev = (d: PlacedItem) => (d.what === 'lv' ? (project.lvPoints ?? []).find((x) => x.id === d.id)?.feederId : undefined);
  /** The right-click menu of the devices picked (src/components/cad/cadObjectMenus.ts). */
  function devMenu(items: PlacedItem[]): CtxEntry[] {
    const fs = new Set(items.map(feederOfDev)), types = new Map<string, { label: string; count: number }>();
    for (const it of items) { const t = typeOf(project, it); types.set(t, { label: it.label, count: (types.get(t)?.count ?? 0) + 1 }); }
    const fid = fs.size === 1 ? [...fs][0] : undefined, f = fid ? project.feeders.find((x) => x.id === fid) : undefined;
    const swapNow = types.size === 1 ? [...types.keys()][0] : undefined;
    return deviceMenu({
      items, edits: editsFor(project, items), oneType: types.size === 1, canShow: !!onShow, repeat: recent[0]?.label,
      circuits: circuits.map((c) => ({ id: c.id, label: circuitLabel(project, c), now: c.id === fid })),
      swaps: replacements(project, items).map((x) => ({ id: x.id, label: x.label, now: x.id === swapNow })),
      types: [...types].map(([id, v]) => ({ id, ...v })),
      ...(f ? { circuit: { id: f.id, board: f.boardId, wired: isWired(project, f.id) } } : {})
    });
  }
  /** Wire one: the circuit's home run drawn, or taken off. */
  function wireCircuit(feederId: string) {
    const f = project.feeders.find((x) => x.id === feederId);
    if (!f || !floor) return;
    const r = toggleWiring(project, f.id);
    const w = r.wired ? levelWiring(r.project, floor.ref).find((x) => x.feederId === f.id) : undefined;
    change(r.project, r.wired ? `${w?.tag ?? circuitLabel(project, f)} wired${w?.warning ? ` — ${w.warning}` : ''} · ⌘Z to undo` : `Wiring of ${circuitLabel(project, f).split(' · ')[0]} taken off · ⌘Z to undo`);
  }
  /** A device entry of the right-click menu: an edit of the toolbar, or one the menu adds. */
  function deviceAct(edit: DeviceEdit | DeviceMore, value?: string) {
    const items = pickedItems, one = items[0];
    setPromptMenu(null);
    if (!one || !floor) return;
    const fid = feederOfDev(one), f = fid ? project.feeders.find((x) => x.id === fid) : undefined;
    const board = one.what === 'board' ? one.id : f?.boardId;
    const show = (s: CadShow, what: string) => { if (!onShow) return; onShow(s); cad.say(what); };
    switch (edit) {
      case 'samecircuit': {
        if (!f) return;
        const on = shownPlaced.filter((d) => feederOfDev(d) === f.id);
        pick(on); cad.say(`SEL  ${on.length} device${on.length === 1 ? '' : 's'} on ${circuitLabel(project, f).split(' · ')[0]} on this level`); return;
      }
      case 'sametype': {
        const t = typeOf(project, one), same = shownPlaced.filter((d) => d.what === one.what && typeOf(project, d) === t);
        pick(same); cad.say(`SEL  ${same.length} × ${one.label} on this level`); return;
      }
      case 'homerun': if (f) wireCircuit(f.id); return;
      case 'homeruns': {
        const r = wireBoard(project, floor.ref, one.id);
        if (!r.added.length) { cad.say(`WIRE  Every circuit of ${one.id} with devices on this level is wired.`); return; }
        change(r.project, `${r.added.length} circuit${r.added.length === 1 ? '' : 's'} of ${one.id} wired on ${floorLabel(project.building, floor)} · ⌘Z to undo`); return;
      }
      case 'schedule': if (board) show({ to: 'load-schedule', board }, `Load schedule of ${board}`); return;
      case 'sld': show(f ? { to: 'sld', feeder: f.id, board: f.boardId } : { to: 'sld', board }, `SLD: ${f ? circuitLabel(project, f).split(' · ')[0] : board}`); return;
      case 'board': show({ to: 'board', board }, `Board diagram of ${board}`); return;
      case 'riser': show({ to: 'riser', board }, `Riser diagram: ${board}`); return;
      case 'feeder': show({ to: 'cable-schedule', board }, `Cable schedule of ${board}`); return;
      case 'elvschedule': show({ to: 'elv' }, 'ELV schedule'); return;
      case 'rotate': cad.setSelected(one.key); setResult({ kind: 'device', it: one }); cad.setTool('rotate'); setTimeout(() => cad.say('ROTATE  Click where it faces:')); return;
      default: editDevices(edit, value);
    }
  }
  /** A room entry of the blank-canvas menu, on the room under the right-click. */
  function roomAct(a: string) {
    const c = ctxAt.current, room = c?.room ? buildingInfoOf(project).rooms.find((r) => r.id === c.room) : undefined;
    if (!room || !c || !floor) return;
    const name = room.name;
    switch (a) {
      case 'lux': luxNext.current = room.id; if (tool === 'lux') setLuxRoom(room.id); else cad.setTool('lux'); setTimeout(() => cad.say(`LUX  ${name}: set the luminaire and circuit, then Place.`)); return;
      case 'luxcheck': {
        const need = lightingOf(project, room, luxSet), lights = devicesInRoom(shownPlaced.filter((d) => d.what === 'lv' && typeOf(project, d) === 'ltg'), room).length;
        cad.say(need.result.invalid ? `LUX CHECK  ${name}: ${need.result.invalid}` : luxCheckLine(name, lights, need.result.count, need.input.targetLux)); return;
      }
      case 'em': setEm((e) => ({ ...e, rooms: e.rooms.includes(room.id) ? e.rooms : [...e.rooms, room.id] })); setEmSet((s) => ({ ...s, mode: 'open' })); cad.setTool('em'); setTimeout(() => cad.say(`EM  ${name} (${m2(room.areaM2)}): open area. Click more rooms or draw the escape routes, then Place.`)); return;
      case 'fill': {
        if (!elvItem) { cad.setTool('fill'); setTimeout(() => cad.say('FILL  Choose an ELV device (a detector, speaker, data outlet…) in the Devices panel, then click the room.')); return; }
        const r = fillAt(project, { building: floor.ref.building, level: floor.ref.level }, elvItem.kind.elv, [c.at[0] * units.factor, c.at[1] * units.factor]);
        if (r.next) change(r.next, r.message); else cad.say(`FILL  ${r.message}`); return;
      }
      case 'select': { const on = devicesInRoom(shownPlaced, room); pick(on); cad.say(`SEL  ${on.length} device${on.length === 1 ? '' : 's'} in ${name}`); return; }
      case 'loads': cad.say(`LOADS  ${name}: ${roomLoads(room, roomTypesOf(buildingInfoOf(project)).find((t) => t.id === room.type), shownPlaced).line}`); return;
      case 'area': { const o = room.outline ?? [], per = o.reduce((t, q, i) => t + distance(q, o[(i + 1) % o.length]), 0); cad.say(`AREA  ${name}: ${m2(room.areaM2)}${per ? `, perimeter ${m(per)}` : ''}`); return; }
      case 'rename': setRoomAsk({ id: room.id, step: 'name' }); cad.say(`RENAME  New name of ${name}:`); input.current?.focus(); return;
      case 'type': {
        const types = roomTypesOf(buildingInfoOf(project)), now = types.find((t) => t.id === room.type);
        setRoomAsk({ id: room.id, step: 'type' });
        cad.say(`ROOM TYPE  ${name}: type the room type (${types.slice(0, 6).map((t) => t.label).join(', ')}${types.length > 6 ? ', …' : ''}) <${now?.label ?? 'none'}>:`); input.current?.focus(); return;
      }
    }
  }
  /** A block of the opened drawing, from its right-click menu: its inserts counted, exploded into drawn
   * objects (the block erased from the drawing; one undo step), copied as a block of the app's own, or cropped. */
  async function dwAct(a: string) {
    const o = ctxObj.current?.dw, name = o?.block;
    if (!view || !o) return;
    const erased = new Set(erasedOf(project, view.file));
    const all = name ? view.blocks().filter((b) => b.block === name && !erased.has(b.handle)) : [];
    const what = `"${name ?? ''}"`;
    switch (argOf(a).action) {
      case 'count': cad.say(`COUNT  ${what}: ${all.length} in this drawing`); return;
      case 'copyblock': if (name) await insertArchBlock(name); return;
      case 'crop': { const c = cropOf(o); cropNext.current = c.state; cad.setTool('crop'); setTimeout(() => cad.say(c.say)); return; }
      case 'explode': {
        try {
          const { pieces, truncated } = await explodeObjects(view, [o.handle]);
          const list = pieces[o.handle] ?? Object.values(pieces).flat();
          const items = defFromPieces(name ?? 'block', list, [0, 0], view.info.units).items;
          if (!items.length) { cad.say(`EXPLODE  ${what} has nothing the app can draw.`); return; }
          const next = items.reduce((q, { id: _id, ...x }) => addSketch(q, view.file, x).project, withErased(project, view.file, [o.handle]));
          pick([]); change(next, `EXPLODE  ${what}: ${items.length} drawn objects${truncated ? ' (a very large array: its first 200,000 pieces)' : ''}, the block erased from the drawing · ⌘Z to undo`);
        } catch (e) { cad.say(`EXPLODE  ${e instanceof Error ? e.message : String(e)}`); }
      }
    }
  }
  /** A reference drawing, from its right-click menu (the References palette's actions). */
  function xrefAct(a: string) {
    const r = xr.refs.find((x) => x.name === ctxObj.current?.ref);
    if (!r || !view) return;
    const { action, value } = argOf(a);
    switch (action) {
      case 'open': {
        const tab = cad.tabOf(r.file), path = pathOfPlan(project.id, r.file);
        if (tab) { cad.show(tab); return; }
        if (SAMPLE_PLANS.some((x) => x.file === r.file)) { showOrLoad(r.file, () => sampleDrawing(r.file)); return; }
        if (path && window.lvds?.cadFile?.readBytes) { showOrLoad(r.file, () => reopenDrawing(path), `XREF  ${r.file} is no longer where it was: Repath it in References (XR).`); return; }
        cad.say(`XREF  ${r.file}: where it is on this computer is not known — open it with OPEN, or Repath it in References (XR).`); return;
      }
      case 'clip': startClip(r); return;
      case 'unclip': xr.actions.update(r, { clip: undefined }, 'clip off'); return;
      case 'fade': xr.actions.update(r, { fade: Number(value) }, `faded ${value} %`); return;
      case 'reload': xr.actions.reload(r); return;
      case 'unload': xr.actions.unload(r); return;
      case 'detach': xr.actions.detach(r); return;
      case 'bind': { const c = copyOf(/^DXF/i.test(view.info.format) ? 'dxf' : 'dwg', true); if (c) void writeCopy({ ...c, path: undefined }, false, false); return; }
      case 'print': xr.actions.update(r, { print: !r.print }, r.print ? 'does not print on the plan sheets' : 'prints on the plan sheets'); return;
      case 'layers': setShowLM(true); return;
      case 'manager': setShowXR(true); return;
    }
  }
  /** A viewport or the paper of a layout, from its right-click menu. */
  function layoutAct(kind: 'vp' | 'paper', a: string) {
    const { action, value } = argOf(a);
    if (!sheetL) return;
    if (kind === 'paper') {
      if (action === 'cmd' && value) { run(value); return; }
      if (action === 'register') { if (onShow) { onShow({ to: 'drawing-register' }); cad.say('Drawing register: the sheet list'); } return; }
      if (action === 'status' && value) {
        const set = setOf(project);
        change({ ...project, drawingSet: { ...set, sheets: set.sheets.map((x) => (x.id === sheetL.id ? { ...x, status: value } : x)) } }, `${sheetL.number || 'Layout'}  issue status ${value} · ⌘Z to undo`);
      }
      return;
    }
    const v = vps.find((x) => x.id === ctxObj.current?.vp);
    if (!v) return;
    const name = vpName(vps, v.id);
    switch (action) {
      case 'ms': cad.setVpSel(v.id); cad.setMsVp(v.id); cad.say(`MSPACE  Working in the model through ${name}. A double-click outside (or PS) returns to the paper.`); return;
      case 'max': {
        const w = vpWindow(v), k = units.factor;
        cad.setMsVp(null); cad.setLayout(null);
        setTimeout(() => zoomTo({ kind: 'window', a: [w.x0 / k, w.y0 / k], b: [w.x1 / k, w.y1 / k] }));
        cad.say(`${name}: its area on the Model tab (1:${v.scale}). The layout tab goes back to the paper.`); return;
      }
      case 'scale': patchVp(v, { scale: Number(value) }, `scale 1:${value}`); return;
      case 'lock': patchVp(v, isLocked(v) ? { locked: false } : { locked: undefined }, isLocked(v) ? 'unlocked: pan and zoom inside it move its view' : 'locked'); return;
      case 'frame': patchVp(v, { frame: v.frame ? undefined : true }, v.frame ? 'frame on screen only' : 'frame prints'); return;
      case 'layers': cad.setVpSel(v.id); setShowLM(true); return;
      case 'erase': setVps((l) => l.filter((x) => x.id !== v.id), `${name} deleted${vps.length === 1 ? ' (the layout shows the level as worked out again)' : ''}`); cad.setVpSel(null); cad.setMsVp(null); return;
    }
  }
  /** Right-click on a layout of the drawing (its own or one made here): inside a viewport (its index) or on the paper. */
  function filePaperContext(i: number | null, x: number, y: number) {
    if (!paperL) return;
    const r = paperStage.current?.getBoundingClientRect(), at: Pt = [x - (r?.left ?? 0), y - (r?.top ?? 0)];
    const v = i !== null ? paperL.viewports[i] : undefined, mpu = units.factor * 1000;
    ctxObj.current = { fvp: i ?? undefined };
    setPaperCtx({ at, items: drawingPaperMenu({ inside: !!v, editable: !!dwgL, scale: v && v.h > 0 ? Math.round((v.vh * mpu) / v.h) : undefined, scales: scalesOf(project) }) });
  }
  /** An entry of that menu. */
  function filePaperAct(a: string) {
    const { action, value } = argOf(a), i = ctxObj.current?.fvp, v = paperL && i !== undefined ? paperL.viewports[i] : undefined;
    if (action === 'cmd' && value) { run(value); return; }
    const tab = dwgL ? { id: drawingLayoutId(dwgL.name), name: dwgL.name, title: '' } : undefined;
    if (action === 'rename' && tab) { drawingTabActs.rename(tab); return; }
    if (action === 'copy' && tab) { drawingTabActs.copy(tab); return; }
    if (action === 'delete' && tab) { drawingTabActs.remove(tab); return; }
    if (!v || !(v.h > 0)) return;
    if (action === 'max') {
      const vw = (v.vh * v.w) / v.h;
      cad.setLayout(null);
      setTimeout(() => zoomTo({ kind: 'window', a: [v.cx - vw / 2, v.cy - v.vh / 2], b: [v.cx + vw / 2, v.cy + v.vh / 2] }));
      cad.say(`${paperL!.name}: the viewport's area on the Model tab.`); return;
    }
    if (action === 'scale' && dwgL && i !== undefined) {
      const n = Number(value), mpu = units.factor * 1000;
      setDwgLayouts(dwgLayouts.map((l) => (l === dwgL ? { ...l, viewports: l.viewports.map((q, k) => (k === i ? { ...q, vh: (q.h * n) / mpu } : q)) } : l)), `${dwgL.name}: viewport at 1:${n}`);
    }
  }
  /** Right-click on a layout's paper (a viewport's id when inside one), at the screen point. */
  function paperContext(id: string | null, x: number, y: number) {
    if (!sheetL) return;
    const r = paperStage.current?.getBoundingClientRect(), at: Pt = [x - (r?.left ?? 0), y - (r?.top ?? 0)];
    const v = id ? vps.find((q) => q.id === id) : undefined;
    if (v) { cad.setVpSel(v.id); ctxObj.current = { vp: v.id }; setPaperCtx({ at, items: viewportMenu(v, scalesOf(project)) }); return; }
    ctxObj.current = null; setPaperCtx({ at, items: paperMenu({ status: sheetL.status }) });
  }
  /** A right-click menu entry picked: its command typed, or the page action. */
  function ctxPick(x: CtxItem) {
    setPromptMenu(null);
    if (x.cmd) { run(x.cmd); return; }
    const a = x.arg ?? '';
    switch (x.act) {
      case 'repeat': { const r = recent[Number(a)]; if (r) repeat(r); return; }
      case 'properties': setShowProps(true); return;
      case 'enter': run(''); return;
      case 'cancel': cancel(); return;
      case 'option': case 'input': run(a); return;
      case 'snap': {
        const m = a as OsnapMode | 'none';
        setSnapOnce(m);
        cad.say(m === 'none' ? 'No snap for the next point.' : `${SNAP_OVERRIDES.find((q) => q.mode === m)?.label ?? m} snap for the next point.`);
        return;
      }
      case 'deselect': setPicked([]); cad.setSelected(null); setResult(null); setMenuAt(null); return;
      case 'dev': { const d = devArg(a); deviceAct(d.edit, d.value); return; }
      case 'room': roomAct(a); return;
      case 'dw': void dwAct(a); return;
      case 'xref': xrefAct(a); return;
      case 'vp': case 'paper': layoutAct(x.act, a); return;
      case 'grip': gripAct(a); return;
      case 'fpaper': filePaperAct(a); return;
    }
  }
  const fileOf = () => view?.file ?? '';
  /** The project with a drawn item replaced by what an edit made of it: the first keeps its ID, the rest are added. */
  const replaced = (p: Project, it: SketchItem, items: Omit<SketchItem, 'id'>[]) => {
    if (!items.length) return removeSketch(p, fileOf(), it.id);
    let next = updateSketch(p, fileOf(), { ...items[0], id: it.id } as SketchItem);
    for (const x of items.slice(1)) next = addSketch(next, fileOf(), x).project;
    return next;
  };
  const added = (p: Project, items: Omit<SketchItem, 'id'>[]) => items.reduce((q, x) => addSketch(q, fileOf(), x).project, p);
  const failed = (r: Edit, cmd: string) => { if (r.error) cad.say(`${cmd}  ${r.error}`); return !!r.error; };
  /** An edit from the toolbar, the menu or the side panel, on the drawn objects picked. */
  function editSketch(e: SketchEdit, arg?: string) {
    setMenuAt(null);
    const sks = pickedSk, one = sks.length === 1 && !pickedItems.length ? sks[0] : undefined;
    if (e === 'filter' && arg) {
      if (arg === 'devices') pick(pickedItems); else if (arg === 'drawn') pick([], sks); else pick([], sks.filter((it) => kindOf(it) === arg));
      return;
    }
    if (e === 'width' && one?.tray && arg) { change(updateSketch(project, fileOf(), { ...one, tray: { ...one.tray, widthMm: Number(arg) } }), `Cable tray ${arg} mm · ⌘Z to undo`); return; }
    if (e === 'clipboard') { if (arg) run(arg === 'cut' ? 'CUTCLIP' : arg === 'copy' ? 'COPYCLIP' : arg === 'copybase' ? 'COPYBASE' : arg === 'paste' ? 'PASTECLIP' : 'PASTEORIG'); return; }
    if (e === 'props') { setShowProps(true); return; }
    if (e === 'repeat') { if (recent[0]) repeat(recent[0]); return; }
    if (e === 'edtext') { if (one) startTextEdit(one); return; }
    if (e === 'ntwidth') { if (one?.kind === 'mtext') { setMtAsk({ step: 'ntwidth', id: one.id }); cad.say(`MTEXT  Width (m) <${toM(noteBox(one).w).toFixed(2)}>:`); input.current?.focus(); } return; }
    if (e === 'edatt') { if (one?.kind === 'insert') startTextEdit(one); return; }
    if (e === 'bedit') { if (one?.kind === 'insert') blockEdit(one.block); return; }
    if (e === 'refedit') { if (one?.kind === 'insert') refEdit(); return; }
    if (e === 'blkreplace' || e === 'blkreset' || e === 'blkexplode' || e === 'blkcount') { if (one?.kind === 'insert') blockMenuEdit(e, one, arg); return; }
    if (e === 'find') { run('FIND'); return; }
    if (e === 'hedit' || e === 'horigin') { if (one?.hatch) startHatchEdit([one], e === 'horigin' ? 'origin' : null); return; }
    if (e === 'hislands') { if (one?.hatch && one.holes?.length) { const { holes: _h, ...rest } = one; change(updateSketch(project, fileOf(), { ...rest, ...(one.assoc?.length ? { assoc: one.assoc.slice(0, 1) } : {}) }), 'HATCH  Islands removed · ⌘Z to undo'); } return; }
    if (e === 'jointool') { cad.setTool('join'); return; }
    if (e === 'txjust' || e === 'txheight' || e === 'txcase' || e === 'txframe' || e === 'txmask' || e === 'dimstyle' || e === 'dimprec' || e === 'dimpos' || e === 'dimreset'
      || e === 'hscale' || e === 'hangle' || e === 'hboundary' || e === 'plclose' || e === 'explode1' || e === 'roomfrom' || e === 'tocable') { if (one) drawnEdit(e, one, arg); return; }
    if (e === 'selblock') { if (one?.kind === 'insert') { pick([], sketch.filter((it) => it.kind === 'insert' && it.block === one.block)); cad.say(`SELECT  Every "${one.block}" block picked`); } return; }
    if (e === 'mkblock') { openBlockDialog(); return; }
    if (e === 'draworder') { const mode = arg as DrMode | undefined; if (!mode) return; if (mode === 'front' || mode === 'back') applyDrawOrder(mode); else { setDrMode(mode); cad.setTool('draworder'); } return; }
    if (e === 'ntjust') { const j = arg ? parseAttach(arg) : undefined; if (one?.kind === 'mtext' && j) change(updateSketch(project, fileOf(), noteAttached(one, j)), `MTEXT  Note justified ${attachLabel(j).toLowerCase()} · ⌘Z to undo`); return; }
    if (e === 'similar') { run('SELECTSIMILAR'); return; }
    if (e === 'qselect') { run('QSELECT'); return; }
    if (e === 'isolate') { run(arg === 'hide' ? 'HIDEOBJECTS' : arg === 'end' ? 'UNISOLATEOBJECTS' : 'ISOLATEOBJECTS'); return; }
    if (e === 'deselect') { setPicked([]); cad.setSelected(null); setResult(null); setMenuAt(null); return; }
    if (e === 'addsel') { setMenuAt(null); run('ADDSELECTED'); return; }
    if (e === 'qmeasure') { run('QUICKMEASURE'); return; }
    if (e === 'count') { run('COUNT'); return; }
    if (e === 'traysize' || e === 'traycables' || e === 'trayfill' || e === 'reverse' || e === 'trace' || e === 'routesld') { if (one) routeEdit(e, one); return; }
    if (e === 'erase') { removeSelected(); return; }
    if (e === 'join') { applyJoin(); return; }
    if (e === 'rotate' && !one) { cad.say('ROTATE  One object at a time.'); return; }
    if (e === 'filter' || e === 'width') return;
    if ((e === 'offset' || e === 'fillet' || e === 'chamfer') && one) preset.current = { id: one.id, at: gripsOf(one).find((g) => g.kind === 'mid')?.at ?? one.pts[0] };
    cad.setTool(e);
  }
  /** The LV tools of a cable tray or cable route picked (its right-click menu). */
  function routeEdit(e: 'traysize' | 'traycables' | 'trayfill' | 'reverse' | 'trace' | 'routesld', it: SketchItem) {
    if (e === 'reverse') {
      change(updateSketch(project, fileOf(), { ...it, pts: [...it.pts].reverse() }), `${it.tray ? 'Cable tray' : it.cable ? 'Cable route' : kindOf(it)} reversed · ⌘Z to undo`); return;
    }
    const f = it.cable ? project.feeders.find((x) => x.id === it.cable!.feederId) : undefined;
    if (e === 'trace' || e === 'routesld') {
      if (!f) { cad.say(`TRACE  The circuit ${it.cable?.feederId ?? ''} is not in the project.`); return; }
      if (e === 'routesld') { onShow?.({ to: 'sld', feeder: f.id, board: f.boardId }); cad.say(`SLD: ${circuitLabel(project, f).split(' · ')[0]}`); return; }
      const on = shownPlaced.filter((d) => feederOfDev(d) === f.id || (d.what === 'board' && (d.id === f.boardId || d.id === f.feedsBoardId)));
      pick(on, [it]); cad.say(`TRACE  ${circuitLabel(project, f)}: ${on.length} device${on.length === 1 ? '' : 's'} and boards on this level`); return;
    }
    const tray = it.tray!, plan = trayPlanOf(project), route = tray.route ? plan.routes.find((r) => r.name.toLowerCase() === tray.route!.toLowerCase()) : undefined;
    if (!route) { cad.say('TRAY  This tray is on no route: choose its route in Properties first (the route\'s cables size it).'); return; }
    const auto = sizeRoute(project, plan, { ...route, widthMm: undefined });
    if (e === 'traycables') {
      const lines = auto.lines.filter((l) => !l.ecc);
      cad.say(lines.length ? `CABLES  Route ${route.name}: ${lines.length} cable${lines.length === 1 ? '' : 's'} — ${lines.slice(0, 6).map((l) => `${l.from} → ${l.to} ${l.description}`).join('; ')}${lines.length > 6 ? `; and ${lines.length - 6} more` : ''}` : `CABLES  Route ${route.name}: no cables on it yet (Cable tray page, or Update schedules).`);
      return;
    }
    if (!auto.cableCount) { cad.say(`TRAY  Route ${route.name} has no cables yet: nothing to size it from.`); return; }
    if (e === 'traysize') {
      if (auto.autoWidthMm === tray.widthMm) { cad.say(`TRAY  ${tray.widthMm} mm is already the size the cables of route ${route.name} need.`); return; }
      change(updateSketch(project, fileOf(), { ...it, tray: { ...tray, widthMm: auto.autoWidthMm } }), `TRAY  Route ${route.name}: ${auto.cableCount} cables need ${auto.autoWidthMm} mm${auto.autoTiers > 1 ? ` in ${auto.autoTiers} tiers` : ''} (was ${tray.widthMm} mm) · ⌘Z to undo`);
      return;
    }
    const drawn = sizeRoute(project, plan, { ...route, widthMm: tray.widthMm });
    cad.say(trayCheckLine(tray.widthMm, drawn.fillPctActual, routeSettings(plan, route).fillPct, auto.autoWidthMm));
  }
  /** A block drawn here, from its right-click menu: replaced by another block (the attribute values it shares kept),
   * its attributes back to the definition's, exploded, or its inserts counted. */
  function blockMenuEdit(e: 'blkreplace' | 'blkreset' | 'blkexplode' | 'blkcount', it: SketchItem, arg?: string) {
    const name = it.block ?? '';
    if (e === 'blkcount') {
      const n = shownSketch.filter((x) => x.kind === 'insert' && x.block?.toLowerCase() === name.toLowerCase()).length;
      cad.say(`COUNT  "${name}": ${n} in this drawing`); return;
    }
    if (e === 'blkexplode') {
      const r = explode(it, defs);
      if (!failed(r, 'EXPLODE')) change(replaced(project, it, r.items!), `EXPLODE  "${name}": ${r.items!.length} objects · ⌘Z to undo`);
      return;
    }
    if (e === 'blkreset') {
      if (!it.attrs) { cad.say(`ATTRIBUTES  "${name}" already shows its block's default values.`); return; }
      const { attrs: _attrs, ...rest } = it;
      change(updateSketch(project, fileOf(), rest as SketchItem), `ATTRIBUTES  "${name}": back to the block's default values · ⌘Z to undo`); return;
    }
    const def = arg ? blockByName(arg) : undefined;
    if (!def) { cad.say('REPLACE  That block is not in this drawing.'); return; }
    const tags = new Set(attdefsOf(def).map((a) => a.tag!.toUpperCase()));
    const kept = Object.fromEntries(Object.entries(it.attrs ?? {}).filter(([t]) => tags.has(t.toUpperCase())));
    const { attrs: _old, ...rest } = it;
    let next = blockDefOf(defs, def.name) ? project : withBlockDef(project, fileOf(), def);
    next = updateSketch(next, fileOf(), { ...rest, block: def.name, ...(Object.keys(kept).length ? { attrs: kept } : {}) } as SketchItem);
    change(next, `REPLACE  "${name}" → "${def.name}"${Object.keys(kept).length ? `, ${Object.keys(kept).length} attribute value${Object.keys(kept).length === 1 ? '' : 's'} kept` : ''} · ⌘Z to undo`);
  }
  /** A text, dimension, hatch, polyline or line picked, from its right-click menu (phase 4): one undo step each. */
  function drawnEdit(e: 'txjust' | 'txheight' | 'txcase' | 'txframe' | 'txmask' | 'dimstyle' | 'dimprec' | 'dimpos' | 'dimreset' | 'hscale' | 'hangle' | 'hboundary' | 'plclose' | 'explode1' | 'roomfrom' | 'tocable', it: SketchItem, arg?: string) {
    const k = unitsPerPaperMm(anno, units.factor), put = (next: SketchItem, what: string) => change(updateSketch(project, fileOf(), next), `${what} · ⌘Z to undo`);
    const baseLook = () => it.look ?? lookOf(currentDimStyle(project), k);
    switch (e) {
      case 'txjust': { const j = arg ? parseJust(arg) : undefined; if (j) put(rejustified(it, j), `TJUST  Text justified ${justLabel(j).toLowerCase()}`); return; }
      case 'txheight': { const mm = Number(arg); if (mm > 0) put(withTextHeight(it, mm * k), `TXTHEIGHT  Text ${mm} mm on paper`); return; }
      case 'txcase': if (it.text && arg) put({ ...it, text: cased(it.text, arg as CaseMode) }, `TCASE  ${arg} case`); return;
      case 'txframe': { const { frame: _f, ...rest } = it; put(arg && arg !== 'none' ? { ...rest, frame: arg as SketchItem['frame'] } : rest as SketchItem, arg && arg !== 'none' ? `TFRAME  ${arg} frame` : 'TFRAME  Frame taken off'); return; }
      case 'txmask': { const { mask: _m, ...rest } = it; put(it.mask ? rest as SketchItem : { ...rest, mask: true }, it.mask ? 'TMASK  Text unmasked' : 'TMASK  Text masked'); return; }
      case 'dimreset': { const { text: _t, ...rest } = it; put(rest as SketchItem, 'DIM  Text override removed: the measurement shows'); return; }
      case 'dimprec': put({ ...it, look: { ...baseLook(), decimals: Number(arg) } }, `DIM  Precision ${Number(arg) ? `0.${'0'.repeat(Number(arg))}` : '0'}`); return;
      case 'dimpos': {
        const b = baseLook(), { textPos: _p, gap: _g, ...rest } = b;
        put({ ...it, look: arg === 'outside' ? rest : { ...rest, textPos: arg as 'above' | 'centered' | 'below', gap: b.gap ?? currentDimStyle(project).gapMm * k } }, `DIM  Text ${arg === 'centered' ? 'centred' : arg}`); return;
      }
      case 'dimstyle': {
        const st = dimStylesOf(project).styles.find((x) => x.name === arg);
        if (!st) return;
        const full = fullDimStyle(st, project);
        put({ ...it, look: lookOf(full, k), h: full.textMm * k }, `DIM  Style "${full.name}"`); return;
      }
      case 'hscale': if (it.hatch) put({ ...it, hatch: { ...it.hatch, scale: +(it.hatch.scale * Number(arg)).toPrecision(6) } }, `HATCH  Scale ${+(it.hatch.scale * Number(arg)).toPrecision(6)}`); return;
      case 'hangle': if (it.hatch) put({ ...it, hatch: { ...it.hatch, angle: Number(arg) } }, `HATCH  Angle ${arg}°`); return;
      case 'hboundary': {
        // The outline and each island drawn as closed polylines (a circle stays a circle) on the hatch's layer; the hatch
        // follows them from now on.
        const { id: _id, hatch: _h, holes: _o, assoc: _a, ...base } = it;
        let next = project;
        const ids: string[] = [], add = (item: Omit<SketchItem, 'id'>) => { const r = addSketch(next, fileOf(), item); next = r.project; ids.push(r.id); };
        add(it.kind === 'circle' ? base : { ...base, kind: 'pline', closed: true });
        for (const h of it.holes ?? []) add({ layer: it.layer, kind: 'pline', pts: h, closed: true, ...(it.color ? { color: it.color } : {}), ...(it.lt ? { lt: it.lt } : {}), ...(it.lw !== undefined ? { lw: it.lw } : {}) });
        change(updateSketch(next, fileOf(), { ...it, assoc: ids }), `HATCH  Its boundary drawn as ${ids.length} closed polyline${ids.length === 1 ? '' : 's'}; the hatch is associative with ${ids.length === 1 ? 'it' : 'them'} · ⌘Z to undo`);
        return;
      }
      case 'plclose': put(closedToggled(it), it.closed ? 'PEDIT  Polyline opened' : 'PEDIT  Polyline closed'); return;
      case 'explode1': { const r = explode(it, defs); if (!failed(r, 'EXPLODE')) change(replaced(project, it, r.items!), `EXPLODE  ${r.items!.length} lines · ⌘Z to undo`); return; }
      case 'roomfrom': {
        const { area } = areaOf(it.pts);
        setResult({ kind: 'area', points: it.pts, how: 'room', name: nameInside(it.pts) });
        cad.say(`Room area = ${m2(toM2(area))} — add it as a room in the panel on the right`); return;
      }
      case 'tocable': {
        const f = project.feeders.find((x) => x.id === cad.cableFeeder);
        if (!f) { cad.setTool('cable'); setTimeout(() => cad.say('ROUTE  Choose the cable in the panel on the right, then right-click the polyline again: Convert to cable route.')); return; }
        put({ ...it, kind: 'pline', layer: CABLE_LAYER, cable: { feederId: f.id } }, `Cable route of ${cableLabel(project, f)}: ${m(toM(pathLength(it.pts)))}`); return;
      }
    }
  }
  /** A grip right-clicked (phase 4): Move, Copy or Rotate from it, or a vertex added, removed, or the polyline closed. */
  function gripAct(a: string) {
    const { action, value } = argOf(a), it = selSketch, i = Number(value);
    if (!it) return;
    const g = gripsOf(it)[i];
    if (!g) return;
    if (action === 'move' || action === 'copy' || action === 'rotate') {
      pointsNext.current = [g.at]; cad.setTool(action);
      setTimeout(() => cad.say(action === 'rotate' ? 'ROTATE  About the grip. Specify rotation angle (degrees) or a point:' : `${action.toUpperCase()}  From the grip. Specify second point:`)); return;
    }
    const next = action === 'add' ? withVertexAdded(it, i) : action === 'remove' ? withVertexRemoved(it, i) : closedToggled(it);
    if (next === it) return;
    change(updateSketch(project, fileOf(), next), `${action === 'add' ? 'GRIP  Vertex added' : action === 'remove' ? 'GRIP  Vertex removed' : it.closed ? 'PEDIT  Polyline opened' : 'PEDIT  Polyline closed'} · ⌘Z to undo`);
  }
  /** REFEDIT: the block picked taken apart where it stands, to edit among the drawing's objects. */
  function refEdit() {
    if (!view) { cad.say('REFEDIT  Open a drawing first.'); return; }
    if (blockEditorOf(view.file)) { cad.say('REFEDIT  Not in the block editor: BSAVE and BCLOSE it, or edit the block there.'); return; }
    const one = pickedSk.length === 1 && !pickedItems.length && pickedSk[0].kind === 'insert' ? pickedSk[0] : selSketch?.kind === 'insert' ? selSketch : undefined;
    if (!one) { cad.say(re ? `REFEDIT  "${re.insert.block}" is being edited in place: REFCLOSE saves or discards it.` : 'REFEDIT  Pick one block drawn here, then REFEDIT (or right-click it: Edit block in place).'); return; }
    const r = startRefEdit(project, view.file, one.id);
    if ('error' in r) { cad.say(r.error); return; }
    pick([]);
    change(r.project, `REFEDIT  Editing "${r.block}" in place: its ${r.n} object${r.n === 1 ? '' : 's'} picked out, the rest faded and locked. Draw, erase or change them; REFCLOSE saves them back into the block or discards them`);
  }
  /** REFCLOSE: the edit in place ended, saved into the block or discarded (asked when not said). */
  function refClose(save?: boolean) {
    if (!re && !project.cadRefEdit) { cad.say('REFCLOSE  No block is being edited in place (REFEDIT starts it).'); return; }
    if (save === undefined) { setReClose(true); cad.say(`REFCLOSE  Save the changes to "${project.cadRefEdit!.insert.block}"? [Save/Discard/Cancel] <Save>:`); input.current?.focus(); return; }
    const r = closeRefEdit(project, save);
    if ('error' in r) { cad.say(r.error); return; }
    pick([]);
    change(r.project, `${r.message} · ⌘Z to undo`);
  }
  /** BEDIT: a block of this drawing opened in the block editor (its tab, if open already, shown). */
  function blockEdit(name?: string) {
    if (!view) { cad.say('BEDIT  Open a drawing first.'); return; }
    if (blockEditorOf(view.file)) { cad.say('BEDIT  This is the block editor: BSAVE saves the block, BCLOSE closes it.'); return; }
    if (project.cadRefEdit) { cad.say(`BEDIT  "${project.cadRefEdit.insert.block}" is being edited in place: REFCLOSE first (Save or Discard).`); return; }
    const one = pickedSk.length === 1 && !pickedItems.length && pickedSk[0].kind === 'insert' ? pickedSk[0] : undefined;
    const want = name?.trim() || one?.block;
    if (!want) { cad.say(defs.length ? `BEDIT  Pick a block, or type BEDIT and its name: ${defs.slice(0, 8).map((d) => d.name).join(', ')}${defs.length > 8 ? ', …' : ''}` : 'BEDIT  This drawing has no blocks of its own yet: make one with BLOCK (an architect\'s block: Copy as a block of this drawing first).'); return; }
    const r = openBlockEditor(project, view.file, want, view.info.units);
    if (!r) { cad.say(`BEDIT  No block "${want}" in this drawing.`); return; }
    const tab = cad.tabOf(r.file);
    if (tab) { cad.show(tab); return; }
    change(r.project, `BEDIT  "${r.def.name}" open in the block editor: ${r.def.items.length} object${r.def.items.length === 1 ? '' : 's'}, base point at 0, 0 · BSAVE saves it into ${view.file}, BCLOSE closes`);
    void load(() => openDrawing(r.file, new TextEncoder().encode(r.dxf)));
  }
  /** BSAVE: the block editor's objects into the block. */
  function blockSave(): boolean {
    if (!view) return false;
    const r = saveBlockEditor(project, view.file);
    if (r.changed) change(r.project, `${r.message} · ⌘Z to undo`); else cad.say(r.message);
    return r.changed;
  }
  /** BCLOSE: the block editor closed, its copies taken out of the project (saved first, or not, when asked). */
  function blockClose(save?: boolean) {
    if (!view) return;
    const be = blockEditorOf(view.file);
    if (!be) { cad.say('BCLOSE  Not in the block editor (BEDIT opens a block in it).'); return; }
    if (save === undefined && blockEditorChanged(project, view.file)) { setBeClose(true); cad.say(`BCLOSE  Save the changes to "${be.name}"? [Yes/No/Cancel] <Yes>:`); input.current?.focus(); return; }
    const saved = save ? saveBlockEditor(project, view.file) : undefined;
    const next = closeBlockEditor(saved?.project ?? project, view.file), editor = view, host = cad.tabOf(be.host);
    change(next, saved ? `${saved.message} · block editor closed · ⌘Z to undo` : `BCLOSE  Block editor of "${be.name}" closed${save === false ? ', changes not saved' : ''}`);
    closeNow([editor]);
    if (host) cad.show(host);
  }
  /** A block by name: one of the drawing's, else one inserted lately (added to the drawing when placed). */
  const blockByName = (name: string): CadBlockDef | undefined => blockDefOf(defs, name.trim()) ?? recentBlocks.find((d) => d.name.toLowerCase() === name.trim().toLowerCase());
  /** INSERT: the block chosen (in the palette, by name, or from Insert's arrow) waits at the cursor for its insertion point. */
  function startInsert(def: CadBlockDef) {
    if (!view) { cad.say('INSERT  Open a drawing first.'); return; }
    setInsBlock(def); setInsAsk(null); setMenuAt(null);
    if (tool === 'insert') cad.say(PROMPT.insert); else cad.setTool('insert');
  }
  /** The block placed: into the drawing's blocks when it is not there yet, then one insert at the point (or, with
   * Explode ticked, its objects), one undo step; Recent remembers it. Repeat placement keeps the tool. */
  function placeInsert(def: CadBlockDef, at: Pt) {
    // A block with attributes: each prompt first (on the command line, or in a dialog as Drafting settings has it).
    const asked = insSet.explode ? [] : askedAttdefs(def);
    if (asked.length) {
      if (draft.attDialog) { setAttPend({ def, at, asked, i: 0, values: {}, dialog: true }); return; }
      setAttPend({ def, at, asked, i: 0, values: {}, dialog: false }); cad.say(`INSERT  ${asked[0].prompt || asked[0].tag} <${asked[0].text ?? ''}>:`); input.current?.focus(); return;
    }
    finishInsert(def, at, {});
  }
  /** The block placed with its attribute values. */
  function finishInsert(def: CadBlockDef, at: Pt, attrs: Record<string, string>) {
    const known = blockDefOf(defs, def.name), allDefs = known ? defs : [...defs, def];
    let next = known ? project : withBlockDef(project, fileOf(), def);
    const ins: SketchItem = { id: '_', kind: 'insert', layer: curLayer, pts: [at], block: def.name, ...(insSet.scale !== 1 ? { sc: insSet.scale } : {}), ...(insSet.rot ? { rot: (insSet.rot * Math.PI) / 180 } : {}), ...(Object.keys(attrs).length ? { attrs } : {}), ...newProps };
    if (insSet.explode) for (const it of explodeInsert(ins, allDefs)) next = addSketch(next, fileOf(), it).project;
    else { const { id: _id, ...rest } = ins; next = addSketch(next, fileOf(), rest).project; }
    change(next, `INSERT  "${def.name}"${insSet.explode ? ', exploded,' : ''} at ${m(toM(at[0]))}, ${m(toM(at[1]))} · ⌘Z to undo`);
    setRecentBlocks((r) => pushRecentBlock(def, r));
    if (insSet.repeat) cad.say(PROMPT.insert); else { setInsBlock(null); cad.setTool('none'); }
  }
  /** One of the architect's blocks, as a block of the app's own: what the engine explodes an insert of it into. */
  async function insertArchBlock(name: string) {
    if (!view) return;
    const ins = view.blocks().find((b) => b.block === name);
    if (!ins) { cad.say(`INSERT  No insert of "${name}" to copy in the drawing.`); return; }
    try {
      const { pieces } = await explodeObjects(view, [ins.handle]);
      const list = pieces[ins.handle] ?? Object.values(pieces).flat();
      if (!list.length) { cad.say(`INSERT  "${name}" has nothing the app can draw.`); return; }
      startInsert(defFromPieces(name, list, undefined, view.info.units));
    } catch (e) { cad.say(`INSERT  ${e instanceof Error ? e.message : String(e)}`); }
  }
  /** A drawing file of the library as one block named after it. */
  async function insertLibraryFile(f: LibraryFile) {
    try {
      const bytes = f.blob ? new Uint8Array(await f.blob.arrayBuffer()) : f.path ? (await window.lvds?.cadFile?.readBytes?.(f.path))?.bytes : undefined;
      if (!bytes) { cad.say(`INSERT  ${f.file} could not be read.`); return; }
      startInsert(defFromGeometry(blockNameFromFile(f.file), await readRefGeometry(f.file, bytes)));
    } catch (e) { cad.say(`INSERT  ${f.file}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  /** Folder… on the desktop: a folder of DWG / DXF files, remembered on this computer. */
  async function chooseLibraryFolder() {
    const r = await window.lvds?.cadFile?.chooseBlockFolder?.();
    if (!r) return;
    setLibrary({ folder: r.folder, files: r.files });
    try { localStorage.setItem(LIB_KEY, r.folder); } catch { /* not kept */ }
  }
  /** A block dragged from the palette and dropped on the drawing. */
  function dropBlock(at: Pt, name: string) { const def = blockByName(name); if (def) { setInsBlock(def); placeInsert(def, at); } }
  /** BLOCK (B, Make block… on the right-click menu): the Block definition dialog, with the drawn objects picked as its
   * objects and the lowest left corner of their points as the base point to start from. */
  function openBlockDialog() {
    if (!view) { cad.say('BLOCK  Open a drawing first.'); return; }
    const items = pickedSk.filter(blockable), pts = items.flatMap((it) => it.pts);
    setMenuAt(null);
    setBlockDlg({ name: '', base: pts.length ? [Math.min(...pts.map((q) => q[0])), Math.min(...pts.map((q) => q[1]))] : null, ids: items.map((it) => it.id), mode: 'convert', description: '' });
    cad.say(`BLOCK  Block definition${items.length ? `: ${picks(items.length)}` : ''}`);
  }
  /** The block defined from the objects (trays and cable routes left out), the objects then kept, replaced by one insert
   * at the base point, or taken away: one undo step. */
  function applyBlock(name: string, base: Pt, ids: string[], mode: BlockDraft['mode'], description: string) {
    const items = sketch.filter((it) => ids.includes(it.id) && blockable(it));
    if (!items.length) { cad.say('BLOCK  Nothing to make a block of: trays and cable routes stay as they are.'); return; }
    const def = defineBlock(name, items, base, { units: view?.info.units, ...(description.trim() ? { description: description.trim() } : {}) });
    let next = withBlockDef(project, fileOf(), def);
    if (mode !== 'retain') for (const it of items) next = removeSketch(next, fileOf(), it.id);
    if (mode === 'convert') next = addSketch(next, fileOf(), { kind: 'insert', layer: curLayer, pts: [base], block: def.name }).project;
    change(next, `BLOCK  "${def.name}" defined from ${picks(items.length).replace(' selected', '')}${mode === 'convert' ? ' and inserted' : mode === 'delete' ? ', the objects removed' : ''} · ⌘Z to undo`);
    setBlockDlg(null); setBlk(null); pick([], []); cad.setTool('none');
  }
  /** DRAWORDER: the drawn objects picked to the front, the back, or just above or under the reference object; the list's
   * order is the paint order on the canvas, the sheets and in the DXF / DWG (one undo step). */
  function applyDrawOrder(mode: DrMode, ref?: SketchItem) {
    const ids = drTargets().map((it) => it.id), n = ids.length, what = `${n} object${n === 1 ? '' : 's'}`;
    const next = mode === 'front' ? toFront(sketch, ids) : mode === 'back' ? toBack(sketch, ids) : ref ? (mode === 'above' ? above : under)(sketch, ids, [ref.id]) : sketch;
    const where = mode === 'front' ? 'in front' : mode === 'back' ? 'at the back' : `${mode} the ${kindOf(ref ?? sketch[0]).toLowerCase()}`;
    if (!n) cad.say('DRAWORDER  Nothing picked.');
    else if (sameOrder(sketch, next)) cad.say(`DRAWORDER  ${what} already ${where}.`);
    else change(withSketchItems(project, fileOf(), next), `DRAWORDER  ${what} ${mode === 'front' ? 'brought to the front' : mode === 'back' ? 'sent to the back' : `put ${where}`} · ⌘Z to undo`);
    setDrMode(null); pick([], []); cad.setTool('none');
  }
  /** The drawn objects DRAWORDER moves: those picked, else the one selected. */
  const drTargets = () => (pickedSk.length ? pickedSk : selSketch ? [selSketch] : []);
  /** TEXTTOFRONT: the texts and notes, dimensions, leaders, or all three, over everything else. */
  function applyTextToFront(which: TextKind) {
    const next = textToFront(sketch, which), name = { text: 'texts', dims: 'dimensions', leaders: 'leaders', all: 'texts, dimensions and leaders' }[which];
    if (sameOrder(sketch, next)) cad.say(`TEXTTOFRONT  The ${name} are in front already.`);
    else change(withSketchItems(project, fileOf(), next), `TEXTTOFRONT  The ${name} brought to the front · ⌘Z to undo`);
    cad.setTool('none');
  }
  /** Join: the drawn objects picked that meet end to end become one. */
  function applyJoin() {
    const r = join(pickedSk, 0.01 / units.factor);
    if (failed(r, 'JOIN')) return;
    const [first, ...rest] = pickedSk.filter((it) => r.joined!.includes(it.id));
    let next = replaced(project, first, r.items!);
    for (const it of rest) next = removeSketch(next, fileOf(), it.id);
    change(next, `JOIN  ${r.joined!.length} objects joined into one polyline${pickedSk.length > r.joined!.length ? ` (${pickedSk.length - r.joined!.length} did not meet the others)` : ''} · ⌘Z to undo`);
    pick([], []); cad.setTool('none');
  }
  /** Array: copies of the drawn objects picked (rectangular, or polar round `centre`). */
  function applyArray(centre?: Pt, polar = edSet.polar) {
    const f = units.factor, n = (s: string, d: number) => (Number.isFinite(Number(s)) && s.trim() !== '' ? Number(s) : d);
    const copies = pickedSk.flatMap((it) => (polar ? arrayPolar(it, centre!, n(edSet.n, 6), n(edSet.angle, 360), edSet.rotate) : arrayRect(it, n(edSet.rows, 2), n(edSet.cols, 3), n(edSet.dx, 1) / f, n(edSet.dy, 1) / f)));
    if (!copies.length) { cad.say('ARRAY  Nothing to copy: more rows, columns or items.'); return; }
    change(added(project, copies), `ARRAY  ${copies.length} cop${copies.length === 1 ? 'y' : 'ies'} made · ⌘Z to undo`);
    pick([], []); cad.setTool('none');
  }
  /** Mirror: the drawn objects picked about the line from `a` to `b`, the originals erased or kept. */
  function applyMirror(a: Pt, b: Pt, erase: boolean) {
    const flipped = pickedSk.map((it) => mirrored(it, a, b));
    let next = project;
    pickedSk.forEach((it, i) => { next = erase ? updateSketch(next, fileOf(), { ...flipped[i], id: it.id } as SketchItem) : addSketch(next, fileOf(), flipped[i]).project; });
    change(next, `MIRROR  ${picks(pickedSk.length).replace(' selected', '')} mirrored${erase ? '' : ', originals kept'} · ⌘Z to undo`);
    setEdSet({ ...edSet, keep: !erase }); setEdAsk(null);
    setPoints([]); pick([], []); cad.setTool('none');
  }
  /** Scale: the drawn objects picked by a factor about the base point. */
  function applyScale(base: Pt, factor: string) {
    const k = Number(factor);
    if (!(k > 0)) { cad.say(`SCALE  The factor must be above 0. Specify scale factor <${edSet.factor}>:`); return; }
    change(pickedSk.reduce((q, it) => updateSketch(q, fileOf(), scaled(it, base, k)), project), `SCALE  ${picks(pickedSk.length).replace(' selected', '')} scaled × ${k} · ⌘Z to undo`);
    setEdSet({ ...edSet, factor }); setEdAsk(null);
    setPoints([]); pick([], []); cad.setTool('none');
  }
  /** A click with an edit tool (drawing units). */
  function editClick(at: Pt, pixel: number, shiftKey: boolean) {
    const sk = hitAt(pickable, at, pickR * pixel), f = units.factor, num = (s: string) => Number(s);
    const cmd = tool.toUpperCase();
    if (PICK_FIRST.includes(tool) && edPhase === 'pick') {
      if (!sk) { cad.say(`${cmd}  Click a drawn object (the architect's drawing is not changed):`); return; }
      const sks = pickedKeys.has(`sk:${sk.id}`) ? pickedSk.filter((x) => x.id !== sk.id) : [...pickedSk, sk];
      pick([], sks); cad.say(`${cmd}  ${picks(sks.length)} — Enter when done`); return;
    }
    if (tool === 'draworder' && edPhase === 'points' && (drMode === 'above' || drMode === 'under')) {
      if (!sk) { cad.say(`DRAWORDER  Nothing there. ${DR_REF}`); return; }
      if (drTargets().some((it) => it.id === sk.id)) { cad.say(`DRAWORDER  That is one of the objects picked: click another. ${DR_REF}`); return; }
      applyDrawOrder(drMode, sk); return;
    }
    if (tool === 'talign' && tAsk?.step === 'ref') {
      const mode = tAsk.mode as AlignMode, texts = pickedSk.filter((it) => it.kind === 'text');
      const ref = sk?.kind === 'text' ? alignEdge(sk, mode) : mode === 'top' || mode === 'bottom' ? at[1] : at[0];
      changeTexts('TALIGN', texts.filter((it) => it.id !== sk?.id).map((it) => alignedTo(it, mode, ref)), `lined up ${mode} on ${sk?.kind === 'text' ? `"${sk.text}"` : 'the point'}`); return;
    }
    if (tool === 'tcen' && edPhase === 'points') {
      const texts = pickedSk.filter((it) => it.kind === 'text');
      if (texts.length !== 1) { cad.say(textToolPrompt(tool)); return; }
      if (!points.length) { setPoints([at]); cad.say('TCEN  Specify second point:'); return; }
      const mid: Pt = [(points[0][0] + at[0]) / 2, (points[0][1] + at[1]) / 2];
      setPoints([]); changeTexts('TCEN', [centredAt(texts[0], mid)], 'centred between the points'); return;
    }
    if (tool === 'tcopy' && edPhase === 'points') {
      if (sk?.kind !== 'text') { cad.say('TCOPY  Click a drawn text to copy the words from:'); return; }
      const texts = pickedSk.filter((it) => it.kind === 'text' && it.id !== sk.id);
      changeTexts('TCOPY', texts.map((it) => ({ ...it, text: sk.text })), `given the words "${sk.text}"`); return;
    }
    if (tool === 'trim' || tool === 'extend') {
      if (!sk) { cad.say(`${cmd}  Click a drawn line (the architect's lines are not changed):`); return; }
      const asTrim = (tool === 'trim') !== shiftKey, edges = edgesFor(sketch, sk.id, drawingSegs);
      const r = asTrim ? trim(sk, at, edges) : extend(sk, at, edges);
      if (failed(r, asTrim ? 'TRIM' : 'EXTEND')) return;
      change(replaced(project, sk, r.items!), asTrim ? `TRIM  ${m(toM((r as { cut?: number }).cut ?? 0))} cut off · ⌘Z to undo` : `EXTEND  ${m(toM((r as { gain?: number }).gain ?? 0))} longer · ⌘Z to undo`);
      return;
    }
    if (tool === 'explode') {
      if (!sk) { cad.say('EXPLODE  Click a polyline or rectangle:'); return; }
      const r = explode(sk, defs);
      if (!failed(r, 'EXPLODE')) change(replaced(project, sk, r.items!), `EXPLODE  ${r.items!.length} ${sk.kind === 'mtext' ? 'texts' : sk.kind === 'insert' ? 'objects' : 'lines'} · ⌘Z to undo`);
      return;
    }
    if (tool === 'offset' || tool === 'fillet' || tool === 'chamfer' || tool === 'break') {
      if (!edStep) {
        if (!sk) { cad.say(`${cmd}  Click a drawn object:`); return; }
        setEdStep({ id: sk.id, at }); setEdAsk(null);
        cad.say(tool === 'offset' ? (edSet.through ? 'OFFSET  Specify through point:' : OFFSET_SIDE) : tool === 'break' ? 'BREAK  Specify second break point <split here>:' : `${cmd}  Select second object:`);
        return;
      }
      const first = sketch.find((x) => x.id === edStep.id);
      setEdStep(null);
      if (!first) return;
      if (tool === 'offset') {
        const d = edSet.through ? throughDistance(first, at) : num(edSet.offset) / f;
        const r = offset(first, d, at);
        // On the current layer (where new drawing goes) unless a tray, which stays on its own. With Erase the source
        // itself moves: a cable route stays the route of its circuit, on its layer.
        const items = r.items?.map((x, i) => (edSet.erase && i === 0 && first.cable ? { ...x, cable: first.cable, layer: first.layer }
          : edSet.layer === 'current' && !x.tray ? { ...x, layer: DRAW_LAYER } : x));
        if (!failed(r, 'OFFSET')) change(edSet.erase ? replaced(project, first, items!) : added(project, items!), `OFFSET  ${first.tray ? `Cable tray ${first.tray.widthMm} mm` : kindOf(first)} ${edSet.erase ? 'moved' : 'copied'} ${m(toM(d))} to the side${edSet.through ? ' (through the point)' : ''} · ⌘Z to undo`);
        cad.say(PROMPT.offset); return;
      }
      if (tool === 'break') {
        const r = breakAt(first, edStep.at, at);
        if (!failed(r, 'BREAK')) change(replaced(project, first, r.items!), `BREAK  ${kindOf(first)} broken · ⌘Z to undo`);
        return;
      }
      if (!sk) { cad.say(`${cmd}  Click the second line:`); setEdStep(edStep); return; }
      const r = tool === 'fillet' ? fillet(first, edStep.at, sk, at, num(edSet.radius) / f) : chamfer(first, edStep.at, sk, at, num(edSet.d1) / f, num(edSet.d2) / f);
      if (failed(r, cmd)) return;
      const [a, b, ...extra] = r.items!;
      // No trim: the lines stay as they are, only the arc (or the chamfer line) is added.
      if (!edSet.trim && !extra.length) { cad.say(`${cmd}  Nothing to add with no trim at 0: set the ${tool === 'fillet' ? 'radius' : 'distances'} first.`); return; }
      change(edSet.trim ? added(replaced(replaced(project, first, [a]), sk, [b]), extra) : added(project, extra), `${cmd}  ${tool === 'fillet' ? (extra.length ? `radius ${m(num(edSet.radius))}` : 'sharp corner') : `${m(num(edSet.d1))} × ${m(num(edSet.d2))}`}${edSet.trim ? '' : ', lines not trimmed'}${r.note ? ` — ${r.note}` : ''} · ⌘Z to undo`);
      return;
    }
    if (tool === 'mirror') {
      if (!points.length) { setPoints([at]); cad.say('MIRROR  Specify second point of the mirror line:'); return; }
      // Then: erase the originals? A click takes the answer in < >, as Enter does.
      if (edAsk === 'erase') { applyMirror(points[0], points[1], !edSet.keep); return; }
      setPoints([points[0], at]); setEdAsk('erase'); cad.say(mirrorAsk(edSet)); return;
    }
    if (tool === 'scale') {
      if (edAsk === 'factor' && points.length) { applyScale(points[0], edSet.factor); return; }
      setPoints([at]); setEdAsk('factor'); cad.say(`SCALE  Specify scale factor <${edSet.factor}>:`); return;
    }
    if (tool === 'array') {
      if (edAsk === 'type') { cad.say(arrayType(edSet)); return; }
      if (edSet.polar) applyArray(at, true); else { setEdAsk('type'); cad.say(arrayType(edSet)); }
      return;
    }
    if (tool === 'stretch') {
      if (!stretchBox) { cad.say(PROMPT.stretch); return; }
      if (!points.length) { setPoints([at]); cad.say('STRETCH  Specify second point:'); return; }
      const [dx, dy] = [at[0] - points[0][0], at[1] - points[0][1]], [a, b] = stretchBox;
      let next = project, n = 0;
      for (const it of sketch) { const st = stretched(it, a, b, dx, dy); if (st) { next = updateSketch(next, fileOf(), st); n += 1; } }
      const inBox = inWindow(placed, [a[0] * f, a[1] * f], [b[0] * f, b[1] * f], false, 0);
      if (inBox.length && floor) next = moveDevices(next, inBox, new Map(inBox.map((d): [string, Pt] => [d.key, [d.x + dx * f, d.y + dy * f]])), floor.ref);
      if (!n && !inBox.length) cad.say('STRETCH  Nothing has points in the window.');
      else change(next, `STRETCH  ${n} drawn object${n === 1 ? '' : 's'}${inBox.length ? ` and ${inBox.length} device${inBox.length === 1 ? '' : 's'}` : ''} by ${m(toM(Math.hypot(dx, dy)))} · ⌘Z to undo`);
      setPoints([]); setStretchBox(null); cad.setTool('none');
    }
  }
  /** An edit from the toolbar, the menu or the side panel, on the devices picked. */
  function editDevices(e: DeviceEdit, arg?: string) {
    const items = pickedItems;
    setMenuAt(null);
    if (!floor || !items.length) return;
    const what = items.length === 1 ? items[0].label : `${items.length} devices`;
    try {
      if (e === 'filter' && arg) { const keep = items.filter((d) => typeOf(project, d) === arg); pick(keep); cad.say(`SEL  ${keep.length} × ${keep[0]?.label ?? arg} kept`); }
      else if (e === 'row' || e === 'column' || e === 'space') {
        const to = arranged(items, e);
        change(moveDevices(project, items, to, floor.ref), `${e === 'space' ? `SPACE  ${items.length} devices spaced equally` : `ALIGN  ${items.length} devices in a ${e}`} · ⌘Z to undo`);
      } else if (e === 'array') {
        const d = (project.lvPoints ?? []).find((x) => x.id === items[0].id);
        setArlSet((s) => ({ ...s, device: typeOf(project, items[0]) }));
        if (d) cad.setFeederId(d.feederId);
        cad.setTool('arl');
      } else if (e === 'replace' && arg) {
        const r = replaceDevices(project, items, arg);
        const to = palette.find((x) => x.id === arg)?.label ?? arg;
        const lighting = items.some((d) => /^ltg$/.test(typeOf(project, d))) && arg !== 'ltg' && items[0].what === 'lv';
        if (r.changed) change(r.project, `REPLACE  ${what} → ${to}${lighting ? ' — check the circuit: it was a lighting point' : ''} · ⌘Z to undo`); else cad.say(`REPLACE  Nothing to change: already ${to}, or an emergency light or sign.`);
      } else if (e === 'circuit' && arg) {
        const f = project.feeders.find((x) => x.id === arg);
        const after = circuitAfter(project, items, arg);
        const r = toCircuit(project, items, arg);
        if (r.changed && f) change(r.project, `CIRCUIT  ${what} on ${circuitLabel(project, f).split(' · ')[0]} (${after.points} points${after.over ? `; ${after.over.n} of this type, over the ${after.over.max} allowed` : ''}) · ⌘Z to undo`);
        else cad.say('CIRCUIT  Already on that circuit.');
      } else if (e === 'coverage') {
        cad.setDevice(typeOf(project, items[0]));
        if (!cad.coverage) cad.setCoverage(true);
      } else if (e === 'match') {
        setMatchFrom(items[0].key); cad.setTool('match');
        setTimeout(() => cad.say(`MA  From ${items[0].label}: click each device to change.`));
      } else if (e === 'move' || e === 'copy') {
        if (items.length === 1) cad.setSelected(items[0].key);
        cad.setTool(e);
        setTimeout(() => cad.say(`${e.toUpperCase()}  ${what}: specify base point:`));
      } else if (e === 'delete') removeSelected();
      else if (e === 'rename') {
        setRenaming(items[0].id); cad.say(`RENAME  Type the new name of ${items[0].id} (now ${items[0].detail || 'none'}), Enter:`); input.current?.focus();
      } else if (e === 'circuits') {
        const on = onBoard(project, placed, items[0].id);
        pick(on); cad.say(`SEL  ${on.length} device${on.length === 1 ? '' : 's'} on ${items[0].id}'s circuits on this level`);
      }
    } catch (err) { cad.say(err instanceof Error ? err.message : String(err)); }
  }
  /** Array on line: places the devices along the line. */
  function placeArl() {
    if (!floor || !arlItem) return;
    try {
      const r = placeAlong(project, floor.ref, arlSet.device, cad.feederId, arlAt);
      const f = 'lv' in arlItem.kind ? project.feeders.find((x) => x.id === cad.feederId) : undefined;
      change(r.project, `ARL  ${r.placed} × ${arlItem.label} placed${f ? ` on ${circuitLabel(project, f).split(' · ')[0]}` : ''} · ⌘Z to undo`);
      setPoints([]);
    } catch (err) { cad.say(`ARL  ${err instanceof Error ? err.message : String(err)}`); }
  }

  /** The room name inside an outline: a text on a layer named like room names, else any text inside. */
  const nameInside = (poly: Pt[]) => {
    const texts = (drawn?.info.texts ?? []).filter((t) => layersOn[t.layer] && inside([t.x, t.y], poly));
    const named = texts.find((t) => /ROOM|RM|NAME|SPACE/i.test(view!.info.layers[t.layer]?.name ?? ''));
    return (named ?? texts[0])?.s.trim();
  };

  function finishArea(pts: Pt[]) {
    if (pts.length < 3) { cad.say('An area needs at least 3 corners.'); return; }
    setResult({ kind: 'area', points: pts, how: tool === 'trace' ? 'trace' : 'corners', name: nameInside(pts) });
    const { area, perimeter } = areaOf(pts);
    cad.say(`Area = ${m2(toM2(area))}, Perimeter = ${m(toM(perimeter))}`);
    setPoints([]);
  }

  /** The dimension Continue and Baseline go on from: the last one drawn on this drawing. */
  const lastDim = useMemo(() => { for (let i = sketch.length - 1; i >= 0; i -= 1) if (sketch[i].kind === 'dim' && sketch[i].pts.length > 2 && !sketch[i].dimKind) return sketch[i]; return undefined; }, [sketch]);
  /** The next dimension of the chain to `to`: baseline ones step out by 3.75 mm on paper (ISO), or 1.5 × their text. */
  const chainDim = (base: SketchItem, to: Pt) => nextDim(base, to, tool === 'dimcont' ? 'continue' : 'baseline', Math.max(3.75 * unitsPerPaperMm(anno, units.factor), 1.5 * (base.h ?? 0)));
  const draw = (item: Omit<SketchItem, 'id'>, what: string) => {
    if (!view) return;
    const { project: next, id } = addSketch(project, view.file, item);
    change(next, `${what} · ⌘Z to undo`);
    return id;
  };
  /** The object a modify tool works on: the drawn object or the device under the click. */
  const selectAt = (at: Pt, pixel: number): boolean => {
    const d = deviceAt(at, pixel);
    if (d) { cad.setSelected(d.key); setResult({ kind: 'device', it: d }); return true; }
    const sk = hitAt(pickable, at, pickR * pixel);
    if (sk) { cad.setSelected(`sk:${sk.id}`); setResult({ kind: 'sketch', it: sk }); return true; }
    return false;
  };
  /** Moves (or copies) the selected object by (dx, dy) drawing units. */
  function shift(dx: number, dy: number, copy: boolean) {
    if (!view || !floor && !selSketch) return;
    if (selSketch) {
      if (copy) draw({ ...moved(selSketch, dx, dy), id: undefined } as Omit<SketchItem, 'id'>, 'Copied');
      else change(updateSketch(project, view.file, moved(selSketch, dx, dy)), 'Moved · ⌘Z to undo');
      return;
    }
    if (!selectedItem || !floor) return;
    const [x, y] = [selectedItem.x + dx * units.factor, selectedItem.y + dy * units.factor];
    if (!copy) { change(selectedItem.what === 'elv' ? moveElv(project, selectedItem.id, x, y) : moveItem(project, selectedItem, x, y, floor.ref), `${selectedItem.label} moved · ⌘Z to undo`); return; }
    if (selectedItem.what === 'lv') {
      const src = (project.lvPoints ?? []).find((p) => p.id === selectedItem.id)!;
      change(placeLvPoint(project, floor.ref, src.type, src.feederId, x, y, src.emergency, src.luminaire).project, `${selectedItem.label} copied onto ${selectedItem.detail.split(' · ')[0]} · ⌘Z to undo`);
    } else if (selectedItem.what === 'elv') {
      const src = (project.elvDevices ?? []).find((p) => p.id === selectedItem.id)!;
      change(placeElv(project, src.type, floor.ref, x, y).project, `${selectedItem.label} copied · ⌘Z to undo`);
    } else cad.say('COPY  A board is one item; place another board with Add device.');
  }

  // ---- clipboard (COPYCLIP, COPYBASE, PASTECLIP, PASTEORIG; src/model/cadClipboard.ts)

  /** Why the objects picked cannot be copied, said on the command line; nothing when they can. */
  function clipRefusal(name: string): boolean {
    if (!view) { cad.say(`${name}  Open a drawing first.`); return true; }
    if (!pickedSk.length) { cad.say(`${name}  Pick drawn objects first${pickedItems.length ? ' (devices are not copied to the clipboard; use CO to copy them on this plan)' : ''}.`); return true; }
    return false;
  }
  /** The drawn objects picked to the clipboard, from `base` (COPYBASE) or their lower-left corner. */
  function copyClip(base?: Pt) {
    const name = base ? 'COPYBASE' : 'COPYCLIP';
    if (clipRefusal(name) || !view) return;
    putClip(clipText(clipPayload(project, view.file, pickedSk, base ?? lowerLeft(pickedSk), unitCode)));
    const n = pickedSk.length, d = pickedItems.length;
    cad.say(`${name}  ${n} object${n === 1 ? '' : 's'} copied${d ? ` · ${d} device${d === 1 ? '' : 's'} not copied (devices stay on their plan)` : ''}`);
  }
  /** CUTCLIP (Ctrl+X): the drawn objects picked to the clipboard, then erased (one undo step); devices stay. */
  function cutClip() {
    if (clipRefusal('CUTCLIP') || !view) return;
    putClip(clipText(clipPayload(project, view.file, pickedSk, lowerLeft(pickedSk), unitCode)));
    const n = pickedSk.length, d = pickedItems.length;
    change(pickedSk.reduce((q, it) => removeSketch(q, view.file, it.id), project), `CUTCLIP  ${n} object${n === 1 ? '' : 's'} cut to the clipboard${d ? ` · ${d} device${d === 1 ? '' : 's'} left (devices stay on their plan)` : ''} · ⌘Z to undo`);
    setPicked([]); cad.setSelected(null); setResult(null);
  }
  /** PASTECLIP: the copied objects follow the cursor to the insertion point. PASTEORIG: the same coordinates, into
   * another drawing. */
  function pasteClip(orig: boolean) {
    const name = orig ? 'PASTEORIG' : 'PASTECLIP';
    if (!view) { cad.say(`${name}  Open a drawing first.`); return; }
    const take = (text: string | null) => {
      if (!text) { cad.say(`${name}  Nothing copied yet: pick drawn objects and press Ctrl+C.`); return; }
      const r = parseClip(text);
      if ('error' in r) { cad.say(`${name}  ${r.error}`); return; }
      if (!orig) { setPasting(r.clip); cad.setTool('paste'); return; }
      if (r.clip.file.toLowerCase() === view.file.toLowerCase()) { cad.say('PASTEORIG  Not in the drawing the objects came from — use PASTECLIP.'); return; }
      placeClip(r.clip, 'orig');
    };
    const got = getClip();
    if (typeof got === 'string') take(got); else void got.then(take);
  }
  /** The copied objects into this drawing as one undo step. */
  function placeClip(c: ClipPayload, at: Pt | 'orig') {
    if (!view) return;
    const name = at === 'orig' ? 'PASTEORIG' : 'PASTECLIP';
    const r = pastedItems(c, view.file, unitCode, at), w = withPasted(project, view.file, c, r.items), n = r.items.length;
    const plain = r.plain ? ` · ${r.plain} tray${r.plain === 1 ? ' or cable route pasted as a polyline' : 's or cable routes pasted as polylines'} (their data stays in its own drawing)` : '';
    const layers = w.layersAdded.length ? ` · layer${w.layersAdded.length === 1 ? '' : 's'} ${w.layersAdded.join(', ')} added` : '';
    change(w.project, `${name}  ${n} object${n === 1 ? '' : 's'} pasted${plain}${layers} · ⌘Z to undo`);
  }

  // ---- zoom (ZOOM Window / Previous / Scale, S2 of the 2D gap plan; src/model/cadView.ts, cadViewHistory.ts)

  const zoomTo = (d: ZoomReq['do']) => setZoomReq((z) => ({ n: (z?.n ?? 0) + 1, do: d }));
  /** Why ZOOM cannot run now: no drawing, or a layout (its paper fits the pane and its viewports keep their scale). */
  function zoomRefused(): boolean {
    if (!view) { cad.say('ZOOM  Open a drawing first.'); return true; }
    if (cad.layout) { cad.say('ZOOM  Works in the model view; a layout\'s paper fits the pane and its viewports keep their scale.'); return true; }
    return false;
  }
  function zoomPrev() {
    if (zoomRefused() || !view) return;
    if (!hasPreviousView(view)) { cad.say('ZOOM  No previous view'); return; }
    zoomTo({ kind: 'previous' });
  }
  /** An option typed at ZOOM's prompt (Enter: Window). */
  function zoomOption(k: string) {
    if (k === 'W') cad.setTool('zoomwin');
    else if (k === 'P') { zoomPrev(); cad.setTool('none'); }
    else if (k === 'S') cad.setTool('zoomscale');
    else if (k === 'E') { cad.fit(); cad.setTool('none'); }
    else cad.say(PROMPT.zoom);
  }
  /** The zoom chip's menu, and the right-click entries with nothing picked. */
  function zoomMenu(k: ZoomMenuKey) {
    if (k === 'extents') cad.fit();
    else if (k === 'previous') zoomPrev();
    else if (!zoomRefused()) cad.setTool(k === 'window' ? 'zoomwin' : 'zoomscale');
  }

  // ---- QSELECT and SELECTSIMILAR (S3; src/model/cadQuickSelect.ts)

  /** The objects the Quick select dialog found: the selection, or added to it. */
  function applyQuickSelect(found: SketchItem[], add: boolean) {
    setDlg(null);
    if (!found.length && !add) { cad.say('QSELECT  No object matches.'); return; }
    const sks = add ? [...pickedSk, ...found.filter((it) => !pickedKeys.has(`sk:${it.id}`))] : found;
    pick([], sks);
    cad.say(`QSELECT  ${picks(sks.length)}`);
  }
  /** SELECTSIMILAR: every pickable drawn object like those picked. */
  function applySimilar() {
    if (!pickedSk.length) { cad.say('SELECTSIMILAR  Pick a drawn object first (click it, then Enter).'); return; }
    const found = selectSimilar(pickable, pickedSk, ssOpts);
    pick([], found);
    cad.say(`SELECTSIMILAR  ${picks(found.length)}`);
    cad.setTool('none');
  }
  /** What is typed at SELECTSIMILAR's prompts: Enter selects, S asks what else to match. */
  function similarInput(c: string) {
    if (ssAsk) { setSsOpts({ colour: c === 'C' || c === 'B', linetype: c === 'L' || c === 'B' }); setSsAsk(false); cad.say(PROMPT.selsim); return; }
    if (c === 'S') { setSsAsk(true); cad.say('SELECTSIMILAR  Also match [Colour/Linetype/Both/None] <None>:'); return; }
    if (c === '') { applySimilar(); return; }
    cad.say(PROMPT.selsim);
  }

  // ---- DIMRADIUS, DIMDIAMETER, DIMANGULAR (S4; src/model/cadSketch.ts radialDimLines / angularDimLines, cadDims.ts)

  /** A new radius, diameter or angular dimension in the current dimension style (plain, as DIM is, without one). */
  const dimItem = (pts: Pt[], dimKind: NonNullable<SketchItem['dimKind']>): Omit<SketchItem, 'id'> => {
    const ds = dimLookOf(project, units.factor);
    return { kind: 'dim', dimKind, layer: ANNO_LAYER, pts, ...(ds ? { h: ds.textH, look: ds.look } : { h: textH * 0.8 }) };
  };
  const radialItem = (q: { c: Pt; r: number }, at: Pt, k: 'radius' | 'diameter') => dimItem([q.c, onRound(q.c, q.r, at), at], k);
  /** What is under a click for the dimensions: a drawn arc or circle (an arc with its ends) or the straight piece of a
   * drawn line, else the same of the opened drawing (its circles and arcs come as segments; src/model/cadDims.ts). */
  async function roundOrLineAt(at: Pt, pixel: number): Promise<{ round?: { c: Pt; r: number; ends?: [Pt, Pt] }; line?: [Pt, Pt] }> {
    const sk = hitAt(pickable, at, pickR * pixel);
    if (sk) {
      if (sk.kind !== 'circle' && sk.kind !== 'arc') return { line: nearestPiece(sk, at) };
      const r = sk.r ?? 0, e = (a: number): Pt => [sk.pts[0][0] + r * Math.cos(a), sk.pts[0][1] + r * Math.sin(a)];
      return { round: { c: sk.pts[0], r, ...(sk.kind === 'arc' ? { ends: [e(sk.a0 ?? 0), e(sk.a1 ?? 0)] as [Pt, Pt] } : {}) } };
    }
    const o = view ? await view.pick(at[0], at[1], pickR * pixel, pickOn) : null;
    if (!o || !view) return {};
    const kind = o.kind.toLowerCase(), S = view.segs;
    if (kind !== 'circle' && kind !== 'arc') return { line: nearestSegment(S, o.seg_start, o.seg_end, at) };
    const q = roundOfSegments(S, o.seg_start, o.seg_end);
    if (!q) return {};
    const ends: [Pt, Pt] = [[S[o.seg_start * 4], S[o.seg_start * 4 + 1]], [S[(o.seg_end - 1) * 4 + 2], S[(o.seg_end - 1) * 4 + 3]]];
    return { round: { c: q.c, r: o.radius ?? q.r, ...(kind === 'arc' ? { ends } : {}) } };
  }

  async function click(at: Pt, pixel: number, shiftKey = false) {
    if (!view) return;
    setPromptMenu(null);
    if (snapOnce) setSnapOnce(null);
    const last = points[points.length - 1];
    if (tool === 'xattach') { if (xDraft) setXDraft({ ...xDraft, at }); cad.setTool('none'); return; }
    if (tool === 'copybase') { copyClip(at); cad.setTool('none'); return; }
    if (tool === 'paste') { if (pasting) placeClip(pasting, at); setPasting(null); cad.setTool('none'); return; }
    if (tool === 'zoomwin') {
      if (!last) { setPoints([at]); cad.say('ZOOM  Opposite corner:'); return; }
      zoomTo({ kind: 'window', a: last, b: at }); setPoints([]); cad.setTool('none'); return;
    }
    if (tool === 'selsim') {
      const sk = hitAt(pickable, at, pickR * pixel);
      if (!sk) { cad.say('SELECTSIMILAR  Nothing there: click a drawn object, or Enter with those picked:'); return; }
      const sks = pickedKeys.has(`sk:${sk.id}`) ? pickedSk.filter((x) => x.id !== sk.id) : [...pickedSk, sk];
      pick([], sks); cad.say(`SEL  ${picks(sks.length)} — Enter when done`); return;
    }
    if (tool === 'textedit') {
      const sk = hitAt(sketch.filter((x) => !effective(x, styles).hidden), at, pickR * pixel);
      if (sk) startTextEdit(sk); else cad.say('TEXTEDIT  Nothing there. Select a text or dimension:');
      return;
    }
    if (tool === 'dimrad' || tool === 'dimdia') {
      const name = tool === 'dimrad' ? 'DIMRADIUS' : 'DIMDIAMETER';
      if (!radPick) {
        const { round } = await roundOrLineAt(at, pixel);
        if (!round) { cad.say(`${name}  No arc or circle there. Select arc or circle:`); return; }
        setRadPick(round); cad.say(`${name}  Dimension line location:`); return;
      }
      const item = radialItem(radPick, at, tool === 'dimrad' ? 'radius' : 'diameter');
      draw(item, `${tool === 'dimrad' ? 'Radius' : 'Diameter'} dimension ${dimLabel(item as SketchItem, units.factor)}`);
      setRadPick(null); cad.say(PROMPT[tool]); return;
    }
    if (tool === 'dimang') {
      const P = angPick ?? {};
      if (P.v && P.p1 && P.p2) {
        const item = dimItem([P.v, P.p1, P.p2, at], 'angular');
        draw(item, `Angular dimension ${dimLabel(item as SketchItem, units.factor)}`);
        setAngPick(null); cad.say(PROMPT.dimang); return;
      }
      if (P.v && P.p1) { setAngPick({ ...P, p2: at }); cad.say('DIMANGULAR  Dimension arc line location:'); return; }
      if (P.vertex) {
        if (!P.v) { setAngPick({ ...P, v: at }); cad.say('DIMANGULAR  Specify first angle endpoint:'); } else { setAngPick({ ...P, p1: at }); cad.say('DIMANGULAR  Specify second angle endpoint:'); }
        return;
      }
      if (P.seg1 && P.at1) {
        const { line } = await roundOrLineAt(at, pixel);
        if (!line) { cad.say('DIMANGULAR  No line there. Select second line:'); return; }
        const x = linesCross(P.seg1, line);
        if (!x) { cad.say('DIMANGULAR  The lines are parallel. Select second line:'); return; }
        setAngPick({ v: x, p1: endTowards(P.seg1, x, P.at1), p2: endTowards(line, x, at) }); cad.say('DIMANGULAR  Dimension arc line location:'); return;
      }
      // The first pick: an arc (its ends), a circle (the point clicked, then another), a line (then a second), or
      // nothing there, which makes the point the vertex.
      const { round, line } = await roundOrLineAt(at, pixel);
      if (round?.ends) { setAngPick({ v: round.c, p1: round.ends[0], p2: round.ends[1] }); cad.say('DIMANGULAR  Dimension arc line location:'); return; }
      if (round) { setAngPick({ v: round.c, p1: onRound(round.c, round.r, at) }); cad.say('DIMANGULAR  Specify second angle endpoint:'); return; }
      if (line) { setAngPick({ seg1: line, at1: at }); cad.say('DIMANGULAR  Select second line:'); return; }
      setAngPick({ vertex: true, v: at }); cad.say('DIMANGULAR  Specify first angle endpoint:'); return;
    }
    if (tool === 'crop' && crop) { await cropClick(at, pixel); return; }
    if (tool === 'xclip') {
      if (xClip?.outline) {
        const rooms = floor ? buildingInfoOf(project).rooms.filter((q) => q.buildingId === floor.ref.building && q.levelId === floor.ref.level && (q.outline?.length ?? 0) > 2).map((q) => q.outline!.map(([x, y]): Pt => [x / units.factor, y / units.factor])) : [];
        const o = hatchOutline(pickable, at, rooms) ?? (() => { const q = roomAround(walls, at, units.factor); return q ? { pts: q.points } : undefined; })();
        if (!o) { cad.say('XCLIP  No closed outline around that point. Click inside one, or Esc:'); return; }
        finishClip(o.pts); return;
      }
      setPoints((p) => [...p, at]); cad.say(`XCLIP  Next corner${points.length ? ', Enter to finish' : ''}:`); return;
    }
    if (tool === 'tcount' && tc) {
      if (tc.step === 'pick') {
        const sk = hitAt(pickable, at, pickR * pixel);
        if (sk?.kind !== 'text') { cad.say('TCOUNT  Click the texts to renumber, in order, then Enter:'); return; }
        const sks = pickedKeys.has(`sk:${sk.id}`) ? pickedSk.filter((x) => x.id !== sk.id) : [...pickedSk, sk];
        pick([], sks); cad.say(`TCOUNT  ${picks(sks.length)} — Enter when done`); return;
      }
      if (tc.step !== 'place') { cad.say('TCOUNT  Finish the prefix, start, step and suffix on the command line first.'); return; }
      const id = draw({ kind: 'text', layer: ANNO_LAYER, pts: [at], text: numberText(tc.prefix, tc.n, tc.pad, tc.suffix), h: textH, just: 'MC' }, `TCOUNT  "${numberText(tc.prefix, tc.n, tc.pad, tc.suffix)}"`);
      setTc({ ...tc, n: tc.n + tc.inc, placed: id ? [...tc.placed, id] : tc.placed }); cad.say(TCOUNT_PLACE); return;
    }
    if (tool === 'keynote' && kn) {
      if (kn.step === 'place') { setKn({ ...kn, step: 'text', at }); cad.say('KEYNOTE  Note text:'); input.current?.focus(); return; }
      if (kn.step === 'legend') { addKeynote(kn.n, kn.at!, kn.note ?? '', at); return; }
      cad.say(kn.step === 'number' ? `KEYNOTE  Type the number first <${kn.n}>:` : 'KEYNOTE  Type the note text first:'); return;
    }
    if (tool === 'matchprop') {
      const sk = hitAt(pickable, at, pickR * pixel), from = sketch.find((x) => x.id === mpFrom);
      if (!sk) { cad.say(from ? 'MATCHPROP  Select destination object:' : PROMPT.matchprop); return; }
      if (!from || sk.id === from.id) { setMpFrom(sk.id); cad.say('MATCHPROP  Select destination object(s):'); return; }
      change(updateSketch(project, fileOf(), matchedProps(from, sk)), `MATCHPROP  Properties copied to the ${kindOf(sk).toLowerCase()} · ⌘Z to undo`);
      return;
    }
    if (EDIT_TOOLS.includes(tool)) { editClick(at, pixel, shiftKey); return; }
    if ((tool === 'move' || tool === 'copy') && many && (floor || !pickedItems.length)) {
      if (!points.length) { setPoints([at]); cad.say(`${tool.toUpperCase()}  Specify second point:`); return; }
      const [ux, uy] = [at[0] - points[0][0], at[1] - points[0][1]], [dx, dy] = [ux * units.factor, uy * units.factor];
      const n = pickedItems.length + pickedSk.length;
      if (tool === 'move') {
        let next = pickedItems.length && floor ? moveDevices(project, pickedItems, new Map(pickedItems.map((d): [string, Pt] => [d.key, [d.x + dx, d.y + dy]])), floor.ref) : project;
        for (const it of pickedSk) next = updateSketch(next, fileOf(), moved(it, ux, uy));
        change(next, `${n} objects moved · ⌘Z to undo`);
        setPoints([]); cad.setTool('none');
      } else {
        const r = pickedItems.length && floor ? copyDevices(project, pickedItems, dx, dy, floor.ref) : { project, copied: 0 };
        const next = added(r.project, pickedSk.map((it) => { const { id: _id, ...rest } = moved(it, ux, uy); return rest; }));
        change(next, `${r.copied + pickedSk.length} object${r.copied + pickedSk.length === 1 ? '' : 's'} copied${r.copied ? ' — point counts updated' : ''} · Enter stops · ⌘Z to undo`);
      }
      return;
    }
    if (tool === 'arl') {
      if (!floor) { cad.say('ARL  Add the building and its levels in Building information first.'); return; }
      setPoints(points.length >= 2 ? [at] : [...points, at]);
      cad.say(points.length === 1 ? 'ARL  Set the device, number or spacing and circuit on the right, then Place (or Enter).' : 'ARL  Click the end of the line:');
      return;
    }
    if (tool === 'match') {
      const d = deviceAt(at, pixel);
      const from = placed.find((x) => x.key === matchFrom);
      if (!d) { cad.say(from ? 'MA  Click a device to change:' : PROMPT.match); return; }
      if (!from || d.key === from.key) { setMatchFrom(d.key); cad.say(`MA  From ${d.label}${d.detail ? ` · ${d.detail.split(' · ')[0]}` : ''}: click each device to change.`); return; }
      const next = matchDevice(project, from, d, matchSet);
      if (next === project) cad.say(`MA  ${d.label}: nothing to take from ${from.label}.`);
      else change(next, `MA  ${d.label} matched to ${from.label}${from.what === 'lv' && matchSet.circuit ? ` on ${from.detail.split(' · ')[0]}` : ''} · ⌘Z to undo`);
      return;
    }
    if (tool === 'move' || tool === 'copy' || tool === 'rotate') {
      if (!selSketch && !selectedItem) {
        if (selectAt(at, pixel)) cad.say(tool === 'rotate' && !hitAt(pickable, at, pickR * pixel) ? 'ROTATE  Click where it faces:' : `${tool.toUpperCase()}  Specify base point:`); else cad.say(`${tool.toUpperCase()}  Select object:`);
        return;
      }
      if (tool === 'rotate' && !selSketch) {
        // A camera or speaker turns to face the point clicked (its coverage follows); other devices keep their way.
        if (selectedItem?.what !== 'elv') { cad.say('ROTATE  Drawn objects, cameras and speakers only (other devices keep their orientation).'); return; }
        const deg = (Math.atan2(at[1] - selectedItem.y / units.factor, at[0] - selectedItem.x / units.factor) * 180) / Math.PI;
        const r = rotateElv(project, selectedItem.id, deg);
        change(r.next, r.message); setPoints([]); cad.setSelected(null); setResult(null); cad.setTool('none'); return;
      }
      if (!points.length) { setPoints([at]); cad.say(tool === 'rotate' ? 'ROTATE  Specify rotation angle (degrees) or a point:' : `${tool.toUpperCase()}  Specify second point:`); return; }
      const base = points[0];
      if (tool === 'rotate') {
        const a = Math.atan2(at[1] - base[1], at[0] - base[0]);
        change(updateSketch(project, view.file, rotated(selSketch!, base, a)), `Rotated ${(a * 180 / Math.PI).toFixed(2)}° · ⌘Z to undo`);
        setPoints([]); cad.setSelected(null); setResult(null); cad.setTool('none'); return;
      }
      shift(at[0] - base[0], at[1] - base[1], tool === 'copy');
      if (tool === 'move') { setPoints([]); cad.setSelected(null); setResult(null); cad.setTool('none'); }
      return;
    }
    if (tool === 'line') {
      if (last) draw({ kind: 'line', layer: curLayer, pts: [last, at], ...newProps }, `Line ${m(toM(distance(last, at)))}`);
      setPoints([at]); cad.say('LINE  Specify next point or Enter to stop:'); return;
    }
    if (tool === 'tray' || tool === 'cable') { setPoints((p) => [...p, at]); cad.say(`${tool === 'tray' ? 'TRAY' : 'ROUTE'}  Specify next point${points.length ? ', Enter to finish' : ''}:`); return; }
    if (tool === 'link') {
      const feeder = project.feeders.find((f) => f.id === cad.cableFeeder);
      if (!feeder) { cad.say('LINK  Choose the cable first (the panel on the right).'); return; }
      const o = await view.pick(at[0], at[1], pickR * pixel, pickOn);
      const pts = o ? objectPath(view, o) : [];
      if (pts.length < 2) { cad.say('LINK  That is not a line or polyline. Click a line of the drawing:'); return; }
      draw({ kind: 'pline', layer: CABLE_LAYER, pts, cable: { feederId: feeder.id } }, `Cable route of ${cableLabel(project, feeder)}: ${m(toM(pathLength(pts)))} (linked from ${view.info.layers[o!.layer]?.name ?? 'the drawing'})`);
      return;
    }
    if (tool === 'pline') {
      if (points.length >= 3 && distance(at, points[0]) <= 8 * pixel) { finishPline(true); return; }
      setPoints((p) => [...p, at]); cad.say('PLINE  Specify next point or [Close], Enter to finish:'); return;
    }
    // INSERT: the block waiting at the cursor goes where the click is (unless its attributes are being answered).
    if (tool === 'insert') {
      if (attPend) { if (!attPend.dialog) { const ad = attPend.asked[attPend.i]; cad.say(`INSERT  ${ad.prompt || ad.tag} <${ad.text ?? ''}>:`); } return; }
      if (!insBlock) { cad.say('INSERT  Type the block name first. Block name:'); input.current?.focus(); return; }
      placeInsert(insBlock, at); return;
    }
    // ATTDEF's Pick on plan: the insertion point, then back to the dialog.
    if (tool === 'attpick') { if (attDlg) setAttDlg({ ...attDlg, at, picking: false }); cad.setTool('none'); return; }
    // ATTEDIT: the block clicked, then its attributes in the dialog.
    if (tool === 'attedit') {
      const sk = hitAt(pickable, at, pickR * pixel);
      if (!sk || sk.kind !== 'insert') { cad.say(`ATTEDIT  ${sk ? `That is a ${kindOf(sk).toLowerCase()}, not a block. ` : ''}Select a block:`); return; }
      if (!attdefsOf(blockDefOf(defs, sk.block)).length) { cad.say(`ATTEDIT  "${sk.block}" has no attributes. Select a block:`); return; }
      cad.setSelected(`sk:${sk.id}`); setResult({ kind: 'sketch', it: sk }); setAttEdit(sk.id); cad.setTool('none'); return;
    }
    // -BLOCK: the base point clicked, then the objects clicked (Enter when done).
    if (tool === 'block' && blk) {
      if (blk.step === 'base') { setBlk({ ...blk, step: 'objects', base: at }); cad.say(`BLOCK  Select objects${pickedSk.length ? ` (${picks(pickedSk.length)})` : ''} — Enter when done:`); return; }
      if (blk.step === 'objects') { const sk = hitAt(pickable, at, pickR * pixel); if (!sk) { cad.say('BLOCK  Nothing there. Select objects — Enter when done:'); return; } const sks = pickedKeys.has(`sk:${sk.id}`) ? pickedSk.filter((x) => x.id !== sk.id) : [...pickedSk, sk]; pick([], sks); cad.say(`BLOCK  ${picks(sks.length)} — Enter when done`); return; }
      cad.say(PROMPT.block); input.current?.focus(); return;
    }
    // The Block definition dialog stepping aside: its base point, or its objects (Enter when done).
    if (tool === 'blockpick' && blockDlg) {
      if (blockDlg.picking === 'base') { setBlockDlg({ ...blockDlg, base: at, picking: undefined }); cad.setTool('none'); return; }
      const sk = hitAt(pickable, at, pickR * pixel);
      if (!sk) { cad.say('BLOCK  Nothing there. Select objects — Enter when done:'); return; }
      const sks = pickedKeys.has(`sk:${sk.id}`) ? pickedSk.filter((x) => x.id !== sk.id) : [...pickedSk, sk];
      pick([], sks); cad.say(`BLOCK  ${picks(sks.length)} — Enter when done`); return;
    }
    if (tool === 'point') { draw({ kind: 'point', layer: curLayer, pts: [at], ...newProps }, 'Point'); cad.say(PROMPT.point); return; }
    if (tool === 'divide' || tool === 'measure') {
      const ask = tool === 'divide' ? 'DIVIDE  Number of segments or [Block]:' : 'MEASURE  Segment length or [Block]:';
      if (divPick) { cad.say(ask); return; }
      const sk = hitAt(pickable, at, pickR * pixel);
      if (!sk || !canDivide(sk)) { cad.say(`${tool.toUpperCase()}  ${sk ? `A ${kindOf(sk).toLowerCase()} cannot be ${tool === 'divide' ? 'divided' : 'measured out'}. ` : ''}Click a line, polyline, arc, circle or ellipse:`); return; }
      setDivPick({ it: sk, at }); cad.setSelected(`sk:${sk.id}`); setResult({ kind: 'sketch', it: sk });
      cad.say(ask); input.current?.focus(); return;
    }
    if (tool === 'rect') {
      if (!last) { setPoints([at]); cad.say('RECTANG  Specify other corner point:'); return; }
      const pts = rectangle(last, at);
      draw({ kind: 'pline', layer: curLayer, pts, closed: true, ...newProps }, `Rectangle ${m(toM(Math.abs(at[0] - last[0])))} × ${m(toM(Math.abs(at[1] - last[1])))}`);
      setPoints([]); cad.say(PROMPT.rect); return;
    }
    if (tool === 'circle') {
      if (!last) { setPoints([at]); cad.say('CIRCLE  Specify radius (a point, or type it):'); return; }
      finishCircle(distance(last, at)); return;
    }
    if (tool === 'arc') {
      if (points.length < 2) { setPoints((p) => [...p, at]); cad.say(points.length ? 'ARC  Specify end point:' : 'ARC  Specify second point:'); return; }
      const a = arcThrough(points[0], points[1], at);
      if (!a) cad.say('ARC  The three points are in line; pick another end point.');
      else { draw({ ...a, layer: curLayer, ...newProps } as Omit<SketchItem, 'id'>, `Arc radius ${m(toM(a.r ?? 0))}`); setPoints([]); cad.say(PROMPT.arc); }
      return;
    }
    if (tool === 'circle2p') {
      if (!last) { setPoints([at]); cad.say('CIRCLE  Specify other end of the diameter:'); return; }
      const q = circle2P(last, at);
      if (q.r > 0) draw({ kind: 'circle', layer: curLayer, pts: [q.c], r: q.r, ...newProps }, `Circle radius ${m(toM(q.r))}`);
      setPoints([]); cad.say(PROMPT.circle2p); return;
    }
    if (tool === 'circle3p') {
      if (points.length < 2) { setPoints((p) => [...p, at]); cad.say(points.length ? 'CIRCLE  Specify third point on the circle:' : 'CIRCLE  Specify second point on the circle:'); return; }
      const q = circleThrough(points[0], points[1], at);
      if (!q) { cad.say('CIRCLE  The three points are in line; pick another third point.'); return; }
      draw({ kind: 'circle', layer: curLayer, pts: [q.c], r: q.r, ...newProps }, `Circle radius ${m(toM(q.r))}`);
      setPoints([]); cad.say(PROMPT.circle3p); return;
    }
    if (tool === 'circled') {
      if (!last) { setPoints([at]); cad.say('CIRCLE  Specify diameter (a point, or type it):'); return; }
      finishCircle(distance(last, at) / 2); return;
    }
    if (tool === 'arcsce') {
      if (points.length < 2) { setPoints((p) => [...p, at]); cad.say(points.length ? 'ARC  Specify end point (anticlockwise):' : 'ARC  Specify center point:'); return; }
      const a = arcStartCentreEnd(points[0], points[1], at);
      if (!a) cad.say('ARC  Pick an end point away from the centre.');
      else { draw({ ...a, layer: curLayer, ...newProps } as Omit<SketchItem, 'id'>, `Arc radius ${m(toM(a.r ?? 0))}`); setPoints([]); cad.say(PROMPT.arcsce); }
      return;
    }
    if (tool === 'polygon') {
      if (!last) { setPoints([at]); cad.say(`POLYGON  Specify radius (a point, or type it), or [Inscribed/Circumscribed] <${polyIn ? 'I' : 'C'}>:`); return; }
      finishPolygon(at); return;
    }
    if (tool === 'ellipse') {
      if (points.length < 2) { setPoints((p) => [...p, at]); cad.say(points.length ? 'ELLIPSE  Specify distance to the other axis:' : ellAxis ? 'ELLIPSE  Specify other end of the axis:' : 'ELLIPSE  Specify end of the axis:'); return; }
      finishEllipse(at); return;
    }
    if (tool === 'revcloud') {
      if (cloudPoly) {
        if (points.length >= 3 && distance(at, points[0]) <= 8 * pixel) { finishCloud(points); return; }
        setPoints((p) => [...p, at]); cad.say(`REVCLOUD  Specify next point${points.length >= 2 ? ', Enter or C to close' : ''}:`); return;
      }
      if (!last) { setPoints([at]); cad.say('REVCLOUD  Specify opposite corner:'); return; }
      finishCloud(rectangle(last, at)); return;
    }
    if (tool === 'mtext') {
      if (edNote) return; // the words are being typed: the box takes the clicks
      if (!last) { setPoints([at]); setMtAsk(null); cad.say(MTEXT_CORNER); return; }
      openNote(last, at); return;
    }
    if (tool === 'text') {
      // A title block field from the Properties palette: placed as it is.
      if (cad.textPreset) {
        const pre = cad.textPreset;
        if (pre.text === LOGO_FIELD && view) {
          // The logo area: a dashed rectangle about the point with the field at its centre; stretch it to size.
          let next = project;
          for (const it of logoItems({ x: at[0] - LOGO_BOX.w / 2, y: at[1] - LOGO_BOX.h / 2, w: LOGO_BOX.w, h: LOGO_BOX.h }, () => '')) next = addSketch(next, view.file, { ...it, layer: pre.layer }).project;
          change(next, 'Logo area · stretch the rectangle to size · ⌘Z to undo');
        } else draw({ kind: 'text', layer: pre.layer, pts: [at], text: pre.text, h: pre.h }, `Field ${pre.text}`);
        cad.setTextPreset(null); cad.say(PROMPT.text); return;
      }
      // The current text style's height, else (0) asked each time from the annotation text height.
      const style = currentTextStyle(project);
      cad.setTextAt(at);
      if (style.heightMm > 0) { setTextAsk({ step: 'rot', mm: style.heightMm, rot: 0 }); cad.say('TEXT  Specify rotation angle <0>:'); }
      else { setTextAsk({ step: 'height', mm: anno.textMm, rot: 0 }); cad.say(`TEXT  Specify height <${anno.textMm} mm>:`); }
      input.current?.focus(); return;
    }
    if (tool === 'hatchedit') { heClick(at, pixel); return; }
    if (tool === 'boundary') {
      const o = areaAround(at, boundIsl);
      if (!o) { cad.say('BOUNDARY  No closed area around that point. Click inside one, or Enter:'); return; }
      // The outline (a circle stays a circle) and, with islands on, a closed polyline for each island, on the current layer.
      const outer: Omit<SketchItem, 'id'> = o.circle ? { kind: 'circle', layer: curLayer, pts: [o.circle.c], r: o.circle.r } : { kind: 'pline', layer: curLayer, pts: o.pts, closed: true };
      const isl = o.holes.map((h, i): Omit<SketchItem, 'id'> => {
        const src = sketch.find((x) => x.id === o.islandIds[i]);
        return src?.kind === 'circle' && src.r ? { kind: 'circle', layer: curLayer, pts: [src.pts[0]], r: src.r } : { kind: 'pline', layer: curLayer, pts: h, closed: true };
      });
      change([outer, ...isl].reduce((q, x) => addSketch(q, fileOf(), x).project, project), `BOUNDARY  1 polyline${isl.length ? ` and ${isl.length} island${isl.length === 1 ? '' : 's'}` : ''} made · ⌘Z to undo`);
      return;
    }
    if (tool === 'hatch') {
      const o = areaAround(at, hatchOpts.islands);
      if (!o) { cad.say('HATCH  No closed object, room or area bounded by lines around that point: draw a closed polyline first.'); return; }
      const assoc = hatchOpts.assoc ? o.ids : undefined, item = hatchItem(o, hatchSet, assoc), n = o.holes.length;
      draw(item, `Hatch ${hatchSet.pattern.toUpperCase()}${o.from === 'room' ? ' in the room' : ''}, ${m2(toM2(hatchArea(item)))}${n ? ` · ${n} island${n === 1 ? '' : 's'}` : ''}${assoc ? ' · associative' : ''}`);
      return;
    }
    if (tool === 'leader') { setPoints((p) => [...p, at]); cad.say(points.length ? 'LEADER  Next point, or type the text and Enter:' : 'LEADER  Specify next point:'); if (points.length) input.current?.focus(); return; }
    if (tool === 'rtag') {
      const room = roomAtPoint(at);
      if (!room) { cad.say('ROOMTAG  No room with an outline there: add it first (Room area, Trace or Rooms).'); return; }
      const c = centreOf(room.outline!.map(([x, y]): Pt => [x / units.factor, y / units.factor]));
      if (view) change(roomTagItems(room.name, room.areaM2, c, textH).reduce((q, x) => addSketch(q, view.file, x).project, project), `Room tag ${room.name} · ⌘Z to undo`);
      return;
    }
    if (tool === 'north') { if (view) change(northArrowItems(at, textH).reduce((q, x) => addSketch(q, view.file, x).project, project), 'North arrow · ⌘Z to undo'); cad.setTool('none'); return; }
    if (tool === 'dim' || tool === 'dimlin') {
      const name = tool === 'dim' ? 'DIM' : 'DIMLINEAR';
      if (points.length < 2) { setPoints((p) => [...p, at]); cad.say(points.length ? `${name}  Specify dimension line location:` : `${name}  Specify second extension line origin:`); return; }
      // Linear: horizontal or vertical by where the line is dragged; it measures along that line.
      const dir = tool === 'dimlin' ? linearDir(points[0], points[1], at) : undefined;
      const len = dimMeasure({ pts: points, dir });
      const ds = dimLookOf(project, units.factor);
      // A dimension of a style keeps no text: it is measured (in the style's unit) wherever it is drawn or saved.
      draw({ kind: 'dim', layer: ANNO_LAYER, pts: [points[0], points[1], at], ...(dir !== undefined ? { dir } : {}), ...(ds ? { h: ds.textH, look: ds.look } : { text: toM(len).toFixed(2), h: textH * 0.8 }) }, `${dir === undefined ? 'Dimension' : 'Linear dimension'} ${m(toM(len))}`);
      setPoints([]); cad.say(PROMPT[tool]); return;
    }
    if (tool === 'dimcont' || tool === 'dimbase') {
      const name = tool === 'dimcont' ? 'DIMCONTINUE' : 'DIMBASELINE';
      if (!lastDim) { cad.say(`${name}  No dimension on this drawing to go on from: draw one first (DIM or DLI).`); return; }
      const next = chainDim(lastDim, at);
      if (!next) { cad.say(`${name}  That point measures nothing along the dimension line.`); return; }
      const len = dimMeasure(next);
      // One drawn before dimension styles carries its length as text: so does the next.
      draw(next.look ? next : { ...next, text: toM(len).toFixed(2) }, `${tool === 'dimcont' ? 'Continued' : 'Baseline'} dimension ${m(toM(len))}`);
      cad.say(PROMPT[tool]); return;
    }
    if (tool === 'none') {
      const d = deviceAt(at, pixel);
      setMenuAt(null);
      const skHit = shiftKey && !d ? hitAt(pickable, at, pickR * pixel) : undefined;
      if (d && shiftKey) {
        const items = pickedKeys.has(d.key) ? pickedItems.filter((x) => x.key !== d.key) : [...pickedItems, d];
        pick(items, pickedSk, pickedDw); cad.say(`SEL  ${picks(items.length + pickedSk.length + pickedDw.length)}`); return;
      }
      if (skHit) {
        const sks = pickedKeys.has(`sk:${skHit.id}`) ? pickedSk.filter((x) => x.id !== skHit.id) : [...pickedSk, skHit];
        pick(pickedItems, sks, pickedDw); cad.say(`SEL  ${picks(pickedItems.length + sks.length + pickedDw.length)}`); return;
      }
      // Shift-click on an object of the opened drawing adds it to what is picked (or takes it off).
      const dwHit = shiftKey && !d ? await view.pick(at[0], at[1], pickR * pixel, pickOn) : null;
      if (dwHit) {
        const dws = pickedKeys.has(`dw:${dwHit.handle}`) ? pickedDw.filter((o) => o.handle !== dwHit.handle) : [...pickedDw, dwHit];
        pick(pickedItems, pickedSk, dws); cad.say(`SEL  ${picks(pickedItems.length + pickedSk.length + dws.length)}`); return;
      }
      setPicked([]);
      if (d) { cad.setSelected(d.key); setResult({ kind: 'device', it: d }); cad.say(`LIST  ${d.label}${d.detail ? ` · ${d.detail}` : ''}${d.room ? ` · ${d.room}` : ''}`); return; }
      cad.setSelected(null);
      const sk = hitAt(pickable, at, pickR * pixel);
      if (sk) { cad.setSelected(`sk:${sk.id}`); setResult({ kind: 'sketch', it: sk }); cad.say(`LIST  ${sk.tray ? `Cable tray ${sk.tray.widthMm} mm, ${m(toM(trayLength(sk)))}${sk.tray.route ? ` on route ${sk.tray.route}` : ', no route'}` : sk.cable ? `Cable route of ${cableLabels[sk.id] ?? sk.cable.feederId}, ${m(toM(pathLength(sk.pts)))}` : sk.kind === 'pline' ? 'Polyline' : sk.kind} on ${sk.layer} (drawn here)`); return; }
      const o = await view.pick(at[0], at[1], pickR * pixel, pickOn);
      setResult(o ? { kind: 'object', o } : null);
      if (o) cad.say(`LIST  ${o.kind}${o.block ? ` ${o.block}` : ''} on ${view.info.layers[o.layer]?.name ?? '?'}${o.length !== undefined && !o.closed ? `, length ${m(toM(o.length))}` : ''}${o.area !== undefined ? `, area ${m2(toM2(o.area))}` : ''}`);
    } else if (tool === 'dist') {
      if (points.length === 0) { setPoints([at]); setResult(null); cad.say('DI  Specify second point:'); return; }
      const a = points[0];
      setResult({ kind: 'dist', a, b: at });
      cad.say(`Distance = ${m(toM(distance(a, at)))}, Angle = ${angleDeg(a, at).toFixed(2)}°, ΔX = ${m(toM(at[0] - a[0]))}, ΔY = ${m(toM(at[1] - a[1]))}`);
      setPoints([]);
    } else if (tool === 'area' || tool === 'trace') {
      if (objectMode && tool === 'area') {
        const o = await view.pick(at[0], at[1], pickR * pixel, pickOn, true);
        if (!o || o.area === undefined) { cad.say('AREA  That is not a closed object (polyline, circle, hatch). Select a closed object:'); return; }
        const segs: Pt[] = [];
        for (let i = o.seg_start; i < o.seg_end; i += 1) segs.push([view.segs[i * 4] + view.info.origin[0], view.segs[i * 4 + 1] + view.info.origin[1]]);
        setResult({ kind: 'area', points: segs, how: 'object' });
        cad.say(`Area = ${m2(toM2(o.area))}${o.length !== undefined ? `, Perimeter = ${m(toM(o.length))}` : ''}`);
        return;
      }
      if (points.length >= 3 && distance(at, points[0]) <= 8 * pixel) { finishArea(points); return; }
      if (points.length === 0) setResult(null);
      setPoints((p) => [...p, at]);
      cad.say(`${tool === 'trace' ? 'TRACE' : 'AREA'}  Specify next corner point or press Enter to close:`);
    } else if (tool === 'dev') {
      if (!floor) { cad.say('DEV  Add the building and its levels in Building information first; devices are kept per level.'); return; }
      try {
        const [x, y] = [at[0] * units.factor, at[1] * units.factor];
        const r = 'elv' in item.kind ? placeElv(project, (ELV_PALETTE.find((e) => e.id === item.id) ?? ELV_PALETTE[0]).kind.elv, floor.ref, x, y)
          : placeItem(project, item, floor.ref, x, y, { feederId: cad.feederId, boardId: cad.boardId });
        change(r.project, `${r.message} · ⌘Z to undo`);
      } catch (e) { cad.say(`DEV  ${e instanceof Error ? e.message : String(e)}`); }
    } else if (tool === 'wire') {
      wireOne(at, pixel);
    } else if (tool === 'fill') {
      if (!floor) { cad.say('FILL  Add the building and its levels in Building information first.'); return; }
      if (!elvItem) { cad.say('FILL  Choose an ELV device first (a detector, speaker, data outlet…) in the Devices panel.'); return; }
      const r = fillAt(project, { building: floor.ref.building, level: floor.ref.level }, elvItem.kind.elv, [at[0] * units.factor, at[1] * units.factor]);
      if (r.next) change(r.next, r.message); else cad.say(`FILL  ${r.message}`);
    } else if (tool === 'lux') {
      if (!floor) { cad.say('LUX  Add the building and its levels in Building information first.'); return; }
      const room = roomAtPointOf(project, floor, at, units.factor);
      if (!room) { cad.say('LUX  No room with an outline there: add it first (Room area, Trace or Rooms).'); return; }
      const r = lightingOf(project, room, { ...luxSet, lux: undefined, ceil: undefined, wp: undefined });
      setLuxRoom(room.id); setLuxSet((s) => ({ ...s, lux: undefined, ceil: undefined, wp: undefined }));
      cad.say(r.result.invalid ? `LUX  ${room.name}: ${r.result.invalid}` : `LUX  ${room.name}: ${r.result.count} light${r.result.count === 1 ? '' : 's'} for ${r.input.targetLux} lx — set the luminaire and circuit, then Place.`);
    } else if (tool === 'em') {
      if (!floor) { cad.say('EM  Add the building and its levels in Building information first.'); return; }
      const atM: Pt = [at[0] * units.factor, at[1] * units.factor];
      if (emSet.mode === 'route') { setPoints((p) => [...p, at]); cad.say(`EM  Specify next point of the escape route${points.length ? ', Enter to finish' : ''}:`); return; }
      if (emSet.mode === 'point') { setEm((e) => ({ ...e, points: [...e.points, { at: atM, kind: emSet.kind }] })); cad.say(`EM  ${EMPHASIS_LABEL[emSet.kind]} marked.`); return; }
      const room = roomAtPointOf(project, floor, at, units.factor);
      if (!room) { cad.say('EM  No room with an outline there: add it first (Room area, Trace or Rooms).'); return; }
      const on = em.rooms.includes(room.id);
      setEm((e) => ({ ...e, rooms: on ? e.rooms.filter((x) => x !== room.id) : [...e.rooms, room.id] }));
      cad.say(on ? `EM  ${room.name}: open area taken off.` : `EM  ${room.name} (${m2(room.areaM2)}): open area${room.areaM2 > OPEN_AREA_M2 ? '' : ' — 60 m² or less: needed only when an escape route passes through it'}.`);
    } else if (tool === 'room') {
      const r = roomAround(walls, at, units.factor);
      if (!r) { cad.say('ROOM AREA  No closed room around that point (open to the outside, or over 50 m across). Use AREA and click its corners.'); return; }
      setResult({ kind: 'area', points: r.points, how: 'room', name: nameInside(r.points) });
      cad.say(`Room area = ${m2(toM2(r.area))}`);
    } else if (tool === 'name') {
      const o = await view.pick(at[0], at[1], pickR * pixel, pickOn);
      const text = o?.text?.trim();
      if (!text) { cad.say('NAME  That is not a text. Click the room name on the drawing:'); return; }
      if (result?.kind === 'area' && result.how !== 'object') { setResult({ ...result, name: text }); cad.say(`NAME  ${text} — Add as room… to add it`); return; }
      const room = floor && roomAtPoint(at);
      if (!room) { cad.say(`NAME  “${text}” is not inside a room yet: find the room first (Click inside or Trace).`); return; }
      if (room.name.toLowerCase() === text.toLowerCase()) { cad.say(`NAME  ${room.name} already`); return; }
      change(renameRoom(project, room.id, text), `${room.name} renamed ${text} · ⌘Z to undo`);
    }
  }

  /** The smallest room of the plan's level whose outline (metres) is around a point (drawing units). */
  const roomAtPoint = (at: Pt) => (floor ? roomAtPointOf(project, floor, at, units.factor) : undefined);

  /** Add found rooms: the closed outlines on the room-outline layers (Layer roles), named by the text inside, added to
   * Building information on the plan's level (a room found again keeps its ID; one undo step). */
  function addFound() {
    if (!view) return;
    if (!floor) { cad.say('ROOMS  Add the building and its levels in Building information first; rooms are kept per level.'); return; }
    if (!roles.some((r) => r.role === 'room')) { cad.say('ROOMS  No layer has the role Room outline: set it in File → Layer roles, or use Click inside / Trace.'); cad.setShowRoles(true); return; }
    const code = CAD_UNITS.find((u) => u.id === units.unit)!.code;
    const { rooms, zones } = roomsFromPlan(planOfView(drawn ?? view, code, layersOn), roles, project.cadLength);
    if (!rooms.length) { cad.say('ROOMS  No closed outlines on the room-outline layers that are shown. Use Click inside or Trace.'); return; }
    const { project: next } = putRooms(project, rooms.map((r) => ({ ...r, file: view.file })), floor.ref, roles);
    const label = floorLabel(project.building, floor);
    change(next, `${rooms.length} room${rooms.length === 1 ? '' : 's'} from the plan on ${label}${rooms.some((r) => !r.named) ? ` (${rooms.filter((r) => !r.named).length} without a name: Pick name)` : ''}${zones ? ` · ${zones} zone outline${zones === 1 ? '' : 's'} left out` : ''}${levelSet ? '' : ' — level not set: File → Level'} · ⌘Z to undo`);
  }

  function finishPline(closed: boolean) {
    if (points.length >= 2) draw({ kind: 'pline', layer: curLayer, pts: points, closed, ...newProps }, `Polyline (${points.length} points${closed ? ', closed' : ''})`);
    setPoints([]); cad.say(PROMPT.pline);
  }
  /** A cable route along the points clicked, for the cable chosen. */
  function finishCable() {
    const feeder = project.feeders.find((f) => f.id === cad.cableFeeder);
    if (!feeder) cad.say('ROUTE  Choose the cable first (the panel on the right).');
    else if (points.length >= 2) draw({ kind: 'pline', layer: CABLE_LAYER, pts: points, cable: { feederId: feeder.id } }, `Cable route of ${cableLabel(project, feeder)}: ${m(toM(pathLength(points)))}`);
    setPoints([]); cad.say(PROMPT.cable);
  }
  /** Update schedules: tray route lengths and fittings, feeder lengths and tray routes, from every level's plan. */
  function schedules() {
    if (!view) return;
    const u = updateSchedules(project, planDrawings(project, { file: view.file, insunits: view.info.units }));
    const same = JSON.stringify([u.project.trays, u.project.feeders]) === JSON.stringify([project.trays, project.feeders]);
    if (same) { cad.say(`SCHED  Up to date: ${scheduleSummary(u)}`); return; }
    change(u.project, `Schedules updated: ${scheduleSummary(u)} · ⌘Z to undo`);
  }
  /** A cable tray run along the points clicked, at the chosen width; on a tray route only once one is chosen. */
  function finishTray() {
    if (points.length >= 2) {
      const { widthMm, service, route } = cad.tray;
      const it = { kind: 'pline' as const, layer: TRAY_LAYER, pts: points, tray: { widthMm, service, ...(route ? { route } : {}) } };
      draw(it, `Cable tray ${widthMm} mm ${service.toLowerCase()}, ${m(toM(trayLength({ ...it, id: '' })))}${route ? ` on route ${route}` : ' (no route: assign one when you know it)'}`);
    }
    setPoints([]); cad.say(PROMPT.tray);
  }
  function finishCircle(r: number) {
    if (!points[0] || r <= 0) return;
    draw({ kind: 'circle', layer: curLayer, pts: [points[0]], r, ...newProps }, `Circle radius ${m(toM(r))}`);
    setPoints([]); setCircleDia(false); cad.say(PROMPT[tool] ?? PROMPT.circle);
  }
  /** A regular polygon round the centre clicked, its corners (or its sides' middles) on the circle through `at`. */
  function finishPolygon(at: Pt) {
    const c = points[0];
    if (!c || distance(c, at) <= 0) return;
    draw({ kind: 'pline', layer: curLayer, pts: polygonPts(c, at, polySides, polyIn), closed: true, ...newProps }, `Polygon of ${polySides} sides, ${polyIn ? 'inscribed in' : 'circumscribed about'} radius ${m(toM(distance(c, at)))}`);
    setPoints([]); cad.say(PROMPT.polygon);
  }
  /** An ellipse: from its centre and one axis's end, or from that axis's two ends; `other` gives the other axis. */
  function finishEllipse(other: Pt) {
    const [a, b] = points;
    if (!a || !b) return;
    const e = ellAxis ? ellipseOf([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], b, other) : ellipseOf(a, b, other);
    if (!e) { cad.say('ELLIPSE  The other axis has no length; pick a point away from the first axis.'); return; }
    const r = Math.hypot(e.ax![0], e.ax![1]);
    draw({ ...e, layer: curLayer, ...newProps } as Omit<SketchItem, 'id'>, `Ellipse ${m(toM(2 * r))} × ${m(toM(2 * r * (e.ratio ?? 1)))}`);
    setPoints([]); setEllAxis(false); cad.say(PROMPT.ellipse);
  }
  /** A revision cloud round the outline (a rectangle, or the points clicked) on the annotation layer: its arcs as typed,
   * else 15 mm long on paper at the annotation scale. */
  function finishCloud(outline: Pt[]) {
    const arc = cloudArc ?? 15 * unitsPerPaperMm(anno, units.factor);
    if (outline.length < 3 || areaOf(outline).area <= 0) { cad.say('REVCLOUD  The outline has no area; pick another corner.'); return; }
    draw({ kind: 'pline', layer: ANNO_LAYER, pts: outline, closed: true, cloud: arc }, `Revision cloud, arcs ${m(toM(arc))} long`);
    setPoints([]); cad.say(PROMPT.revcloud);
  }

  /** Typed input for an edit tool: an option of its prompt (the capital letters, or the word), a value, or Enter alone
   * (the value in < >, else the end of the step, then of the tool). True when it was one. */
  function editInput(typedC: string): boolean {
    const opt = promptOptions(cad.history[cad.history.length - 1] ?? '').find((o) => o.option.toUpperCase() === typedC);
    const c = opt ? opt.key : typedC, num = isNumber(c) && !c.startsWith('-') ? String(Number(c)) : undefined, CMD = tool.toUpperCase();
    // DRAWORDER after the objects: Front or Back at once; Above or Under then wait for the reference clicked.
    if (tool === 'draworder' && edPhase === 'points') {
      if (drMode === 'above' || drMode === 'under') { if (c) cad.say(`DRAWORDER  Click the reference object. ${DR_REF}`); return true; }
      const k = c || 'B';
      if (k === 'F' || k === 'B') { applyDrawOrder(k === 'F' ? 'front' : 'back'); return true; }
      if (k === 'A' || k === 'U') { setDrMode(k === 'A' ? 'above' : 'under'); cad.say(DR_REF); return true; }
      cad.say(`DRAWORDER  "${c}" is not an option. ${DR_OPTIONS}`); return true;
    }
    if (tool === 'texttofront') {
      const which = ({ T: 'text', D: 'dims', L: 'leaders', A: 'all' } as Record<string, TextKind>)[c || 'A'];
      if (!which) { cad.say(`TEXTTOFRONT  "${c}" is not an option. ${PROMPT.texttofront}`); return true; }
      applyTextToFront(which); return true;
    }
    if (tool === 'offset') {
      if (num) { setEdSet({ ...edSet, offset: num, through: false }); setEdAsk(null); cad.say(`OFFSET  Distance ${f2(num)} m`); if (!edStep) cad.say(PROMPT.offset); return true; }
      if (edStep) { if (c) return false; setEdStep(null); cad.say(PROMPT.offset); return true; }
      if (edAsk === 'offset') {
        if (!c) { setEdAsk(null); cad.say(PROMPT.offset); return true; }
        const s: EditSettings | undefined = c === 'T' ? { ...edSet, through: !edSet.through } : c === 'E' ? { ...edSet, erase: !edSet.erase } : c === 'L' ? { ...edSet, layer: edSet.layer === 'source' ? 'current' : 'source' } : undefined;
        if (!s) return false;
        setEdSet(s);
        cad.say(c === 'T' ? `OFFSET  Through point: ${s.through ? 'Yes' : 'No'}` : c === 'E' ? `OFFSET  Erase source after offsetting: ${s.erase ? 'Yes' : 'No'}` : `OFFSET  Copies on the ${s.layer === 'source' ? "source object's layer" : `current layer (${DRAW_LAYER})`}`);
        cad.say(editPrompt('offset', s)); return true;
      }
      if (!c || c === 'E') { cad.setTool('none'); return true; }
      return false;
    }
    if (tool === 'fillet' || tool === 'chamfer') {
      const fil = tool === 'fillet';
      if (edAsk === 'radius' || edAsk === 'd1' || edAsk === 'd2') {
        if (c && !num) return false;
        const s = num ? { ...edSet, [edAsk]: num } : edSet;
        setEdSet(s);
        if (edAsk === 'd1') { setEdAsk('d2'); cad.say(`CHAMFER  Specify second chamfer distance <${f2(s.d2)}>:`); return true; }
        setEdAsk(null); cad.say(editPrompt(tool, s)); return true;
      }
      if (num) { const s = fil ? { ...edSet, radius: num } : { ...edSet, d1: num, d2: num }; setEdSet(s); cad.say(edStep ? `${CMD}  ${fil ? 'Radius' : 'Distances'} ${f2(num)} m` : editPrompt(tool, s)); return true; }
      if (!edStep && c === (fil ? 'R' : 'D')) { setEdAsk(fil ? 'radius' : 'd1'); cad.say(fil ? `FILLET  Specify fillet radius <${f2(edSet.radius)}>:` : `CHAMFER  Specify first chamfer distance <${f2(edSet.d1)}>:`); return true; }
      if (!edStep && c === 'T') { const s = { ...edSet, trim: !edSet.trim }; setEdSet(s); cad.say(`${CMD}  Trim: ${s.trim ? 'Yes' : 'No'}`); cad.say(editPrompt(tool, s)); return true; }
      if (!c) { if (edStep) { setEdStep(null); cad.say(editPrompt(tool, edSet)); } else cad.setTool('none'); return true; }
      return false;
    }
    if (tool === 'mirror' && edAsk === 'erase' && points.length === 2) {
      if (c && c !== 'Y' && c !== 'N') return false;
      applyMirror(points[0], points[1], c ? c === 'Y' : !edSet.keep); return true;
    }
    if (tool === 'scale' && edAsk === 'factor' && points.length) {
      if (c && !num) return false;
      applyScale(points[0], num ?? edSet.factor); return true;
    }
    if (tool === 'array' && edAsk === 'type') {
      if (c === 'R' || (!c && !edSet.polar)) { setEdSet({ ...edSet, polar: false }); applyArray(undefined, false); return true; }
      if (c === 'P' || !c) { setEdSet({ ...edSet, polar: true }); setEdAsk(null); cad.say('ARRAY  Specify center point of array:'); return true; }
      return false;
    }
    // A text tool with its texts picked: the justification or height typed (Enter: the default).
    // (TCEN, TCOPY and TALIGN's reference take clicks or typed points, not words.)
    const clicks = ((tool === 'tcen' || tool === 'tcopy') || (tool === 'talign' && tAsk?.step === 'ref')) && !!c;
    if (TEXT_TOOLS.includes(tool) && edPhase === 'points' && !clicks) { textToolInput(c); return true; }
    if (c) return false;
    if (tool === 'break') {
      const it = edStep && sketch.find((x) => x.id === edStep.id);
      const r = it ? breakAt(it, edStep.at) : undefined;
      if (!edStep) { cad.setTool('none'); return true; }
      setEdStep(null);
      if (it && r && !failed(r, 'BREAK')) change(replaced(project, it, r.items!), `BREAK  ${kindOf(it)} split in two · ⌘Z to undo`);
      return true;
    }
    if (tool === 'join') { applyJoin(); return true; }
    if (PICK_FIRST.includes(tool) && edPhase === 'pick') {
      // TXTHEIGHT with nothing picked asks the height for new text.
      if (!pickedSk.length && tool !== 'th') { cad.say(`${CMD}  Pick the ${tool === 'tjust' ? 'texts' : 'objects'} first.`); return true; }
      setEdPhase('points');
      if (tool === 'array') { setEdAsk('type'); cad.say(arrayType(edSet)); } else if (TEXT_TOOLS.includes(tool)) cad.say(textToolPrompt(tool)); else if (tool === 'draworder') { if (drMode === 'front' || drMode === 'back') applyDrawOrder(drMode); else cad.say(drMode ? DR_REF : DR_OPTIONS); } else cad.say(tool === 'mirror' ? 'MIRROR  Specify first point of the mirror line:' : 'SCALE  Specify base point:');
      return true;
    }
    if (tool === 'array' && !edSet.polar && pickedSk.length) { applyArray(); return true; }
    if (tool === 'trim' || tool === 'extend' || tool === 'explode' || (tool === 'stretch' && !stretchBox)) { cad.setTool('none'); return true; }
    return false;
  }
  /** The edit tool's prompt as it is now, with the values in < > as they are now: the command line shows it in place
   * of the one said before, so a value changed in the dialog shows there at once. */
  const promptNow = (s: EditSettings): string | undefined => (tool === 'offset' ? (edStep ? undefined : edAsk === 'offset' ? editPrompt(tool, s) : PROMPT.offset)
    : tool === 'fillet' || tool === 'chamfer' ? (edStep ? undefined : edAsk === 'radius' ? `FILLET  Specify fillet radius <${f2(s.radius)}>:` : edAsk === 'd1' ? `CHAMFER  Specify first chamfer distance <${f2(s.d1)}>:`
      : edAsk === 'd2' ? `CHAMFER  Specify second chamfer distance <${f2(s.d2)}>:` : editPrompt(tool, s))
    : tool === 'mirror' && edAsk === 'erase' ? mirrorAsk(s) : tool === 'scale' && edAsk === 'factor' ? `SCALE  Specify scale factor <${s.factor}>:` : tool === 'array' && edAsk === 'type' ? arrayType(s) : undefined);
  /** Runs a recent command again (Enter or Space with no tool, Repeat in the right-click menu). */
  const repeat = (x: { tool?: CadTool; text?: string }) => { if (x.tool) cad.setTool(x.tool); else if (x.text) run(x.text); };

  function run(text: string) {
    const raw = text.trim();
    const c = raw.toUpperCase().replace(/\s+/g, ' ');
    setPromptMenu(null);
    if (tool === 'pan' && !c) { cad.setTool('none'); cad.say('PAN  Ended.'); return; }
    // A value typed at a prompt (a number, a point, a distance) is kept for Recent input ▸ on the command menu.
    if (tool !== 'none' && /\d/.test(raw) && !cadCommand(c)) setInputs((l) => [raw, ...l.filter((x) => x !== raw)].slice(0, 8));
    // Width… on a note's right-click menu: the box's new width in metres (its left edge stays).
    if (mtAsk?.step === 'ntwidth' && mtAsk.id) {
      const it = sketch.find((x) => x.id === mtAsk.id), n = Number(raw.replace(',', '.'));
      if (!raw || !it) { setMtAsk(null); cad.say('*Cancel*'); return; }
      if (!(n > 0)) { cad.say('MTEXT  Type the width in metres.'); return; }
      setMtAsk(null); change(updateSketch(project, fileOf(), noteWithWidth(it, n / units.factor)), `MTEXT  Note ${m(n)} wide · ⌘Z to undo`); return;
    }
    // Typed input for the tool in use: the text of TEXT, a radius, an angle, a point or a distance.
    if (renamingLayout && raw) {
      const id = renamingLayout, set = setOf(project);
      setRenamingLayout(null);
      const d = drawingLayoutOf(dwgLayouts, id);
      if (d) {
        if (layoutNames.some((n) => n.toLowerCase() === raw.toLowerCase() && n !== d.name)) { cad.say(`RENAME  There is a layout "${raw}" already.`); return; }
        setDwgLayouts(dwgLayouts.map((x) => (x === d ? { ...x, name: raw } : x)), `${d.name} renamed "${raw}"`);
        if (cad.layout === id) cad.setLayout(drawingLayoutId(raw));
        return;
      }
      change({ ...project, drawingSet: { ...set, sheets: set.sheets.map((x) => (x.id === id ? { ...x, title: raw } : x)) } }, `LAYOUT  renamed "${raw}" · ⌘Z to undo`);
      return;
    }
    if (reClose) {
      setReClose(false);
      const a = c[0];
      if (!c || a === 'S') refClose(true); else if (a === 'D') refClose(false); else cad.say('*Cancel*');
      return;
    }
    if (beClose) {
      setBeClose(false);
      const a = c[0];
      if (!c || a === 'Y') blockClose(true); else if (a === 'N') blockClose(false); else cad.say('*Cancel*');
      return;
    }
    if (findAsk) {
      if (!raw) { setFindAsk(null); cad.say(findAsk.step === 'with' ? 'FIND  Nothing replaced.' : '*Cancel*'); return; }
      if (findAsk.step === 'what') {
        const n = findCount(sketch, raw);
        if (!n) { setFindAsk(null); cad.say(`FIND  "${raw}" is not in the texts drawn here.`); return; }
        setFindAsk({ step: 'with', what: raw }); cad.say(`FIND  ${n} found for "${raw}". Replace with (Enter: leave them):`); return;
      }
      const r = findReplace(sketch, findAsk.what, raw);
      setFindAsk(null);
      change(r.changed.reduce((q, x) => updateSketch(q, fileOf(), x), project), `FIND  ${r.n} replaced: "${findAsk.what}" → "${raw}" in ${r.changed.length} object${r.changed.length === 1 ? '' : 's'} · ⌘Z to undo`); return;
    }
    if (roomAsk) {
      const room = buildingInfoOf(project).rooms.find((r) => r.id === roomAsk.id);
      setRoomAsk(null);
      if (!raw || !room) { cad.say('*Cancel*'); return; }
      if (roomAsk.step === 'name') { change(renameRoom(project, room.id, raw), `${room.name} renamed ${raw} · ⌘Z to undo`); return; }
      const types = roomTypesOf(buildingInfoOf(project)), low = raw.toLowerCase();
      const t = types.find((x) => x.label.toLowerCase() === low || x.id.toLowerCase() === low) ?? types.find((x) => x.label.toLowerCase().startsWith(low));
      if (!t) { cad.say(`ROOM TYPE  No room type "${raw}" (the types are in Building information).`); return; }
      change(setRoomType(project, room.id, t.id), `${room.name}: ${t.label} · ⌘Z to undo`); return;
    }
    if (renaming && raw) {
      const id = renaming;
      setRenaming(null);
      try { change(renameBoard(project, id, raw), `${id} renamed ${raw} · ⌘Z to undo`); } catch (e) { cad.say(`RENAME  ${e instanceof Error ? e.message : String(e)}`); }
      return;
    }
    if (tool === 'crop' && crop && cropTyped(c, raw)) return;
    if (tool === 'xclip' && (c === '' || c === 'C')) { finishClip(points); return; }
    if (tool === 'xclip' && c === 'O' && xClip) { setXClip({ ...xClip, outline: true }); setPoints([]); cad.say('XCLIP  Click inside a closed outline (a closed polyline, or a room):'); return; }
    if (tool === 'leader' && points.length >= 2 && raw) {
      if (view) change(leaderItems(points, raw, textH).reduce((q, x) => addSketch(q, view.file, x).project, project), `Leader "${raw}" · ⌘Z to undo`);
      setPoints([]); cad.say(PROMPT.leader); return;
    }
    // TEXT: its height (paper mm) and rotation (degrees) after the point, then the text. A word typed at either is the text.
    if (tool === 'text' && cad.textAt && textAsk?.step && (!c || isNumber(c))) {
      const n = c ? Number(c) : undefined;
      if (textAsk.step === 'height') { setTextAsk({ ...textAsk, step: 'rot', mm: n && n > 0 ? n : textAsk.mm }); cad.say(`TEXT  Specify rotation angle <${textAsk.rot}>:`); }
      else { setTextAsk({ ...textAsk, step: null, rot: n ?? textAsk.rot }); cad.say('TEXT  Enter text:'); }
      return;
    }
    // ATTEXT: the table's format.
    if (attExt) {
      setAttExt(false);
      if (!c || c === 'E' || c === 'EXCEL') void exportAs('attributes'); else if (c === 'C' || c === 'CSV') void exportAs('attributesCsv'); else cad.say(`ATTEXT  "${c}" is not a format.`);
      return;
    }
    // A block placed whose attributes are asked one by one: the value typed, Enter for the default.
    if (tool === 'insert' && attPend && !attPend.dialog) {
      const ad = attPend.asked[attPend.i], values = { ...attPend.values, [ad.tag ?? '']: raw.trim() ? raw : ad.text ?? '' };
      if (attPend.i + 1 < attPend.asked.length) { const nx = attPend.asked[attPend.i + 1]; setAttPend({ ...attPend, i: attPend.i + 1, values }); cad.say(`INSERT  ${nx.prompt || nx.tag} <${nx.text ?? ''}>:`); }
      else { setAttPend(null); finishInsert(attPend.def, attPend.at, values); }
      return;
    }
    // INSERT on the command line: the block's name (-INSERT), S or R for its scale and rotation, a point typed to place it.
    if (tool === 'insert') {
      if (!insBlock) { if (!raw) { cad.say('INSERT  Block name:'); return; } const def = blockByName(raw); if (!def) { cad.say(`INSERT  No block "${raw.trim()}" in this drawing or Recent. Block name:`); return; } setInsBlock(def); cad.say(PROMPT.insert); return; }
      if (insAsk === 'scale') { if (!c) { setInsAsk(null); cad.say(PROMPT.insert); return; } const n = Number(raw.replace(',', '.')); if (!(n > 0)) { cad.say(`INSERT  A number above 0. Scale <${insSet.scale}>:`); return; } setInsSet({ ...insSet, scale: n }); setInsAsk(null); cad.say(PROMPT.insert); return; }
      if (insAsk === 'rot') { if (!c) { setInsAsk(null); cad.say(PROMPT.insert); return; } const n = Number(raw.replace(',', '.')); if (!Number.isFinite(n)) { cad.say(`INSERT  Degrees. Rotation <${insSet.rot}>:`); return; } setInsSet({ ...insSet, rot: n }); setInsAsk(null); cad.say(PROMPT.insert); return; }
      if (c === 'S' || c === 'SCALE') { setInsAsk('scale'); cad.say(`INSERT  Scale <${insSet.scale}>:`); return; }
      if (c === 'R' || c === 'ROTATE') { setInsAsk('rot'); cad.say(`INSERT  Rotation <${insSet.rot}>:`); return; }
      const p = typedPoint(raw, undefined, cursor.at);
      if (p) { placeInsert(insBlock, p); return; }
      cad.say(c ? `INSERT  "${c}" is not an option. ${PROMPT.insert}` : PROMPT.insert); return;
    }
    // -INSERT with the name typed (what Insert's arrow sends): the block waits at the cursor.
    const insTyped = /^-INSERT\s+(.+)$/i.exec(raw.trim());
    if (insTyped && view) {
      setTyped((t) => [...t.filter((x) => x !== c), c].slice(-30));
      cad.say(`Command: -INSERT ${insTyped[1].trim()}`);
      const def = blockByName(insTyped[1]);
      if (!def) { cad.say(`INSERT  No block "${insTyped[1].trim()}" in this drawing or Recent.`); return; }
      startInsert(def); return;
    }
    // -BLOCK on the command line: the name, the base point (typed, or clicked), then the objects: Enter when picked.
    if (tool === 'block' && blk) {
      if (blk.step === 'name') { const why = blockNameError(raw, archBlockNames); if (why) { cad.say(`BLOCK  ${why} Block name:`); return; } setBlk({ step: 'base', name: raw.trim() }); cad.say(PROMPT.blockpick); return; }
      if (blk.step === 'base') { const p = typedPoint(raw, undefined, cursor.at); if (!p) { cad.say('BLOCK  A point (x,y), or click it. Specify base point:'); return; } setBlk({ ...blk, step: 'objects', base: p }); cad.say(`BLOCK  Select objects${pickedSk.length ? ` (${picks(pickedSk.length)})` : ''} — Enter when done:`); return; }
      if (!c) { if (!pickedSk.length) { cad.say('BLOCK  Nothing picked. Select objects — Enter when done:'); return; } applyBlock(blk.name, blk.base!, pickedSk.map((it) => it.id), 'convert', ''); return; }
      cad.say('BLOCK  Click the objects, Enter when done:'); return;
    }
    if (tool === 'blockpick' && blockDlg?.picking === 'objects' && !c) { setBlockDlg({ ...blockDlg, ids: pickedSk.map((it) => it.id), picking: undefined }); cad.setTool('none'); return; }
    // DIVIDE / MEASURE after the object: the number of parts, or the length in metres; Block waits for Steps 9 and 10.
    if ((tool === 'divide' || tool === 'measure') && divPick) {
      const CMD = tool.toUpperCase(), ask = tool === 'divide' ? 'DIVIDE  Number of segments or [Block]:' : 'MEASURE  Segment length or [Block]:';
      // Block: its name (one of the drawing's, or a recent one), then whether it turns with the object, then the number.
      if (divPick.step === 'bname') { if (!raw) { setDivPick({ ...divPick, step: undefined }); cad.say(ask); return; } const def = blockByName(raw); if (!def) { cad.say(`${CMD}  No block "${raw.trim()}" in this drawing or Recent. Block name:`); return; } setDivPick({ ...divPick, block: def.name, step: 'align' }); cad.say(`${CMD}  Align block with object? [Yes/No] <Yes>:`); return; }
      if (divPick.step === 'align') { if (c && c !== 'Y' && c !== 'YES' && c !== 'N' && c !== 'NO') { cad.say(`${CMD}  Yes or No. Align block with object? [Yes/No] <Yes>:`); return; } setDivPick({ ...divPick, align: !c || c === 'Y' || c === 'YES', step: undefined }); cad.say(ask.replace(' or [Block]', '')); return; }
      if (c === 'B' || c === 'BLOCK') { setDivPick({ ...divPick, step: 'bname' }); cad.say(`${CMD}  Block name:`); return; }
      if (!c) { cad.say(ask); return; }
      const n = Number(raw.replace(',', '.'));
      const pts = tool === 'divide' ? (Number.isInteger(n) && n >= 2 ? pointsAlong(divPick.it, n) : []) : n > 0 ? pointsEvery(divPick.it, n / units.factor, divPick.at) : [];
      if (!pts.length) {
        cad.say(tool === 'divide' ? `DIVIDE  A whole number of 2 or more. ${ask}` : n > 0 ? `MEASURE  The ${kindOf(divPick.it).toLowerCase()} is shorter than ${m(n)}: no point fits. ${ask}` : `MEASURE  A length in metres. ${ask}`);
        return;
      }
      const def = divPick.block ? blockByName(divPick.block) : undefined;
      let next = def && !blockDefOf(defs, def.name) ? withBlockDef(project, fileOf(), def) : project;
      for (const q of pts) next = addSketch(next, fileOf(), def ? { kind: 'insert', layer: curLayer, pts: [q.at], block: def.name, ...(divPick.align && q.angle ? { rot: q.angle } : {}), ...newProps } : { kind: 'point', layer: curLayer, pts: [q.at], ...newProps }).project;
      change(next, `${CMD}  ${pts.length} ${def ? `"${def.name}" block${pts.length === 1 ? '' : 's'}` : `point${pts.length === 1 ? '' : 's'}`} on the ${kindOf(divPick.it).toLowerCase()} · ⌘Z to undo`);
      if (def) setRecentBlocks((r) => pushRecentBlock(def, r));
      setDivPick(null); cad.setTool('none'); return;
    }
    // MTEXT at the second corner: H, J or W, then the value asked for; a point typed is the corner.
    if (tool === 'mtext' && points.length === 1 && !edNote) {
      if (mtAsk?.step === 'height') { const n = Number(c); if (c && !(n > 0)) { cad.say(`MTEXT  Height on paper (mm) <${mtMm()}>:`); return; } if (n > 0) setMtSet({ ...mtSet, mm: n }); setMtAsk(null); cad.say(MTEXT_CORNER); return; }
      if (mtAsk?.step === 'just') { const j = c ? parseAttach(c) : mtSet.just ?? 'TL'; if (!j) { cad.say(`MTEXT  "${c}" is not a justification. ${MTEXT_JUST(mtSet.just)}`); return; } setMtSet({ ...mtSet, just: j }); setMtAsk(null); cad.say(MTEXT_CORNER); return; }
      if (mtAsk?.step === 'width') { const n = Number(raw.replace(',', '.')); if (!(n > 0)) { cad.say('MTEXT  Width (m):'); return; } openNote(points[0], [points[0][0] + n / units.factor, points[0][1]]); return; }
      if (c === 'H') { setMtAsk({ step: 'height' }); cad.say(`MTEXT  Height on paper (mm) <${mtMm()}>:`); return; }
      if (c === 'J') { setMtAsk({ step: 'just' }); cad.say(MTEXT_JUST(mtSet.just)); return; }
      if (c === 'W') { setMtAsk({ step: 'width' }); cad.say('MTEXT  Width (m):'); return; }
    }
    if (tool === 'zoom') { zoomOption(c || 'W'); return; }
    if (tool === 'zoomscale') {
      const z = parseZoomScale(raw);
      if (!z) { cad.say('ZOOM  A factor such as 2, 0.5 or 2x:'); return; }
      zoomTo({ kind: 'scale', ...z }); cad.say(`ZOOM  ${z.k}× ${z.relative ? 'the view' : 'the whole drawing'}`); cad.setTool('none'); return;
    }
    if (tool === 'selsim') { similarInput(c); return; }
    if (tool === 'hatchedit' && !c) {
      if (hePhase) { setHePhase(null); cad.say(hatchEditSay(null, heIds.length)); } else { cad.setTool('none'); cad.say('HATCHEDIT  Ended.'); }
      return;
    }
    if (tool === 'boundary') {
      if (c === 'I' || c === 'ISLANDS') { setBoundIsl(!boundIsl); cad.say(`BOUNDARY  Pick internal point or [Islands] <Islands ${boundIsl ? 'off' : 'on'}>:`); return; }
      if (!c) { cad.setTool('none'); cad.say('BOUNDARY  Ended.'); return; }
    }
    if (tool === 'dimang' && !c && !angPick) { setAngPick({ vertex: true }); cad.say('DIMANGULAR  Specify angle vertex:'); return; }
    if (tool === 'tcount' && tc) { tcountInput(text, c); return; }
    if (tool === 'keynote' && kn) {
      if (kn.step === 'number') {
        const n = c ? Number(c) : kn.n;
        if (c && !/^\d+$/.test(c)) { cad.say(`KEYNOTE  A whole number <${kn.n}>:`); return; }
        setKn({ step: 'place', n }); cad.say(`KEYNOTE  Place keynote ${n}:`); return;
      }
      if (kn.step === 'text') {
        if (!raw) { cad.say('KEYNOTE  Type the note text:'); return; }
        if (legendNext(sketch)) { addKeynote(kn.n, kn.at!, raw); return; }
        setKn({ ...kn, step: 'legend', note: raw }); cad.say('KEYNOTE  Legend position (the top left of its title):'); return;
      }
      const p = typedPoint(raw, undefined, cursor.at);
      if (p) { click(p, 1e-9); return; }
      cad.say(kn.step === 'place' ? `KEYNOTE  Click where keynote ${kn.n} goes:` : 'KEYNOTE  Click where the legend starts:'); return;
    }
    if ((tool === 'tprefix' || tool === 'tsuffix') && edPhase === 'points') {
      if (!raw) { cad.say(`${tool.toUpperCase()}  Nothing added.`); cad.setTool('none'); return; }
      const texts = pickedSk.filter((it) => it.kind === 'text');
      // As typed, spaces at the ends included ("EX. " before a name).
      changeTexts(tool.toUpperCase(), texts.map((it) => ({ ...it, text: tool === 'tprefix' ? `${text}${it.text ?? ''}` : `${it.text ?? ''}${text}` })), `with "${text}" ${tool === 'tprefix' ? 'before' : 'after'}`); return;
    }
    if (tool === 'rtall') {
      const key = promptOptions(PROMPT.rtall).find((o) => o.option.toUpperCase() === c)?.key ?? c;
      if (key === '' || key === 'A' || key === 'U') { tagAllRooms(key === 'A'); return; }
    }
    if (tool === 'text' && cad.textAt && raw) {
      const t = textAsk ?? { mm: anno.textMm, rot: 0 };
      draw({ kind: 'text', layer: tb ? (/\{[^}]+\}/.test(raw) ? TB_LAYERS.field : TB_LAYERS.text) : ANNO_LAYER, pts: [cad.textAt], text: raw, h: tb ? t.mm : textUnits({ ...anno, textMm: t.mm }, units.factor), ...(t.rot ? { rot: (t.rot * Math.PI) / 180 } : {}) }, `Text "${raw}"`);
      cad.setTextAt(null); setTextAsk(null); cad.say(PROMPT.text); return;
    }
    if (!renaming && EDIT_TOOLS.includes(tool) && editInput(c)) return;
    if (c && layoutCmd(c)) { setTyped((t) => [...t.filter((x) => x !== c), c].slice(-30)); return; }
    // CLAYER and a layer's name: new lines, polylines, rectangles, circles and arcs go on it.
    // DRAWORDER with its order typed (or from the ribbon): the objects picked, else those picked next, go there.
    const rc = /^REFCLOSE\s+(S|D|SAVE|DISCARD)$/i.exec(raw.trim());
    if (rc) { cad.say(`Command: ${c}`); refClose(rc[1][0].toUpperCase() === 'S'); return; }
    // While a block is edited in place, the drawing is not saved or exported (its block is taken apart).
    if (project.cadRefEdit && /^(SAVE|QSAVE|SAVEAS|DXFOUT|SAVEDWG|DWGOUT|EXPORT|EXPORTPDF|PNGOUT|WBLOCK|W|PUBLISH|BEDIT|BE)$/.test(c)) { cad.say(`${c}  "${project.cadRefEdit.insert.block}" is being edited in place: REFCLOSE first (Save or Discard).`); return; }
    const be = /^(?:BE|BEDIT)\s+(.+)$/i.exec(raw.trim());
    if (be && view) { setTyped((t) => [...t.filter((x) => x !== c), c].slice(-30)); cad.say(`Command: ${c}`); blockEdit(be[1]); return; }
    // SAVE in the block editor saves the block.
    if ((c === 'SAVE' || c === 'QSAVE') && blockEditorOf(view?.file)) { cad.say(`Command: ${c}`); blockSave(); return; }
    const dr = /^(?:DR|DRAWORDER)\s+(F|B|A|U|FRONT|BACK|ABOVE|UNDER)$/i.exec(raw.trim());
    if (dr && view) {
      setTyped((t) => [...t.filter((x) => x !== c), c].slice(-30));
      cad.say(`Command: ${c}`);
      setDrMode(({ F: 'front', B: 'back', A: 'above', U: 'under' } as Record<string, DrMode>)[dr[1][0].toUpperCase()]);
      cad.setTool('draworder'); return;
    }
    const cl = /^CLAYER\s+(.+)$/i.exec(raw.trim());
    if (cl && view) {
      setTyped((t) => [...t.filter((x) => x !== c), c].slice(-30));
      const want = cl[1].trim(), row = lRows.find((r) => r.name.toLowerCase() === want.toLowerCase());
      cad.say(`Command: CLAYER ${want}`);
      if (!row) cad.say(`CLAYER  There is no layer ${want}. Add it with New layer in the layer palette (LM).`);
      else if (row.group !== 'drawn') cad.say(`CLAYER  ${row.name} is ${row.group === 'arch' ? 'the architect\'s' : 'a reference\'s'}; new objects go on the app's drawn layers.`);
      else if (row.freeze) cad.say(`CLAYER  ${row.name} is frozen; thaw it first.`);
      else setCurrentLayer(row.name);
      return;
    }
    if (!c) {
      if ((tool === 'area' || tool === 'trace') && points.length >= 3) finishArea(points);
      else if (tool === 'pline') finishPline(false);
      else if (tool === 'revcloud' && cloudPoly && points.length >= 3) finishCloud(points);
      else if (tool === 'tray') finishTray();
      else if (tool === 'em') finishRoute();
      else if (tool === 'arl' && arlAt.length && points.length >= 2) placeArl();
      else if (renaming) { setRenaming(null); cad.say('*Cancel*'); }
      else if (tool === 'cable') finishCable();
      else if (tool === 'point') cad.setTool('none');
      else if (tool === 'line') { setPoints([]); cad.say(PROMPT.line); }
      else if (tool === 'leader') { if (points.length >= 2 && view) change(addSketch(project, view.file, leaderItems(points, '', textH)[0]).project, 'Leader · ⌘Z to undo'); setPoints([]); cad.say(PROMPT.leader); }
      else if (tool === 'copy') { setPoints([]); cad.setSelected(null); setResult(null); cad.setTool('none'); }
      else if (tool === 'none' && recent[0]) repeat(recent[0]);
      return;
    }
    if (tool === 'pline' && c === 'C' && points.length >= 3) { finishPline(true); return; }
    if (tool === 'circle' && points.length === 1 && isNumber(c)) { finishCircle(circleDia ? Number(c) / 2 : Number(c)); return; }
    if (tool === 'circled' && points.length === 1 && isNumber(c)) { finishCircle(Number(c) / 2); return; }
    if (tool === 'circle' && !points.length && (c === '2P' || c === '3P')) { cad.setTool(c === '2P' ? 'circle2p' : 'circle3p'); return; }
    if (tool === 'circle' && points.length === 1 && (c === 'D' || c === 'DIAMETER')) { setCircleDia(true); cad.say('CIRCLE  Specify diameter (a point, or type it):'); return; }
    if (tool === 'polygon' && !points.length && /^\d+$/.test(c)) {
      const n = Number(c);
      if (n >= 3 && n <= 64) { setPolySides(n); cad.say(`POLYGON  ${n} sides. Specify center:`); } else cad.say('POLYGON  Type 3 to 64 sides.');
      return;
    }
    if (tool === 'polygon' && (c === 'I' || c === 'C' || c === 'INSCRIBED' || c === 'CIRCUMSCRIBED')) {
      const ins = c.startsWith('I');
      setPolyIn(ins); cad.say(`POLYGON  ${ins ? 'Corners on the circle (inscribed)' : 'Sides touching the circle (circumscribed)'}`); return;
    }
    if (tool === 'polygon' && points.length === 1 && isNumber(c) && Number(c) > 0) { finishPolygon([points[0][0] + Number(c), points[0][1]]); return; }
    if (tool === 'ellipse' && !points.length && (c === 'A' || c === 'AXIS')) { setEllAxis(true); cad.say('ELLIPSE  Specify end of the axis:'); return; }
    if (tool === 'ellipse' && !points.length && (c === 'C' || c === 'CENTER' || c === 'CENTRE')) { setEllAxis(false); cad.say('ELLIPSE  Specify center:'); return; }
    if (tool === 'ellipse' && points.length === 2 && isNumber(c) && Number(c) > 0) {
      // The other axis's half-length typed: a point that far across the first axis.
      const [a, b] = points, ctr: Pt = ellAxis ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : a, l = distance(ctr, b) || 1;
      finishEllipse([ctr[0] - ((b[1] - ctr[1]) / l) * Number(c), ctr[1] + ((b[0] - ctr[0]) / l) * Number(c)]); return;
    }
    if (tool === 'revcloud' && !points.length && (c === 'P' || c === 'POLYGONAL')) { setCloudPoly(true); cad.say('REVCLOUD  Specify first point:'); return; }
    if (tool === 'revcloud' && !points.length && (c === 'R' || c === 'RECTANGULAR')) { setCloudPoly(false); cad.say(PROMPT.revcloud); return; }
    if (tool === 'revcloud' && !points.length && isNumber(c) && Number(c) > 0) { setCloudArc(Number(c)); cad.say(`REVCLOUD  Arcs ${m(toM(Number(c)))} long. Specify first corner:`); return; }
    if (tool === 'revcloud' && cloudPoly && c === 'C' && points.length >= 3) { finishCloud(points); return; }
    if (tool === 'rotate' && !selSketch && selectedItem?.what === 'elv' && isNumber(c)) {
      const r = rotateElv(project, selectedItem.id, Number(c));
      change(r.next, r.message); cad.setSelected(null); setResult(null); cad.setTool('none'); return;
    }
    if (tool === 'rotate' && selSketch && points.length === 1 && isNumber(c)) {
      const a = (Number(c) * Math.PI) / 180;
      if (view) change(updateSketch(project, view.file, rotated(selSketch, points[0], a)), `Rotated ${Number(c).toFixed(2)}° · ⌘Z to undo`);
      setPoints([]); cad.setSelected(null); setResult(null); cad.setTool('none'); return;
    }
    // A number typed with Scale (before its base point) sets the factor.
    if (tool === 'scale' && isNumber(c) && !c.startsWith('-')) { const k = String(Number(c)); setEdSet({ ...edSet, factor: k }); cad.say(`SCALE  Factor ${k}`); return; }
    if (DRAW_TOOLS.includes(tool) || tool === 'copybase' || tool === 'paste' || tool === 'dist' || tool === 'area' || tool === 'trace' || tool === 'zoomwin' || tool === 'dimrad' || tool === 'dimdia' || tool === 'dimang' || (tool === 'tcen' && edPhase === 'points') || (tool === 'talign' && tAsk?.step === 'ref')) {
      const p = typedPoint(raw, points[points.length - 1], cursor.at);
      if (p) { cad.say(`  ${raw}`); click(p, 1e-9); return; }
    }
    cad.say(`Command: ${c}`);
    if (c === 'O' && tool === 'area') { setObjectMode(true); setPoints([]); cad.say('AREA  Select a closed object:'); return; }
    const act: Record<CadAction, () => void> = {
      new: () => newFile(),
      open: () => openFile(),
      tbSave: () => { if (!view || !tbIdOf(view.file)) { cad.say('TBSAVE  Not a title block drawing: open one with Project → Title block → Edit in CAD.'); return; } const r = saveTitleBlockFromCad(project, view.file); if (r.project !== project) change(r.project, r.message); else cad.say(r.message); },
      close: () => { if (view) closeDrawings(c === 'CLOSE' ? [view] : undefined); else cad.say('No drawing open.'); },
      fit: () => cad.fit(),
      addRooms: () => addFound(),
      schedules: () => schedules(),
      select: () => { cad.setTool('none'); cad.say('SEL  Click a device, Shift-click to add or remove, or drag a window (left to right: inside; right to left: crossing):'); },
      xref: () => { if (view) setShowXR(true); else cad.say('XREF  Open a drawing first.'); },
      xattach: () => { if (view) void startAttach(); else cad.say('XATTACH  Open a plan first.'); },
      xclip: () => { const one = xr.refs.filter((x) => !x.unloaded); if (one.length === 1) startClip(one[0]); else if (view) { setShowXR(true); cad.say('XCLIP  Choose the reference, then Clip.'); } },
      layerManager: () => { if (view) setShowLM((v) => !v); else cad.say('LAYER  Open a drawing first.'); },
      newLayer: () => { if (!view) { cad.say('LAYER  Open a drawing first.'); return; } setShowLM(true); const n = addLayer(); cad.say(`LAYER  ${n} added. Double-click its name in the layer palette (or F2) to rename it.`); },
      clayer: () => cad.say(`CLAYER  Current layer: ${curLayer}. Type CLAYER and a layer name to change it, e.g. CLAYER ${curLayer}.`),
      layiso: () => {
        const keep = pickedLayers();
        if (!view) cad.say('LAYISO  Open a drawing first.'); else if (!keep.length) cad.say('LAYISO  Pick the objects whose layers stay on first (or select layers in the layer palette, then Iso).'); else isolateLayers(keep);
      },
      layuniso: () => unisolateLayers(),
      layoff: () => layerCmd('LAYOFF', { on: false }, 'off'),
      layfrz: () => layerCmd('LAYFRZ', { freeze: true }, 'frozen'),
      laylck: () => layerCmd('LAYLCK', { lock: true }, 'locked'),
      layulk: () => layerCmd('LAYULK', { lock: false }, 'unlocked'),
      laymcur: () => {
        const names = pickedLayers();
        if (!view) cad.say('LAYMCUR  Open a drawing first.'); else if (names.length !== 1) cad.say(names.length ? 'LAYMCUR  Pick objects on one layer only.' : 'LAYMCUR  Pick an object on the layer first, then LAYMCUR.'); else run(`CLAYER ${names[0]}`);
      },
      layon: () => allLayers('LAYON', { on: true }, 'on'),
      laythw: () => allLayers('LAYTHW', { freeze: false }, 'thawed'),
      align: () => { if (pickedItems.length < 2) cad.say(`${c}  Select two or more devices first.`); else editDevices(c === 'ALIGN' ? 'row' : c === 'ALIGNV' ? 'column' : 'space'); },
      wireAll: () => wireAll(),
      wireTags: () => cad.setWireTags(!cad.wireTags),
      coverage: () => cad.setCoverage(!cad.coverage),
      erase: () => removeSelected(),
      restoreDwg: () => {
        const n = view ? erasedOf(project, view.file).length : 0;
        if (!view || !n) { cad.say('RESTOREDWG  Nothing of this drawing is erased.'); return; }
        setPicked([]); setResult(null);
        change(restoredErased(project, view.file), `RESTOREDWG  ${n} erased drawing object${n === 1 ? '' : 's'} back · ⌘Z to undo`);
      },
      save: () => void saveNow(),
      saveDwg: () => startSaveAs('dwg'),
      saveAs: () => startSaveAs(c === 'DXFOUT' ? 'dxf' : undefined),
      closeOthers: () => { if (view) closeDrawings(cad.drawings.filter((v) => v !== view)); else cad.say('No drawing open.'); },
      export: () => cad.say('EXPORT  EXPORTPDF (PDF of this view) · PNGOUT (image) · WBLOCK (the objects picked, as DXF) · or File → Export for the layout PDF and the device and cable lists.'),
      exportPdf: () => void exportAs('pdfView'),
      pngOut: () => void exportAs('png'),
      wblock: () => void exportAs('wblock'),
      publish: () => setPublishing(true),
      dsettings: () => setDsTab('snap'),
      osnapSettings: () => setDsTab('osnap'),
      polar: () => cad.toggle('polar'),
      otrack: () => cad.toggle('otrack'),
      lwt: () => cad.toggle('lwt'),
      copyClip: () => copyClip(),
      cutClip: () => cutClip(),
      copyBase: () => { if (clipRefusal('COPYBASE')) return; cad.setTool('copybase'); },
      pasteClip: () => pasteClip(false),
      pasteOrig: () => pasteClip(true),
      zoomPrev: () => zoomPrev(),
      qselect: () => { if (!view) { cad.say('QSELECT  Open a drawing first.'); return; } setDlg('qselect'); },
      layers: () => cad.setShowLayers(!cad.showLayers),
      osnap: () => cad.toggle('osnap'),
      grid: () => cad.cycleGrid(),
      ortho: () => cad.toggle('ortho'),
      snap: () => cad.toggle('snap'),
      help: () => { cad.say(HELP); setLog('help'); },
      textStyle: () => { setDlg('style'); cad.say(`STYLE  Current text style: "${currentTextStyle(project).name}"`); },
      dimStyle: () => { setDlg('dimstyle'); cad.say(`DIMSTYLE  Current dimension style: "${dimStylesOf(project).current}"`); },
      pointStyle: () => { setDlg('ptype'); cad.say(`PTYPE  Points shown as ${pointShapeLabel(pointStyleOf(project).mode).toLowerCase()}`); },
      blockDialog: () => openBlockDialog(),
      blocksPalette: () => { if (!view) { cad.say('INSERT  Open a drawing first.'); return; } cad.setShowBlocks(!cad.showBlocks); },
      attDef: () => { if (!view) { cad.say('ATTDEF  Open a drawing first.'); return; } setAttDlg({ ...ATT_DRAFT, heightMm: currentTextStyle(project).heightMm || anno.textMm, style: currentTextStyle(project).name }); cad.say('ATTDEF  Attribute definition'); },
      attExport: () => { if (!view) { cad.say('ATTEXT  Open a drawing first.'); return; } setAttExt(true); cad.say('ATTEXT  Format [Csv/Excel] <Excel>:'); input.current?.focus(); },
      undo: () => { if (onUndo && canUndo) onUndo(); else cad.say('UNDO  Nothing to undo.'); },
      redo: () => { if (onRedo && canRedo) onRedo(); else cad.say('REDO  Nothing to redo.'); },
      selectAll: () => {
        if (!view) { cad.say('SELECTALL  Open a drawing first.'); return; }
        const devs = cad.showDevices ? placed.filter((d) => shown(d.key)) : [];
        pick(devs, pickable);
        cad.say(`SELECTALL  ${picks(devs.length + pickable.length)}`);
      },
      count: () => {
        const any = pickedSk.length + pickedItems.length > 0;
        const sks = any ? pickedSk : pickable, devs = any ? pickedItems : cad.showDevices ? placed.filter((d) => shown(d.key)) : [];
        const kinds = [...sks.map((it) => (it.kind === 'insert' && it.block ? `${it.block} (block)` : kindOf(it))), ...devs.map((d) => typeOf(project, d) || d.what)];
        cad.say(kinds.length ? `COUNT  ${any ? 'Picked' : 'In view'}: ${countLine(kinds, 0)} — ${kinds.length} in all` : 'COUNT  Nothing to count.');
      },
      isolateObjects: () => hideObjects('isolate'),
      hideObjects: () => hideObjects('hide'),
      unisolateObjects: () => { if (objHide && objHide.file === view?.file) { setObjHide(null); cad.say('UNISOLATEOBJECTS  All objects shown again.'); } else cad.say('UNISOLATEOBJECTS  No objects are isolated or hidden.'); },
      addSelected: () => addSelected(),
      refedit: () => refEdit(),
      refclose: () => refClose(),
      bedit: () => blockEdit(),
      bsave: () => { if (!view || !blockEditorOf(view.file)) { cad.say('BSAVE  Not in the block editor (BEDIT opens a block in it).'); return; } blockSave(); },
      bclose: () => blockClose(),
      find: () => { if (!view) { cad.say('FIND  Open a drawing first.'); return; } setFindAsk({ step: 'what' }); cad.say('FIND  Find what (in the texts, notes, attributes and dimension texts drawn here):'); input.current?.focus(); },
      quickMeasure: () => {
        if (!pickedSk.length) { cad.say('QUICKMEASURE  Pick lines, polylines, arcs or circles first.'); return; }
        const q = measureOf(pickedSk);
        cad.say(q.n ? `QUICKMEASURE  ${q.n} object${q.n === 1 ? '' : 's'}: length ${m(toM(q.length))}${q.area > 0 ? ` · closed area ${m2(toM2(q.area))}` : ''}` : 'QUICKMEASURE  Nothing with a length is picked.');
      }
    };
    const command = cadCommand(c);
    if (command) setTyped((t) => [...t.filter((x) => x !== c), c].slice(-30));
    if (command && 'action' in command && command.action !== 'help') setRecent((r) => [{ label: c, text: c }, ...r.filter((x) => x.label !== c)].slice(0, 8));
    if (!command) cad.say(`Unknown command "${c}". Press F1 for the list.`);
    else if ('tool' in command) cad.setTool(command.tool);
    else act[command.action]();
  }

  /** The prompt of a text tool once the texts are picked: the first one's justification or height on paper as the default. */
  function textToolPrompt(t: CadTool): string {
    const texts = pickedSk.filter((it) => it.kind === 'text');
    if (t === 'tjust') return TJUST_PROMPT(justLabel(texts[0]?.just));
    if (t === 'th') {
      const sized = pickedSk.filter((it) => it.kind === 'text' || it.kind === 'dim'), h = sized[0]?.h;
      return TH_PROMPT(h ? Math.round((h / unitsPerPaperMm(anno, units.factor)) * 100) / 100 : anno.textMm, !sized.length);
    }
    if (t === 'talign') return TALIGN_PROMPT;
    if (t === 'tcase') return TCASE_PROMPT;
    if (t === 'torient') return TORIENT_PROMPT;
    if (t === 'tprefix' || t === 'tsuffix') return `${t.toUpperCase()}  Type the words to add ${t === 'tprefix' ? 'before' : 'after'} each text, Enter:`;
    if (t === 'tcen') return texts.length === 1 ? 'TCEN  Specify first point:' : `TCEN  Pick one text (${texts.length} picked).`;
    if (t === 'tframe') return TFRAME_PROMPT;
    if (t === 'tmask') return TMASK_PROMPT;
    return 'TCOPY  Click the text to copy the words from:';
  }
  /** The texts picked changed by a text tool, as one undo step; the other objects picked are left as they are. */
  function changeTexts(name: string, texts: SketchItem[], what: string) {
    const others = pickedSk.length - texts.length;
    let next = project;
    for (const it of texts) next = updateSketch(next, fileOf(), it);
    change(next, `${name}  ${texts.length} text${texts.length === 1 ? '' : 's'} ${what}${others ? ` (${others} other object${others === 1 ? '' : 's'} left as ${others === 1 ? 'it is' : 'they are'})` : ''} · ⌘Z to undo`);
    cad.setTool('none');
  }
  /** The gap TALIGN's Spacing offers: 1.5 × the first text's height, in paper mm. */
  const spacingDefault = () => { const h = pickedSk.find((it) => it.kind === 'text')?.h; return Math.round(((h ? h / unitsPerPaperMm(anno, units.factor) : anno.textMm) * 1.5) * 100) / 100; };
  /** What is typed at a text tool's prompt (Enter: the default): TJUST moves each text's anchor on its box; TXTHEIGHT
   * sets the height of the texts and dimensions picked, or of new text when none is. One undo step. */
  function textToolInput(c: string) {
    const texts = pickedSk.filter((it) => it.kind === 'text'), others = pickedSk.length - texts.length;
    const left = (n: number) => (n ? ` (${n} other object${n === 1 ? '' : 's'} left as ${n === 1 ? 'it is' : 'they are'})` : '');
    if (tool === 'tjust') {
      const j = c ? parseJust(c) : texts[0]?.just ?? 'L';
      if (!j) { cad.say(`TJUST  "${c}" is not a justification. ${textToolPrompt(tool)}`); return; }
      let next = project;
      for (const it of texts) next = updateSketch(next, fileOf(), rejustified(it, j));
      change(next, `TJUST  ${texts.length} text${texts.length === 1 ? '' : 's'} justified ${justLabel(j).toLowerCase()}${left(others)} · ⌘Z to undo`);
      cad.setTool('none'); return;
    }
    if (tool === 'tcase') {
      const mode = ({ U: 'upper', L: 'lower', T: 'title', S: 'sentence' } as Record<string, CaseMode>)[c || 'U'];
      if (!mode) { cad.say(`TCASE  "${c}" is not a case. ${TCASE_PROMPT}`); return; }
      changeTexts('TCASE', texts.map((it) => ({ ...it, text: cased(it.text ?? '', mode) })), `in ${mode} case`); return;
    }
    if (tool === 'torient') {
      const mode = ({ B: 'bottom', R: 'right', BO: 'both' } as Record<string, OrientMode>)[c || 'BO'];
      if (!mode) { cad.say(`TORIENT  "${c}" is not a side. ${TORIENT_PROMPT}`); return; }
      changeTexts('TORIENT', texts.map((it) => oriented(it, mode)), `readable from the ${mode === 'both' ? 'bottom or the right' : mode}`); return;
    }
    if (tool === 'talign') {
      if (tAsk?.step === 'gap') {
        const mm = c ? Number(c) : spacingDefault();
        if (c && (!isNumber(c) || !(mm > 0))) { cad.say(`TALIGN  Type the gap on paper in mm <${spacingDefault()}>:`); return; }
        changeTexts('TALIGN', spaced(texts, mm * unitsPerPaperMm(anno, units.factor)), `spaced ${mm} mm apart on paper`); return;
      }
      if (tAsk) { cad.say('TALIGN  Click the text to line up with, or a point:'); return; }
      const mode = ({ L: 'left', R: 'right', C: 'centre', T: 'top', B: 'bottom', S: 'spacing' } as Record<string, AlignMode | 'spacing'>)[c || 'L'];
      if (!mode) { cad.say(`TALIGN  "${c}" is not an edge. ${TALIGN_PROMPT}`); return; }
      if (mode === 'spacing') { setTAsk({ mode, step: 'gap' }); cad.say(`TALIGN  Gap between texts on paper (mm) <${spacingDefault()}>:`); return; }
      setTAsk({ mode, step: 'ref' }); cad.say(`TALIGN  ${mode[0].toUpperCase()}${mode.slice(1)}: click the text to line up with, or a point:`); return;
    }
    if (tool === 'tframe') {
      const f = parseFrame(c || 'C');
      if (!f) { cad.say(`TFRAME  "${c}" is not a frame. ${TFRAME_PROMPT}`); return; }
      changeTexts('TFRAME', texts.map((it) => { const { frame: _f, ...rest } = it; return f === 'none' ? rest : { ...rest, frame: f }; }), f === 'none' ? 'without a frame' : `framed with a ${f}`); return;
    }
    if (tool === 'tmask') {
      if (c && c !== 'Y' && c !== 'N') { cad.say(`TMASK  Yes or No. ${TMASK_PROMPT}`); return; }
      const on = c !== 'N';
      changeTexts('TMASK', texts.map((it) => { const { mask: _m, ...rest } = it; return on ? { ...rest, mask: true } : rest; }), on ? 'masked' : 'unmasked'); return;
    }
    if (tool === 'tcen' || tool === 'tcopy') { cad.say(textToolPrompt(tool)); return; }
    const sized = pickedSk.filter((it) => it.kind === 'text' || it.kind === 'dim');
    const mm = c ? Number(c) : sized[0]?.h ? Math.round((sized[0].h / unitsPerPaperMm(anno, units.factor)) * 100) / 100 : anno.textMm;
    if (c && (!isNumber(c) || !(mm > 0))) { cad.say(`TXTHEIGHT  Type the height on paper in mm. ${textToolPrompt(tool)}`); return; }
    if (!sized.length) { change({ ...project, cadAnno: { ...anno, textMm: mm } }, `TXTHEIGHT  New text ${mm} mm on paper at 1:${anno.scale} · ⌘Z to undo`); cad.setTool('none'); return; }
    const h = textUnits({ ...anno, textMm: mm }, units.factor);
    let next = project;
    for (const it of sized) next = updateSketch(next, fileOf(), withTextHeight(it, h));
    change(next, `TXTHEIGHT  ${sized.length} object${sized.length === 1 ? '' : 's'} ${mm} mm on paper at 1:${anno.scale}${left(pickedSk.length - sized.length)} · ⌘Z to undo`);
    cad.setTool('none');
  }

  /** What is typed at TCOUNT's prompts: the prefix and suffix as typed (Enter: none), the start (its leading zeros
   * kept as digits) and step; then at Place, S renumbers the texts picked (or asks for them), U takes the last one
   * placed back, Enter ends. */
  function tcountInput(text: string, c: string) {
    if (!tc) return;
    const say = (s: string) => cad.say(s);
    if (tc.step === 'prefix') { setTc({ ...tc, step: 'start', prefix: text.trim() ? text : '' }); say('TCOUNT  Start number <1>:'); return; }
    if (tc.step === 'start') {
      if (c && !/^\d+$/.test(c)) { say('TCOUNT  A whole number. Start number <1>:'); return; }
      setTc({ ...tc, step: 'step', n: c ? Number(c) : 1, pad: padOf(c) }); say('TCOUNT  Step <1>:'); return;
    }
    if (tc.step === 'step') {
      if (c && !/^-?\d+$/.test(c)) { say('TCOUNT  A whole number. Step <1>:'); return; }
      setTc({ ...tc, step: 'suffix', inc: c ? Number(c) : 1 }); say('TCOUNT  Suffix <>:'); return;
    }
    if (tc.step === 'suffix') { setTc({ ...tc, step: 'place', suffix: text.trim() ? text : '' }); say(`${TCOUNT_PLACE.replace(':', '')} — next "${numberText(tc.prefix, tc.n, tc.pad, text.trim() ? text : '')}":`); return; }
    const texts = pickedSk.filter((it) => it.kind === 'text');
    if (tc.step === 'pick' || c === 'S') {
      if (!texts.length) { setTc({ ...tc, step: 'pick' }); say(c === 'S' ? 'TCOUNT  Click the texts to renumber, in order, then Enter:' : 'TCOUNT  Pick the texts first.'); return; }
      if (c && c !== 'S') { say('TCOUNT  Enter renumbers the texts picked, Esc cancels.'); return; }
      let next = project, n = tc.n;
      for (const it of texts) { next = updateSketch(next, fileOf(), { ...it, text: numberText(tc.prefix, n, tc.pad, tc.suffix) }); n += tc.inc; }
      change(next, `TCOUNT  ${texts.length} text${texts.length === 1 ? '' : 's'} renumbered from ${numberText(tc.prefix, tc.n, tc.pad, tc.suffix)} · ⌘Z to undo`);
      cad.setTool('none'); return;
    }
    if (c === 'U') {
      const last = tc.placed[tc.placed.length - 1];
      if (!last) { say('TCOUNT  Nothing placed yet.'); return; }
      change(removeSketch(project, fileOf(), last), 'TCOUNT  Last text taken back · ⌘Z to undo');
      setTc({ ...tc, n: tc.n - tc.inc, placed: tc.placed.slice(0, -1) }); say(TCOUNT_PLACE); return;
    }
    if (!c) { cad.setTool('none'); return; }
    const p = typedPoint(text, undefined, cursor.at);
    if (p) { click(p, 1e-9); return; }
    say(TCOUNT_PLACE);
  }
  /** KEYNOTE: the hexagon bubble at its point and its line in the legend (the title too when the legend starts), one
   * undo step; then the next number is asked. */
  function addKeynote(n: number, at: Pt, note: string, legendAt?: Pt) {
    if (!view) return;
    const items = keynoteItems(n, at, note, textH, ANNO_LAYER, sketch, legendAt);
    const next = items.reduce((q, x) => addSketch(q, view.file, x).project, project);
    change(next, `KEYNOTE  ${n} "${note}"${items.length > 2 ? ' · legend started' : ''} · ⌘Z to undo`);
    const nn = n + 1;
    setKn({ step: 'number', n: nn }); cad.say(`KEYNOTE  Number <${nn}>:`);
  }

  /** ROOMTAGALL: a room tag (name and area at the centre) for every room of the level with an outline, or only those
   * with no tag yet, as one undo step. */
  function tagAllRooms(all: boolean) {
    if (!floor || !view) { cad.say('ROOMTAGALL  Open a level\'s plan first (Plans).'); cad.setTool('none'); return; }
    const rooms = buildingInfoOf(project).rooms.filter((r) => r.buildingId === floor.ref.building && r.levelId === floor.ref.level && (r.outline?.length ?? 0) >= 3);
    const todo = all ? rooms : untaggedRooms(rooms, sketch, units.factor, inside);
    if (!todo.length) { cad.say(rooms.length ? 'ROOMTAGALL  Every room of the level is tagged.' : 'ROOMTAGALL  No room with an outline on this level: add them first (Room area, Trace or Rooms).'); cad.setTool('none'); return; }
    let next = project;
    for (const r of todo) for (const it of roomTagItems(r.name, r.areaM2, centreOf(r.outline!.map(([x, y]): Pt => [x / units.factor, y / units.factor])), textH)) next = addSketch(next, view.file, it).project;
    change(next, `ROOMTAGALL  ${todo.length} room tag${todo.length === 1 ? '' : 's'} · ⌘Z to undo`);
    cad.setTool('none');
  }

  /** Esc: the step, then the tool, then what is picked (the history or command list, and a menu, close first). */
  function cancel() {
    setCmd(''); input.current?.blur(); setPromptMenu(null);
    if (tool === 'hatchedit' && hePhase) { setHePhase(null); cad.say('*Cancel*'); cad.say(hatchEditSay(null, heIds.length)); return; }
    if (edNote) { setEdNote(null); cad.say('*Cancel*'); if (tool === 'mtext') cad.setTool('none'); }
    else if (points.length || objectMode || cad.textAt || mtAsk) { setPoints([]); setObjectMode(false); cad.setTextAt(null); setTextAsk(null); setEdAsk(null); setMtAsk(null); cad.say('*Cancel*'); }
    else if (edStep || edAsk === 'radius' || edAsk === 'd1' || edAsk === 'd2') { setEdStep(null); setEdAsk(null); cad.say('*Cancel*'); cad.say(tool === 'offset' ? PROMPT.offset : editPrompt(tool, edSet)); }
    else if (menuAt) setMenuAt(null); else if (renaming || roomAsk || findAsk || beClose || reClose) { setRenaming(null); setRoomAsk(null); setFindAsk(null); setBeClose(false); setReClose(false); cad.say('*Cancel*'); } else if (tool !== 'none') cad.setTool('none'); else { setResult(null); cad.setSelected(null); setPicked([]); }
  }
  /** What Space does in the command line: types a space in text (a name, TEXT contents, a leader's text); at TEXT's
   * height and rotation, where a word is the text, ends only an empty input or a number; else ends a whole word. */
  const spaceMode: SpaceMode = renaming || renamingLayout || roomAsk || findAsk || (tool === 'text' && cad.textAt && !textAsk?.step) || (tool === 'leader' && points.length >= 2) || ((tool === 'tprefix' || tool === 'tsuffix') && edPhase === 'points')
    || (tool === 'tcount' && (tc?.step === 'prefix' || tc?.step === 'suffix')) || (tool === 'keynote' && kn?.step === 'text') ? 'text'
    : tool === 'text' && cad.textAt ? 'value' : 'command';
  /** Numbers typed go to the command line (or the box at the cursor) rather than the view's keys (0 fits, − zooms out):
   * while a tool is running or something is typed there. */
  const valuesTyped = tool !== 'none' || cmd !== '';
  // Space tapped on the drawing works as Enter when it is let go, unless it was held to pan (the mouse pressed while
  // it was down) or long enough to repeat.
  const spaceTap = useRef<{ dragged: boolean; repeated: boolean } | null>(null);

  // CAD keys while this page shows: function keys toggle, typing goes to the command line, Enter or Space ends the step
  // (with no tool, repeats the last command), Esc cancels the command (and the tool), F2 the taller history, F1 the
  // command list.
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
    const mods = e.metaKey || e.ctrlKey || e.altKey;
    const fn: Record<string, keyof CadToggles> = { F3: 'osnap', F7: 'grid', F8: 'ortho', F9: 'snap', F10: 'polar', F11: 'otrack', F12: 'dyn' };
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key === '1') { e.preventDefault(); setShowProps((v) => !v); return; }
    if (fn[e.key]) { e.preventDefault(); if (fn[e.key] === 'grid') cad.cycleGrid(); else cad.toggle(fn[e.key]); return; }
    // Keys in a dialog over the page (the layer manager, references…) are the dialog's.
    if (e.defaultPrevented || (e.target instanceof Element && e.target.closest('[aria-modal="true"], [role="dialog"]'))) return;
    if ((e.key === 'F1' || e.key === 'F2') && !mods && !e.shiftKey && (!typing || e.target === input.current)) { e.preventDefault(); const k = e.key === 'F1' ? 'help' : 'history'; setLog(log === k ? null : k); return; }
    if (e.key === 'Escape' && (!typing || e.target === input.current)) {
      if (log) { setLog(null); return; }
      if (promptMenu) { setPromptMenu(null); return; }
      if (paperCtx) { setPaperCtx(null); return; }
      cancel();
      return;
    }
    // Ctrl/⌘+C, Ctrl/⌘+Shift+C and Ctrl/⌘+V: the clipboard of drawn objects (a field keeps its own; with nothing
    // picked Ctrl+C leaves the page's text selection to copy).
    const ck = e.key.toLowerCase();
    // Ctrl/⌘+A: SELECTALL (a field keeps its own).
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && !typing && ck === 'a' && view && !(e.target instanceof Element && e.target.closest('[contenteditable="true"]'))) { e.preventDefault(); if (!e.repeat) run('SELECTALL'); return; }
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !typing && (ck === 'c' || ck === 'v' || ck === 'x') && !(e.target instanceof Element && e.target.closest('[contenteditable="true"]'))) {
      if ((ck === 'c' || ck === 'x') && !pickedSk.length && !pickedItems.length) return;
      e.preventDefault();
      if (e.repeat) return;
      if (ck === 'v') { cad.say('Command: PASTECLIP'); pasteClip(false); }
      else if (ck === 'x') { cad.say('Command: CUTCLIP'); cutClip(); }
      else if (e.shiftKey) { cad.say('Command: COPYBASE'); if (!clipRefusal('COPYBASE')) cad.setTool('copybase'); }
      else { cad.say('Command: COPYCLIP'); copyClip(); }
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && (selectedItem || selSketch || many || pickedDw.length)) { e.preventDefault(); removeSelected(); return; }
    // Enter or Space on the drawing (not on a button, a field or a palette) works as Enter on the empty command line:
    // Enter at once, Space when it is let go (see spaceTap); once per press.
    const onControl = e.target instanceof Element && !!e.target.closest('button, a, [role="tab"], [role="menuitem"], [contenteditable="true"], .cad-lpal, .cad-ppal');
    if (e.key === ' ' && spaceMode !== 'text' && !typing && !onControl && !mods) {
      e.preventDefault();
      if (!e.repeat) spaceTap.current = { dragged: false, repeated: false }; else if (spaceTap.current) spaceTap.current.repeated = true;
      return;
    }
    if (e.key === 'Enter' && !typing && !onControl && !mods) { e.preventDefault(); if (!e.repeat) run(''); return; }
    // A number (0 too: it fits the view only with no tool and nothing typed), a point or a minus goes to the first box
    // at the cursor (dynamic input), else to the command line, while a tool is running or something is typed there.
    if (!typing && !mods && /^[0-9.,-]$/.test(e.key) && valuesTyped) { (dynBoxes.length ? dynRefs[0] : input).current?.focus(); return; }
    if (!typing && !mods && /^[a-zA-Z?@]$/.test(e.key)) input.current?.focus();
  };
  const keyUpRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyUpRef.current = (e: KeyboardEvent) => {
    if (e.key !== ' ') return;
    const tap = spaceTap.current;
    spaceTap.current = null;
    if (tap && !tap.dragged && !tap.repeated) run('');
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => keyRef.current(e);
    const up = (e: KeyboardEvent) => keyUpRef.current(e);
    // A press of the mouse while Space is down pans: then Space is not Enter.
    const press = () => { if (spaceTap.current) spaceTap.current.dragged = true; };
    const blur = () => { spaceTap.current = null; };
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', up);
    window.addEventListener('mousedown', press, true);
    window.addEventListener('pointerdown', press, true);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', key); window.removeEventListener('keyup', up);
      window.removeEventListener('mousedown', press, true); window.removeEventListener('pointerdown', press, true); window.removeEventListener('blur', blur);
    };
  }, []);

  // The object being drawn (or moved / copied / rotated), following the cursor.
  const cur = cursor.at;
  const lastPt = points[points.length - 1];
  const preview: SketchItem[] = !cur ? [] : (() => {
    const base = { id: '_', layer: '' };
    if (tool === 'insert' && insBlock) return expandInsert({ id: '_', kind: 'insert', layer: curLayer, pts: [cur], block: insBlock.name, sc: insSet.scale, rot: (insSet.rot * Math.PI) / 180 }, blockDefOf(defs, insBlock.name) ? defs : [...defs, insBlock]).map((it) => ({ ...it, id: '_' }));
    if (tool === 'line' && lastPt) return [{ ...base, kind: 'line', pts: [lastPt, cur] }];
    if (tool === 'leader' && points.length) return [{ ...base, kind: 'line', pts: [...points, cur] }];
    if (tool === 'pline' && points.length) return [{ ...base, kind: 'line', pts: [...points, cur] }];
    if (tool === 'cable' && points.length) return [{ ...base, kind: 'line', pts: [...points, cur] }];
    if (tool === 'tray' && points.length) return [{ ...base, kind: 'pline', pts: [...points, cur], tray: { widthMm: cad.tray.widthMm, service: cad.tray.service } }];
    if (tool === 'em' && emSet.mode === 'route' && points.length) return [{ ...base, kind: 'line', pts: [...points, cur] }];
    if (tool === 'rect' && lastPt) return [{ ...base, kind: 'pline', pts: rectangle(lastPt, cur), closed: true }];
    if (tool === 'mtext' && lastPt && !edNote) return [{ ...base, kind: 'pline', pts: rectangle(lastPt, cur), closed: true }];
    if (tool === 'zoomwin' && lastPt) return [{ ...base, kind: 'pline', pts: rectangle(lastPt, cur), closed: true }];
    if ((tool === 'dimrad' || tool === 'dimdia') && radPick) return [{ ...base, ...radialItem(radPick, cur, tool === 'dimrad' ? 'radius' : 'diameter') }];
    if (tool === 'dimang' && angPick) {
      if (angPick.v && angPick.p1 && angPick.p2) return [{ ...base, ...dimItem([angPick.v, angPick.p1, angPick.p2, cur], 'angular') }];
      if (angPick.v) return [{ ...base, kind: 'line', pts: [angPick.v, cur] }];
    }
    if (tool === 'circle' && lastPt) return [{ ...base, kind: 'circle', pts: [lastPt], r: distance(lastPt, cur) }];
    if (tool === 'arc' && points.length === 1) return [{ ...base, kind: 'line', pts: [points[0], cur] }];
    if (tool === 'arc' && points.length === 2) { const a = arcThrough(points[0], points[1], cur); return a ? [{ ...base, ...a } as SketchItem] : []; }
    if (tool === 'circle2p' && lastPt) { const q = circle2P(lastPt, cur); return [{ ...base, kind: 'circle', pts: [q.c], r: q.r }]; }
    if (tool === 'circled' && lastPt) return [{ ...base, kind: 'circle', pts: [lastPt], r: distance(lastPt, cur) / 2 }];
    if (tool === 'circle3p' && points.length === 1) return [{ ...base, kind: 'line', pts: [points[0], cur] }];
    if (tool === 'circle3p' && points.length === 2) { const q = circleThrough(points[0], points[1], cur); return q ? [{ ...base, kind: 'circle', pts: [q.c], r: q.r }] : []; }
    if (tool === 'arcsce' && points.length === 1) return [{ ...base, kind: 'line', pts: [points[0], cur] }];
    if (tool === 'arcsce' && points.length === 2) { const a = arcStartCentreEnd(points[0], points[1], cur); return a ? [{ ...base, ...a } as SketchItem] : []; }
    if (tool === 'polygon' && lastPt && distance(lastPt, cur) > 0) return [{ ...base, kind: 'pline', pts: polygonPts(lastPt, cur, polySides, polyIn), closed: true }];
    if (tool === 'ellipse' && points.length === 1) return [{ ...base, kind: 'line', pts: [points[0], cur] }];
    if (tool === 'ellipse' && points.length === 2) {
      const [a, b] = points, e = ellAxis ? ellipseOf([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], b, cur) : ellipseOf(a, b, cur);
      return e ? [{ ...base, ...e } as SketchItem] : [{ ...base, kind: 'line', pts: [a, b] }];
    }
    if (tool === 'revcloud' && cloudPoly && points.length) return [{ ...base, kind: 'line', pts: [...points, cur] }];
    if (tool === 'revcloud' && lastPt) { const o = rectangle(lastPt, cur); return areaOf(o).area > 0 ? [{ ...base, kind: 'pline', pts: o, closed: true, cloud: cloudArc ?? 15 * unitsPerPaperMm(anno, units.factor) }] : []; }
    if (tool === 'dim' && points.length === 1) return [{ ...base, kind: 'line', pts: [points[0], cur] }];
    if (tool === 'dim' && points.length === 2) { const look = dimLookOf(project, units.factor)?.look; return [{ ...base, kind: 'dim', pts: [points[0], points[1], cur], ...(look ? { look } : {}) }]; }
    if (tool === 'dimlin' && points.length === 1) return [{ ...base, kind: 'line', pts: [points[0], cur] }];
    if (tool === 'dimlin' && points.length === 2) { const look = dimLookOf(project, units.factor)?.look; return [{ ...base, kind: 'dim', pts: [points[0], points[1], cur], dir: linearDir(points[0], points[1], cur), ...(look ? { look } : {}) }]; }
    if ((tool === 'dimcont' || tool === 'dimbase') && lastDim) { const n = chainDim(lastDim, cur); return n ? [{ ...n, id: '_' }] : []; }
    if ((tool === 'move' || tool === 'copy') && lastPt && selSketch) return [moved(selSketch, cur[0] - lastPt[0], cur[1] - lastPt[1])];
    if ((tool === 'move' || tool === 'copy') && lastPt) return [{ ...base, kind: 'line', pts: [lastPt, cur] }];
    if (tool === 'rotate' && lastPt && selSketch) return [rotated(selSketch, lastPt, Math.atan2(cur[1] - lastPt[1], cur[0] - lastPt[0]))];
    if (tool === 'paste' && pasting && view) return pastedItems(pasting, view.file, unitCode, cur).items.slice(0, 2000).map((x, i) => ({ ...x, id: `_${i}` }) as SketchItem);
    return [];
  })();
  const liveLabel = cur && lastPt && ['line', 'pline', 'tray', 'cable', 'dim', 'dimlin', 'move', 'copy'].includes(tool) ? `${m(toM(distance(lastPt, cur)))}  ${angleDeg(lastPt, cur).toFixed(1)}°`
    : cur && lastPt && tool === 'circle' ? `R ${m(toM(distance(lastPt, cur)))}` : undefined;
  // Dynamic input (DYN, F12): length and angle while a point is asked for after a first one, a radius for a circle,
  // else the distance, radius or factor of Offset, Fillet and Scale; and the prompt in short form with its options.
  const dynOn = !!cad.toggles.dyn && tool !== 'none' && !!cur && spaceMode !== 'text';
  const dynBoxes: DynBox[] = !dynOn || !cur || !draft.dynBoxes ? []
    : lastPt && POINT_TOOLS.includes(tool) ? [{ label: 'Length', live: fmtFixed(toM(distance(lastPt, cur)), 2), unit: 'm' }, { label: 'Angle', live: angleDeg(lastPt, cur).toFixed(1), unit: '°' }]
    : lastPt && tool === 'circle' ? [{ label: 'Radius', live: fmtFixed(toM(distance(lastPt, cur)), 2), unit: 'm' }]
    : tool === 'offset' && !edStep ? [{ label: 'Distance', live: edSet.through ? 'Through' : f2(edSet.offset), unit: 'm' }]
    : tool === 'fillet' && !edStep && !edAsk ? [{ label: 'Radius', live: f2(edSet.radius), unit: 'm' }]
    : tool === 'scale' && edAsk === 'factor' ? [{ label: 'Factor', live: edSet.factor, unit: '×' }] : [];
  const dynLine = cad.history[cad.history.length - 1] ?? '';
  const dynOptions = dynOn && draft.dynOptions ? promptOptions(dynLine) : [];
  const marks: CadMarks | null = DRAW_TOOLS.includes(tool) && lastPt ? { points: [lastPt], live: true, label: dynBoxes.length ? undefined : liveLabel }
    : result?.kind === 'dist' ? { points: [result.a, result.b], label: m(toM(distance(result.a, result.b))) }
    : result?.kind === 'area' && result.how !== 'object' ? { points: result.points, closed: true, label: m2(toM2(areaOf(result.points).area)) }
    : points.length ? (() => {
      const live = cursor.at ? [...points, cursor.at] : points;
      const corners = tool === 'area' || tool === 'trace';
      const label = tool === 'dist' && live.length === 2 ? m(toM(distance(live[0], live[1]))) : corners && live.length >= 3 ? m2(toM2(areaOf(live).area)) : undefined;
      return { points, live: true, area: corners, label };
    })()
    : tool === 'dist' || tool === 'area' || tool === 'trace' ? { points: [], live: false } : null;
  useEffect(() => { setDynVals([]); setDynMenu(null); }, [tool, points.length, edStep, edAsk]);
  /** Enter in a box at the cursor: the point at the length and angle typed (the cursor's where not typed), as a typed
   * @length<angle; the circle's radius; or the distance, radius or factor, as typed on the command line. */
  function dynEnter() {
    const [a = '', b = ''] = dynVals.map((v) => v.trim());
    setDynVals([]); dynRefs.forEach((r) => r.current?.blur());
    if (!cur || (!a && !b)) { run(''); return; }
    const label = dynBoxes[0]?.label;
    // A point typed in a box ("x,y", "@dx,dy", "@d<angle") works as on the command line, in drawing units.
    if (/[,<@]/.test(a)) {
      const p = label === 'Length' || label === 'Radius' ? typedPoint(a, lastPt, cur) : undefined;
      if (p) { cad.say(`  ${a}`); void click(p, 1e-9); }
      else cad.say(label === 'Length' || label === 'Radius' ? `  ${a}: type a point as x,y, @dx,dy or @distance<angle (drawing units), or a length in metres.` : `${tool.toUpperCase()}  Type the ${label?.toLowerCase() ?? 'value'} as a number.`);
      return;
    }
    if (label === 'Length' && lastPt) {
      if ((a && !isNumber(a)) || (b && !isNumber(b))) { cad.say('Type a length in metres and an angle in degrees.'); return; }
      const d = a ? Number(a) / units.factor : distance(lastPt, cur), deg = b ? Number(b) : angleDeg(lastPt, cur);
      cad.say(`  ${fmtFixed(d * units.factor, 2)} m < ${fmtFixed(deg, 1)}°`);
      void click([lastPt[0] + d * Math.cos((deg * Math.PI) / 180), lastPt[1] + d * Math.sin((deg * Math.PI) / 180)], 1e-9);
      return;
    }
    if (label === 'Radius' && tool === 'circle') { const r = isNumber(a) ? Number(a) / units.factor : NaN; if (r > 0) finishCircle(r); else cad.say('CIRCLE  Type a radius above 0 (metres).'); return; }
    run(a);
  }
  /** Keys while the options under the prompt box are open: arrows move, Enter takes one, Esc closes. */
  function dynKey(e: { key: string; preventDefault: () => void }): boolean {
    if (dynMenu === null) return false;
    const n = dynOptions.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setDynMenu((dynMenu + (e.key === 'ArrowDown' ? 1 : n - 1)) % n); return true; }
    if (e.key === 'Enter') { e.preventDefault(); const o = dynOptions[dynMenu]; setDynMenu(null); if (o) run(o.key); return true; }
    if (e.key === 'Escape') { e.preventDefault(); setDynMenu(null); return true; }
    return false;
  }
  const highlight = dwHighlight;
  const objectArea = result?.kind === 'area' && result.how === 'object';

  /** The drawing: on the Model tab, or inside the viewport worked in on a layout (fitted to its window). */
  const drawCanvas = (vpProps?: Pick<React.ComponentProps<typeof CadCanvas>, 'fitBox' | 'fixed' | 'onView'>) => (
            <CadCanvas view={view!} fadeExcept={reWork} draft={snapDraft} cursorMode={cursorMode} hover={hover} panLeft={tool === 'pan'} pointStyle={pointStyleOf(project)} blocks={defs} onDrop={dropBlock} hidden={hidden} layersOn={layersOn} extents={fitExtents} toggles={snapToggles} gridDots={cad.gridDots} fitKey={cad.fitKey} onCursor={(at, snap, pixel) => setCursor({ at, snap, pixel })} onClick={click} marks={objectArea ? { points: result.points, closed: true } : marks} highlight={highlight} devices={devices} wiring={canvasWiring} sketch={sketch} selectedSketch={pickedSk.map((it) => it.id)} extraSnaps={snapExtra} preview={[...preview, ...emRoutes, ...(gripIdx !== null && selSketch && cursor.at ? [gripMoved(selSketch, gripIdx, cursor.at)] : []), ...(arlLine.length === 2 ? [{ id: '_arl', layer: '', kind: 'line' as const, pts: arlLine }] : [])]} unitsPerMm={0.001 / units.factor} labels={cableLabels} covers={elv?.covers} gaps={elv?.gaps}
              numbersTyped={valuesTyped} layerStyle={styles} refs={xr.placed} refSnap={snapRef} windowSelect={tool === 'none' || tool === 'stretch' || tool === 'zoomwin' || tool === 'selsim' || (PICK_FIRST.includes(tool) && edPhase === 'pick') || (tool === 'tcount' && tc?.step === 'pick')} onWindow={pickWindow} onContext={contextAt} onDouble={doubleClick} zoom={zoomReq} onZoomMenu={zoomMenu}
              grips={draft.grips && tool === 'none' && selSketch && !many ? gripsOf(selSketch).map((g) => g.at) : []} onGripStart={setGripIdx}
              onGripEnd={(i, at, moved) => {
                setGripIdx(null);
                if (i < 0 || !selSketch) return;
                // Clicked, not dragged: the grip is hot (its right-click menu, phase 4).
                if (moved === false) { setHotGrip(i); cad.say('GRIP  Hot grip: drag it, or right-click for its menu (Move, Copy, Rotate from it; vertices).'); return; }
                setHotGrip(null);
                const next = gripMoved(selSketch, i, at);
                change(updateSketch(project, fileOf(), next), `GRIP  ${kindOf(selSketch)} ${gripsOf(selSketch)[i]?.kind === 'mid' ? 'side moved' : 'changed'}${isPath(next) ? ` — now ${m(toM(next.pts.slice(1).reduce((t, q, k) => t + distance(next.pts[k], q), 0)))}` : ''} · ⌘Z to undo`);
              }}
              overlay={(toScreen, moving) => {
                if (edNote) {
                  // The note's editor over its box: its top left corner, width, letter and line heights on the screen, at its angle.
                  const d = edNote.draft, b = noteBox(d), o = toScreen(b.tl), e = toScreen([b.tl[0] + b.w * b.u[0], b.tl[1] + b.w * b.u[1]]), up = toScreen([b.tl[0] - b.h * b.v[0], b.tl[1] - b.h * b.v[1]]);
                  const px = Math.hypot(up[0] - o[0], up[1] - o[1]), perMm = tb ? 1 : unitsPerPaperMm(anno, units.factor);
                  return <CadNoteEdit key={edNote.id ?? 'new'} left={o[0]} top={o[1]} w={Math.hypot(e[0] - o[0], e[1] - o[1])} h={px} lineH={(px * b.lineH) / b.h} rot={d.rot ?? 0} note={d.note ?? []}
                    heightMm={Math.round((b.h / perMm) * 100) / 100} attach={attachOf(d)} unitsPerPx={b.h / Math.max(px, 1e-9)}
                    onHeightMm={(v) => setEdNote({ ...edNote, draft: { ...d, h: v * perMm } })} onAttach={(j) => setEdNote({ ...edNote, draft: noteAttached(d, j) })} onWidth={(wu) => setEdNote({ ...edNote, draft: noteWithWidth(d, wu) })}
                    onCommit={(paras) => endNoteEdit(true, paras)} onCancel={() => endNoteEdit(false)} />;
                }
                const edIt = edText ? sketch.find((x) => x.id === edText.id) : undefined;
                if (edText && edIt) {
                  // The box over the text: at the left end of its baseline, as high and wide as the text on the screen, at
                  // its angle (a dimension's text sits centred on its baseline point).
                  const b = edIt.kind === 'text' ? { ...textBox(edIt), rot: edIt.rot ?? 0 } : (() => {
                    const d = dimOf(edIt, units.factor), w = textWidth(d.label, d.h);
                    return { origin: [d.text[0] - (w / 2) * Math.cos(d.angle), d.text[1] - (w / 2) * Math.sin(d.angle)] as Pt, w, h: d.h, rot: d.angle };
                  })();
                  const o = toScreen(b.origin), e = toScreen([b.origin[0] + b.w * Math.cos(b.rot), b.origin[1] + b.w * Math.sin(b.rot)]), u = toScreen([b.origin[0] - b.h * Math.sin(b.rot), b.origin[1] + b.h * Math.cos(b.rot)]);
                  return <CadTextEdit left={o[0]} top={o[1]} w={Math.hypot(e[0] - o[0], e[1] - o[1])} h={Math.hypot(u[0] - o[0], u[1] - o[1])} rot={b.rot} value={edText.value}
                    onChange={(v) => setEdText({ ...edText, value: v })} onCommit={() => endTextEdit(true)} onCancel={() => endTextEdit(false)} />;
                }
                const dyn = dynOn && cur && !moving && !promptMenu ? (() => {
                  const [x, y] = toScreen(cur);
                  return <CadDynInput left={x + 16} top={y + 16} boxes={dynBoxes} vals={dynVals} refs={dynRefs} prompt={draft.dynPrompt ? shortPrompt(dynLine) : ''} options={dynOptions} menu={dynMenu !== null} hi={dynMenu ?? 0}
                    onVals={setDynVals} onPick={(k) => { setDynMenu(null); run(k); }} onBlur={() => setDynMenu(null)}
                    onKey={(e, i) => {
                      if (dynKey(e)) return;
                      // Enter, or Space after a whole value (not inside a point being typed), once per press.
                      if (e.key === 'Enter' || (e.key === ' ' && spaceEnters(dynVals[i] ?? ''))) { e.preventDefault(); if (!e.repeat) dynEnter(); }
                      else if (e.key === 'Tab' && dynBoxes.length > 1) { e.preventDefault(); dynRefs[(i + 1) % dynBoxes.length].current?.focus(); }
                      else if (e.key === 'ArrowDown' && dynOptions.length) { e.preventDefault(); setDynMenu(0); }
                      else if (e.key === 'Escape') { e.preventDefault(); const typedAny = dynVals.some((v) => v); setDynVals([]); e.currentTarget.blur(); if (!typedAny) cancel(); }
                      else if (/^[a-zA-Z@]$/.test(e.key) && !e.metaKey && !e.ctrlKey) input.current?.focus();
                    }} />;
                })() : null;
                if (promptMenu && !moving) return <CadPromptMenu left={promptMenu.at[0] + 4} top={promptMenu.at[1] + 4} items={promptMenu.items} onPick={ctxPick} />;
                if (tool !== 'none' || moving || gripIdx !== null || (!pickedItems.length && !pickedSk.length)) return dyn;
                if (!pickedSk.length && (!floor || !cad.showDevices)) return null;
                const skPts = pickedSk.flatMap((it) => { const sg = segmentsOf(it, 0.001, defs); return sg.length ? sg.flat() : it.pts; });
                const xs = [...pickedItems.map((d) => d.x / units.factor), ...skPts.map((q) => q[0])], ys = [...pickedItems.map((d) => d.y / units.factor), ...skPts.map((q) => q[1])], pad = rUnits * 2;
                const [l, t] = toScreen([Math.min(...xs) - pad, Math.max(...ys) + pad]), [, b] = toScreen([0, Math.min(...ys) - pad]);
                const at = menuAt ? { left: menuAt[0] + 4, top: menuAt[1] + 4, place: 'menu' as const } : t < 60 ? { left: Math.max(4, l), top: b + 8, place: 'below' as const } : { left: Math.max(4, l), top: t - 8, place: 'above' as const };
                if (pickedSk.length) {
                  const one = pickedSk.length === 1 && !pickedItems.length && isPath(pickedSk[0]) ? pickedSk[0] : undefined;
                  return <SketchToolbar key={[...pickedKeys].join()} items={pickedSk} devices={pickedItems.length} canShow={!!onShow} blocks={defs.map((d) => d.name)} dimStyles={dimStylesOf(project).styles.map((x) => x.name)} repeat={recent[0]?.label} lengthM={one ? toM(pathLength(one.pts)) : undefined} {...at} canPaste={hasClip()} withAtts={(it) => attdefsOf(blockDefOf(defs, it.block)).length > 0} onEdit={editSketch} />;
                }
                return <DeviceToolbar key={[...pickedKeys].join()} project={project} items={pickedItems} edits={editsFor(project, pickedItems)} circuits={circuits} {...at} onEdit={editDevices} />;
              }} {...vpProps} />
  );

  // The properties dock (Ctrl/Cmd+1 folds it): in place of the Panels list, on the left (or the right, ⇄), as wide as
  // dragged. Only what is picked: its properties and details. The drawing column (`info`) stands on the other side.
  // What is picked, named in the dock's header.
  const pickedName = many ? `${pickedSk.length + pickedItems.length} picked`
    : selSketch ? kindOf(selSketch)
    : result?.kind === 'device' ? result.it.label
    : result?.kind === 'object' ? `${result.o.kind}${result.o.block ? ` · ${result.o.block}` : ''}` : '';
  const dockCol = showProps ? `${dockState.w}px` : '26px';
  const workColumns = [dockSide === 'left' ? dockCol : '260px', showLM && view ? '420px' : '', cad.showBlocks && view ? '300px' : '', 'minmax(0,1fr)', dockSide === 'right' ? dockCol : '260px'].filter(Boolean).join(' ');
  const dock = !showProps ? (
    <aside className="cad-dock folded" aria-label="Properties (folded)">
      <button type="button" aria-label="Show the properties palette" title="Properties (Ctrl/Cmd+1)" onClick={() => setShowProps(true)}>{dockSide === 'left' ? '»' : '«'}<b>Properties</b></button>
    </aside>
  ) : (
    <aside className={`cad-side cad-dock ${dockSide}`} aria-label="Properties">
      <div className="cad-dock-h">
        <b>Properties</b><span className="m">{pickedName || (view ? 'No selection' : '')}</span><span className="sp" />
        <button type="button" title="Layer palette (LM)" disabled={!view} onClick={() => setShowLM((v) => !v)}>Layers</button>
        <button type="button" aria-label={`Dock on the ${dockSide === 'left' ? 'right' : 'left'}`} title={`Dock on the ${dockSide === 'left' ? 'right' : 'left'}`} onClick={() => setDock({ side: dockSide === 'left' ? 'right' : 'left' })}>⇄</button>
        <button type="button" aria-label="Fold the properties palette" title="Fold (Ctrl/Cmd+1)" onClick={() => setShowProps(false)}>{dockSide === 'left' ? '«' : '»'}</button>
      </div>
      <div className="cad-dock-b">
            {sheetL && selT && <TablePanel sheet={sheetL} table={selT} labels={legendLabels} onChange={(patch, what) => setTables((l) => patchTable(l, selT.id, patch), `${tableName(tables, selT.id)}: ${what}`)}
            onDelete={() => { setTables((l) => l.filter((x) => x.id !== selT.id), `${tableName(tables, selT.id)} deleted`); cad.setVpSel(null); }} />}
            {sheetL && selV && <ViewportPanel project={project} sheet={sheetL} vp={selV} refs={xr.refs.map((r) => r.name)} onChange={(patch, what) => patchVp(selV, patch, what)}
            onDelete={() => { setVps((l) => l.filter((x) => x.id !== selV.id), `${vpName(vps, selV.id)} deleted${vps.length === 1 ? ' (the layout shows the level as worked out again)' : ''}`); cad.setVpSel(null); cad.setMsVp(null); }}
            onLayers={() => setShowLM(true)} />}
          {view && (pickedSk.length > 0 || !pickedName) && <PropertiesPalette blocks={defs} key={pickedSk.map((it) => it.id).join()} items={pickedSk} devices={pickedItems.length} layers={drawnLayers(sketch, [...(layerFile.layers ?? []), curLayer])} styles={styles} current={curLayer} textMm={anno.textMm} k={units.factor}
                  onItems={(next, what) => change(next.reduce((q, it) => updateSketch(q, fileOf(), it), project), `${what} · ⌘Z to undo`)}
                  onCurrent={setCurrentLayer} newProps={newProps} onNewProps={setProps} onTextMm={(mm) => change({ ...project, cadAnno: { ...anno, textMm: mm } }, `Annotation: ${mm} mm text at 1:${anno.scale} · ⌘Z to undo`)}
                  titleBlock={tb ? { name: project.titleTemplates?.find((x) => x.id === tbIdOf(view.file))?.name ?? '', fields: TB_FIELDS, onField: (f) => { cad.setTextPreset({ text: f, h: 2.5, layer: TB_LAYERS.field }); cad.setTool('text'); cad.say(`TEXT  Click where ${f} goes:`); }, onSave: () => { const r = saveTitleBlockFromCad(project, view.file); if (r.project !== project) change(r.project, r.message); else cad.say(r.message); } } : undefined}
                  bare />}
          {(pickedName || result) && <>
          <h4>{pickedName ? 'Selected' : 'Result'}{pickedName && <span className="m">{pickedName}</span>}</h4>
          <div className="cad-res">
            {many && pickedSk.length ? <DrawnSelectionPanel items={pickedSk} devices={pickedItems.length} onEdit={editSketch} /> : many ? <SelectionPanel key={[...pickedKeys].join()} project={project} items={pickedItems} circuits={circuits} level={floor ? floorLabel(project.building, floor) : undefined} onEdit={editDevices} /> : result ? <ResultView r={result.kind === 'sketch' && selSketch ? { kind: 'sketch', it: selSketch } : result} view={view!} toM={toM} toM2={toM2} project={project} onChange={onChange} onMove={() => cad.setTool('move')} onRemove={removeSelected} onCopy={() => cad.setTool('copy')} onRotate={() => cad.setTool('rotate')} onAdded={() => setResult(null)} fittings={fittings} /> : null}
          </div>
          </>}
      </div>
      <span className={`cad-dock-grip ${dockSide}`} role="separator" aria-orientation="vertical" aria-label="Palette width" onPointerDown={startDockDrag} />
    </aside>
  );
  // The drawing column, on the other side of the drawing from the properties dock: the drawing itself, the tool's own
  // settings, plans, layer roles and layers — kept apart from the properties of what is picked.
  const info = (
    <aside className={`cad-side cad-info ${dockSide === 'left' ? 'right' : 'left'}`} aria-label="Drawing">
      <div className="cad-dock-b">
          <h4>Drawing</h4>
          <div className="cad-res">
            {view ? (
              <>{view.file}<br /><span className="m">{view.info.format} · {units.label}{units.assumed ? ' (not set in the drawing: taken as mm)' : ''} · {fmtUpTo(view.info.segments, 0)} lines · {view.info.texts.length} texts</span><br /><span className="m">{editPrompt(tool, edSet)}</span></>
            ) : <span className="m">No drawing open.</span>}
            {view && SAMPLE_PLANS.some((x) => x.file === view.file) && (
              <div className="cad-sample">
                Sample plan for testing{' '}
                <select aria-label="Sample floor" value={view.file} onChange={(e) => { const file = e.target.value; showOrLoad(file, () => sampleDrawing(file)); }}>
                  {SAMPLE_PLANS.map((x) => <option key={x.file} value={x.file}>{x.label}</option>)}
                </select>
              </div>
            )}
          </div>
          {tool === 'tray' && view && (
            <>
              <h4>Cable tray</h4>
              <div className="cad-devform">
                <TrayFields project={project} widthMm={cad.tray.widthMm} service={cad.tray.service} route={cad.tray.route} onChange={(t) => cad.setTray({ ...cad.tray, ...t })} />
                <span className="m">Click the run's points, Enter to finish. The route can be left for later. End a run on another tray for a tee; a run of another width in line makes a reducer.</span>
              </div>
              <Fittings fittings={fittings} title="Fittings on this plan" />
            </>
          )}
          {(tool === 'cable' || tool === 'link') && view && (
            <>
              <h4>Cable route</h4>
              <div className="cad-devform">
                <label>Cable<select aria-label="Cable" value={cad.cableFeeder} onChange={(e) => cad.setCableFeeder(e.target.value)}>
                  <option value="">Choose a cable…</option>
                  {cables.map((f) => <option key={f.id} value={f.id}>{cableLabel(project, f)}</option>)}
                </select></label>
                <span className="m">{tool === 'cable' ? 'Click the route\'s points, Enter to finish.' : 'Click a line or polyline of the drawing (e.g. on a cable layer).'} Update schedules then gives the cable its length, and the tray routes it runs along.</span>
              </div>
            </>
          )}
          {tool === 'wire' && view && (
            <>
              <h4>Wiring</h4>
              <div className="cad-devform">
                {wiring.map((w) => <span key={w.feederId} className="m">{w.tag}{w.warning ? ` — ${w.warning}` : ''}</span>)}
                <span className="m">{wiring.length ? `${wiring.length} circuit${wiring.length === 1 ? '' : 's'} wired on this level. Update schedules sends the lengths to the cable schedule.` : 'No circuit wired on this level yet: click a device, or use Wire circuits.'}</span>
              </div>
            </>
          )}
          {tool === 'lux' && view && (
            <RoomLightingPanel project={project} room={luxOf} lit={lit} settings={luxSet} onSettings={setLuxSet} circuits={circuits} feederId={cad.feederId} onFeeder={cad.setFeederId} onPlace={placeLux} onCancel={() => { setLuxRoom(null); cad.say(`Command: ${PROMPT.lux}`); }} />
          )}
          {tool === 'arl' && view && (
            <ArrayPanel project={project} settings={arlSet} onSettings={setArlSet} palette={palette} circuits={circuits} feederId={cad.feederId} onFeeder={cad.setFeederId}
              lengthM={points.length >= 2 ? distance(points[0], points[1]) * units.factor : undefined} at={points.length >= 2 ? arlAt : []} onPlace={placeArl} onCancel={() => { setPoints([]); cad.say(`Command: ${PROMPT.arl}`); }} />
          )}
          {EDIT_TOOLS.includes(tool) && !DIALOG_TOOLS.includes(tool as EditTool) && view && (
            <EditToolPanel tool={tool as EditTool} settings={edSet} onSettings={setEdSet} picked={pickedSk.length}
              step={edStep ? `${kindOf(sketch.find((x) => x.id === edStep.id) ?? sketch[0])} picked — ${tool === 'offset' ? 'click the side' : tool === 'break' ? 'click the second point, or Enter' : 'click the second line'}` : stretchBox ? 'Window set — click the base point, then the second point' : PICK_FIRST.includes(tool) && edPhase === 'points' ? (TEXT_TOOLS.includes(tool) ? 'Picked — type the value on the command line' : 'Objects picked — now the points') : undefined}
              onApply={tool === 'join' ? applyJoin : tool === 'array' && !edSet.polar ? () => applyArray() : undefined} />
          )}
          {tool === 'hatch' && view && <HatchPanel spec={hatchSet} onSpec={setHatchSet} patterns={project.cadPatterns} computer={computerPats} onImport={importPat} onExport={() => void exportPat()} opts={hatchOpts} onOpts={setHatchOpts} />}
          {tool === 'hatchedit' && view && heItems.length > 0 && heItems[0].hatch && <HatchPanel key={heItems[0].id} spec={heItems[0].hatch} onSpec={heSpec} patterns={project.cadPatterns} computer={computerPats} editing={{
            count: heItems.length, origin: [(heItems[0].hatch.origin?.[0] ?? 0) * units.factor, (heItems[0].hatch.origin?.[1] ?? 0) * units.factor], islands: heItems[0].holes?.length ?? 0,
            assoc: isAssociative(heItems[0], sketch), canAssoc: isAssociative(heItems[0], sketch),
            onOrigin: ([x, y]) => heUpdate((it) => ({ ...it, hatch: { ...it.hatch!, origin: [x / units.factor, y / units.factor] } }), `Origin ${x.toFixed(2)}, ${y.toFixed(2)} m`),
            onPick: () => { setHePhase('origin'); cad.say(hatchEditSay('origin', 1)); }, onAdd: () => { setHePhase('add'); cad.say(hatchEditSay('add', 1)); }, onRemove: () => { setHePhase('remove'); cad.say(hatchEditSay('remove', 1)); },
            onAssoc: () => heUpdate((it) => { const { assoc: _a, ...rest } = it; return rest; }, 'No longer associative')
          }} />}
          {(tool === 'text' || tool === 'mtext' || tool === 'dim' || tool === 'dimlin' || tool === 'dimcont' || tool === 'dimbase' || tool === 'leader' || tool === 'rtag' || tool === 'rtall' || tool === 'north') && view && (
            <AnnoPanel anno={anno} onAnno={(a) => onChange({ ...project, cadAnno: a }, `Annotation: ${a.textMm} mm text at 1:${a.scale}`)}
              {...({ text: { title: 'Text', cmd: 'T', help: 'Click where it goes, type it on the command line, Enter.' }, mtext: { title: 'Notes', cmd: 'MT', help: 'Two corners for the box, then type; lines wrap to its width.' }, dim: { title: 'Dimension', cmd: 'DIM', help: 'Two points, then where the dimension line goes.' }, dimlin: { title: 'Linear dimension', cmd: 'DLI', help: 'Two points, then where the dimension line goes: above or below them it is horizontal, beside them vertical.' }, dimcont: { title: 'Continue dimension', cmd: 'DCO', help: 'Click each next point: a dimension from the last one\'s second point, in line with it. Esc stops.' }, dimbase: { title: 'Baseline dimension', cmd: 'DBA', help: 'Click each next point: a dimension from the last one\'s first point, one step further out. Esc stops.' }, leader: { title: 'Leader', cmd: 'LE', help: 'Click the arrow point, then the text point (more points bend it); type the text and Enter.' }, rtag: { title: 'Room tag', cmd: 'RT', help: 'Click inside a room: its name and area at its centre.' }, rtall: { title: 'Tag all rooms', cmd: 'RTALL', help: 'Enter tags every room of the level with no tag yet; A tags them all again.' }, north: { title: 'North arrow', cmd: 'NORTH', help: 'Click where it goes; it points up the plan.' } } as const)[tool]} />
          )}
          {tool === 'matchprop' && view && <><h4>Match properties <span className="m">MP</span></h4><div className="cad-devform"><span className="m">{mpFrom ? 'Click each object to give it the layer, colour, linetype and lineweight of the first; Esc stops. Trays and cable routes keep their layers.' : 'Click the object to copy from.'}</span></div></>}
          {tool === 'match' && view && <MatchPanel from={placed.find((x) => x.key === matchFrom)} settings={matchSet} onSettings={setMatchSet} />}
          {tool === 'em' && view && (
            <EmergencyPanel project={project} settings={emSet} onSettings={(s) => { if (s.mode !== emSet.mode) { setPoints([]); cad.say(EM_PROMPT[s.mode]); } setEmSet(s); }} layout={emLayout} routes={em.routes.length} openRooms={emRooms.map((r) => r.name)} circuits={circuits} feederId={cad.feederId} onFeeder={cad.setFeederId} onPlace={placeEm} onCancel={() => { setEm({ routes: [], points: [], rooms: [] }); setPoints([]); cad.say(`Command: ${PROMPT.em}`); }} />
          )}
          {(tool === 'dev' || tool === 'move' || tool === 'fill') && view && (
            <>
              <h4>Devices</h4>
              <div className="cad-pal" role="group" aria-label="Device to place">
                {palette.map((x) => (
                  <button key={x.id} aria-pressed={cad.device === x.id} className={'elv' in x.kind ? 'elv' : 'lv'} onClick={() => { cad.setDevice(x.id); if (tool !== 'fill' || !('elv' in x.kind)) cad.setTool('dev'); }}>{x.symbol.text || '●'}<span>{x.label}</span></button>
                ))}
              </div>
              <div className="cad-devform">
                {floors.length > 0 && (
                  <label>This drawing shows<select aria-label="Level of this drawing" value={floor?.key} onChange={(e) => { const f = floors.find((x) => x.key === e.target.value); if (f && view) setPlanLevel(project, view.file, f, change, view.info.units); }}>{floors.map((f) => <option key={f.key} value={f.key}>{floorLabel(project.building, f)}</option>)}</select></label>
                )}
                {'lv' in item.kind && (
                  <label>Circuit<select aria-label="Circuit" value={cad.feederId} onChange={(e) => cad.setFeederId(e.target.value)}>
                    <option value="">Choose a circuit…</option>
                    {circuits.map((f) => <option key={f.id} value={f.id}>{circuitLabel(project, f)}</option>)}
                  </select></label>
                )}
                {'board' in item.kind && (
                  <label>Board<select aria-label="Board" value={cad.boardId} onChange={(e) => cad.setBoardId(e.target.value)}>
                    <option value="">Choose a board…</option>
                    {project.boards.map((b) => <option key={b.id} value={b.id}>{b.id} · {b.name}</option>)}
                  </select></label>
                )}
                {!floors.length && <p className="m">Add the building and its levels in Building information first; devices are kept per level.</p>}
                <span className="m">{placed.length} device{placed.length === 1 ? '' : 's'} on this level</span>
                {elvItem && <span className="m">{elvItem.label}{coverageNote(elvItem.kind.elv)} · {SYSTEM_LABEL[elvSystem]}{cad.coverage && elv ? ` · ${elv.coverage.filter((c) => c.gaps.length).length} room${elv.coverage.filter((c) => c.gaps.length).length === 1 ? '' : 's'} not fully covered` : ''}</span>}
              </div>
            </>
          )}
          {plans.length > 0 && (
            <>
              <h4>Plans</h4>
              <div className="cad-layers" role="list" aria-label="Plans of this project">
                {plans.map((x) => {
                  const here = !!view && levelSet && floor?.key === x.floor.key;
                  const inTab = !!x.file && !!cad.tabOf(x.file);
                  const canOpen = !!x.file && canOpenPlan(x.file);
                  return (
                    <button key={x.floor.key} role="listitem" className={`cad-lyr${x.file ? '' : ' off'}`} aria-current={here || undefined} disabled={busy || here || (!!x.file && !canOpen)}
                      title={x.file ? (canOpen ? `Open ${x.file}` : `${x.file}: open it from Plans (its folder is not known on this computer)`) : `Open a drawing as the plan of ${x.label}`}
                      onClick={() => openPlan(x.file, x.floor)}>
                      <b>{x.label}</b>{x.file ?? 'no plan'}<span className="m">{here || inTab ? 'open' : x.file ? '' : 'open…'}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
          {view && cad.showRoles && (
            <>
              <h4>Layer roles</h4>
              <div>
                <CadLayerTable layers={layerStats} roles={roles}
                  onChange={(layer: string, role: CadLayerRole) => change(withLayerMap(project, roles.map((x) => (x.layer === layer ? { ...x, role } : x))), `Layer ${layer}: ${role} · ⌘Z to undo`)}
                  onApplyMap={(m: CadLayerMap[]) => change(withLayerMap(project, m), 'Layer template applied · ⌘Z to undo')} />
              </div>
            </>
          )}
          {cad.showLayers && <>
          <h4>Layers {view && <span className="cad-lyr-all"><button onClick={() => layerChange(applyLayerPatch(project, view.file, lRows.filter((r) => r.group === 'arch'), { on: true }), 'LAYER  All layers on')}>All on</button></span>}</h4>
          <div className="cad-layers">
            {view && placed.length > 0 && (
              <button className={`cad-lyr${cad.showDevices ? '' : ' off'}`} aria-pressed={cad.showDevices} onClick={() => cad.setShowDevices(!cad.showDevices)}>
                <i style={{ background: 'var(--cad-dev)' }} />Devices placed in the app<span className="m">{cad.showDevices ? 'on' : 'off'}</span>
              </button>
            )}
            {view?.info.layers.map((l, i) => l.count > 0 || view.info.texts.some((t) => t.layer === i) ? (
              <button key={l.name} className={`cad-lyr${archOn[i] ? '' : ' off'}`} aria-pressed={!!archOn[i]} title={`${fmtUpTo(l.count, 0)} lines`} onClick={() => layerChange(applyLayerPatch(project, view.file, [{ name: l.name, group: 'arch', drawingOn: l.on }], { on: !archOn[i] }), `Layer ${l.name} ${archOn[i] ? 'off' : 'on'}`)}>
                <i style={{ background: hex(l.rgb) }} />{l.name}<span className="m">{archOn[i] ? 'on' : 'off'}</span>
              </button>
            ) : null)}
            {view && <RefLayersList x={xr} />}
          </div>
          </>}
      </div>
    </aside>
  );
  const fileLists = dsTab ? cadFileMenu(project, cad, (next, message) => onChange(next, message), onStatus) : null;
  return (
    <section className="cad" ref={page}>
      <CadTabs cad={cad} project={project} busy={busy} onOpen={openFile} onClose={closeDrawings} />
      <div className="cad-work" style={{ gridTemplateColumns: workColumns }}>
        {dockSide === 'left' ? dock : info}
        {cad.showBlocks && view && (
          <BlocksPalette defs={defs} archNames={archBlockNames} recent={recentBlocks} library={library} chosen={tool === 'insert' ? insBlock?.name : undefined} settings={insSet} onSettings={setInsSet}
            onPick={startInsert} onPickArch={(n) => void insertArchBlock(n)} onLibraryFolder={window.lvds?.cadFile?.chooseBlockFolder ? () => void chooseLibraryFolder() : undefined}
            onLibraryFiles={(files) => setLibrary({ folder: `${files.length} file${files.length === 1 ? '' : 's'} chosen`, files: files.map((b) => ({ file: b.name, blob: b })) })} onLibraryFile={(f) => void insertLibraryFile(f)}
            onInsertAt={() => { const x = Number(insSet.x.replace(',', '.')), y = Number(insSet.y.replace(',', '.')); if (!insBlock) cad.say('INSERT  Choose a block first.'); else if (!Number.isFinite(x) || !Number.isFinite(y) || !insSet.x.trim() || !insSet.y.trim()) cad.say('INSERT  Type X and Y in metres.'); else placeInsert(insBlock, [x / units.factor, y / units.factor]); }}
            onClose={() => cad.setShowBlocks(false)} />
        )}
        {showLM && view && (
          <LayerPalette file={view.file} rows={lRows} current={curLayer} states={layerFile.states ?? []} isolated={!!layerFile.iso}
            viewport={sheetL && vpTarget ? { name: vpName(vps, vpTarget.id), frozen: (l) => isFrozen(vpTarget, l), toggle: (l) => patchVp(vpTarget, toggleFrozen(vpTarget, l), `${l} ${isFrozen(vpTarget, l) ? 'thawed' : 'frozen'} here`) } : undefined}
            onApply={(rows, patch) => layerChange(applyLayerPatch(project, view.file, rows, patch), `${layerNames(rows)} changed`)}
            onNew={addLayer}
            onRename={(from, to) => {
              const r = renameLayer(project, view.file, from, to, lRows.map((x) => x.name));
              if ('error' in r) return r.error;
              change(r.project, `Layer ${from} renamed ${to} · ⌘Z to undo`);
              return undefined;
            }}
            onDelete={(rows) => change(rows.reduce((q, r) => withoutLayer(q, view.file, r.name), project), `${layerNames(rows)} deleted · ⌘Z to undo`)}
            onCurrent={setCurrentLayer}
            onIsolate={(rows: LayerRow[]) => isolateLayers(rows.map((r) => r.name))}
            onUnisolate={unisolateLayers}
            onSaveState={(name) => change(withSavedState(project, view.file, name, lRows), `Layer state ${name} saved · ⌘Z to undo`)}
            onRestoreState={(name) => { const r = restoreState(project, view.file, name, lRows); if (r) layerChange(r.project, `Layer state ${name} restored${r.kept ? ` (${r.kept} stays thawed: it is the current layer)` : ''}`); }}
            onDeleteState={(name) => change(withoutState(project, view.file, name), `Layer state ${name} deleted · ⌘Z to undo`)}
            onClose={() => setShowLM(false)} />
        )}
        {/* Save As, Close with changes and Drafting settings float over the drawing, as the other CAD dialogs do. */}
        {saveAs && view && <CadSaveAs key={view.file} initial={saveAs} own={view.info.format} hasRefs={xr.refs.length > 0} onClose={() => { setSaveAs(null); closeAfterSave.current = null; }}
          onSave={(c) => { setSaveAs(null); const after = closeAfterSave.current; void writeCopy(c, false).then((ok) => { if (ok && after) closeNow(after); }); }} />}
        {closing && <CloseUnsaved files={closing.filter((v) => cad.isDirty(v.file)).map((v) => v.file)} canSave={!!view && closing.filter((v) => cad.isDirty(v.file)).every((v) => v === view)}
          onClose={() => setClosing(null)} onDiscard={() => closeNow(closing)}
          onSave={() => { const going = closing; setClosing(null); if (view && cad.saved.current.get(view.file.toLowerCase())) void saveNow().then((ok) => { if (ok) closeNow(going); }); else { closeAfterSave.current = going; startSaveAs(); } }} />}
        {dsTab && fileLists && <CadDraftSettings tab={dsTab} draft={draft} toggles={cad.toggles} gridDots={cad.gridDots} level={fileLists.level} levels={fileLists.levels} unit={fileLists.unit} units={fileLists.units} autosaveMin={autosaveMin}
          onClose={() => setDsTab(null)}
          onApply={(x) => {
            setDsTab(null);
            cad.setToggles(x.toggles); cad.setGridDots(x.gridDots);
            onPrefs?.({ draft: x.draft, autosaveMin: Math.max(0, Math.min(60, x.autosaveMin)) });
            x.level?.onClick(); x.unit?.onClick();
            cad.say('DSETTINGS  Drafting settings changed.');
          }} />}
        {dlg === 'edit' && DIALOG_TOOLS.includes(tool as EditTool) && <EditDialog tool={tool as EditTool} settings={edSet} onPatch={(p) => setEdSet((x) => ({ ...x, ...p }))} onClose={() => setDlg(null)} />}
        {attDlg && tool !== 'attpick' && <AttDefDialog draft={attDlg} styles={textStylesOf(project).styles.map((x) => x.name)} k={units.factor} onDraft={setAttDlg} onClose={() => setAttDlg(null)}
          onPick={() => { setAttDlg({ ...attDlg, picking: true }); cad.setTool('attpick'); }}
          onOk={() => {
            if (!attDlg.at) return;
            const flags = Object.fromEntries(Object.entries(attDlg.modes).filter(([, on]) => on).map(([k]) => [k, true])) as NonNullable<SketchItem['att']>;
            draw({ kind: 'attdef', layer: curLayer, pts: [attDlg.at], tag: cleanTag(attDlg.tag), prompt: attDlg.prompt.trim(), text: attDlg.def, h: tb ? attDlg.heightMm : textUnits({ ...anno, textMm: attDlg.heightMm }, units.factor),
              ...(attDlg.rot ? { rot: (attDlg.rot * Math.PI) / 180 } : {}), ...(attDlg.just !== 'L' ? { just: attDlg.just } : {}), ...(Object.keys(flags).length ? { att: flags } : {}), ...newProps }, `Attribute ${cleanTag(attDlg.tag)}`);
            setAttDlg(null);
          }} />}
        {attEdit && (() => {
          const it = sketch.find((x) => x.id === attEdit), def = it ? blockDefOf(defs, it.block) : undefined;
          return it && def ? <AttEditDialog insert={it} def={def} k={units.factor} layers={lRows.filter((r) => r.group === 'drawn').map((r) => r.name)} onClose={() => setAttEdit(null)}
            onApply={(ins, d, keep) => {
              let next = updateSketch(project, fileOf(), ins);
              if (JSON.stringify(d) !== JSON.stringify(def)) next = withBlockDef(next, fileOf(), d);
              if (JSON.stringify(next) !== JSON.stringify(project)) change(next, `ATTEDIT  "${def.name}" attributes · ⌘Z to undo`);
              if (!keep) setAttEdit(null);
            }} /> : null;
        })()}
        {attPend?.dialog && <AttPromptDialog def={attPend.def} values={attPend.values} onClose={() => { setAttPend(null); cad.say('*Cancel*'); }} onOk={(values) => { const p = attPend; setAttPend(null); finishInsert(p.def, p.at, values); }} />}
        {blockDlg && tool !== 'blockpick' && <BlockDialog draft={blockDlg} names={defs.map((d) => d.name)} archNames={archBlockNames} k={units.factor}
          units={({ 1: 'inches', 2: 'feet', 4: 'millimetres', 5: 'centimetres', 6: 'metres' } as Record<number, string>)[view?.info.units ?? 0] ?? 'drawing units'}
          onDraft={setBlockDlg} onClose={() => setBlockDlg(null)} onOk={() => { if (blockDlg.base) applyBlock(blockDlg.name, blockDlg.base, blockDlg.ids, blockDlg.mode, blockDlg.description); }}
          onPick={(what) => { pick([], what === 'objects' ? sketch.filter((it) => blockDlg.ids.includes(it.id)) : []); setBlockDlg({ ...blockDlg, picking: what }); cad.setTool('blockpick'); }} />}
        {dlg === 'ptype' && <PointStyleDialog style={pointStyleOf(project)} onClose={() => setDlg(null)}
          onSave={(s) => { setDlg(null); change({ ...project, cadPointStyle: s }, `PTYPE  Points shown as ${pointShapeLabel(s.mode).toLowerCase()}, ${s.size}${s.relative ? ' % of the view' : ' drawing units'} · ⌘Z to undo`); }} />}
        {dlg === 'style' && <TextStyleDialog styles={textStylesOf(project)} annoMm={anno.textMm} onClose={() => setDlg(null)}
          onSave={(s) => {
            setDlg(null);
            // Standard unchanged is not kept; saved with nothing changed, nothing changes.
            const keep = textStylesToStore(s), { cadTextStyles: _t, ...rest } = project;
            if (JSON.stringify(keep) === JSON.stringify(project.cadTextStyles)) { cad.say('STYLE  No change.'); return; }
            change(keep ? { ...project, cadTextStyles: keep } : rest, `STYLE  ${s.styles.length} text style${s.styles.length === 1 ? '' : 's'}, current "${s.current}" · ⌘Z to undo`);
          }} />}
        {dlg === 'qselect' && view && <QuickSelectDialog items={pickable} picked={pickedSk} metresPerUnit={units.factor} onClose={() => setDlg(null)} onApply={applyQuickSelect} />}
        {dlg === 'dimstyle' && <DimStyleDialog styles={dimStylesOf(project)} asBefore={dimStandardAsBefore(project)} onClose={() => setDlg(null)}
          onSave={(s) => {
            setDlg(null);
            const keep = dimStylesToStore(project, s), { cadDimStyles: _d, ...rest } = project;
            if (JSON.stringify(keep) === JSON.stringify(project.cadDimStyles)) { cad.say('DIMSTYLE  No change.'); return; }
            change(keep ? { ...project, cadDimStyles: keep } : rest, `DIMSTYLE  ${s.styles.length} dimension style${s.styles.length === 1 ? '' : 's'}, current "${s.current}" · ⌘Z to undo`);
          }} />}
        {view && paperL ? (
          <div className="cad-stage cad-paper" ref={paperStage} onMouseDown={() => setPaperCtx(null)}>
            <CadFilePaper layout={paperL} model={view} onContext={filePaperContext} onDblClick={() => cad.say(fileL ? `LAYOUT  ${fileL.name} is shown as the drawing file has it: work in the model on the Model tab.` : `LAYOUT  ${paperL.name} shows the model: work in it on the Model tab.`)} />
            {paperCtx && <CadPromptMenu left={paperCtx.at[0] + 4} top={paperCtx.at[1] + 4} items={paperCtx.items} onPick={(x) => { setPaperCtx(null); ctxPick(x); }} />}
          </div>
        ) : view && sheetL ? (
          <div className="cad-stage cad-paper" ref={paperStage} onMouseDown={() => setPaperCtx(null)}>
            {sheetUi ? <SheetWorkspace bare project={project} run={calcRun} sheetId={sheetL.id} design={null} ui={sheetUi} onChange={(next) => change(next, `${sheetL.number || 'Layout'}  paper changed · ⌘Z to undo`)} onStatus={onStatus} onActive={() => {}} overlay={layoutOverlay({
              project, sheet: sheetL, sel: cad.vpSel, ms: cad.msVp, mv, place: placing,
              onSelect: cad.setVpSel,
              onPlace: (kind, at) => {
                setPlacing(null);
                const id = tableId(tables);
                setTables((l) => [...l, { id, kind, at, widthMm: TABLE_WIDTH }], `${kind === 'legend' ? 'Legend' : 'Notes'} table placed at ${at[0]}, ${at[1]} mm`);
                cad.setVpSel(id);
              },
              onTableAt: (id, at) => setTables((l) => patchTable(l, id, { at }), `${tableName(tables, id)} moved`),
              onContext: paperContext,
              onMs: (id) => { cad.setMsVp(id); if (id) cad.setVpSel(id); cad.say(id ? `MSPACE  Working in the model through ${vpName(vps, id)}. A double-click outside (or PS) returns to the paper.` : 'PSPACE  On the paper.'); },
              onBox: (id, box) => setVps((l) => patchViewport(l, id, { box }), `${vpName(vps, id)} moved or resized`),
              onNew: (box) => {
                setMv(false);
                const base = vpTarget ?? vps[0], id = vpId(vps);
                const at = base ? vpToModel(base, [box[0] + box[2] / 2, box[1] + box[3] / 2]) : [0, 0] as [number, number];
                setVps((l) => [...l, { id, box, at, scale: base?.scale ?? 100 }], `${vpName([...vps, { id } as PlanViewport], id)} added at 1:${base?.scale ?? 100}`);
                cad.setVpSel(id);
              },
              canvas: (v, pxPerMm) => {
                const w = vpWindow(v), k = units.factor;
                return drawCanvas({
                  fitBox: [w.x0 / k, w.y0 / k, w.x1 / k, w.y1 / k], fixed: isLocked(v),
                  onView: (c, pxPerUnit) => {
                    const scale = Math.max(1, Math.round((1000 * pxPerMm * k) / pxPerUnit));
                    patchVp(v, { at: [+(c[0] * k).toFixed(3), +(c[1] * k).toFixed(3)], scale }, `view moved (1:${scale})`);
                  }
                });
              }
            })} /> : <p className="m">Layouts open from the app's sheets.</p>}
            {paperCtx && <CadPromptMenu left={paperCtx.at[0] + 4} top={paperCtx.at[1] + 4} items={paperCtx.items} onPick={(x) => { setPaperCtx(null); ctxPick(x); }} />}
          </div>
        ) : view ? (
          <div className="cad-stage">
            {drawCanvas()}
            <div className="cad-coords">{cursor.at ? `X ${cursor.at[0].toFixed(2)}   Y ${cursor.at[1].toFixed(2)}   ${units.label}` : units.label}</div>
          </div>
        ) : (
          <div className="cad-stage cad-empty">
            <p className="m">Open a DWG or DXF drawing. It opens here as in a CAD program — read by the app's own engine, no CAD program needed.</p>
            <div className="cad-actions">
              <button className="chip primary" disabled={busy} onClick={openFile}>{busy ? 'Opening…' : 'Open drawing…'}</button>
              <button className="chip" disabled={busy} onClick={newFile}>New drawing</button>
              {last && window.lvds?.cadFile?.readBytes && <button className="chip" disabled={busy} onClick={() => void load(() => reopenDrawing(last), 'That drawing is no longer where it was. Open it again.')}>Reopen {last.split(/[\\/]/).pop()}</button>}
              {SAMPLE_PLANS.map((x) => <button key={x.file} className="chip" disabled={busy} onClick={() => void load(() => sampleDrawing(x.file))}>{x.label}</button>)}
            </div>
          </div>
        )}
        {dockSide === 'right' ? dock : info}
      </div>
      <CadCommandLine history={cad.history} live={EDIT_TOOLS.includes(tool) ? promptNow(edSet) : undefined} cmd={cmd} setCmd={setCmd} inputRef={input} typed={typed} space={spaceMode} log={log} onLog={setLog} onRun={run} />
      {view && <LayoutTabs files={view.layouts.map((l) => ({ id: fileLayoutId(l.name), name: l.name, title: fileLayoutTitle(l, units.factor * 1000) }))} drawings={dwgLayouts.map((l, n) => ({ id: drawingLayoutId(l.name), name: l.name, title: fileLayoutTitle(asFileLayout(l, n), units.factor * 1000) }))} layouts={layouts} active={sheetL?.id ?? (fileL ? fileLayoutId(fileL.name) : dwgL ? drawingLayoutId(dwgL.name) : null)} onPick={(id) => { cad.setLayout(id); const f = fileLayoutOf(view.layouts, id); const d = drawingLayoutOf(dwgLayouts, id); if (f) cad.say(`LAYOUT  ${f.name} — the drawing file's own layout, as saved: ${fileLayoutTitle(f, units.factor * 1000)}.`); else if (d) cad.say(`LAYOUT  ${d.name} — ${fileLayoutTitle(asFileLayout(d, 0), units.factor * 1000)}.`); else if (id) cad.say(`LAYOUT  ${layouts.find((x) => x.id === id)?.number ?? ''} — the paper; double-click inside a viewport to work in it, MV adds one.`); }}
        onNew={addDrawingLayout} onNewSheet={addLayout}
        onDrawing={{ ...drawingTabActs, pageSetup: (d) => { cad.setLayout(d.id); setLayoutDlg('paper'); } }}
        onTemplates={() => layoutCmd('LAYOUT T')} onSaveTemplate={(id) => { cad.setLayout(id); setLayoutDlg('templates'); }}
        onRename={(x) => { setRenamingLayout(x.id); cad.say(`RENAME  Type the new title of ${x.number} (now "${x.title}"):`); input.current?.focus(); }}
        onCopy={(x) => { if (!lv) return; const r = newLayout(setOf(project), lv, x.plan ?? 'lighting', x); change({ ...project, drawingSet: r.set }, `LAYOUT  ${x.number} copied · ⌘Z to undo`); cad.setLayout(r.id); }}
        onMove={(x, dir) => change({ ...project, drawingSet: renumber(moveLayout(setOf(project), x.id, dir)) }, `LAYOUT  ${x.number} moved ${dir < 0 ? 'left' : 'right'} · ⌘Z to undo`)}
        onDelete={(x) => { const set = setOf(project); change({ ...project, drawingSet: { ...set, sheets: set.sheets.filter((y) => y.id !== x.id) } }, `LAYOUT  ${x.number} ${x.title} deleted (its sheet too) · ⌘Z to undo`); if (cad.layout === x.id) cad.setLayout(null); }}
        onPageSetup={(x) => onSheet?.(x.id)} onPlot={(x) => onPlot(x.id)} />}
      <div className="cad-status">
        <CadStatusToggles toggles={cad.toggles} gridDots={cad.gridDots} draft={draft} canFit={!!view} onToggle={cad.toggle} onCycleGrid={cad.cycleGrid} onSettings={setDsTab} onFit={() => cad.fit()}
          onDraft={onPrefs ? (d) => onPrefs({ draft: d, autosaveMin }) : undefined} />
        <span className="sp" />
        {paperL ? <>
          <span className="cad-tg on" title={fileL ? "On the drawing file's own layout (paper space)" : 'On a layout of the drawing (paper space)'}>PAPER</span>
          <span>{`${paperL.name} · ${fileLayoutTitle(paperL, units.factor * 1000)}`}</span>
        </> : sheetL ? <>
          <button className={`cad-tg on`} aria-label={msV ? 'Model space in a viewport' : 'Paper space'} title={msV ? 'In the model through a viewport: click for the paper (PS)' : 'On the paper: click to work in a viewport (MS)'} onClick={() => run(msV ? 'PS' : 'MS')}>{msV ? 'MODEL' : 'PAPER'}</button>
          {vpTarget && <span>{`${vpName(vps, vpTarget.id)} · 1:${vpTarget.scale}${isLocked(vpTarget) ? ' · locked' : ''}`}</span>}
          <span>{`${sheetL.number} · ${layoutPaper(project, sheetL)?.size ?? ''} · mm`}</span>
        </> : <>
          <span>{cursor.snap ?? ''}</span>
          <span>{view ? `${view.file} · ${view.info.format} · ${units.label} · 1 : 1` : ''}</span>
        </>}
      </div>
      {layoutDlg === 'templates' && view && <LayoutTemplatesDialog canSheet={!!lv} onStatus={(m) => cad.say(m)} onClose={() => setLayoutDlg(null)}
        current={sheetL ? { name: sheetL.title || sheetL.number, make: (n) => templateFromSheet(project, sheetL, n) }
          : dwgL ? { name: dwgL.name, make: (n) => templateFromPaper(n, dwgL.paper, dwgL.viewports.map((v) => ({ x: v.x, y: v.y, w: v.w, h: v.h, scale: viewportScaleN(v, units.factor * 1000) || undefined }))) }
          : fileL ? { name: fileL.name, make: (n) => {
            const g = paperOf(fileL), k = fileL.mm_per_unit || 1;
            return templateFromPaper(n, [g.w, g.h], fileL.viewports.filter((v) => v.on).map((v) => { const [x, y] = g.mm(v.x, v.y), sc = v.h > 0 ? Math.round((v.vh * units.factor * 1000) / (v.h * k)) : 0; return { x, y, w: v.w * k, h: v.h * k, scale: sc > 0 ? sc : undefined }; }));
          } } : undefined}
        onNew={(t, as) => {
          if (as === 'drawing') {
            const l = drawingLayoutFromTemplate(t, nextLayoutName(layoutNames), view.info.extents, units.factor * 1000);
            setDwgLayouts([...dwgLayouts, l], `${l.name} — from the template ${t.name}: ${paperName(t.paper)}, ${l.viewports.length} viewport${l.viewports.length === 1 ? '' : 's'}`);
            cad.setLayout(drawingLayoutId(l.name));
            return;
          }
          if (!lv) return;
          const r = newLayout(setOf(project), lv, as), made = r.set.sheets.find((x) => x.id === r.id);
          if (!made) return;
          const set = { ...r.set, sheets: r.set.sheets.map((x) => (x.id === r.id ? sheetWithTemplate({ ...project, drawingSet: r.set }, x, t) : x)) };
          change({ ...project, drawingSet: set }, `LAYOUT  ${made.number} ${lv.name} · ${PLAN_LABEL[as]} — from the template ${t.name} · ⌘Z to undo`);
          cad.setLayout(r.id);
        }} />}
      {layoutDlg === 'paper' && dwgL && <LayoutPaperDialog layout={dwgL} onClose={() => setLayoutDlg(null)} onSave={(paper) => setDwgLayouts(dwgLayouts.map((l) => (l === dwgL ? withPaper(dwgL, paper) : l)), `${dwgL.name}: ${paperName(paper)}`)} />}
      {layoutDlg === 'scales' && <ScaleListDialog scales={scalesOf(project)} onClose={() => setLayoutDlg(null)} onSave={(list) => change(withScales(project, list), `SCALELISTEDIT  ${list.length} scales in the list · ⌘Z to undo`)} />}
      {publishing && <PublishDialog project={project} run={calcRun} current={sheetL?.id} ticked={layouts.map((x) => x.id)} onClose={() => setPublishing(false)} onChange={(p) => onChange(p, 'Sheets issued · ⌘Z to undo')} onStatus={onStatus} onOpen={(id) => { setPublishing(false); onSheet?.(id); }} />}
      {showXR && view && <RefManager file={view.file} level={floor ? floorLabel(project.building, floor) : undefined} x={xr} onAttach={() => void startAttach()} onClip={startClip} onBind={() => { setShowXR(false); const c = copyOf(/^DXF/i.test(view.info.format) ? 'dxf' : 'dwg', true); if (c) void writeCopy({ ...c, path: undefined }, false, false); }} onClose={() => setShowXR(false)} />}
      {xDraft && tool !== 'xattach' && view && (
        <AttachDialog key={`${xDraft.at[0]},${xDraft.at[1]}`} draft={xDraft} level={floor ? floorLabel(project.building, floor) : undefined} units={{ ref: unitName(refGeometry(xDraft.file)?.units), plan: unitName(view.info.units) }}
          onPick={(d) => { setXDraft(d); cad.setTool('xattach'); }} onCancel={() => { setXDraft(null); cad.say('*Cancel*'); }} onAttach={(d) => { setXDraft(null); xr.actions.confirm(d); }} />
      )}
    </section>
  );
}

/** The Result panel: a distance, an area (with Add as room…), or what the clicked object is. */
function ResultView({ r, view, toM, toM2, project, onChange, onMove, onRemove, onCopy, onRotate, onAdded, fittings }: {
  r: Result; view: CadView; toM: (v: number) => number; toM2: (v: number) => number; project: Project; onChange: (next: Project, message: string) => void;
  onMove: () => void; onRemove: () => void; onCopy: () => void; onRotate: () => void; onAdded: () => void; fittings: TrayFitting[];
}) {
  if (r.kind === 'sketch' && r.it.cable) {
    const it = r.it, cable = r.it.cable;
    const f = project.feeders.find((x) => x.id === cable.feederId);
    return (
      <>
        <div><b>Cable route</b> <span className="m">drawn here · {it.layer}</span></div>
        <dl className="cad-props">
          <dt>Cable</dt><dd>{f ? cableLabel(project, f) : `${cable.feederId} (no longer in the design)`}</dd>
          <dt>Route</dt><dd>{m(toM(pathLength(it.pts)))}</dd>
          {f?.lengthM !== undefined && <><dt>Cable length</dt><dd>{f.lengthM} m</dd></>}
        </dl>
        <div className="cad-devform">
          <label>Cable<select aria-label="Cable of this route" value={cable.feederId} onChange={(e) => {
            const g = project.feeders.find((x) => x.id === e.target.value);
            if (g) onChange(updateSketch(project, view.file, { ...it, cable: { feederId: g.id } }), `Cable route now for ${cableLabel(project, g)} · ⌘Z to undo`);
          }}>{cablesOf(project).map((x) => <option key={x.id} value={x.id}>{cableLabel(project, x)}</option>)}</select></label>
        </div>
        <div className="cad-devbtns"><button className="chip" onClick={onMove}>Move</button><button className="chip" onClick={onCopy}>Copy</button><button className="chip" onClick={onRotate}>Rotate</button><button className="chip" onClick={onRemove}>Erase</button></div>
      </>
    );
  }
  if (r.kind === 'sketch' && r.it.tray) {
    const it = r.it, tray = r.it.tray;
    return (
      <>
        <div><b>Cable tray</b> <span className="m">drawn here · {it.layer}</span></div>
        <dl className="cad-props">
          <dt>Length</dt><dd>{m(toM(trayLength(it)))}</dd>
          <dt>Carries</dt><dd>{tray.service ?? 'not set'}</dd>
          <dt>Route</dt><dd>{tray.route ?? 'not assigned'}</dd>
        </dl>
        <div className="cad-devform">
          <TrayFields project={project} widthMm={tray.widthMm} service={tray.service ?? ''} route={tray.route ?? ''} onChange={(t) => {
            const next = { ...tray, ...t };
            const { route, service, ...rest } = next;
            onChange(updateSketch(project, view.file, { ...it, tray: { ...rest, ...(service ? { service } : {}), ...(route ? { route } : {}) } }), `Cable tray ${next.widthMm} mm${service ? ` ${service.toLowerCase()}` : ''}${route ? ` on route ${route}` : ', no route'} · ⌘Z to undo`);
          }} />
        </div>
        <Fittings fittings={fittings.filter((f) => f.runs.includes(it.id))} title="Fittings on this run" />
        <div className="cad-devbtns"><button className="chip" onClick={onMove}>Move</button><button className="chip" onClick={onCopy}>Copy</button><button className="chip" onClick={onRotate}>Rotate</button><button className="chip" onClick={onRemove}>Erase</button></div>
      </>
    );
  }
  if (r.kind === 'sketch') {
    const it = r.it;
    const len = segmentsOf(it).reduce((t, [a, b]) => t + distance(a, b), 0);
    const name = kindOf(it);
    const ellipseArea = it.kind === 'ellipse' && it.ax ? Math.PI * Math.hypot(it.ax[0], it.ax[1]) ** 2 * (it.ratio ?? 1) : 0;
    return (
      <>
        <div><b>{name}</b> <span className="m">drawn here · {it.layer}</span></div>
        <dl className="cad-props">
          {it.kind === 'text' && <><dt>Text</dt><dd>{it.text}</dd></>}
          {it.kind === 'mtext' && <><dt>Note</dt><dd>{plainText(it)}</dd></>}
          {it.kind === 'dim' && <><dt>Measures</dt><dd>{m(toM(dimMeasure(it)))}</dd></>}
          {it.r !== undefined && <><dt>Radius</dt><dd>{m(toM(it.r))}</dd></>}
          {it.kind !== 'text' && it.kind !== 'dim' && <><dt>{it.closed || it.kind === 'circle' || it.kind === 'ellipse' ? 'Perimeter' : 'Length'}</dt><dd>{m(toM(len))}</dd></>}
          {it.hatch ? <><dt>Area</dt><dd>{m2(toM2(hatchArea(it)))}</dd></> : it.closed && <><dt>Area</dt><dd>{m2(toM2(areaOf(it.pts).area))}</dd></>}
          {it.kind === 'ellipse' && <><dt>Area</dt><dd>{m2(toM2(ellipseArea))}</dd></>}
        </dl>
        <div className="cad-devbtns"><button className="chip" onClick={onMove}>Move</button><button className="chip" onClick={onCopy}>Copy</button><button className="chip" onClick={onRotate}>Rotate</button><button className="chip" onClick={onRemove}>Erase</button></div>
      </>
    );
  }
  if (r.kind === 'device') {
    const it = r.it;
    return (
      <>
        <div><b>{it.label}</b> <span className="m">{it.what === 'lv' ? 'LV point' : it.what === 'elv' ? 'ELV device' : 'Board'}</span></div>
        <dl className="cad-props">
          {it.detail && <><dt>{it.what === 'lv' ? 'Circuit' : it.what === 'elv' ? 'System' : 'Name'}</dt><dd>{it.detail}</dd></>}
          <dt>Room</dt><dd>{it.room ?? '—'}</dd>
          <dt>Position</dt><dd>{it.x.toFixed(2)}, {it.y.toFixed(2)} m</dd>
        </dl>
        <div className="cad-devbtns"><button className="chip" onClick={onMove}>Move</button><button className="chip" onClick={onCopy}>Copy</button><button className="chip" onClick={onRemove}>Delete</button></div>
      </>
    );
  }
  if (r.kind === 'dist') {
    const d = distance(r.a, r.b);
    return <><div>Distance <b className="cad-big">{m(toM(d))}</b></div><div className="m">ΔX {m(toM(r.b[0] - r.a[0]))} · ΔY {m(toM(r.b[1] - r.a[1]))} · angle {angleDeg(r.a, r.b).toFixed(2)}°</div></>;
  }
  if (r.kind === 'area') {
    const { area, perimeter } = areaOf(r.points);
    return (
      <>
        <div>{r.how === 'room' || r.how === 'trace' ? 'Room area' : 'Area'} <b className="cad-big">{m2(toM2(area))}</b></div>
        <div className="m">Perimeter {m(toM(perimeter))}{r.how === 'object' ? ' · of the object picked' : ''}</div>
        <AddRoom key={`${area}:${r.name ?? ''}`} project={project} areaM2={toM2(area)} name={r.name ?? ''} file={view.file} level={planLevel(project, view.file).floor?.key} onChange={onChange}
          outline={r.points.map(([x, y]): Pt => [Math.round(toM(x) * 1000) / 1000, Math.round(toM(y) * 1000) / 1000])} startOpen={r.how === 'trace' || r.how === 'room'} onAdded={onAdded} />
      </>
    );
  }
  const o = r.o;
  const layer = view.info.layers[o.layer];
  return (
    <>
      <div><b>{o.kind}{o.block ? ` · ${o.block}` : ''}</b></div>
      <dl className="cad-props">
        <dt>Layer</dt><dd><i style={{ background: hex(layer?.rgb ?? 0) }} />{layer?.name ?? '—'}</dd>
        <dt>Handle</dt><dd>{o.handle}</dd>
        {o.text !== undefined && <><dt>Text</dt><dd>{o.text}</dd></>}
        {o.radius !== undefined && <><dt>Radius</dt><dd>{m(toM(o.radius))}</dd></>}
        {o.length !== undefined && <><dt>{o.closed ? 'Perimeter' : 'Length'}</dt><dd>{m(toM(o.length))}</dd></>}
        {o.area !== undefined && <><dt>Area</dt><dd>{m2(toM2(o.area))}</dd></>}
        {o.vertices !== undefined && <><dt>Vertices</dt><dd>{o.vertices}{o.closed ? ' · closed' : ''}</dd></>}
        {Object.entries(o.attrs ?? {}).map(([k, v]) => <><dt key={`k${k}`}>{k}</dt><dd key={`v${k}`}>{v || '—'}</dd></>)}
      </dl>
      <div className="cad-devbtns"><button className="chip" onClick={onRemove}>Erase</button></div>
    </>
  );
}

/** Tray fittings counted by kind and size ("2 × Bend 90° 300"). */
function Fittings({ fittings, title }: { fittings: TrayFitting[]; title: string }) {
  if (!fittings.length) return null;
  return (
    <dl className="cad-props" aria-label={title}>
      <dt>{title}</dt><dd>{fittingCounts(fittings).map(([label, n]) => `${n} × ${label}`).join(', ')}</dd>
    </dl>
  );
}

/** Width, service and tray route of a cable tray run: the route is optional (Not assigned), chosen from the project's
 * tray routes. */
function TrayFields({ project, widthMm, service, route, onChange }: { project: Project; widthMm: number; service: string; route: string; onChange: (t: { widthMm?: number; service?: string; route?: string }) => void }) {
  const routes = trayPlanOf(project).routes;
  return (
    <>
      <label>Width<select aria-label="Tray width" value={widthMm} onChange={(e) => onChange({ widthMm: Number(e.target.value) })}>
        {TRAY_WIDTHS.map((w) => <option key={w} value={w}>{w} mm</option>)}
      </select></label>
      <label>Carries<select aria-label="Tray service" value={service} onChange={(e) => onChange({ service: e.target.value })}>
        {!service && <option value="">Not set</option>}
        {TRAY_SERVICES.map((x) => <option key={x} value={x}>{x}</option>)}
      </select></label>
      <label>Route<select aria-label="Tray route" value={route} onChange={(e) => onChange({ route: e.target.value })}>
        <option value="">Not assigned</option>
        {routes.map((r) => <option key={r.id} value={r.name}>{r.name}{r.from || r.to ? ` · ${r.from ?? ''} → ${r.to ?? ''}` : ''}</option>)}
        {route && !routes.some((r) => r.name === route) && <option value={route}>{route}</option>}
      </select></label>
    </>
  );
}

/** Sends a measured area to Building information as a room on a level. */
function AddRoom({ project, areaM2, name: initial, file, level, outline, startOpen, onChange, onAdded }: {
  project: Project; areaM2: number; name: string; file: string; level?: string; outline: Pt[]; startOpen?: boolean; onChange: (next: Project, message: string) => void; onAdded: () => void;
}) {
  const floors = floorList(project.building).filter((f) => !f.ref.index);
  const [open, setOpen] = useState(!!startOpen);
  const [name, setName] = useState(initial);
  const [levelKey, setLevelKey] = useState(level ?? floors[0]?.key ?? '');
  const floor = floors.find((f) => f.key === levelKey);
  if (!open) return <button className="chip cad-addroom" onClick={() => setOpen(true)}>Add as room…</button>;
  if (!floors.length) return <p className="m">Add the building and its levels in Building information first; rooms are kept per level.</p>;
  return (
    <div className="cad-roomform">
      <label>Name<input value={name} placeholder="e.g. Majlis" onChange={(e) => setName(e.target.value)} /></label>
      <label>Level<select value={levelKey} onChange={(e) => setLevelKey(e.target.value)}>{floors.map((f) => <option key={f.key} value={f.key}>{floorLabel(project.building, f)}</option>)}</select></label>
      <button className="chip primary" disabled={!floor} onClick={() => {
        const room = pickedRoom(project, name.trim(), areaM2, file, floor!.ref, outline);
        const { project: next } = putRooms(project, [room], floor!.ref, []);
        onChange(next, `${room.name} · ${m2(room.areaM2)} added to ${floorLabel(project.building, floor!)} · ⌘Z to undo`);
        setOpen(false); onAdded();
      }}>Add</button>
    </div>
  );
}
