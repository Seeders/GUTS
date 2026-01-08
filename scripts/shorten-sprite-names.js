/**
 * Shorten Sprite Names Script
 *
 * Updates existing consolidated SpriteAnimationSet files to use shorter
 * frame/animation names without the unit name prefix.
 *
 * Before: barbarianIdleDown_0 -> After: idleDown_0
 * Before: peasantAttackUp -> After: attackUp
 *
 * Usage: node scripts/shorten-sprite-names.js [--dry-run]
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
 * Extract the base name (unit name) from the file/set name
 */
function getBaseName(fileName) {
    return fileName.replace('.json', '');
}

/**
 * Remove unit name prefix from animation/frame names and ensure camelCase
 * e.g., "barbarianIdleDown" -> "idleDown"
 * e.g., "peasantAttackUp_3" -> "attackUp_3"
 * e.g., "IdleDown" -> "idleDown" (fix PascalCase to camelCase)
 */
function shortenName(name, baseName) {
    // Animation types that can appear after the base name
    const animTypes = ['idle', 'walk', 'attack', 'death', 'celebrate', 'cast', 'takeoff', 'land'];

    const lowerName = name.toLowerCase();
    const lowerBase = baseName.toLowerCase();

    let shortened = name;

    // Check if name starts with baseName followed by an animation type
    if (lowerName.startsWith(lowerBase)) {
        const afterBase = name.slice(baseName.length);
        const afterBaseLower = afterBase.toLowerCase();

        // Check if what follows is a valid animation type
        for (const animType of animTypes) {
            if (afterBaseLower.startsWith(animType)) {
                shortened = afterBase;
                break;
            }
        }
    }

    // Ensure camelCase (first letter lowercase)
    if (shortened.length > 0 && shortened[0] === shortened[0].toUpperCase()) {
        shortened = shortened.charAt(0).toLowerCase() + shortened.slice(1);
    }

    return shortened;
}

/**
 * Process a single SpriteAnimationSet file
 */
function processSpriteAnimationSet(filePath) {
    const fileName = path.basename(filePath, '.json');
    const baseName = getBaseName(fileName);

    let content;
    try {
        content = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
        console.error(`Error reading ${filePath}:`, err.message);
        return null;
    }

    const data = JSON.parse(content);

    // Check if already using consolidated format
    if (!data.frames || !data.animations) {
        log(`  Skipping ${fileName}: Not consolidated format`);
        return null;
    }

    // Check if needs processing:
    // 1. Names still have unit prefix (needs shortening)
    // 2. Names start with uppercase (needs camelCase fix)
    const firstFrameName = Object.keys(data.frames)[0];
    if (!firstFrameName) {
        log(`  Skipping ${fileName}: No frames`);
        return null;
    }

    const hasUnitPrefix = firstFrameName.toLowerCase().startsWith(baseName.toLowerCase());
    const needsCamelCase = firstFrameName[0] === firstFrameName[0].toUpperCase();

    // Also check if any ballistic animation arrays still have the prefix
    // Keys look like: ballisticIdleSpriteAnimationsUp90, ballisticIdleSpriteAnimationsLevel
    const ballisticKeys = Object.keys(data).filter(k => k.startsWith('ballistic') && k.includes('SpriteAnimations'));
    let ballisticNeedsUpdate = false;
    for (const key of ballisticKeys) {
        if (Array.isArray(data[key]) && data[key].length > 0) {
            const firstBallisticName = data[key][0];
            if (firstBallisticName.toLowerCase().startsWith(baseName.toLowerCase())) {
                ballisticNeedsUpdate = true;
                break;
            }
        }
    }

    if (!hasUnitPrefix && !needsCamelCase && !ballisticNeedsUpdate) {
        log(`  Skipping ${fileName}: Already shortened and camelCase`);
        return null;
    }

    log(`\nProcessing: ${fileName}`);

    // Create new shortened versions
    const newFrames = {};
    const newAnimations = {};
    const frameNameMap = {}; // Old name -> new name

    // Shorten frame names
    for (const [frameName, frameData] of Object.entries(data.frames)) {
        const newFrameName = shortenName(frameName, baseName);
        newFrames[newFrameName] = frameData;
        frameNameMap[frameName] = newFrameName;
    }

    // Shorten animation names and update frame references
    for (const [animName, animData] of Object.entries(data.animations)) {
        const newAnimName = shortenName(animName, baseName);
        newAnimations[newAnimName] = {
            ...animData,
            frames: animData.frames.map(f => frameNameMap[f] || f)
        };
    }

    // Update animation arrays (idleSpriteAnimations, walkSpriteAnimations, etc.)
    // Also include ballistic arrays like ballisticIdleSpriteAnimationsUp90
    const animArrayKeys = Object.keys(data).filter(k =>
        k.endsWith('SpriteAnimations') ||
        (k.startsWith('ballistic') && k.includes('SpriteAnimations'))
    );
    const newData = { ...data, frames: newFrames, animations: newAnimations };

    for (const key of animArrayKeys) {
        if (Array.isArray(data[key])) {
            newData[key] = data[key].map(name => shortenName(name, baseName));
        }
    }

    // Stats
    const originalFrameCount = Object.keys(data.frames).length;
    const shortenedCount = Object.keys(frameNameMap).filter(k => frameNameMap[k] !== k).length;
    log(`  Shortened ${shortenedCount}/${originalFrameCount} frame names`);

    return { filePath, newData, shortenedCount };
}

async function main() {
    log('='.repeat(60));
    log('Shorten Sprite Names');
    log('='.repeat(60));

    if (DRY_RUN) {
        log('\n*** DRY RUN MODE - No files will be modified ***\n');
    }

    // Get all sprite animation set files
    const files = fs.readdirSync(SPRITE_ANIMATION_SETS_PATH)
        .filter(f => f.endsWith('.json'))
        .map(f => path.join(SPRITE_ANIMATION_SETS_PATH, f));

    log(`Found ${files.length} sprite animation sets`);

    let totalShortened = 0;
    let filesModified = 0;

    for (const filePath of files) {
        const result = processSpriteAnimationSet(filePath);
        if (result) {
            totalShortened += result.shortenedCount;
            filesModified++;

            if (!DRY_RUN) {
                fs.writeFileSync(result.filePath, JSON.stringify(result.newData, null, 2));
                log(`  Saved: ${path.basename(result.filePath)}`);
            }
        }
    }

    log('\n' + '='.repeat(60));
    log('Summary');
    log('='.repeat(60));
    log(`Modified: ${filesModified} files`);
    log(`Shortened: ${totalShortened} frame names`);

    if (DRY_RUN) {
        log('\n*** DRY RUN - No files were modified ***');
        log('Run without --dry-run to apply changes');
    }
}

main().catch(err => {
    console.error('Failed:', err);
    process.exit(1);
});
