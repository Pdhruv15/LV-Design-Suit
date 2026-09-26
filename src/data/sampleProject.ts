import type { Project } from '../types';

// Cables and breakers in this sample were sized with the app's own engine
// (breaker In >= 1.25 x Ib, total voltage drop <= 80 % of the limit), so
// every check passes. DB-GF1 is a villa DB built from its load schedule
// (21 circuits, phases balanced). Edit anything to see the checks respond.
export const sampleProject: Project = {
  name: "Villa Complex 415V LV Network",
  voltageV: 415,
  frequencyHz: 50,
  ambientC: 45,
  vdLimitPct: 4,
  boards: [
    {"id":"MDB-1","name":"Main Distribution Board","kind":"MDB","sourceKva":1000,"sourceImpedancePct":5,"ratedCurrentA":1600,"busbarMaterial":"copper","ipRating":"IP42","location":"Main building – ground floor","manufacturer":"Schneider Electric","model":"PrismaSeT P"},
    {"id":"SMDB-GF","name":"Ground floor SMDB","kind":"SMDB","upstreamId":"MDB-1","ratedCurrentA":630,"busbarMaterial":"copper","ipRating":"IP42","location":"Ground floor electrical room"},
    {"id":"SMDB-FF","name":"First floor SMDB","kind":"SMDB","upstreamId":"MDB-1","ratedCurrentA":250,"busbarMaterial":"copper","ipRating":"IP42","location":"First floor electrical room"},
    {"id":"MCC-1","name":"Pump room MCC","kind":"MCC","upstreamId":"MDB-1","ratedCurrentA":400,"busbarMaterial":"copper","ipRating":"IP54","location":"Basement pump room"},
    {"id":"DB-GF1","name":"Villa ground floor DB","kind":"DB","upstreamId":"SMDB-GF","ratedCurrentA":100,"busbarMaterial":"copper","ipRating":"IP42","location":"Villa GF – store room","elcbGroupSize":6}
  ],
  feeders: [
    {"id":"INC-GF","boardId":"MDB-1","name":"Incomer to Ground floor SMDB","loadKw":0,"demandFactor":1,"powerFactor":0.85,"lengthM":35,"cableCsaMm2":300,"cores":4,"breakerRatingA":500,"breakerIcuKa":36,"feedsBoardId":"SMDB-GF","breakerType":"MCCB"},
    {"id":"INC-FF","boardId":"MDB-1","name":"Incomer to First floor SMDB","loadKw":0,"demandFactor":1,"powerFactor":0.85,"lengthM":55,"cableCsaMm2":95,"cores":4,"breakerRatingA":200,"breakerIcuKa":36,"feedsBoardId":"SMDB-FF","breakerType":"MCCB"},
    {"id":"INC-MCC","boardId":"MDB-1","name":"Incomer to Pump room MCC","loadKw":0,"demandFactor":1,"powerFactor":0.85,"lengthM":40,"cableCsaMm2":150,"cores":4,"breakerRatingA":315,"breakerIcuKa":36,"feedsBoardId":"MCC-1","breakerType":"MCCB"},
    {"id":"DB-EV","boardId":"MDB-1","name":"EV charging – parking","loadKw":44,"demandFactor":0.7,"powerFactor":0.98,"lengthM":60,"cableCsaMm2":10,"cores":4,"breakerRatingA":63,"breakerIcuKa":36,"loadType":"ev","breakerType":"C"},
    {"id":"DB-PV","boardId":"MDB-1","name":"Solar PV inverter","loadKw":50,"demandFactor":1,"powerFactor":1,"lengthM":30,"cableCsaMm2":25,"cores":4,"breakerRatingA":100,"breakerIcuKa":36,"loadType":"pv","generation":true,"breakerType":"MCCB"},
    {"id":"GF-LTG","boardId":"SMDB-GF","name":"Lighting","loadKw":45,"demandFactor":0.9,"powerFactor":0.9,"lengthM":30,"cableCsaMm2":16,"cores":4,"breakerRatingA":80,"breakerIcuKa":25,"loadType":"lighting","breakerType":"MCCB"},
    {"id":"GF-SKT","boardId":"SMDB-GF","name":"Sockets","loadKw":28,"demandFactor":0.6,"powerFactor":0.85,"lengthM":35,"cableCsaMm2":4,"cores":4,"breakerRatingA":40,"breakerIcuKa":25,"loadType":"sockets","breakerType":"C"},
    {"id":"GF-HVAC","boardId":"SMDB-GF","name":"HVAC","loadKw":120,"demandFactor":0.9,"powerFactor":0.85,"lengthM":40,"cableCsaMm2":95,"cores":4,"breakerRatingA":250,"breakerIcuKa":25,"loadType":"hvac","breakerType":"MCCB"},
    {"id":"FF-OFF","boardId":"SMDB-FF","name":"Office","loadKw":35,"demandFactor":0.8,"powerFactor":0.9,"lengthM":25,"cableCsaMm2":10,"cores":4,"breakerRatingA":63,"breakerIcuKa":25,"loadType":"sockets","breakerType":"C"},
    {"id":"FF-IT","boardId":"SMDB-FF","name":"IT room","loadKw":20,"demandFactor":1,"powerFactor":0.95,"lengthM":20,"cableCsaMm2":4,"cores":4,"breakerRatingA":40,"breakerIcuKa":25,"loadType":"it","breakerType":"C"},
    {"id":"FF-LAB","boardId":"SMDB-FF","name":"Lab","loadKw":50,"demandFactor":0.7,"powerFactor":0.85,"lengthM":30,"cableCsaMm2":16,"cores":4,"breakerRatingA":80,"breakerIcuKa":25,"loadType":"general","breakerType":"MCCB"},
    {"id":"FF-LTG","boardId":"SMDB-FF","name":"Corridor lighting","loadKw":4,"demandFactor":1,"powerFactor":0.9,"lengthM":35,"cableCsaMm2":6,"cores":2,"breakerRatingA":25,"breakerIcuKa":25,"loadType":"lighting","breakerType":"C"},
    {"id":"MCC-WP","boardId":"MCC-1","name":"Water pump","loadKw":75,"demandFactor":1,"powerFactor":0.86,"lengthM":20,"cableCsaMm2":50,"cores":4,"breakerRatingA":160,"breakerIcuKa":25,"loadType":"motor","breakerType":"MCCB"},
    {"id":"MCC-FP","boardId":"MCC-1","name":"Fire pump","loadKw":55,"demandFactor":1,"powerFactor":0.86,"lengthM":25,"cableCsaMm2":35,"cores":4,"breakerRatingA":125,"breakerIcuKa":25,"loadType":"fire-pump","breakerType":"MCCB"},
    {"id":"INC-DBGF1","boardId":"SMDB-GF","name":"Incomer to Villa ground floor DB","loadKw":0,"demandFactor":1,"powerFactor":0.9,"lengthM":30,"cableCsaMm2":35,"cores":4,"breakerRatingA":100,"breakerIcuKa":25,"feedsBoardId":"DB-GF1","breakerType":"MCCB"},
    {"id":"DB-GF1-Y6","boardId":"DB-GF1","name":"Majlis lighting","room":"Majlis lighting","points":{"ltg":10},"phase":"Y","way":6,"loadKw":1,"demandFactor":1,"powerFactor":0.9,"lengthM":18,"cableCsaMm2":1.5,"cores":2,"breakerRatingA":6,"breakerIcuKa":10,"breakerType":"C","loadType":"lighting"},
    {"id":"DB-GF1-Y5","boardId":"DB-GF1","name":"Living lighting","room":"Living lighting","points":{"ltg":12},"phase":"Y","way":5,"loadKw":1.2,"demandFactor":1,"powerFactor":0.9,"lengthM":20,"cableCsaMm2":1.5,"cores":2,"breakerRatingA":10,"breakerIcuKa":10,"breakerType":"C","loadType":"lighting"},
    {"id":"DB-GF1-Y7","boardId":"DB-GF1","name":"Kitchen lighting","room":"Kitchen lighting","points":{"ltg":8,"exfan":1},"phase":"Y","way":7,"loadKw":0.84,"demandFactor":1,"powerFactor":0.9,"lengthM":22,"cableCsaMm2":1.5,"cores":2,"breakerRatingA":6,"breakerIcuKa":10,"breakerType":"C","loadType":"lighting"},
    {"id":"DB-GF1-Y4","boardId":"DB-GF1","name":"Majlis sockets","room":"Majlis sockets","points":{"s13":6},"phase":"Y","way":4,"loadKw":1.5,"demandFactor":1,"powerFactor":0.9,"lengthM":18,"cableCsaMm2":1.5,"cores":2,"breakerRatingA":10,"breakerIcuKa":10,"breakerType":"C","loadType":"sockets"},
    {"id":"DB-GF1-R2","boardId":"DB-GF1","name":"Living sockets","room":"Living sockets","points":{"s13":8},"phase":"R","way":2,"loadKw":2,"demandFactor":1,"powerFactor":0.9,"lengthM":20,"cableCsaMm2":1.5,"cores":2,"breakerRatingA":16,"breakerIcuKa":10,"breakerType":"C","loadType":"sockets"},
    {"id":"DB-GF1-B5","boardId":"DB-GF1","name":"Kitchen sockets","room":"Kitchen sockets","points":{"s13":5},"phase":"B","way":5,"loadKw":1.25,"demandFactor":1,"powerFactor":0.9,"lengthM":22,"cableCsaMm2":1.5,"cores":2,"breakerRatingA":10,"breakerIcuKa":10,"breakerType":"C","loadType":"sockets"},
    {"id":"DB-GF1-R1","boardId":"DB-GF1","name":"Cooker","room":"Cooker","points":{"cooker":1},"phase":"R","way":1,"loadKw":6,"demandFactor":1,"powerFactor":0.9,"lengthM":24,"cableCsaMm2":6,"cores":2,"breakerRatingA":40,"breakerIcuKa":10,"breakerType":"C","loadType":"general"},
    {"id":"DB-GF1-Y1","boardId":"DB-GF1","name":"Kitchen water heater","room":"Kitchen water heater","points":{"wh":1},"phase":"Y","way":1,"loadKw":3,"demandFactor":1,"powerFactor":0.9,"lengthM":24,"cableCsaMm2":2.5,"cores":2,"breakerRatingA":20,"breakerIcuKa":10,"breakerType":"C","loadType":"general"},
    {"id":"DB-GF1-R4","boardId":"DB-GF1","name":"Maid room","room":"Maid room","points":{"ltg":3,"s13":3,"exfan":1},"phase":"R","way":4,"loadKw":1.09,"demandFactor":1,"powerFactor":0.9,"lengthM":28,"cableCsaMm2":1.5,"cores":2,"breakerRatingA":6,"breakerIcuKa":10,"breakerType":"C","loadType":"sockets"},
    {"id":"DB-GF1-Y2","boardId":"DB-GF1","name":"Majlis split A/C","room":"Majlis split A/C","points":{"sac":1},"phase":"Y","way":2,"loadKw":2.5,"demandFactor":1,"powerFactor":0.9,"lengthM":18,"cableCsaMm2":1.5,"cores":2,"breakerRatingA":16,"breakerIcuKa":10,"breakerType":"C","loadType":"hvac"},
    {"id":"DB-GF1-B2","boardId":"DB-GF1","name":"Living split A/C","room":"Living split A/C","points":{"sac":1},"phase":"B","way":2,"loadKw":2.5,"demandFactor":1,"powerFactor":0.9,"lengthM":20,"cableCsaMm2":2.5,"cores":2,"breakerRatingA":16,"breakerIcuKa":10,"breakerType":"C","loadType":"hvac"},
    {"id":"DB-GF1-Y3","boardId":"DB-GF1","name":"Dining split A/C","room":"Dining split A/C","points":{"sac":1},"phase":"Y","way":3,"loadKw":2.5,"demandFactor":1,"powerFactor":0.9,"lengthM":22,"cableCsaMm2":2.5,"cores":2,"breakerRatingA":16,"breakerIcuKa":10,"breakerType":"C","loadType":"hvac"},
    {"id":"DB-GF1-B4","boardId":"DB-GF1","name":"Guest bedroom","room":"Guest bedroom","points":{"ltg":4,"s13":4,"cfan":1},"phase":"B","way":4,"loadKw":1.48,"demandFactor":1,"powerFactor":0.9,"lengthM":26,"cableCsaMm2":1.5,"cores":2,"breakerRatingA":10,"breakerIcuKa":10,"breakerType":"C","loadType":"sockets"},
    {"id":"DB-GF1-B8","boardId":"DB-GF1","name":"Guest bathroom","room":"Guest bathroom","points":{"ltg":2,"shaver":1,"exfan":1},"phase":"B","way":8,"loadKw":0.26,"demandFactor":1,"powerFactor":0.9,"lengthM":27,"cableCsaMm2":1.5,"cores":2,"breakerRatingA":6,"breakerIcuKa":10,"breakerType":"C","loadType":"lighting"},
    {"id":"DB-GF1-B1","boardId":"DB-GF1","name":"Guest bath water heater","room":"Guest bath water heater","points":{"wh":1},"phase":"B","way":1,"loadKw":3,"demandFactor":1,"powerFactor":0.9,"lengthM":27,"cableCsaMm2":4,"cores":2,"breakerRatingA":20,"breakerIcuKa":10,"breakerType":"C","loadType":"general"},
    {"id":"DB-GF1-B3","boardId":"DB-GF1","name":"Guest bedroom split A/C","room":"Guest bedroom split A/C","points":{"sac":1},"phase":"B","way":3,"loadKw":2.5,"demandFactor":1,"powerFactor":0.9,"lengthM":26,"cableCsaMm2":2.5,"cores":2,"breakerRatingA":16,"breakerIcuKa":10,"breakerType":"C","loadType":"hvac"},
    {"id":"DB-GF1-R6","boardId":"DB-GF1","name":"Dining lighting","room":"Dining lighting","points":{"ltg":6},"phase":"R","way":6,"loadKw":0.6,"demandFactor":1,"powerFactor":0.9,"lengthM":22,"cableCsaMm2":1.5,"cores":2,"breakerRatingA":6,"breakerIcuKa":10,"breakerType":"C","loadType":"lighting"},
    {"id":"DB-GF1-B6","boardId":"DB-GF1","name":"Dining sockets","room":"Dining sockets","points":{"s13":4},"phase":"B","way":6,"loadKw":1,"demandFactor":1,"powerFactor":0.9,"lengthM":22,"cableCsaMm2":1.5,"cores":2,"breakerRatingA":6,"breakerIcuKa":10,"breakerType":"C","loadType":"sockets"},
    {"id":"DB-GF1-R5","boardId":"DB-GF1","name":"External lighting","room":"External lighting","points":{"ltg":10},"phase":"R","way":5,"loadKw":1,"demandFactor":1,"powerFactor":0.9,"lengthM":35,"cableCsaMm2":1.5,"cores":2,"breakerRatingA":6,"breakerIcuKa":10,"breakerType":"C","loadType":"lighting"},
    {"id":"DB-GF1-B7","boardId":"DB-GF1","name":"Water pump","room":"Water pump","points":{"pump":1},"phase":"B","way":7,"loadKw":0.75,"demandFactor":1,"powerFactor":0.9,"lengthM":30,"cableCsaMm2":1.5,"cores":2,"breakerRatingA":6,"breakerIcuKa":10,"breakerType":"C","loadType":"motor"},
    {"id":"DB-GF1-R3","boardId":"DB-GF1","name":"Laundry","room":"Laundry","points":{"s15":2},"phase":"R","way":3,"loadKw":2,"demandFactor":1,"powerFactor":0.9,"lengthM":25,"cableCsaMm2":2.5,"cores":2,"breakerRatingA":16,"breakerIcuKa":10,"breakerType":"C","loadType":"sockets"}
  ],
  updatedAt: new Date().toISOString()
};
