#!/usr/bin/env node

// build-catalog.js
//
// Reads all plugins/{id}/plugin.json files and generates catalog.json
// matching the CatalogPlugin[] format expected by Agent Hub.
//
// Usage:
//   node scripts/build-catalog.js [--release-url <base>]

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PLUGINS_DIR = path.join(__dirname, '..', 'plugins');
const DIST_DIR = path.join(__dirname, '..', 'dist');
const OUTPUT_PATH = path.join(__dirname, '..', 'catalog.json');

// Parse CLI args
let releaseUrl = '';
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--release-url' && args[i + 1]) {
    releaseUrl = args[i + 1].replace(/\/$/, '');
    i++;
  }
}

function computeSha256(filePath) {
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function buildCatalog() {
  const pluginDirs = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const catalog = [];

  for (const dirName of pluginDirs) {
    const pluginJsonPath = path.join(PLUGINS_DIR, dirName, 'plugin.json');
    if (!fs.existsSync(pluginJsonPath)) {
      console.warn(`Skipping ${dirName}: no plugin.json found`);
      continue;
    }

    let plugin;
    try {
      plugin = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf-8'));
    } catch (err) {
      console.error(`Error parsing ${pluginJsonPath}:`, err.message);
      continue;
    }

    const tarballName = `${plugin.id}.tar.gz`;
    const downloadUrl = releaseUrl
      ? `${releaseUrl}/${tarballName}`
      : `https://github.com/agenthub-dev/plugin-registry/releases/latest/download/${tarballName}`;

    const entry = {
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      description: plugin.description || '',
      author: plugin.author || '',
      capabilities: plugin.capabilities || [],
      level: plugin.level || 1,
      source: 'official',
      icon: plugin.icon || undefined,
      tags: plugin.tags || undefined,
      category: plugin.category || undefined,
      downloadUrl,
      homepage: plugin.homepage || undefined,
      license: plugin.license || undefined,
      updatedAt: new Date().toISOString(),
      configSchema: plugin.configSchema || undefined,
    };

    // Compute sha256 if tarball exists in dist/
    const distTarball = path.join(DIST_DIR, tarballName);
    if (fs.existsSync(distTarball)) {
      entry.sha256 = computeSha256(distTarball);
    }

    catalog.push(entry);
  }

  // Sort by id for deterministic output
  catalog.sort((a, b) => a.id.localeCompare(b.id));

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(catalog, null, 2) + '\n', 'utf-8');
  console.log(`catalog.json generated with ${catalog.length} plugin(s):`);
  catalog.forEach((p) => console.log(`  - ${p.id} v${p.version}`));
}

buildCatalog();
