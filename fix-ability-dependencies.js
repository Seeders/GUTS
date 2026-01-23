const fs = require('fs');
const path = require('path');

function fixAbilityDependencies(filePath) {
    console.log(`\nProcessing: ${filePath}`);

    let content = fs.readFileSync(filePath, 'utf8');

    // Skip BaseAbility itself
    if (filePath.includes('BaseAbility.js')) {
        console.log('  Skipping BaseAbility');
        return false;
    }

    // Check if file has static serviceDependencies
    if (!content.includes('static serviceDependencies')) {
        console.log('  No serviceDependencies found');
        return false;
    }

    // Pattern to match: static serviceDependencies = [
    // But NOT: static serviceDependencies = [...BaseAbility.serviceDependencies
    const pattern = /static serviceDependencies = \[(?!\.\.\.BaseAbility\.serviceDependencies)/;

    if (!content.match(pattern)) {
        console.log('  Already extends BaseAbility.serviceDependencies');
        return false;
    }

    // Replace with spread syntax
    const newContent = content.replace(
        /static serviceDependencies = \[/,
        'static serviceDependencies = [\n        ...BaseAbility.serviceDependencies,'
    );

    if (newContent === content) {
        console.log('  No changes made');
        return false;
    }

    fs.writeFileSync(filePath, newContent, 'utf8');
    console.log('  ✓ Updated to extend BaseAbility.serviceDependencies');
    return true;
}

// Get directory from command line args
const args = process.argv.slice(2);

if (args.length === 0) {
    console.log('Usage: node fix-ability-dependencies.js <directory>');
    process.exit(1);
}

const dir = args[0];
const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.js') && f !== 'BaseAbility.js')
    .map(f => path.join(dir, f));

console.log(`Processing ${files.length} ability files...`);

let fixed = 0;
for (const file of files) {
    if (fixAbilityDependencies(file)) {
        fixed++;
    }
}

console.log(`\n✓ Fixed ${fixed} files`);
