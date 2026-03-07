const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true },
  });

  const html = `
    <html>
    <head>
      <style>
        * { margin: 0; padding: 0; }
        body {
          width: 1024px;
          height: 1024px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
        }
        .icon {
          width: 824px;
          height: 824px;
          border-radius: 185px;
          background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: inset 0 0 0 3px rgba(255,255,255,0.12);
        }
        .text {
          color: white;
          font-size: 340px;
          font-weight: 800;
          font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Arial, sans-serif;
          letter-spacing: -10px;
          line-height: 1;
          margin-top: -10px;
        }
      </style>
    </head>
    <body>
      <div class="icon">
        <div class="text">AH</div>
      </div>
    </body>
    </html>
  `;

  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

  // Wait for render
  await new Promise(r => setTimeout(r, 500));

  const image = await win.webContents.capturePage();
  const pngBuffer = image.toPNG();

  const outPath = path.join(__dirname, '..', 'public', 'icon.png');
  fs.writeFileSync(outPath, pngBuffer);
  console.log('Icon saved to', outPath, '(' + pngBuffer.length + ' bytes)');

  app.quit();
});
