const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 256,
    height: 256,
    show: false,
    transparent: true,
    frame: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  win.loadFile(path.join(__dirname, 'generate-icon.html'));

  win.webContents.on('page-title-updated', async () => {
    try {
      const dataURL = await win.webContents.executeJavaScript('window.__iconDataURL');
      const base64 = dataURL.replace(/^data:image\/png;base64,/, '');
      const outPath = path.join(__dirname, '../assets/tray-icon.png');
      fs.writeFileSync(outPath, Buffer.from(base64, 'base64'));
      console.log('Icon written to', outPath);
    } catch (e) {
      console.error('Failed:', e);
    } finally {
      app.exit(0);
    }
  });
});
