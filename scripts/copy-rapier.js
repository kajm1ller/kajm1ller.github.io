#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// Copies the @dimforge/rapier3d package into public/vendor/rapier so the
// browser can load the wasm and glue from the same origin.

const pkgName = '@dimforge/rapier3d';
const srcDir = path.join(__dirname, '..', 'node_modules', pkgName);
const destDir = path.join(__dirname, '..', 'public', 'vendor', 'rapier');

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const item of fs.readdirSync(src)) {
      copyRecursive(path.join(src, item), path.join(dest, item));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

if (!fs.existsSync(srcDir)) {
  console.error('Source package not found:', srcDir);
  console.error('Run `npm install` first so node_modules contains the Rapier package.');
  process.exit(1);
}

// Create dest and copy files
console.log('Copying', srcDir, 'to', destDir);
copyRecursive(srcDir, destDir);

// Create a small browser entry file that re-exports the package's module entry
const pkgJsonPath = path.join(srcDir, 'package.json');
let entry = 'rapier.js';
try {
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
  entry = pkg.module || pkg.browser || pkg.main || entry;
} catch (e) {
  console.warn('Could not read package.json for', pkgName, e.message);
}

// Ensure entry file exists in dest
const entryBase = path.basename(entry);
const shimPath = path.join(destDir, 'rapier-browser-entry.js');
const relativeEntry = './' + entryBase;
const shimContent = `// Auto-generated shim to re-export Rapier for browser usage\nexport * from '${relativeEntry}';\n`;
fs.writeFileSync(shimPath, shimContent, 'utf8');
console.log('Wrote shim:', shimPath, ' -> re-exports', relativeEntry);

console.log('Rapier files copied to public/vendor/rapier');
