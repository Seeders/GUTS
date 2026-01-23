const fs = require('fs');
const path = require('path');

function convertBehaviorServiceCalls(filePath) {
    console.log(`\nProcessing: ${filePath}`);

    let content = fs.readFileSync(filePath, 'utf8');

    // Find all game.call('serviceName', or game.call('serviceName')
    const callPattern = /\bgame\.call\(['\"]([^'\"]+)['\"]/g;
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

        // Try to insert after class declaration, before any methods
        const classPattern = /(class \w+ extends [^\{]+\{\s*\n)/;
        if (content.match(classPattern)) {
            content = content.replace(classPattern, `$1    ${serviceDepsBlock}\n\n`);
            console.log('  Added serviceDependencies after class declaration');
        } else {
            console.log('  WARNING: Could not find suitable location for serviceDependencies');
        }
    }

    // Replace all game.call('serviceName', with this.call.serviceName(
    // and game.call('serviceName') with this.call.serviceName()
    let replacements = 0;
    for (const service of services) {
        const oldPattern1 = new RegExp(`\\bgame\\.call\\(['"]${service}['"],`, 'g');
        const oldPattern2 = new RegExp(`\\bgame\\.call\\(['"]${service}['"]\\)`, 'g');

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

// Get directory from command line args
const args = process.argv.slice(2);

if (args.length === 0) {
    console.log('Usage: node convert-behavior-service-calls.js <directory>');
    process.exit(1);
}

const dir = args[0];
const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.js'))
    .map(f => path.join(dir, f));

console.log(`Processing ${files.length} files...`);

let processed = 0;
for (const file of files) {
    if (convertBehaviorServiceCalls(file)) {
        processed++;
    }
}

console.log(`\n✓ Processed ${processed} files`);
