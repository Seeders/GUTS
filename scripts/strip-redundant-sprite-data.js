/**
 * Strip Redundant Sprite Data Script
 *
 * Removes redundant animation definitions from SpriteAnimationSet files.
 * Since animation names are now standardized (idleDown, walkUpLeft, etc.),
 * the animations and *SpriteAnimations arrays can be derived at runtime
 * from the frame names.
 *
 * Keeps only:
 * - title
 * - spriteSheet
 * - spriteOffset
 * - generatorSettings
 * - frames (the actual sprite coordinates)
 *
 * Usage: node scripts/strip-redundant-sprite-data.js [--dry-run]
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

    // Check if using consolidated format
    if (!data.frames) {
        log(`  Skipping ${fileName}: No frames (not consolidated)`);
        return null;
    }

    // Check if already stripped (no animations object)
    if (!data.animations) {
        log(`  Skipping ${fileName}: Already stripped`);
        return null;
    }

    log(`\nProcessing: ${fileName}`);

    // Keep only essential data
    const strippedData = {
        title: data.title,
        spriteSheet: data.spriteSheet
    };

    // Only include spriteOffset if it exists
    if (data.spriteOffset !== undefined) {
        strippedData.spriteOffset = data.spriteOffset;
    }

    // Include generator settings if present
    if (data.generatorSettings) {
        strippedData.generatorSettings = data.generatorSettings;
    }

    // Keep only the frames
    strippedData.frames = data.frames;

    // Calculate savings
    const originalSize = JSON.stringify(data).length;
    const newSize = JSON.stringify(strippedData).length;
    const savedBytes = originalSize - newSize;
    const savedPercent = Math.round((savedBytes / originalSize) * 100);

    log(`  Removed: animations, *SpriteAnimations arrays`);
    log(`  Size: ${originalSize} -> ${newSize} bytes (saved ${savedPercent}%)`);

    return { filePath, strippedData, savedBytes };
}

async function main() {
    log('='.repeat(60));
    log('Strip Redundant Sprite Data');
    log('='.repeat(60));

    if (DRY_RUN) {
        log('\n*** DRY RUN MODE - No files will be modified ***\n');
    }

    // Get all sprite animation set files
    const files = fs.readdirSync(SPRITE_ANIMATION_SETS_PATH)
        .filter(f => f.endsWith('.json'))
        .map(f => path.join(SPRITE_ANIMATION_SETS_PATH, f));

    log(`Found ${files.length} sprite animation sets`);

    let totalSaved = 0;
    let filesModified = 0;

    for (const filePath of files) {
        const result = processSpriteAnimationSet(filePath);
        if (result) {
            totalSaved += result.savedBytes;
            filesModified++;

            if (!DRY_RUN) {
                fs.writeFileSync(result.filePath, JSON.stringify(result.strippedData, null, 2));
                log(`  Saved: ${path.basename(result.filePath)}`);
            }
        }
    }

    log('\n' + '='.repeat(60));
    log('Summary');
    log('='.repeat(60));
    log(`Modified: ${filesModified} files`);
    log(`Total saved: ${(totalSaved / 1024).toFixed(1)} KB`);

    if (DRY_RUN) {
        log('\n*** DRY RUN - No files were modified ***');
        log('Run without --dry-run to apply changes');
    }
}

main().catch(err => {
    console.error('Failed:', err);
    process.exit(1);
});
