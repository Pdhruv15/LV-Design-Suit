import { Document, HeadingLevel, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType, BorderStyle, PageOrientation } from 'docx';
import type { ReviewDoc } from './reviewReport';

/** The review report as an editable Word document, from the same document model as the PDF. */
const border = { style: BorderStyle.SINGLE, size: 4, color: '9AA6B8' };
const borders = { top: border, bottom: border, left: border, right: border };

export function buildReviewDocx(doc: ReviewDoc): Document {
  const children: (Paragraph | Table)[] = [
    new Paragraph({ children: [new TextRun({ text: doc.project, color: '5B6B82' })] }),
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: doc.title })] })
  ];
  doc.sections.forEach((s, i) => {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(`${i + 1}. ${s.title}`)] }));
    for (const b of s.blocks) {
      if (b.kind === 'para') children.push(new Paragraph({ children: [new TextRun({ text: b.text, color: b.muted ? '5B6B82' : undefined })] }));
      else if (b.kind === 'bullets') b.items.forEach((t) => children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun(t)] })));
      else children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
        new TableRow({ tableHeader: true, children: b.headers.map((h) => new TableCell({ borders, shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'EEF2F7' }, children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 16 })] })] })) }),
        ...b.rows.map((r) => new TableRow({ cantSplit: true, children: r.map((c) => new TableCell({ borders, children: [new Paragraph({ children: [new TextRun({ text: c, size: 16 })] })] })) }))
      ] }));
    }
  });
  children.push(new Paragraph({ spacing: { before: 300 }, children: [new TextRun({ text: doc.footer, size: 16, color: '5B6B82' })] }));
  return new Document({
    creator: 'LV Design Studio', title: doc.title, styles: { default: { document: { run: { font: 'Arial', size: 20 } } } },
    sections: [{ properties: { page: { size: { orientation: PageOrientation.LANDSCAPE }, margin: { top: 720, bottom: 720, left: 720, right: 720 } } }, children }]
  });
}
