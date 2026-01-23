const fs = require('fs');
const path = require('path');

function convertServiceCalls(filePath) {
    console.log(`\nProcessing: ${filePath}`);

    let content = fs.readFileSync(filePath, 'utf8');

    // Find all this.game.call('serviceName', or this.game.call('serviceName')
    const callPattern = /this\.game\.call\(['"]([^'"]+)['"]/g;
    const services = new Set();

    let match;
    while ((match = callPattern.exec(content)) !== null) {
        services.add(match[1]);
    }

    if (services.size === 0) {
        console.log('  No service calls found');
        return false;
    }

    console.log(`  Found ${services.size} unique services:`, Array.from(services).join(', '));

    // Check if serviceDependencies already exists
    if (content.includes('static serviceDependencies')) {
        console.log('  serviceDependencies already exists, skipping dependency addition');
    } else {
        const serviceDepsArray = Array.from(services).map(s => `        '${s}'`).join(',\n');
        const serviceDepsBlock = `static serviceDependencies = [\n${serviceDepsArray}\n    ];`;

        // Try multiple anchor points in order of preference:

        // 1. Try to insert after static services array
        const servicesPattern = /(static services = \[[^\]]*\];)/;
        if (content.match(servicesPattern)) {
            content = content.replace(servicesPattern, `$1\n\n    ${serviceDepsBlock}`);
            console.log('  Added serviceDependencies after static services');
        }
        // 2. Try to insert after class declaration, before constructor
        else if (content.match(/class \w+ extends [^\{]+\{[\s\n]+constructor\(/)) {
            content = content.replace(
                /(class \w+ extends [^\{]+\{\s*\n)/,
                `$1    ${serviceDepsBlock}\n\n`
            );
            console.log('  Added serviceDependencies after class declaration');
        }
        // 3. Try to insert after class declaration with other static properties
        else if (content.match(/class \w+ extends [^\{]+\{[\s\n]+static /)) {
            // Find the last static property and insert after it
            const staticPropPattern = /((?:static [^\n]+\n)+)/;
            content = content.replace(
                staticPropPattern,
                `$1\n    ${serviceDepsBlock}\n`
            );
            console.log('  Added serviceDependencies after other static properties');
        }
        // 4. Fallback: insert right after class declaration
        else if (content.match(/class \w+ extends [^\{]+\{/)) {
            content = content.replace(
                /(class \w+ extends [^\{]+\{\s*\n)/,
                `$1    ${serviceDepsBlock}\n\n`
            );
            console.log('  Added serviceDependencies after class declaration (fallback)');
        }
        else {
            console.log('  WARNING: Could not find suitable location for serviceDependencies');
        }
    }

    // Replace all this.game.call('serviceName', with this.call.serviceName(
    // and this.game.call('serviceName') with this.call.serviceName()
    let replacements = 0;
    for (const service of services) {
        const oldPattern1 = new RegExp(`this\\.game\\.call\\(['"]${service}['"],`, 'g');
        const oldPattern2 = new RegExp(`this\\.game\\.call\\(['"]${service}['"]\\)`, 'g');

        const count1 = (content.match(oldPattern1) || []).length;
        const count2 = (content.match(oldPattern2) || []).length;

        content = content.replace(oldPattern1, `this.call.${service}(`);
        content = content.replace(oldPattern2, `this.call.${service}()`);

        replacements += count1 + count2;
    }

    console.log(`  Replaced ${replacements} service calls`);

    // Write back
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('  ✓ File updated');

    return true;
}

// Get file paths from command line args, or use default list
const args = process.argv.slice(2);

if (args.length === 0) {
    console.log('Usage: node convert-service-calls.js <file1> <file2> ...');
    console.log('Or: node convert-service-calls.js <directory>');
    process.exit(1);
}

let files = [];

// Check if argument is a directory
if (args.length === 1 && fs.statSync(args[0]).isDirectory()) {
    const dir = args[0];
    files = fs.readdirSync(dir)
        .filter(f => f.endsWith('.js'))
        .map(f => path.join(dir, f));
} else {
    files = args;
}

console.log(`Processing ${files.length} files...`);

let processed = 0;
for (const file of files) {
    if (convertServiceCalls(file)) {
        processed++;
    }
}

console.log(`\n✓ Processed ${processed} files`);
