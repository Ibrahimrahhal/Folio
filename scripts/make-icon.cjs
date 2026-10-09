const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const spike = (() => {
  const points = [];
  for (let i = 0; i < 16; i += 1) {
    const radius = i % 2 === 0 ? 11 : 3.2;
    const angle = (Math.PI / 8) * i - Math.PI / 2;
    points.push(`${(12 + radius * Math.cos(angle)).toFixed(2)} ${(12 + radius * Math.sin(angle)).toFixed(2)}`);
  }
  return `M${points.join(' L')}Z`;
})();

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 256 256">
  <rect width="256" height="256" rx="56" fill="#faf9f5"/>
  <rect x="28" y="28" width="200" height="200" rx="40" fill="#cc785c"/>
  <g transform="translate(128 128) scale(7) translate(-12 -12)">
    <path fill="#faf9f5" d="${spike}"/>
  </g>
</svg>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true },
  });
  const html = `<html><body style="margin:0;background:transparent">${svg}</body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  const out = path.join(__dirname, '..', 'build');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'icon.png'), image.toPNG());
  app.exit(0);
});
