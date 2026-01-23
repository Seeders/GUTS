const fs = require('fs');
const path = require('path');

function fixBaseAbilityReference(filePath) {
    console.log(`\nProcessing: ${filePath}`);

    let content = fs.readFileSync(filePath, 'utf8');

    // Skip BaseAbility itself
    if (filePath.includes('BaseAbility.js')) {
        console.log('  Skipping BaseAbility');
        return false;
    }

    // Check if file has ...BaseAbility.serviceDependencies
    if (!content.includes('...BaseAbility.serviceDependencies')) {
        console.log('  No BaseAbility.serviceDependencies found');
        return false;
    }

    // Replace ...BaseAbility.serviceDependencies with ...GUTS.BaseAbility.serviceDependencies
    const newContent = content.replace(
        /\.\.\.BaseAbility\.serviceDependencies/g,
        '...GUTS.BaseAbility.serviceDependencies'
    );

    if (newContent === content) {
        console.log('  No changes made');
        return false;
    }

    const count = (content.match(/\.\.\.BaseAbility\.serviceDependencies/g) || []).length;

    fs.writeFileSync(filePath, newContent, 'utf8');
    console.log(`  ✓ Updated ${count} reference(s) to GUTS.BaseAbility`);
    return true;
}

// Get directory from command line args
const args = process.argv.slice(2);

if (args.length === 0) {
    console.log('Usage: node fix-baseability-reference.js <directory>');
    process.exit(1);
}

const dir = args[0];
const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.js') && f !== 'BaseAbility.js')
    .map(f => path.join(dir, f));

console.log(`Processing ${files.length} ability files...`);

let fixed = 0;
for (const file of files) {
    if (fixBaseAbilityReference(file)) {
        fixed++;
    }
}

console.log(`\n✓ Fixed ${fixed} files`);
