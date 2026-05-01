const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const lucideRoot = path.dirname(require.resolve('lucide-static/package.json', { paths: [root] }));
const iconDir = path.join(lucideRoot, 'icons');
const sourceDir = path.join(root, 'src');
const iconNames = new Map();

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }

    if (!/\.(hbs|ts)$/.test(entry.name)) {
      continue;
    }

    collectIcons(fullPath);
  }
}

function remember(name, filePath) {
  if (!/^[a-z0-9-]+$/.test(name)) {
    return;
  }

  const relativePath = path.relative(root, filePath);
  const locations = iconNames.get(name) || [];
  locations.push(relativePath);
  iconNames.set(name, locations);
}

function collectIcons(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const patterns = [
    /\{\{\{\s*icon\s+["']([^"']+)["']/g,
    /renderIcon\(\s*["']([^"']+)["']/g,
    /\bicon:\s*["']([a-z0-9-]+)["']/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      remember(match[1], filePath);
    }
  }
}

walk(sourceDir);

const missing = [...iconNames.keys()]
  .sort()
  .filter((name) => !fs.existsSync(path.join(iconDir, `${name}.svg`)));

if (missing.length > 0) {
  console.error('Missing Lucide icons:');
  for (const name of missing) {
    console.error(`- ${name}: ${iconNames.get(name).join(', ')}`);
  }
  process.exit(1);
}

console.log(`Validated ${iconNames.size} Lucide icons.`);
