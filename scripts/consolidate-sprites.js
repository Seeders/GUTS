/**
 * Sprite Consolidation Migration Script
 *
 * Merges individual sprite frame JSONs and animation definition JSONs
 * directly into SpriteAnimationSet files to reduce build bundle size.
 *
 * Before: ~39,000 individual sprite files + ~2,000 animation files
 * After: ~50 consolidated SpriteAnimationSet files
 *
 * Usage: node scripts/consolidate-sprites.js [--dry-run] [--verbose]
 */

const fs = require('fs');
const path = require('path');

// Configuration
const PROJECT_ROOT = path.resolve(__dirname, '..');
const COLLECTIONS_PATH = path.join(PROJECT_ROOT, 'projects', 'TurnBasedWarfare', 'collections');
const SPRITE_ANIMATION_SETS_PATH = path.join(COLLECTIONS_PATH, 'data', 'spriteAnimationSets');
const SPRITES_PATH = path.join(COLLECTIONS_PATH, 'sprites');

// Parse command line arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');
const CLEANUP = args.includes('--cleanup');

function log(...args) {
    console.log(...args);
}

function verbose(...args) {
    if (VERBOSE) console.log('  ', ...args);
}

/**
 * Read JSON file with error handling
 */
function readJson(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(content);
    } catch (err) {
        console.error(`Error reading ${filePath}:`, err.message);
        return null;
    }
}

/**
 * Write JSON file with pretty formatting
 */
function writeJson(filePath, data) {
    if (DRY_RUN) {
        verbose(`Would write: ${filePath}`);
        return true;
    }
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (err) {
        console.error(`Error writing ${filePath}:`, err.message);
        return false;
    }
}

/**
 * Get all JSON files in a directory
 */
function getJsonFiles(dirPath) {
    try {
        if (!fs.existsSync(dirPath)) return [];
        return fs.readdirSync(dirPath)
            .filter(f => f.endsWith('.json'))
            .map(f => path.join(dirPath, f));
    } catch (err) {
        console.error(`Error reading directory ${dirPath}:`, err.message);
        return [];
    }
}

/**
 * Load all sprites from a sprite collection folder
 */
function loadSpriteCollection(spriteCollectionName) {
    const spritesDir = path.join(SPRITES_PATH, spriteCollectionName);
    const sprites = {};

    const files = getJsonFiles(spritesDir);
    for (const filePath of files) {
        const fileName = path.basename(filePath, '.json');
        const data = readJson(filePath);
        if (data) {
            // Store only the essential fields (not title)
            sprites[fileName] = {
                x: data.x,
                y: data.y,
                w: data.width,
                h: data.height
            };
        }
    }

    return sprites;
}

/**
 * Load all animations from an animation collection folder
 */
function loadAnimationCollection(animationCollectionName) {
    const animsDir = path.join(SPRITES_PATH, animationCollectionName);
    const animations = {};

    const files = getJsonFiles(animsDir);
    for (const filePath of files) {
        const fileName = path.basename(filePath, '.json');
        const data = readJson(filePath);
        if (data) {
            animations[fileName] = {
                sprites: data.sprites,
                fps: data.fps,
                spriteCollection: data.spriteCollection
            };
        }
    }

    return animations;
}

/**
 * Process a single SpriteAnimationSet file
 */
function processSpriteAnimationSet(setFilePath) {
    const setData = readJson(setFilePath);
    if (!setData) return null;

    const setName = path.basename(setFilePath, '.json');
    log(`\nProcessing: ${setName}`);

    // Get the animation collection name from the set
    const animationCollectionName = setData.animationCollection;
    if (!animationCollectionName) {
        log(`  Skipping: No animationCollection defined`);
        return null;
    }

    // Load animation collection
    const animationCollection = loadAnimationCollection(animationCollectionName);
    if (Object.keys(animationCollection).length === 0) {
        log(`  Skipping: Animation collection '${animationCollectionName}' is empty or not found`);
        return null;
    }
    verbose(`Loaded ${Object.keys(animationCollection).length} animations from ${animationCollectionName}`);

    // Find sprite collection from first animation
    const firstAnimKey = Object.keys(animationCollection)[0];
    const spriteCollectionName = animationCollection[firstAnimKey]?.spriteCollection;
    if (!spriteCollectionName) {
        log(`  Skipping: No spriteCollection in animations`);
        return null;
    }

    // Load sprite collection
    const spriteCollection = loadSpriteCollection(spriteCollectionName);
    if (Object.keys(spriteCollection).length === 0) {
        log(`  Skipping: Sprite collection '${spriteCollectionName}' is empty or not found`);
        return null;
    }
    verbose(`Loaded ${Object.keys(spriteCollection).length} sprites from ${spriteCollectionName}`);

    // Build consolidated data structure
    const consolidated = {
        title: setData.title,
        spriteSheet: setData.spriteSheet,
        spriteOffset: setData.spriteOffset,
        generatorSettings: setData.generatorSettings,
        // Embed all sprite frame coordinates
        frames: spriteCollection,
        // Embed all animation definitions
        animations: {}
    };

    // Convert animation definitions to new format
    // Animation arrays by type (idle, walk, attack, death, celebrate, etc.)
    const animationTypes = [
        'idle', 'walk', 'attack', 'death', 'celebrate',
        'cast', 'takeoff', 'land'
    ];

    // Also handle ballistic animations
    const ballisticAngles = ['Up90', 'Up45', 'Level', 'Down45', 'Down90'];

    for (const animType of animationTypes) {
        const animKey = `${animType}SpriteAnimations`;
        const animNames = setData[animKey];

        if (animNames && Array.isArray(animNames)) {
            consolidated[animKey] = animNames;

            // Process each animation in the array
            for (const animName of animNames) {
                const animData = animationCollection[animName];
                if (animData) {
                    consolidated.animations[animName] = {
                        frames: animData.sprites, // Just the sprite names, actual coords in 'frames'
                        fps: animData.fps
                    };
                }
            }
        }

        // Also process ballistic animations if they exist
        for (const angle of ballisticAngles) {
            const ballisticKey = `ballistic${animType.charAt(0).toUpperCase() + animType.slice(1)}SpriteAnimations${angle}`;
            const ballisticAnimNames = setData[ballisticKey];

            if (ballisticAnimNames && Array.isArray(ballisticAnimNames)) {
                consolidated[ballisticKey] = ballisticAnimNames;

                for (const animName of ballisticAnimNames) {
                    const animData = animationCollection[animName];
                    if (animData) {
                        consolidated.animations[animName] = {
                            frames: animData.sprites,
                            fps: animData.fps
                        };
                    }
                }
            }
        }
    }

    // Stats
    const frameCount = Object.keys(consolidated.frames).length;
    const animCount = Object.keys(consolidated.animations).length;
    log(`  Consolidated: ${frameCount} frames, ${animCount} animations`);

    return {
        setName,
        originalPath: setFilePath,
        consolidated,
        spriteCollectionName,
        animationCollectionName,
        stats: { frameCount, animCount }
    };
}

/**
 * Main migration function
 */
async function main() {
    log('='.repeat(60));
    log('Sprite Consolidation Migration');
    log('='.repeat(60));

    if (DRY_RUN) {
        log('\n*** DRY RUN MODE - No files will be modified ***\n');
    }

    // Get all sprite animation set files
    const setFiles = getJsonFiles(SPRITE_ANIMATION_SETS_PATH);
    log(`Found ${setFiles.length} sprite animation sets`);

    // Process each set
    const results = [];
    let totalFrames = 0;
    let totalAnimations = 0;

    for (const setFile of setFiles) {
        const result = processSpriteAnimationSet(setFile);
        if (result) {
            results.push(result);
            totalFrames += result.stats.frameCount;
            totalAnimations += result.stats.animCount;
        }
    }

    // Summary
    log('\n' + '='.repeat(60));
    log('Summary');
    log('='.repeat(60));
    log(`Processed: ${results.length} sprite animation sets`);
    log(`Total frames embedded: ${totalFrames}`);
    log(`Total animations embedded: ${totalAnimations}`);

    if (DRY_RUN) {
        log('\n*** DRY RUN - No changes made ***');
        log('Run without --dry-run to apply changes');
        return;
    }

    // Write consolidated files
    log('\nWriting consolidated files...');

    const collectionsToDelete = new Set();

    for (const result of results) {
        const success = writeJson(result.originalPath, result.consolidated);
        if (success) {
            log(`  Wrote: ${result.setName}.json`);
            collectionsToDelete.add(result.spriteCollectionName);
            collectionsToDelete.add(result.animationCollectionName);
        }
    }

    // List collections that can be deleted
    log('\n' + '='.repeat(60));
    log('Collections that can now be deleted:');
    log('='.repeat(60));

    for (const collection of collectionsToDelete) {
        const collectionPath = path.join(SPRITES_PATH, collection);
        if (fs.existsSync(collectionPath)) {
            const fileCount = getJsonFiles(collectionPath).length;
            log(`  ${collection}/ (${fileCount} files)`);
        }
    }

    log('\nTo delete old sprite files, run:');
    log('  node scripts/consolidate-sprites.js --cleanup');

    log('\nMigration complete!');
}

/**
 * Cleanup function - delete old sprite and animation collections
 */
async function cleanup() {
    log('='.repeat(60));
    log('Sprite Cleanup - Deleting Old Collections');
    log('='.repeat(60));

    if (DRY_RUN) {
        log('\n*** DRY RUN MODE - No files will be deleted ***\n');
    }

    // Get all sprite animation set files to find collections to delete
    const setFiles = getJsonFiles(SPRITE_ANIMATION_SETS_PATH);
    const collectionsToDelete = new Set();

    for (const setFile of setFiles) {
        const setData = readJson(setFile);
        if (!setData) continue;

        // Check if using consolidated format (has embedded frames and animations)
        if (setData.frames && setData.animations) {
            // Derive sprite collection name from spriteSheet path
            // e.g., "sprites/peasantSprites/peasantSheet.png" -> "peasantSprites"
            if (setData.spriteSheet) {
                const parts = setData.spriteSheet.split('/');
                if (parts.length >= 2) {
                    const spriteCollection = parts[1]; // e.g., "peasantSprites"
                    collectionsToDelete.add(spriteCollection);
                    // Animation collection follows pattern: xxxSprites -> xxxSpritesAnimations
                    collectionsToDelete.add(spriteCollection + 'Animations');
                }
            }
        }
    }

    log(`Found ${collectionsToDelete.size} collections to delete\n`);

    let totalDeleted = 0;

    for (const collection of collectionsToDelete) {
        const collectionPath = path.join(SPRITES_PATH, collection);

        if (!fs.existsSync(collectionPath)) {
            log(`  Skipping ${collection}/ (not found)`);
            continue;
        }

        const files = getJsonFiles(collectionPath);
        log(`  Deleting ${collection}/ (${files.length} files)...`);

        if (!DRY_RUN) {
            try {
                // Delete all files in the collection
                for (const file of files) {
                    fs.unlinkSync(file);
                }
                // Delete the directory
                fs.rmdirSync(collectionPath);
                totalDeleted += files.length;
                log(`    Deleted ${files.length} files`);
            } catch (err) {
                console.error(`    Error deleting ${collection}:`, err.message);
            }
        } else {
            log(`    Would delete ${files.length} files`);
            totalDeleted += files.length;
        }
    }

    log('\n' + '='.repeat(60));
    log('Summary');
    log('='.repeat(60));
    log(`Deleted ${totalDeleted} files from ${collectionsToDelete.size} collections`);

    if (DRY_RUN) {
        log('\n*** DRY RUN - No files were deleted ***');
        log('Run without --dry-run to delete files');
    }
}

// Run cleanup or migration based on command line args
if (CLEANUP) {
    cleanup().catch(err => {
        console.error('Cleanup failed:', err);
        process.exit(1);
    });
} else {
    main().catch(err => {
        console.error('Migration failed:', err);
        process.exit(1);
    });
}
