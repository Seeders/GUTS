const fs = require('fs');
const path = require('path');

// Read the bundled game.js
const bundleContent = fs.readFileSync('./game.js', 'utf8');

// Find all JSON module definitions using JSON.parse pattern
const jsonModuleRegex = /\/\*{3}\/ "(\.\/(global|projects|engine)\/[^"]+\.json)":\s*\/\*[\s\S]*?\*\/\s*\/\*{3}\/ \(\(module\) => \{\s*"use strict";\s*module\.exports = \/\*#__PURE__\*\/JSON\.parse\('(.+?)'\)/g;

let modules = {};
let match;

while ((match = jsonModuleRegex.exec(bundleContent)) !== null) {
    const modulePath = match[1];
    const jsonString = match[3];

    try {
        // The JSON string has escaped single quotes and other escapes
        let unescaped = jsonString
            .replace(/\\'/g, "'")
            .replace(/\\n/g, '\n')
            .replace(/\\r/g, '\r')
            .replace(/\\t/g, '\t')
            .replace(/\\\\/g, '\\');

        // Parse and re-stringify with pretty formatting
        const parsed = JSON.parse(unescaped);
        modules[modulePath] = JSON.stringify(parsed, null, 2);
    } catch (e) {
        console.error(`Failed to parse JSON for ${modulePath}: ${e.message}`);
    }
}

console.log(`Found ${Object.keys(modules).length} JSON modules`);

// Process and write each module
let extracted = 0;
let skipped = 0;

for (const modulePath of Object.keys(modules)) {
    // Skip node_modules
    if (modulePath.includes('node_modules')) {
        skipped++;
        continue;
    }

    // Only process collection files and engine files
    if (!modulePath.includes('/collections/') && !modulePath.includes('/engine/')) {
        skipped++;
        continue;
    }

    const content = modules[modulePath];

    console.log(`Extracting: ${modulePath}`);

    // Ensure directory exists
    const dir = path.dirname(modulePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(modulePath, content + '\n', 'utf8');
    extracted++;
}

console.log(`\nDone! Extracted ${extracted} JSON files, skipped ${skipped}`);
