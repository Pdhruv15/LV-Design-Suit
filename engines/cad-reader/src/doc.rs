//! The CAD view's document: a DWG / DXF drawing flattened for drawing and snapping, as a CAD program shows model space.
//! Blocks are expanded with their transforms (nested, arrays), colours resolved (ByLayer / ByBlock / index / true
//! colour), curves tessellated, texts kept with their height and rotation, and snap points (endpoint, midpoint,
//! centre, quadrant, insertion, node) indexed on a grid with the segments for intersections. 2D (plan) only.

use acadrust::entities::mtext_format::parse_mtext;
use acadrust::entities::{BoundaryEdge, EntityType};
use acadrust::types::Color;
use acadrust::{CadDocument, DwgReader, DxfReader};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use std::f64::consts::PI;
use std::io::Cursor;
use wasm_bindgen::prelude::*;

/// Snap kinds (bits of the snap mask).
pub const ENDPOINT: u32 = 1;
pub const MIDPOINT: u32 = 2;
pub const CENTER: u32 = 4;
pub const INTERSECTION: u32 = 8;
pub const INSERTION: u32 = 16;
pub const NODE: u32 = 32;
pub const QUADRANT: u32 = 64;

/// Colour for "foreground" (index 7: white on dark, black on light), decided by the view.
const INK: u32 = 0xFF00_0007;
const MAX_SEGMENTS: usize = 3_000_000;
const MAX_DEPTH: u32 = 12;

#[derive(Clone, Copy)]
struct Affine { a: f64, b: f64, c: f64, d: f64, e: f64, f: f64 } // x' = a x + c y + e; y' = b x + d y + f

impl Affine {
    const ID: Affine = Affine { a: 1.0, b: 0.0, c: 0.0, d: 1.0, e: 0.0, f: 0.0 };
    fn apply(&self, x: f64, y: f64) -> (f64, f64) { (self.a * x + self.c * y + self.e, self.b * x + self.d * y + self.f) }
    fn then(&self, o: &Affine) -> Affine {
        // self ∘ o: apply o first, then self
        Affine {
            a: self.a * o.a + self.c * o.b, b: self.b * o.a + self.d * o.b,
            c: self.a * o.c + self.c * o.d, d: self.b * o.c + self.d * o.d,
            e: self.a * o.e + self.c * o.f + self.e, f: self.b * o.e + self.d * o.f + self.f,
        }
    }
    fn translate(x: f64, y: f64) -> Affine { Affine { e: x, f: y, ..Affine::ID } }
    fn rotate(r: f64) -> Affine { let (s, c) = r.sin_cos(); Affine { a: c, b: s, c: -s, d: c, e: 0.0, f: 0.0 } }
    fn scale(x: f64, y: f64) -> Affine { Affine { a: x, b: 0.0, c: 0.0, d: y, e: 0.0, f: 0.0 } }
    /// Length scale (for text heights and radii).
    fn size(&self) -> f64 { (self.a * self.d - self.b * self.c).abs().sqrt() }
    fn angle(&self) -> f64 { self.b.atan2(self.a) }
}

#[derive(Serialize)]
struct LayerInfo { name: String, rgb: u32, on: bool, count: u32 }

#[derive(Serialize)]
struct TextItem { x: f64, y: f64, h: f64, rot: f64, s: String, layer: u16, rgb: u32, align: u8, o: u32 }

/** What one object of model space is, for inspecting it: kind, layer, handle, block and attributes, and its length /
 * area in drawing units. Its drawn segments are `seg_start..seg_end`. */
#[derive(Serialize, Clone, Default)]
struct ObjInfo {
    kind: &'static str,
    layer: u16,
    handle: String,
    #[serde(skip_serializing_if = "Option::is_none")] block: Option<String>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")] attrs: BTreeMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")] length: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] area: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] radius: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] vertices: Option<usize>,
    closed: bool,
    seg_start: u32,
    seg_end: u32,
}

struct SnapPoint { x: f64, y: f64, kind: u32, layer: u16 }

#[wasm_bindgen]
pub struct CadDoc {
    format: &'static str,
    units: i16,
    origin: (f64, f64),
    segs: Vec<f64>, // x1, y1, x2, y2 in drawing units
    seg_layer: Vec<u16>,
    seg_rgb: Vec<u32>,
    seg_real: Vec<bool>, // a drawn straight piece (not a curve tessellation step) — used for intersections
    seg_obj: Vec<u32>, // the model-space object each segment belongs to
    objects: Vec<ObjInfo>,
    texts: Vec<TextItem>,
    snaps: Vec<SnapPoint>,
    layers: Vec<LayerInfo>,
    grid: Grid,
    truncated: bool,
}

struct Grid { x0: f64, y0: f64, cell: f64, nx: usize, ny: usize, segs: Vec<Vec<u32>>, pts: Vec<Vec<u32>> }

impl Grid {
    fn cell_of(&self, x: f64, y: f64) -> (usize, usize) {
        let cx = ((x - self.x0) / self.cell).floor().clamp(0.0, (self.nx - 1) as f64) as usize;
        let cy = ((y - self.y0) / self.cell).floor().clamp(0.0, (self.ny - 1) as f64) as usize;
        (cx, cy)
    }
}

struct Builder<'a> {
    doc: &'a CadDocument,
    layer_index: HashMap<String, u16>,
    layer_rgb: Vec<u32>,
    blocks: HashMap<String, (f64, f64)>, // block name (upper) → base point
    out: CadDoc,
    current: u32,
}

fn rgb_of(c: &Color) -> Option<u32> {
    match c {
        Color::Index(7) => Some(INK),
        _ => c.rgb().map(|(r, g, b)| ((r as u32) << 16) | ((g as u32) << 8) | b as u32),
    }
}

impl<'a> Builder<'a> {
    fn layer(&mut self, name: &str) -> u16 {
        if let Some(i) = self.layer_index.get(name) { return *i; }
        let i = self.out.layers.len() as u16;
        self.out.layers.push(LayerInfo { name: name.to_string(), rgb: INK, on: true, count: 0 });
        self.layer_rgb.push(INK);
        self.layer_index.insert(name.to_string(), i);
        i
    }

    /// The layer and colour an entity is drawn with: layer "0" and ByBlock inside a block take the insert's.
    fn style(&mut self, layer: &str, color: &Color, parent: (u16, u32)) -> (u16, u32) {
        let l = if layer == "0" && parent.0 != u16::MAX { parent.0 } else { self.layer(layer) };
        let rgb = match color {
            Color::ByLayer => self.layer_rgb[l as usize],
            Color::ByBlock => if parent.1 == u32::MAX { INK } else { parent.1 },
            Color::None => INK,
            c => rgb_of(c).unwrap_or(INK),
        };
        (l, rgb)
    }

    fn seg(&mut self, t: &Affine, p: (f64, f64), q: (f64, f64), l: u16, rgb: u32, real: bool) {
        if self.out.seg_layer.len() >= MAX_SEGMENTS { self.out.truncated = true; return; }
        let (x1, y1) = t.apply(p.0, p.1);
        let (x2, y2) = t.apply(q.0, q.1);
        if !(x1.is_finite() && y1.is_finite() && x2.is_finite() && y2.is_finite()) { return; }
        self.out.segs.extend_from_slice(&[x1, y1, x2, y2]);
        self.out.seg_layer.push(l);
        self.out.seg_rgb.push(rgb);
        self.out.seg_real.push(real);
        self.out.seg_obj.push(self.current);
        self.out.layers[l as usize].count += 1;
    }

    fn snap(&mut self, t: &Affine, p: (f64, f64), kind: u32, l: u16) {
        let (x, y) = t.apply(p.0, p.1);
        if x.is_finite() && y.is_finite() { self.out.snaps.push(SnapPoint { x, y, kind, layer: l }); }
    }

    fn polyline(&mut self, t: &Affine, pts: &[(f64, f64, f64)], closed: bool, l: u16, rgb: u32) {
        let n = pts.len();
        if n == 0 { return; }
        let last = if closed { n } else { n - 1 };
        for i in 0..last {
            let a = pts[i];
            let b = pts[(i + 1) % n];
            if a.2.abs() < 1e-9 {
                self.seg(t, (a.0, a.1), (b.0, b.1), l, rgb, true);
                self.snap(t, ((a.0 + b.0) / 2.0, (a.1 + b.1) / 2.0), MIDPOINT, l);
            } else {
                // Bulged (arc) segment: bulge = tan(θ/4)
                let theta = 4.0 * a.2.atan();
                let chord = ((b.0 - a.0).powi(2) + (b.1 - a.1).powi(2)).sqrt();
                if chord < 1e-12 { continue; }
                let r = chord / (2.0 * (theta.abs() / 2.0).sin());
                let mx = (a.0 + b.0) / 2.0;
                let my = (a.1 + b.1) / 2.0;
                let h = (r * r - (chord / 2.0).powi(2)).max(0.0).sqrt() * if theta.abs() > PI { -1.0 } else { 1.0 } * theta.signum();
                let cx = mx - h * (b.1 - a.1) / chord;
                let cy = my + h * (b.0 - a.0) / chord;
                let start = (a.1 - cy).atan2(a.0 - cx);
                self.arc_pts(t, (cx, cy), r, start, start + theta, l, rgb);
                let mid = start + theta / 2.0;
                self.snap(t, (cx + r * mid.cos(), cy + r * mid.sin()), MIDPOINT, l);
                self.snap(t, (cx, cy), CENTER, l);
            }
        }
        for p in pts { self.snap(t, (p.0, p.1), ENDPOINT, l); }
    }

    fn arc_pts(&mut self, t: &Affine, c: (f64, f64), r: f64, a0: f64, a1: f64, l: u16, rgb: u32) {
        let sweep = a1 - a0;
        let n = ((sweep.abs() / (PI / 36.0)).ceil() as usize).clamp(2, 256);
        let mut prev = (c.0 + r * a0.cos(), c.1 + r * a0.sin());
        for i in 1..=n {
            let a = a0 + sweep * i as f64 / n as f64;
            let p = (c.0 + r * a.cos(), c.1 + r * a.sin());
            self.seg(t, prev, p, l, rgb, false);
            prev = p;
        }
    }

    fn text(&mut self, t: &Affine, at: (f64, f64), h: f64, rot: f64, s: String, l: u16, rgb: u32, align: u8) {
        if s.trim().is_empty() { return; }
        let (x, y) = t.apply(at.0, at.1);
        self.out.texts.push(TextItem { x, y, h: h * t.size(), rot: rot + t.angle(), s, layer: l, rgb, align, o: self.current });
        self.snap(t, at, INSERTION, l);
    }

    fn entity(&mut self, e: &EntityType, t: &Affine, parent: (u16, u32), depth: u32) {
        let c = e.common();
        if c.invisible { return; }
        let (l, rgb) = self.style(&c.layer, &c.color, parent);
        // Entities whose extrusion points down (mirrored in plan): x mirrored in their own coordinates.
        let mirror = |n: &acadrust::types::Vector3, t: &Affine| if n.z < -0.5 { t.then(&Affine::scale(-1.0, 1.0)) } else { *t };
        match e {
            EntityType::Line(x) => {
                self.seg(t, (x.start.x, x.start.y), (x.end.x, x.end.y), l, rgb, true);
                self.snap(t, (x.start.x, x.start.y), ENDPOINT, l);
                self.snap(t, (x.end.x, x.end.y), ENDPOINT, l);
                self.snap(t, ((x.start.x + x.end.x) / 2.0, (x.start.y + x.end.y) / 2.0), MIDPOINT, l);
            }
            EntityType::Arc(x) => {
                let t = mirror(&x.normal, t);
                let mut a1 = x.end_angle;
                while a1 <= x.start_angle { a1 += 2.0 * PI; }
                self.arc_pts(&t, (x.center.x, x.center.y), x.radius, x.start_angle, a1, l, rgb);
                let c = (x.center.x, x.center.y);
                for a in [x.start_angle, a1] { self.snap(&t, (c.0 + x.radius * a.cos(), c.1 + x.radius * a.sin()), ENDPOINT, l); }
                let m = (x.start_angle + a1) / 2.0;
                self.snap(&t, (c.0 + x.radius * m.cos(), c.1 + x.radius * m.sin()), MIDPOINT, l);
                self.snap(&t, c, CENTER, l);
            }
            EntityType::Circle(x) => {
                let t = mirror(&x.normal, t);
                let c = (x.center.x, x.center.y);
                self.arc_pts(&t, c, x.radius, 0.0, 2.0 * PI, l, rgb);
                self.snap(&t, c, CENTER, l);
                for k in 0..4 { let a = k as f64 * PI / 2.0; self.snap(&t, (c.0 + x.radius * a.cos(), c.1 + x.radius * a.sin()), QUADRANT, l); }
            }
            EntityType::Ellipse(x) => {
                let (mx, my) = (x.major_axis.x, x.major_axis.y);
                let (nx, ny) = (-my * x.minor_axis_ratio, mx * x.minor_axis_ratio);
                let mut p1 = x.end_parameter;
                while p1 <= x.start_parameter { p1 += 2.0 * PI; }
                let n = (((p1 - x.start_parameter) / (PI / 36.0)).ceil() as usize).clamp(4, 256);
                let at = |p: f64| (x.center.x + mx * p.cos() + nx * p.sin(), x.center.y + my * p.cos() + ny * p.sin());
                let mut prev = at(x.start_parameter);
                for i in 1..=n { let q = at(x.start_parameter + (p1 - x.start_parameter) * i as f64 / n as f64); self.seg(t, prev, q, l, rgb, false); prev = q; }
                self.snap(t, (x.center.x, x.center.y), CENTER, l);
            }
            EntityType::LwPolyline(x) => {
                let t = mirror(&x.normal, t);
                let pts: Vec<_> = x.vertices.iter().map(|v| (v.location.x, v.location.y, v.bulge)).collect();
                self.polyline(&t, &pts, x.is_closed, l, rgb);
            }
            EntityType::Polyline2D(x) => {
                let t = mirror(&x.normal, t);
                let pts: Vec<_> = x.vertices.iter().map(|v| (v.location.x, v.location.y, v.bulge)).collect();
                self.polyline(&t, &pts, x.is_closed(), l, rgb);
            }
            EntityType::Polyline3D(x) => {
                let pts: Vec<_> = x.vertices.iter().map(|v| (v.position.x, v.position.y, 0.0)).collect();
                self.polyline(t, &pts, x.is_closed(), l, rgb);
            }
            EntityType::Spline(x) => {
                let pts = spline_points(x);
                for w in pts.windows(2) { self.seg(t, w[0], w[1], l, rgb, false); }
                if let (Some(a), Some(b)) = (pts.first(), pts.last()) { self.snap(t, *a, ENDPOINT, l); self.snap(t, *b, ENDPOINT, l); }
            }
            EntityType::Solid(x) => {
                let p = [(x.first_corner.x, x.first_corner.y), (x.second_corner.x, x.second_corner.y), (x.fourth_corner.x, x.fourth_corner.y), (x.third_corner.x, x.third_corner.y)];
                for i in 0..4 { self.seg(t, p[i], p[(i + 1) % 4], l, rgb, true); self.snap(t, p[i], ENDPOINT, l); }
            }
            EntityType::Hatch(x) => {
                for path in &x.paths {
                    for edge in &path.edges {
                        match edge {
                            BoundaryEdge::Line(e) => self.seg(t, (e.start.x, e.start.y), (e.end.x, e.end.y), l, rgb, true),
                            BoundaryEdge::Polyline(p) => {
                                let pts: Vec<_> = p.vertices.iter().map(|v| (v.x, v.y, v.z)).collect();
                                self.polyline(t, &pts, p.is_closed, l, rgb);
                            }
                            BoundaryEdge::CircularArc(a) => {
                                let (mut a0, mut a1) = (a.start_angle, a.end_angle);
                                if !a.counter_clockwise { std::mem::swap(&mut a0, &mut a1); }
                                while a1 <= a0 { a1 += 2.0 * PI; }
                                self.arc_pts(t, (a.center.x, a.center.y), a.radius, a0, a1, l, rgb);
                            }
                            _ => {}
                        }
                    }
                }
            }
            EntityType::Text(x) => {
                let left = x.alignment_point.is_none() || matches!(x.horizontal_alignment, acadrust::entities::TextHorizontalAlignment::Left);
                let at = if left { (x.insertion_point.x, x.insertion_point.y) } else { let p = x.alignment_point.unwrap(); (p.x, p.y) };
                let align = match x.horizontal_alignment { acadrust::entities::TextHorizontalAlignment::Left => 0, acadrust::entities::TextHorizontalAlignment::Right => 2, _ => 1 };
                self.text(t, at, x.height, x.rotation, x.value.clone(), l, rgb, if left { 0 } else { align });
            }
            EntityType::MText(x) => {
                let s = parse_mtext(&x.value, true).to_plain_text();
                for (i, line) in s.lines().enumerate() {
                    let dy = -(i as f64 + 1.0) * x.height * 1.66 + x.height * 0.66;
                    let (sin, cos) = x.rotation.sin_cos();
                    let at = (x.insertion_point.x - dy * sin, x.insertion_point.y + dy * cos);
                    self.text(t, at, x.height, x.rotation, line.to_string(), l, rgb, 0);
                }
            }
            EntityType::Point(x) => self.snap(t, (x.location.x, x.location.y), NODE, l),
            EntityType::Insert(x) => {
                if depth >= MAX_DEPTH { return; }
                let t0 = mirror(&x.normal, t);
                self.snap(&t0, (x.insert_point.x, x.insert_point.y), INSERTION, l);
                let base = self.blocks.get(&x.block_name.to_uppercase()).copied().unwrap_or((0.0, 0.0));
                let cols = x.column_count.max(1);
                let rows = x.row_count.max(1);
                for r in 0..rows {
                    for col in 0..cols {
                        let off = Affine::rotate(x.rotation).apply(col as f64 * x.column_spacing, r as f64 * x.row_spacing);
                        let local = Affine::translate(x.insert_point.x + off.0, x.insert_point.y + off.1)
                            .then(&Affine::rotate(x.rotation))
                            .then(&Affine::scale(x.x_scale(), x.y_scale()))
                            .then(&Affine::translate(-base.0, -base.1));
                        let tt = t0.then(&local);
                        let name = x.block_name.clone();
                        let children: Vec<&EntityType> = self.doc.entities_in_block(&name).collect();
                        for child in children { self.entity(child, &tt, (l, rgb), depth + 1); }
                    }
                }
                for a in &x.attributes {
                    if a.common.invisible { continue; }
                    let (al, argb) = self.style(&a.common.layer, &a.common.color, (l, rgb));
                    self.text(t, (a.insertion_point.x, a.insertion_point.y), a.height, a.rotation, a.value.clone(), al, argb, 0);
                }
            }
            EntityType::Dimension(x) => {
                if depth >= MAX_DEPTH { return; }
                let name = x.base().block_name.clone();
                if name.is_empty() { return; }
                let children: Vec<&EntityType> = self.doc.entities_in_block(&name).collect();
                for child in children { self.entity(child, t, (l, rgb), depth + 1); }
            }
            _ => {}
        }
    }
}

/// Points along a spline: its B-spline evaluated (de Boor, rational with weights), else its fit or control points.
fn spline_points(s: &acadrust::entities::Spline) -> Vec<(f64, f64)> {
    let p = s.degree.max(1) as usize;
    let cp = &s.control_points;
    let k = &s.knots;
    if cp.len() > p && k.len() == cp.len() + p + 1 {
        let w = |i: usize| if s.weights.len() == cp.len() { s.weights[i] } else { 1.0 };
        let (t0, t1) = (k[p], k[cp.len()]);
        let steps = (cp.len() * 8).clamp(16, 2000);
        let mut out = Vec::with_capacity(steps + 1);
        for n in 0..=steps {
            let u = t0 + (t1 - t0) * n as f64 / steps as f64;
            let mut span = p;
            while span < cp.len() - 1 && u >= k[span + 1] { span += 1; }
            let mut d: Vec<(f64, f64, f64)> = (0..=p).map(|j| { let i = span - p + j; let wi = w(i); (cp[i].x * wi, cp[i].y * wi, wi) }).collect();
            for r in 1..=p {
                for j in (r..=p).rev() {
                    let i = span - p + j;
                    let den = k[i + p + 1 - r] - k[i];
                    let a = if den.abs() < 1e-12 { 0.0 } else { (u - k[i]) / den };
                    d[j] = ((1.0 - a) * d[j - 1].0 + a * d[j].0, (1.0 - a) * d[j - 1].1 + a * d[j].1, (1.0 - a) * d[j - 1].2 + a * d[j].2);
                }
            }
            let q = d[p];
            if q.2.abs() > 1e-12 { out.push((q.0 / q.2, q.1 / q.2)); }
        }
        return out;
    }
    let src = if !s.fit_points.is_empty() { &s.fit_points } else { cp };
    src.iter().map(|v| (v.x, v.y)).collect()
}

/// Length and (when closed) area of a polyline with bulges: vertices [x, y, bulge].
fn poly_measure(v: &[(f64, f64, f64)], closed: bool) -> (f64, f64) {
    let n = v.len();
    if n < 2 { return (0.0, 0.0); }
    let (mut len, mut twice_area) = (0.0, 0.0);
    let last = if closed { n } else { n - 1 };
    for i in 0..last {
        let (a, b) = (v[i], v[(i + 1) % n]);
        let chord = ((b.0 - a.0).powi(2) + (b.1 - a.1).powi(2)).sqrt();
        twice_area += a.0 * b.1 - b.0 * a.1;
        if a.2.abs() < 1e-12 || chord < 1e-12 { len += chord; continue; }
        let theta = 4.0 * a.2.atan();
        let r = chord / (2.0 * (theta.abs() / 2.0).sin());
        len += r * theta.abs();
        // the arc's segment beyond the chord, on the bulge's side
        twice_area += theta.signum() * r * r * (theta.abs() - theta.abs().sin());
    }
    (len, if closed { (twice_area / 2.0).abs() } else { 0.0 })
}

/// What a model-space object is (kind, handle, block, attributes, length, area) in its own coordinates.
fn describe(e: &EntityType) -> ObjInfo {
    let c = e.common();
    let mut o = ObjInfo { handle: format!("{:X}", c.handle.value()), ..Default::default() };
    match e {
        EntityType::Line(x) => { o.kind = "Line"; o.length = Some(((x.end.x - x.start.x).powi(2) + (x.end.y - x.start.y).powi(2)).sqrt()); }
        EntityType::Arc(x) => {
            o.kind = "Arc"; o.radius = Some(x.radius);
            let mut sweep = x.end_angle - x.start_angle;
            while sweep <= 0.0 { sweep += 2.0 * PI; }
            o.length = Some(x.radius * sweep);
        }
        EntityType::Circle(x) => { o.kind = "Circle"; o.radius = Some(x.radius); o.length = Some(2.0 * PI * x.radius); o.area = Some(PI * x.radius * x.radius); o.closed = true; }
        EntityType::Ellipse(x) => {
            o.kind = "Ellipse";
            let a = (x.major_axis.x.powi(2) + x.major_axis.y.powi(2)).sqrt();
            let b = a * x.minor_axis_ratio;
            let full = ((x.end_parameter - x.start_parameter).abs() - 2.0 * PI).abs() < 1e-6 || (x.end_parameter - x.start_parameter).abs() < 1e-9;
            if full {
                o.closed = true; o.area = Some(PI * a * b);
                let h = ((a - b) / (a + b)).powi(2);
                o.length = Some(PI * (a + b) * (1.0 + 3.0 * h / (10.0 + (4.0 - 3.0 * h).sqrt())));
            }
        }
        EntityType::LwPolyline(x) => {
            o.kind = "Polyline"; o.closed = x.is_closed; o.vertices = Some(x.vertices.len());
            let v: Vec<_> = x.vertices.iter().map(|v| (v.location.x, v.location.y, v.bulge)).collect();
            let (l, a) = poly_measure(&v, x.is_closed);
            o.length = Some(l); if x.is_closed { o.area = Some(a); }
        }
        EntityType::Polyline2D(x) => {
            o.kind = "Polyline"; o.closed = x.is_closed(); o.vertices = Some(x.vertices.len());
            let v: Vec<_> = x.vertices.iter().map(|v| (v.location.x, v.location.y, v.bulge)).collect();
            let (l, a) = poly_measure(&v, x.is_closed());
            o.length = Some(l); if x.is_closed() { o.area = Some(a); }
        }
        EntityType::Polyline3D(x) => {
            o.kind = "3D polyline"; o.closed = x.is_closed(); o.vertices = Some(x.vertices.len());
            let v: Vec<_> = x.vertices.iter().map(|v| (v.position.x, v.position.y, 0.0)).collect();
            o.length = Some(poly_measure(&v, x.is_closed()).0);
        }
        EntityType::Spline(x) => {
            o.kind = "Spline";
            let p = spline_points(x);
            o.length = Some(p.windows(2).map(|w| ((w[1].0 - w[0].0).powi(2) + (w[1].1 - w[0].1).powi(2)).sqrt()).sum());
        }
        EntityType::Hatch(x) => {
            o.kind = "Hatch"; o.closed = true;
            let path = x.paths.iter().find(|p| p.flags.is_external()).or(x.paths.first());
            if let Some(path) = path {
                let mut v = Vec::new();
                for edge in &path.edges {
                    match edge {
                        BoundaryEdge::Polyline(p) => v.extend(p.vertices.iter().map(|q| (q.x, q.y, q.z))),
                        BoundaryEdge::Line(l) => v.push((l.start.x, l.start.y, 0.0)),
                        _ => {}
                    }
                }
                if v.len() >= 3 { let (l, a) = poly_measure(&v, true); o.length = Some(l); o.area = Some(a); }
            }
        }
        EntityType::Solid(x) => {
            o.kind = "Solid"; o.closed = true;
            let v = [(x.first_corner.x, x.first_corner.y, 0.0), (x.second_corner.x, x.second_corner.y, 0.0), (x.fourth_corner.x, x.fourth_corner.y, 0.0), (x.third_corner.x, x.third_corner.y, 0.0)];
            let (l, a) = poly_measure(&v, true); o.length = Some(l); o.area = Some(a);
        }
        EntityType::Text(x) => { o.kind = "Text"; o.text = Some(x.value.clone()); }
        EntityType::MText(x) => { o.kind = "Multiline text"; o.text = Some(parse_mtext(&x.value, true).to_plain_text()); }
        EntityType::Point(_) => { o.kind = "Point"; }
        EntityType::Insert(x) => {
            o.kind = "Block"; o.block = Some(x.block_name.clone());
            for a in &x.attributes { o.attrs.insert(a.tag.clone(), a.value.clone()); }
        }
        EntityType::Dimension(x) => { o.kind = "Dimension"; o.length = Some(x.base().actual_measurement); }
        _ => { o.kind = "Other"; }
    }
    o
}

fn read(bytes: Vec<u8>) -> Result<(CadDocument, &'static str), String> {
    if bytes.starts_with(b"AC10") {
        DwgReader::from_stream(Cursor::new(bytes)).read().map(|d| (d, "DWG")).map_err(|e| e.to_string())
    } else {
        DxfReader::from_reader(Cursor::new(bytes)).and_then(|r| r.read()).map(|d| (d, "DXF")).map_err(|e| e.to_string())
    }
}

#[wasm_bindgen]
impl CadDoc {
    /// Opens a DWG (R13–2018) or DXF drawing.
    #[wasm_bindgen(constructor)]
    pub fn new(bytes: Vec<u8>) -> Result<CadDoc, JsError> {
        let (doc, format) = read(bytes).map_err(|e| JsError::new(&e))?;
        let mut b = Builder {
            doc: &doc,
            layer_index: HashMap::new(),
            layer_rgb: Vec::new(),
            blocks: HashMap::new(),
            current: 0,
            out: CadDoc { format, units: doc.header.insertion_units, origin: (0.0, 0.0), segs: vec![], seg_layer: vec![], seg_rgb: vec![], seg_real: vec![], seg_obj: vec![], objects: vec![], texts: vec![], snaps: vec![], layers: vec![], grid: Grid { x0: 0.0, y0: 0.0, cell: 1.0, nx: 1, ny: 1, segs: vec![vec![]], pts: vec![vec![]] }, truncated: false },
        };
        for layer in doc.layers.iter() {
            let i = b.layer(&layer.name);
            let rgb = rgb_of(&layer.color).unwrap_or(INK);
            b.layer_rgb[i as usize] = rgb;
            b.out.layers[i as usize].rgb = rgb;
            b.out.layers[i as usize].on = !layer.is_off() && !layer.is_frozen();
        }
        for rec in doc.block_records.iter() {
            if let Some(EntityType::Block(blk)) = doc.get_entity(rec.block_entity_handle) {
                b.blocks.insert(rec.name.to_uppercase(), (blk.base_point.x, blk.base_point.y));
            }
        }
        let model: Vec<&EntityType> = doc.model_space_entities().collect();
        for e in model {
            let mut info = describe(e);
            info.layer = b.layer(&e.common().layer);
            info.seg_start = b.out.seg_layer.len() as u32;
            b.current = b.out.objects.len() as u32;
            b.out.objects.push(info);
            b.entity(e, &Affine::ID, (u16::MAX, u32::MAX), 0);
            let end = b.out.seg_layer.len() as u32;
            b.out.objects.last_mut().unwrap().seg_end = end;
        }
        let mut out = b.out;
        out.build_grid();
        Ok(out)
    }

    /// Drawing facts as JSON: format, units (INSUNITS), origin, extents (most of the drawing), layers, texts, counts.
    pub fn info(&self) -> String {
        let (x0, y0, x1, y1) = self.extents();
        serde_json::json!({
            "format": self.format, "units": self.units, "origin": [self.origin.0, self.origin.1],
            "extents": [x0, y0, x1, y1], "layers": self.layers, "texts": self.texts,
            "segments": self.seg_layer.len(), "snaps": self.snaps.len(), "truncated": self.truncated
        }).to_string()
    }

    /// Segments x1, y1, x2, y2 relative to the origin (single precision is enough for drawing).
    pub fn segments(&self) -> Vec<f32> {
        self.segs.chunks(4).flat_map(|s| [(s[0] - self.origin.0) as f32, (s[1] - self.origin.1) as f32, (s[2] - self.origin.0) as f32, (s[3] - self.origin.1) as f32]).collect()
    }
    pub fn segment_layers(&self) -> Vec<u16> { self.seg_layer.clone() }
    /// Colour of each segment: 0xRRGGBB, or 0xFF000007 for the foreground (index 7).
    pub fn segment_colors(&self) -> Vec<u32> { self.seg_rgb.clone() }

    /// The object under (x, y) within `tol` (drawing units) on shown layers, as JSON (ObjInfo with its `id`), or "".
    /// The nearest drawn line wins; a text wins when the point is on it. `closed_only` considers only objects with an
    /// area (closed polylines, circles, hatches…), as for AREA → Object.
    pub fn pick(&self, x: f64, y: f64, tol: f64, layers_on: &[u8], closed_only: bool) -> String {
        let on = |l: u16| layers_on.get(l as usize).map_or(true, |v| *v != 0);
        let wanted = |o: u32| !closed_only || self.objects.get(o as usize).map_or(false, |x| x.area.is_some());
        let mut best: Option<(f64, u32)> = None;
        let g = &self.grid;
        let (cx0, cy0) = g.cell_of(x - tol, y - tol);
        let (cx1, cy1) = g.cell_of(x + tol, y + tol);
        let mut seen = std::collections::HashSet::new();
        for cy in cy0..=cy1 {
            for cx in cx0..=cx1 {
                for &s in &g.segs[cy * g.nx + cx] {
                    if !seen.insert(s) || !on(self.seg_layer[s as usize]) || !wanted(self.seg_obj[s as usize]) { continue; }
                    let (x1, y1, x2, y2) = self.seg_at(s as usize);
                    let (dx, dy) = (x2 - x1, y2 - y1);
                    let l2 = dx * dx + dy * dy;
                    let t = if l2 > 0.0 { (((x - x1) * dx + (y - y1) * dy) / l2).clamp(0.0, 1.0) } else { 0.0 };
                    let d = ((x - x1 - t * dx).powi(2) + (y - y1 - t * dy).powi(2)).sqrt();
                    if d <= tol && best.map_or(true, |b| d < b.0) { best = Some((d, self.seg_obj[s as usize])); }
                }
            }
        }
        for t in &self.texts {
            if closed_only || !on(t.layer) || t.h <= 0.0 { continue; }
            let w = 0.6 * t.h * t.s.chars().count() as f64;
            let (sin, cos) = t.rot.sin_cos();
            let (px, py) = ((x - t.x) * cos + (y - t.y) * sin, -(x - t.x) * sin + (y - t.y) * cos);
            let x0 = match t.align { 1 => -w / 2.0, 2 => -w, _ => 0.0 };
            if px >= x0 - tol && px <= x0 + w + tol && py >= -tol && py <= t.h + tol { best = Some((0.0, t.o)); break; }
        }
        if best.is_none() && !closed_only {
            // Inside a block (a board symbol, a fitting) but not on its lines: the smallest block around the point.
            let mut inside: Option<(f64, u32)> = None;
            for (i, o) in self.objects.iter().enumerate() {
                if o.kind != "Block" || o.seg_end <= o.seg_start || !on(o.layer) { continue; }
                let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
                for sgi in o.seg_start..o.seg_end {
                    let (a, b, c, d) = self.seg_at(sgi as usize);
                    x0 = x0.min(a.min(c)); y0 = y0.min(b.min(d)); x1 = x1.max(a.max(c)); y1 = y1.max(b.max(d));
                }
                if x >= x0 && x <= x1 && y >= y0 && y <= y1 {
                    let area = (x1 - x0) * (y1 - y0);
                    if inside.map_or(true, |b| area < b.0) { inside = Some((area, i as u32)); }
                }
            }
            best = inside.map(|(_, i)| (0.0, i));
        }
        let Some((_, id)) = best else { return String::new() };
        let Some(o) = self.objects.get(id as usize) else { return String::new() };
        let mut v = serde_json::to_value(o).unwrap_or_default();
        v["id"] = serde_json::json!(id);
        v.to_string()
    }

    /// The snap point nearest (x, y) within r (drawing units): [x, y, kind], or empty. `mask` chooses the kinds,
    /// `layers_on` (one byte per layer, 1 = shown) leaves out hidden layers.
    pub fn snap(&self, x: f64, y: f64, r: f64, mask: u32, layers_on: &[u8]) -> Vec<f64> {
        let on = |l: u16| layers_on.get(l as usize).map_or(true, |v| *v != 0);
        let mut best: Option<(f64, f64, f64, u32)> = None;
        let consider = |px: f64, py: f64, kind: u32, best: &mut Option<(f64, f64, f64, u32)>| {
            let d = ((px - x).powi(2) + (py - y).powi(2)).sqrt();
            // Prefer the more specific kind at (almost) the same distance: endpoint and intersection over midpoint etc.
            let rank = match kind { ENDPOINT | INTERSECTION => 0.0, CENTER | INSERTION | NODE => 0.05, _ => 0.1 } * r;
            if d <= r && best.map_or(true, |b| d + rank < b.2) { *best = Some((px, py, d + rank, kind)); }
        };
        let g = &self.grid;
        let (cx0, cy0) = g.cell_of(x - r, y - r);
        let (cx1, cy1) = g.cell_of(x + r, y + r);
        let mut segs: Vec<u32> = Vec::new();
        for cy in cy0..=cy1 {
            for cx in cx0..=cx1 {
                let i = cy * g.nx + cx;
                for &p in &g.pts[i] {
                    let s = &self.snaps[p as usize];
                    if s.kind & mask != 0 && on(s.layer) { consider(s.x, s.y, s.kind, &mut best); }
                }
                if mask & INTERSECTION != 0 { segs.extend(g.segs[i].iter().copied().filter(|s| self.seg_real[*s as usize] && on(self.seg_layer[*s as usize]))); }
            }
        }
        if mask & INTERSECTION != 0 {
            segs.sort_unstable();
            segs.dedup();
            segs.truncate(400);
            for i in 0..segs.len() {
                for j in i + 1..segs.len() {
                    if let Some((px, py)) = self.cross(segs[i] as usize, segs[j] as usize) { consider(px, py, INTERSECTION, &mut best); }
                }
            }
        }
        best.map_or(vec![], |b| vec![b.0, b.1, b.3 as f64])
    }
}

impl CadDoc {
    fn seg_at(&self, i: usize) -> (f64, f64, f64, f64) { (self.segs[i * 4], self.segs[i * 4 + 1], self.segs[i * 4 + 2], self.segs[i * 4 + 3]) }

    fn cross(&self, i: usize, j: usize) -> Option<(f64, f64)> {
        let (x1, y1, x2, y2) = self.seg_at(i);
        let (x3, y3, x4, y4) = self.seg_at(j);
        let d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
        if d.abs() < 1e-12 { return None; }
        let t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d;
        let u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
        let e = 1e-9;
        if t < -e || t > 1.0 + e || u < -e || u > 1.0 + e { return None; }
        Some((x1 + t * (x2 - x1), y1 + t * (y2 - y1)))
    }

    /// The drawing's extents; when a few stray objects lie far away, where nearly all of it is (1st–99th percentile).
    fn extents(&self) -> (f64, f64, f64, f64) {
        let mut xs: Vec<f64> = self.segs.chunks(2).map(|p| p[0]).collect();
        let mut ys: Vec<f64> = self.segs.chunks(2).map(|p| p[1]).collect();
        for t in &self.texts { xs.push(t.x); ys.push(t.y); }
        if xs.is_empty() { return (0.0, 0.0, 1000.0, 1000.0); }
        xs.sort_by(|a, b| a.partial_cmp(b).unwrap());
        ys.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let at = |v: &Vec<f64>, f: f64| v[((v.len() - 1) as f64 * f) as usize];
        let full = (xs[0], ys[0], xs[xs.len() - 1], ys[ys.len() - 1]);
        let most = (at(&xs, 0.01), at(&ys, 0.01), at(&xs, 0.99), at(&ys, 0.99));
        // The whole drawing, unless a few stray objects far away would make it much larger than where nearly all of it is.
        let area = |e: (f64, f64, f64, f64)| ((e.2 - e.0).max(1e-9)) * ((e.3 - e.1).max(1e-9));
        if area(full) <= 25.0 * area(most) { return full; }
        let (mx, my) = ((most.2 - most.0) * 0.05, (most.3 - most.1) * 0.05);
        (most.0 - mx, most.1 - my, most.2 + mx, most.3 + my)
    }

    fn build_grid(&mut self) {
        let (x0, y0, x1, y1) = self.extents();
        self.origin = (x0, y0);
        // Cells over the main extents (with a margin); anything outside falls in the edge cells.
        let (w, h) = ((x1 - x0).max(1.0), (y1 - y0).max(1.0));
        let cell = (w.max(h) / 256.0).max(1e-6);
        let (gx0, gy0) = (x0 - w * 0.1, y0 - h * 0.1);
        let nx = (((w * 1.2) / cell).ceil() as usize).clamp(1, 512);
        let ny = (((h * 1.2) / cell).ceil() as usize).clamp(1, 512);
        let mut g = Grid { x0: gx0, y0: gy0, cell, nx, ny, segs: vec![Vec::new(); nx * ny], pts: vec![Vec::new(); nx * ny] };
        for (i, s) in self.segs.chunks(4).enumerate() {
            let (ax, ay) = g.cell_of(s[0].min(s[2]), s[1].min(s[3]));
            let (bx, by) = g.cell_of(s[0].max(s[2]), s[1].max(s[3]));
            if (bx - ax + 1) * (by - ay + 1) > 4096 { continue; } // very long lines: no intersections from the index
            for cy in ay..=by { for cx in ax..=bx { g.segs[cy * nx + cx].push(i as u32); } }
        }
        for (i, p) in self.snaps.iter().enumerate() {
            let (cx, cy) = g.cell_of(p.x, p.y);
            g.pts[cy * nx + cx].push(i as u32);
        }
        self.grid = g;
    }
}

/// A device placed in the app, written into the drawing (drawing units).
#[derive(serde::Deserialize)]
struct DeviceOut { layer: String, x: f64, y: f64, r: f64, text: String, label: String }

/// The drawing (DWG or DXF) saved as DXF with the devices placed in the app added on their own layers: each device as a
/// circle with its letters inside and its label (circuit or type) beside it. The architect's entities are kept as read.
#[wasm_bindgen(js_name = exportDxf)]
pub fn export_dxf(bytes: Vec<u8>, devices_json: &str) -> Result<Vec<u8>, JsError> {
    use acadrust::entities::{Circle, Text};
    use acadrust::tables::Layer;
    use acadrust::types::Vector3;
    let (mut doc, _) = read(bytes).map_err(|e| JsError::new(&e))?;
    let devices: Vec<DeviceOut> = serde_json::from_str(devices_json).map_err(|e| JsError::new(&e.to_string()))?;
    for d in &devices {
        if !doc.layers.contains(&d.layer) { doc.layers.add(Layer::new(d.layer.clone())).map_err(|e| JsError::new(&e.to_string()))?; }
        let mut c = Circle::new();
        c.center = Vector3::new(d.x, d.y, 0.0);
        c.radius = d.r;
        c.common.layer = d.layer.clone();
        doc.add_entity(EntityType::Circle(c)).map_err(|e| JsError::new(&e.to_string()))?;
        for (s, h, dx, dy) in [(&d.text, d.r * 0.7, -d.r * 0.35 * d.text.chars().count() as f64, -d.r * 0.35), (&d.label, d.r * 0.6, d.r * 1.3, -d.r * 0.3)] {
            if s.is_empty() { continue; }
            let mut t = Text::new();
            t.value = s.clone();
            t.insertion_point = Vector3::new(d.x + dx, d.y + dy, 0.0);
            t.height = h;
            t.common.layer = d.layer.clone();
            doc.add_entity(EntityType::Text(t)).map_err(|e| JsError::new(&e.to_string()))?;
        }
    }
    acadrust::DxfWriter::new(&doc).write_to_vec().map_err(|e| JsError::new(&e.to_string()))
}
