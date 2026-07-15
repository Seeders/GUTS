/**
 * Path resolution for the GUTS build system.
 *
 * GUTS can build a project in two layouts:
 *
 *   1. Monorepo (the original): the project lives inside this repo at
 *      projects/<name>/. Nothing special is set; project root is derived from
 *      the name.
 *
 *   2. External (project as its own repo, GUTS installed as a dependency): the
 *      project repo runs `npx guts build` from its own directory. The CLI sets
 *      GUTS_PROJECT_ROOT to that directory, and the project's collections live
 *      there directly (no projects/<name> nesting).
 *
 * GUTS_ROOT is always this framework's install directory — the parent of build/.
 * That holds whether GUTS is the repo you are in or node_modules/guts inside a
 * consuming project. Framework assets (engine/, global/, node_modules/) resolve
 * against it; project assets resolve against the project root.
 */

const path = require('path');
const fs = require('fs');

// The GUTS framework root: parent of this build/ directory.
const GUTS_ROOT = path.resolve(__dirname, '..');

/**
 * Resolve the root directory of the project being built.
 *
 * @param {string} projectName - Project name (used for the monorepo layout).
 * @returns {string} Absolute path to the project root.
 */
function resolveProjectRoot(projectName) {
    if (process.env.GUTS_PROJECT_ROOT) {
        return path.resolve(process.env.GUTS_PROJECT_ROOT);
    }
    return path.join(GUTS_ROOT, 'projects', projectName);
}

/**
 * Resolve an installed npm package's directory, wherever the package manager
 * placed it (hoisted to the consumer's node_modules, or nested under
 * node_modules/guts/). Resolves from GUTS_ROOT so framework dependencies are
 * found regardless of the project's own node_modules.
 *
 * @param {string} pkg - Package name, e.g. 'three'.
 * @returns {string|null} Absolute path to the package directory, or null if not installed.
 */
function resolvePackageDir(pkg) {
    // Fast path: most packages let you resolve their package.json directly.
    try {
        return path.dirname(require.resolve(`${pkg}/package.json`, { paths: [GUTS_ROOT] }));
    } catch (e) { /* fall through */ }

    // Fallback: packages with a restrictive "exports" map (e.g. `three`) refuse
    // deep access to package.json (ERR_PACKAGE_PATH_NOT_EXPORTED). Resolve the
    // package's main entry instead and walk up to the directory whose
    // package.json actually belongs to this package.
    try {
        let dir = path.dirname(require.resolve(pkg, { paths: [GUTS_ROOT] }));
        const root = path.parse(dir).root;
        while (dir && dir !== root) {
            const pj = path.join(dir, 'package.json');
            if (fs.existsSync(pj)) {
                try {
                    if (JSON.parse(fs.readFileSync(pj, 'utf8')).name === pkg) return dir;
                } catch (e) { /* keep walking */ }
            }
            dir = path.dirname(dir);
        }
    } catch (e) { /* not installed */ }

    return null;
}

module.exports = { GUTS_ROOT, resolveProjectRoot, resolvePackageDir };
