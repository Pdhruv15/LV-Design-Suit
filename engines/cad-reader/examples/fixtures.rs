//! Writes the test drawings in tests/fixtures/cad from the sample floor plan: the plan plus one cable route line
//! tagged "route:F-03" (LVDS extended data), as DXF and as DWG 2018 / 2004. Run: cargo run --example fixtures
use acadrust::entities::{EntityType, Line};
use acadrust::tables::{AppId, Layer};
use acadrust::types::DxfVersion;
use acadrust::xdata::{ExtendedDataRecord, XDataValue};
use acadrust::{DwgWriter, DxfReader, DxfWriter};

fn main() {
    let root = concat!(env!("CARGO_MANIFEST_DIR"), "/../..");
    let mut doc = DxfReader::from_file(format!("{root}/docs/samples/sample-ground-floor-plan.dxf")).unwrap().read().unwrap();
    if !doc.app_ids.contains("LVDS") {
        doc.app_ids.add(AppId::new("LVDS")).unwrap();
    }
    if !doc.layers.contains("E-ROUTE") {
        doc.layers.add(Layer::new("E-ROUTE")).unwrap();
    }
    let mut line = Line::from_coords(1000.0, 1000.0, 0.0, 9000.0, 1000.0, 0.0);
    line.common.layer = "E-ROUTE".into();
    let mut record = ExtendedDataRecord::new("LVDS");
    record.add_value(XDataValue::String("route:F-03".into()));
    line.common.extended_data.add_record(record);
    doc.add_entity(EntityType::Line(line)).unwrap();

    let out = format!("{root}/tests/fixtures/cad");
    std::fs::create_dir_all(&out).unwrap();
    DxfWriter::new(&doc).write_to_file(format!("{out}/plan-tagged.dxf")).unwrap();
    for (name, version) in [("plan-2018.dwg", DxfVersion::AC1032), ("plan-2004.dwg", DxfVersion::AC1018)] {
        doc.version = version;
        DwgWriter::write_to_file(format!("{out}/{name}"), &doc).unwrap();
    }
}
