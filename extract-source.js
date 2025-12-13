const fs = require('fs');
const path = require('path');

// Read the bundled game.js
const bundleContent = fs.readFileSync('./game.js', 'utf8');

// Find all module definitions
const lines = bundleContent.split('\n');
let modules = {};

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for module path marker like: /***/ "./global/collections/scripts/libraries/js/BaseECSGame.js":
    const pathMatch = line.match(/\/\*{3}\/ "([^"]+)":/);
    if (pathMatch) {
        const modulePath = pathMatch[1];

        // Look for eval on next lines
        for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
            if (lines[j].includes('eval("')) {
                const evalLine = lines[j];
                const evalStart = evalLine.indexOf('eval("') + 6;
                let evalEnd = evalLine.lastIndexOf('")');
                if (evalEnd === -1) evalEnd = evalLine.lastIndexOf('");');

                if (evalEnd > evalStart) {
                    let content = evalLine.substring(evalStart, evalEnd);

                    // Unescape the string
                    content = content
                        .replace(/\\n/g, '\n')
                        .replace(/\\t/g, '\t')
                        .replace(/\\r/g, '\r')
                        .replace(/\\"/g, '"')
                        .replace(/\\\\/g, '\\');

                    modules[modulePath] = content;
                }
                break;
            }
        }
    }
}

console.log(`Found ${Object.keys(modules).length} modules`);

// Clean up webpack artifacts from content
function cleanContent(content, modulePath) {
    // Remove webpack harmony export/import comments and code
    let clean = content
        // Remove harmony export block at the start
        .replace(/^\/\* harmony export \*\/[^\n]*\n/gm, '')
        .replace(/__webpack_require__\.d\(__webpack_exports__,\s*\{[\s\S]*?\}\);?\s*/g, '')
        // Remove harmony import comments
        .replace(/^\/\* harmony import \*\/[^\n]*\n/gm, '')
        // Remove harmony default export comment
        .replace(/^\/\* harmony default export \*\/[^\n]*/gm, '')
        // Remove unused harmony export comments
        .replace(/^\/\* unused harmony export[^\n]*\n/gm, '')
        // Remove WEBPACK_IMPORTED_MODULE variable declarations
        .replace(/var [A-Za-z_$][A-Za-z0-9_$]*__WEBPACK_IMPORTED_MODULE_\d+[^\n]*\n/g, '')
        // Clean up WEBPACK module references in code
        .replace(/[A-Za-z_$][A-Za-z0-9_$]*__WEBPACK_IMPORTED_MODULE_\d+___default\(\)\./g, '')
        .replace(/[A-Za-z_$][A-Za-z0-9_$]*__WEBPACK_IMPORTED_MODULE_\d+__\["default"\]/g, '')
        .replace(/[A-Za-z_$][A-Za-z0-9_$]*__WEBPACK_IMPORTED_MODULE_\d+__\./g, '')
        .replace(/[A-Za-z_$][A-Za-z0-9_$]*__WEBPACK_IMPORTED_MODULE_\d+__/g, '')
        // Remove __WEBPACK_DEFAULT_EXPORT__
        .replace(/const __WEBPACK_DEFAULT_EXPORT__ = \(/g, '')
        .replace(/__WEBPACK_DEFAULT_EXPORT__/g, '')
        // Remove source map comments
        .replace(/\/\/# sourceURL=\[module\]\n?/g, '')
        .replace(/\/\/# sourceMappingURL=data:application\/json[^\n]*/g, '')
        .replace(/\/\/# sourceURL=webpack-internal:[^\n]*/g, '')
        // Clean up extra blank lines
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    // Find the actual class/function definition
    const classMatch = clean.match(/^(class\s+\w+[\s\S]*)/m);
    if (classMatch) {
        clean = classMatch[1];
    }

    // Remove trailing webpack closure if present
    clean = clean.replace(/\n\}\s*$/, '\n}');

    return clean;
}

// Process and write each module
let extracted = 0;
let skipped = 0;

for (const modulePath of Object.keys(modules)) {
    // Only process our source files (not node_modules, not dist)
    if (modulePath.includes('node_modules')) {
        skipped++;
        continue;
    }

    if (!modulePath.endsWith('.js')) {
        skipped++;
        continue;
    }

    if (!modulePath.includes('/collections/') && !modulePath.includes('/engine/')) {
        skipped++;
        continue;
    }

    const content = modules[modulePath];
    const cleanedContent = cleanContent(content, modulePath);

    // Skip if content is too short (likely just exports)
    if (cleanedContent.length < 50) {
        console.log(`Skipping (too short): ${modulePath}`);
        skipped++;
        continue;
    }

    console.log(`Extracting: ${modulePath}`);

    // Ensure directory exists
    const dir = path.dirname(modulePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(modulePath, cleanedContent, 'utf8');
    extracted++;
}

console.log(`\nDone! Extracted ${extracted} files, skipped ${skipped}`);
