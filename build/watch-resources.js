/**
 * Resource Watcher for GUTS
 * Watches project resources folder and copies files to dist/client/resources
 */

const chokidar = require('chokidar');
const fs = require('fs');
const path = require('path');

// Get project name from command line or environment
const projectName = process.argv[2] || process.env.PROJECT_NAME || 'TurnBasedWarfare';

const projectRoot = path.resolve(__dirname, '..', 'projects', projectName);
const resourcesSource = path.join(projectRoot, 'resources');
const resourcesDest = path.join(projectRoot, 'dist', 'client', 'resources');

console.log(`
╔═══════════════════════════════════════════════════════════╗
║           GUTS Resources Watcher                          ║
╟───────────────────────────────────────────────────────────╢
║  Project: ${projectName.padEnd(48)}║
║  Watching: ${path.relative(process.cwd(), resourcesSource).padEnd(45)}║
║  Copying to: ${path.relative(process.cwd(), resourcesDest).padEnd(43)}║
╚═══════════════════════════════════════════════════════════╝
`);

// Ensure source directory exists
if (!fs.existsSync(resourcesSource)) {
    console.log(`⚠️  Resources folder not found: ${resourcesSource}`);
    console.log(`   Creating resources folder...`);
    fs.mkdirSync(resourcesSource, { recursive: true });
}

// Ensure destination directory exists
if (!fs.existsSync(resourcesDest)) {
    fs.mkdirSync(resourcesDest, { recursive: true });
}

/**
 * Copy a file from source to destination, maintaining directory structure
 */
function copyFile(sourcePath) {
    // Get relative path from resources source
    const relativePath = path.relative(resourcesSource, sourcePath);
    const destPath = path.join(resourcesDest, relativePath);

    // Ensure destination directory exists
    const destDir = path.dirname(destPath);
    if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
    }

    // Copy file
    try {
        fs.copyFileSync(sourcePath, destPath);
        console.log(`✓ Copied: ${relativePath}`);
    } catch (error) {
        console.error(`✗ Error copying ${relativePath}:`, error.message);
    }
}

/**
 * Delete a file from destination
 */
function deleteFile(sourcePath) {
    const relativePath = path.relative(resourcesSource, sourcePath);
    const destPath = path.join(resourcesDest, relativePath);

    try {
        if (fs.existsSync(destPath)) {
            fs.unlinkSync(destPath);
            console.log(`✓ Deleted: ${relativePath}`);

            // Clean up empty directories
            let dir = path.dirname(destPath);
            while (dir !== resourcesDest && fs.existsSync(dir)) {
                const files = fs.readdirSync(dir);
                if (files.length === 0) {
                    fs.rmdirSync(dir);
                    dir = path.dirname(dir);
                } else {
                    break;
                }
            }
        }
    } catch (error) {
        console.error(`✗ Error deleting ${relativePath}:`, error.message);
    }
}

/**
 * Initial copy of all existing files
 */
function initialCopy() {
    console.log('\n📦 Performing initial copy of resources...\n');

    function copyRecursive(src) {
        if (!fs.existsSync(src)) return;

        const entries = fs.readdirSync(src, { withFileTypes: true });

        for (const entry of entries) {
            const srcPath = path.join(src, entry.name);

            if (entry.isDirectory()) {
                copyRecursive(srcPath);
            } else if (entry.isFile()) {
                copyFile(srcPath);
            }
        }
    }

    copyRecursive(resourcesSource);
    console.log('\n✅ Initial copy complete\n');
}

// Perform initial copy
initialCopy();

// Watch for changes
const watcher = chokidar.watch(resourcesSource, {
    persistent: true,
    ignoreInitial: true, // We already did initial copy
    awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50
    }
});

watcher
    .on('add', copyFile)
    .on('change', copyFile)
    .on('unlink', deleteFile)
    .on('error', error => console.error(`Watcher error: ${error}`))
    .on('ready', () => {
        console.log('👀 Watching for resource changes...\n');
    });

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n🛑 Stopping resource watcher...');
    watcher.close();
    process.exit(0);
});
