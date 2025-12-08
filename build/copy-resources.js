/**
 * Resource Copier for GUTS
 * Copies project resources folder to dist/client/resources
 * Can be used standalone or required by other scripts
 */

const fs = require('fs');
const path = require('path');

/**
 * Copy resources from project/resources to dist/client/resources
 * @param {string} projectName - Name of the project
 * @param {boolean} verbose - Whether to log each file copied
 * @returns {boolean} - True if successful
 */
function copyResources(projectName, verbose = true) {
    const projectRoot = path.resolve(__dirname, '..', 'projects', projectName);
    const resourcesSource = path.join(projectRoot, 'resources');
    const resourcesDest = path.join(projectRoot, 'dist', 'client', 'resources');

    if (!fs.existsSync(resourcesSource)) {
        if (verbose) console.log(`No resources folder found at ${resourcesSource}`);
        return true;
    }

    if (verbose) console.log('📂 Copying resources...');

    // Ensure destination directory exists
    if (!fs.existsSync(resourcesDest)) {
        fs.mkdirSync(resourcesDest, { recursive: true });
    }

    function copyRecursive(src, dest) {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }

        const entries = fs.readdirSync(src, { withFileTypes: true });
        for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);

            if (entry.isDirectory()) {
                copyRecursive(srcPath, destPath);
            } else if (entry.isFile()) {
                fs.copyFileSync(srcPath, destPath);
                if (verbose) {
                    const relativePath = path.relative(resourcesSource, srcPath);
                    console.log(`  ✓ ${relativePath}`);
                }
            }
        }
    }

    try {
        copyRecursive(resourcesSource, resourcesDest);
        if (verbose) console.log('✅ Resources copied\n');
        return true;
    } catch (error) {
        console.error('❌ Error copying resources:', error.message);
        return false;
    }
}

// If run directly from command line
if (require.main === module) {
    const projectName = process.argv[2];

    if (!projectName) {
        console.log(`
Usage: node build/copy-resources.js <project-name>

Examples:
  node build/copy-resources.js TurnBasedWarfare
`);
        process.exit(1);
    }

    const projectRoot = path.resolve(__dirname, '..', 'projects', projectName);
    if (!fs.existsSync(projectRoot)) {
        console.error(`Error: Project "${projectName}" not found at ${projectRoot}`);
        process.exit(1);
    }

    const success = copyResources(projectName, true);
    process.exit(success ? 0 : 1);
}

module.exports = { copyResources };
