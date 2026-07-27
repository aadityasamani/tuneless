const { execSync } = require('child_process');
const path = require('path');

const MONOREPO = 'D:/Aaditya Samani/Personal Projects/tuneless';
const DESKTOP_SRC = 'D:/Aaditya Samani/Personal Projects/tuneless-desktop';
const DESKTOP_DST = path.join(MONOREPO, 'packages/desktop');

function run(cmd, cwd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

// 1. Copy all desktop files
console.log('\n=== Copying desktop app ===');
run(`cp "${DESKTOP_SRC}/main.js" "${DESKTOP_DST}/main.js"`, MONOREPO);
run(`cp "${DESKTOP_SRC}/preload.js" "${DESKTOP_DST}/preload.js"`, MONOREPO);
run(`cp "${DESKTOP_SRC}/yt-dlp.exe" "${DESKTOP_DST}/yt-dlp.exe"`, MONOREPO);
run(`cp -r "${DESKTOP_SRC}/renderer/" "${DESKTOP_DST}/renderer/"`, MONOREPO);
run(`cp "${DESKTOP_SRC}/assets/icon.svg" "${DESKTOP_DST}/assets/icon.svg"`, MONOREPO);
run(`cp "${DESKTOP_SRC}/scripts/render-icon.js" "${DESKTOP_DST}/scripts/render-icon.js"`, MONOREPO);
run(`cp "${DESKTOP_SRC}/scripts/generate-icon.js" "${DESKTOP_DST}/scripts/generate-icon.js"`, MONOREPO);

// 2. Render icons
console.log('\n=== Rendering icons ===');
run('node scripts/render-icon.js', DESKTOP_DST);

// 3. npm install
console.log('\n=== Installing dependencies ===');
run('npm install', DESKTOP_DST);

// 4. Build installer
console.log('\n=== Building installer ===');
run('npx electron-builder --win', DESKTOP_DST);

console.log('\n✅ Monorepo setup complete!');
console.log(`📦 Installer: ${path.join(DESKTOP_DST, 'dist/Tuneless-Setup-1.0.0.exe')}`);
