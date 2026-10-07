// Renders one HTML file to PDF with the same Chromium print call as the app
// (electron/main.cjs, files:pdfBytes with cssPages), and measures the layout:
//   electron tests/pdf/render.cjs <in.html> <out.pdf> <layout.json> <content width px>
// Layout: every table, figure and SLD drawing wider than the printable width, with print styles applied.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');

const [input, output, layoutFile, widthArg] = process.argv.slice(-4);
const width = Number(widthArg);

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width, height: 1200, useContentSize: true, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  try {
    await win.loadFile(input);
    const pdf = await win.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true });
    fs.writeFileSync(output, pdf);
    win.webContents.debugger.attach();
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { media: 'print' });
    const layout = await win.webContents.executeJavaScript(`(() => {
      const limit = ${width} + 1, out = [];
      for (const el of document.querySelectorAll('section:not(.sld) table, section:not(.sld) figure, section:not(.sld) svg')) {
        const w = Math.max(el.scrollWidth, el.getBoundingClientRect().width);
        if (w > limit) out.push({ tag: el.tagName.toLowerCase(), caption: (el.querySelector('caption')?.textContent ?? el.closest('section')?.querySelector('h2')?.textContent ?? '').trim(), width: Math.round(w) });
      }
      return { overflow: out };
    })()`);
    fs.writeFileSync(layoutFile, JSON.stringify(layout));
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    win.destroy();
    app.quit();
  }
});
