/**
 * Backfill Animation Types Script
 *
 * Adds animationTypes to generatorSettings in existing sprite animation sets.
 * This derives the animation types from the frame names and stores them
 * so they don't need to be hardcoded at runtime.
 *
 * Usage: node scripts/backfill-animation-types.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SPRITE_ANIMATION_SETS_PATH = path.join(PROJECT_ROOT, 'projects', 'TurnBasedWarfare', 'collections', 'data', 'spriteAnimationSets');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

function log(...args) {
    console.log(...args);
}

/**
 * Derive animation types from frame names
 * Frame names follow pattern: {animType}{direction}_{frameIndex}
 * e.g., "idleDown_0", "walkUpLeft_3", "attackRight_5"
 */
function deriveAnimationTypes(frames) {
    const knownTypes = ['idle', 'walk', 'attack', 'death', 'celebrate', 'cast', 'takeoff', 'land'];
    const detectedTypes = new Set();

    for (const frameName of Object.keys(frames)) {
        const lowerName = frameName.toLowerCase();
        for (const type of knownTypes) {
            if (lowerName.startsWith(type)) {
                detectedTypes.add(type);
                break;
            }
        }
    }

    return Array.from(detectedTypes);
}

/**
 * Process a single SpriteAnimationSet file
 */
function processSpriteAnimationSet(filePath) {
    const fileName = path.basename(filePath, '.json');

    let content;
    try {
        content = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
        console.error(`Error reading ${filePath}:`, err.message);
        return null;
    }

    const data = JSON.parse(content);

    // Check if using stripped format (has frames but no animations array)
    if (!data.frames) {
        log(`  Skipping ${fileName}: No frames`);
        return null;
    }

    // Check if already has animationTypes
    if (data.generatorSettings?.animationTypes) {
        log(`  Skipping ${fileName}: Already has animationTypes`);
        return null;
    }

    log(`\nProcessing: ${fileName}`);

    // Derive animation types from frame names
    const animationTypes = deriveAnimationTypes(data.frames);

    if (animationTypes.length === 0) {
        log(`  Warning: No animation types detected in ${fileName}`);
        return null;
    }

    log(`  Detected types: ${animationTypes.join(', ')}`);

    // Ensure generatorSettings exists
    if (!data.generatorSettings) {
        data.generatorSettings = {};
    }

    // Add animationTypes
    data.generatorSettings.animationTypes = animationTypes;

    return { filePath, data, animationTypes };
}

async function main() {
    log('='.repeat(60));
    log('Backfill Animation Types');
    log('='.repeat(60));

    if (DRY_RUN) {
        log('\n*** DRY RUN MODE - No files will be modified ***\n');
    }

    // Get all sprite animation set files
    const files = fs.readdirSync(SPRITE_ANIMATION_SETS_PATH)
        .filter(f => f.endsWith('.json'))
        .map(f => path.join(SPRITE_ANIMATION_SETS_PATH, f));

    log(`Found ${files.length} sprite animation sets`);

    let filesModified = 0;

    for (const filePath of files) {
        const result = processSpriteAnimationSet(filePath);
        if (result) {
            filesModified++;

            if (!DRY_RUN) {
                fs.writeFileSync(result.filePath, JSON.stringify(result.data, null, 2));
                log(`  Saved: ${path.basename(result.filePath)}`);
            }
        }
    }

    log('\n' + '='.repeat(60));
    log('Summary');
    log('='.repeat(60));
    log(`Modified: ${filesModified} files`);

    if (DRY_RUN) {
        log('\n*** DRY RUN - No files were modified ***');
        log('Run without --dry-run to apply changes');
    }
}

main().catch(err => {
    console.error('Failed:', err);
    process.exit(1);
});
