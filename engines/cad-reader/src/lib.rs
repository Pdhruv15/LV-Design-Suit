//! LV Design Studio CAD reader: a DWG / DXF floor plan (bytes) → the model-space entities a plan read needs, as JSON.
//!
//! Built once to WebAssembly (`npm run build:cad`) and run by the desktop app and the CLI. 2D plan geometry only:
//! lines, arcs, polylines (with bulges), hatch outer boundaries, texts and blocks with their attributes, each with its
//! layer, handle and LVDS tag (extended data). The plan logic itself (rooms, routes, trays) stays in TypeScript.

use acadrust::entities::mtext_format::parse_mtext;
use acadrust::entities::{BoundaryEdge, BoundaryPath, EntityCommon, EntityType};
use acadrust::{CadDocument, DwgReader, DxfReader};
use serde::Serialize;
use std::collections::BTreeMap;
use std::io::Cursor;

/// Extended-data application LV Design Studio tags drawing objects with ("route:<id>", "tray:<name>", …).
const TAG_APP: &str = "LVDS";

#[derive(Serialize)]
#[serde(tag = "k", rename_all = "lowercase")]
pub enum Item {
    Line { l: String, h: String, #[serde(skip_serializing_if = "Option::is_none")] x: Option<String>, a: [f64; 2], b: [f64; 2] },
    Arc { l: String, h: String, #[serde(skip_serializing_if = "Option::is_none")] x: Option<String>, c: [f64; 2], r: f64, s: f64, e: f64 },
    /// Polyline vertices as [x, y, bulge]; `closed` when the last vertex joins the first.
    Pline { l: String, h: String, #[serde(skip_serializing_if = "Option::is_none")] x: Option<String>, v: Vec<[f64; 3]>, closed: bool },
    /// A hatch's outer boundary as [x, y, bulge].
    Hatch { l: String, h: String, #[serde(skip_serializing_if = "Option::is_none")] x: Option<String>, v: Vec<[f64; 3]> },
    /// Text with its height (drawing units).
    Text { l: String, h: String, at: [f64; 2], s: String, ht: f64 },
    Insert { l: String, h: String, #[serde(skip_serializing_if = "Option::is_none")] x: Option<String>, name: String, at: [f64; 2], attrs: BTreeMap<String, String> },
}

#[derive(Serialize)]
pub struct Drawing {
    pub format: &'static str,
    pub units: i16,
    pub entities: Vec<Item>,
}

fn handle(c: &EntityCommon) -> String {
    format!("{:X}", c.handle.value())
}

/// The LVDS tag of an entity: the first string of its LVDS extended data.
fn tag(c: &EntityCommon) -> Option<String> {
    c.extended_data.get_record(TAG_APP)?.values.iter().find_map(|v| match v {
        acadrust::xdata::XDataValue::String(s) => Some(s.clone()),
        _ => None,
    })
}

fn hatch_outline(paths: &[BoundaryPath]) -> Vec<[f64; 3]> {
    let Some(path) = paths.iter().find(|p| p.flags.is_external()).or(paths.first()) else { return Vec::new() };
    let mut out = Vec::new();
    for edge in &path.edges {
        match edge {
            BoundaryEdge::Polyline(p) => out.extend(p.vertices.iter().map(|v| [v.x, v.y, v.z])),
            BoundaryEdge::Line(l) => out.push([l.start.x, l.start.y, 0.0]),
            _ => {}
        }
    }
    out
}

fn item(e: &EntityType) -> Option<Item> {
    Some(match e {
        EntityType::Line(x) => Item::Line { l: x.common.layer.clone(), h: handle(&x.common), x: tag(&x.common), a: [x.start.x, x.start.y], b: [x.end.x, x.end.y] },
        EntityType::Arc(x) => Item::Arc { l: x.common.layer.clone(), h: handle(&x.common), x: tag(&x.common), c: [x.center.x, x.center.y], r: x.radius, s: x.start_angle, e: x.end_angle },
        EntityType::LwPolyline(x) => Item::Pline {
            l: x.common.layer.clone(), h: handle(&x.common), x: tag(&x.common),
            v: x.vertices.iter().map(|v| [v.location.x, v.location.y, v.bulge]).collect(), closed: x.is_closed,
        },
        EntityType::Polyline2D(x) => Item::Pline {
            l: x.common.layer.clone(), h: handle(&x.common), x: tag(&x.common),
            v: x.vertices.iter().map(|v| [v.location.x, v.location.y, v.bulge]).collect(), closed: x.is_closed(),
        },
        EntityType::Hatch(x) => Item::Hatch { l: x.common.layer.clone(), h: handle(&x.common), x: tag(&x.common), v: hatch_outline(&x.paths) },
        EntityType::Text(x) => Item::Text { l: x.common.layer.clone(), h: handle(&x.common), at: [x.insertion_point.x, x.insertion_point.y], s: x.value.clone(), ht: x.height },
        EntityType::MText(x) => Item::Text {
            l: x.common.layer.clone(), h: handle(&x.common), at: [x.insertion_point.x, x.insertion_point.y],
            s: parse_mtext(&x.value, true).to_plain_text(), ht: x.height,
        },
        EntityType::Insert(x) => Item::Insert {
            l: x.common.layer.clone(), h: handle(&x.common), x: tag(&x.common), name: x.block_name.clone(),
            at: [x.insert_point.x, x.insert_point.y],
            attrs: x.attributes.iter().map(|a| (a.tag.clone(), a.value.clone())).collect(),
        },
        _ => return None,
    })
}

/// Reads a DWG (starts with "AC10") or DXF drawing.
pub fn read(bytes: Vec<u8>) -> Result<Drawing, String> {
    let dwg = bytes.starts_with(b"AC10");
    let doc: CadDocument = if dwg {
        DwgReader::from_stream(Cursor::new(bytes)).read().map_err(|e| e.to_string())?
    } else {
        DxfReader::from_reader(Cursor::new(bytes)).and_then(|r| r.read()).map_err(|e| e.to_string())?
    };
    Ok(Drawing {
        format: if dwg { "DWG" } else { "DXF" },
        units: doc.header.insertion_units,
        entities: doc.model_space_entities().filter_map(item).collect(),
    })
}

/// JSON for the host: `{ "ok": true, "drawing": … }` or `{ "ok": false, "error": "…" }`.
pub fn read_json(bytes: Vec<u8>) -> String {
    match read(bytes) {
        Ok(d) => serde_json::json!({ "ok": true, "drawing": d }).to_string(),
        Err(e) => serde_json::json!({ "ok": false, "error": e }).to_string(),
    }
}

/// WebAssembly entry point: the drawing's bytes → JSON (see `read_json`).
#[wasm_bindgen::prelude::wasm_bindgen(js_name = readDrawing)]
pub fn read_drawing(bytes: Vec<u8>) -> String {
    read_json(bytes)
}
