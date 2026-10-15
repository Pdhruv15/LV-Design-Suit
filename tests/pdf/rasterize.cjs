// Rasterises the pages of a PDF with pdf.js inside Electron's Chromium (its canvas, no native module):
//   electron tests/pdf/rasterize.cjs <in.pdf> <out dir> <scale> <max pages>
// Writes <out dir>/p<n>.png for the first <max pages> pages and <out dir>/pages.json
// ({ count, sizes: [[w, h] in pt] } for every page).
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const [input, outDir, scaleArg, maxArg] = process.argv.slice(-4);
const root = path.resolve(__dirname, '../../node_modules/pdfjs-dist');
const url = (p) => pathToFileURL(path.join(root, p)).href;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  try {
    fs.mkdirSync(outDir, { recursive: true });
    const page = path.join(outDir, 'rasterize.html');
    fs.writeFileSync(page, '<!doctype html><html><body></body></html>');
    await win.loadFile(page);
    const data = fs.readFileSync(input).toString('base64');
    const result = await win.webContents.executeJavaScript(`(async () => {
      const pdfjs = await import(${JSON.stringify(url('legacy/build/pdf.mjs'))});
      pdfjs.GlobalWorkerOptions.workerSrc = ${JSON.stringify(url('legacy/build/pdf.worker.mjs'))};
      const bytes = Uint8Array.from(atob(${JSON.stringify(data)}), (c) => c.charCodeAt(0));
      const doc = await pdfjs.getDocument({ data: bytes, standardFontDataUrl: ${JSON.stringify(url('standard_fonts/'))}, cMapUrl: ${JSON.stringify(url('cmaps/'))}, cMapPacked: true }).promise;
      const sizes = [], images = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const p = await doc.getPage(i);
        const vp1 = p.getViewport({ scale: 1 });
        sizes.push([Math.round(vp1.width * 100) / 100, Math.round(vp1.height * 100) / 100]);
        if (i > ${Number(maxArg)}) continue;
        const vp = p.getViewport({ scale: ${Number(scaleArg)} });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        await p.render({ canvasContext: ctx, viewport: vp }).promise;
        images.push(canvas.toDataURL('image/png').split(',')[1]);
      }
      return { count: doc.numPages, sizes, images };
    })()`);
    result.images.forEach((b64, i) => fs.writeFileSync(path.join(outDir, `p${i + 1}.png`), Buffer.from(b64, 'base64')));
    fs.writeFileSync(path.join(outDir, 'pages.json'), JSON.stringify({ count: result.count, sizes: result.sizes }));
    fs.rmSync(page);
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    win.destroy();
    app.quit();
  }
});
