#!/usr/bin/env node

/**
 * Fork diff: find engine files that game projects carry their own copies of,
 * and show how each copy differs from the engine.
 *
 * A project file "shadows" an engine file when it has the same basename as a
 * .js file under global/collections. Comparison ignores line endings, trailing
 * whitespace and blank lines, so only real edits count.
 *
 *     node build/fork-diff.js ../Descent ../KingdomOfDefiance
 *     guts fork-diff ../Descent ../KingdomOfDefiance --out report.md
 *
 * Options:
 *   --engine <dir>     GUTS root to compare against (default: this GUTS)
 *   --out <file>       Write a markdown report with the diff hunks
 *   --context <n>      Context lines around each hunk (default 2)
 *   --max-hunk-lines <n>  Truncate each file's diff after n lines (default 400)
 *
 * With no project arguments, the current directory is the project.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { GUTS_ROOT } = require('./paths');

function parseArgs(argv) {
    const opts = { projects: [], engine: GUTS_ROOT, out: null, context: 2, maxHunkLines: 400 };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--engine') opts.engine = path.resolve(argv[++i]);
        else if (a === '--out') opts.out = path.resolve(argv[++i]);
        else if (a === '--context') opts.context = parseInt(argv[++i], 10);
        else if (a === '--max-hunk-lines') opts.maxHunkLines = parseInt(argv[++i], 10);
        else opts.projects.push(path.resolve(a));
    }
    if (opts.projects.length === 0) opts.projects.push(process.cwd());
    return opts;
}

function walkJs(dir, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walkJs(full, out);
        else if (entry.name.endsWith('.js')) out.push(full);
    }
    return out;
}

/** Lines with endings and trailing whitespace normalized, blank lines dropped. */
function normalizedLines(file) {
    return fs.readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .map(l => l.replace(/\s+$/, ''))
        .filter(l => l.length > 0);
}

function hashLines(lines) {
    return crypto.createHash('sha1').update(lines.join('\n')).digest('hex');
}

/**
 * Line diff as a list of ops: { type: ' ' | '-' | '+', line }.
 * Trims the common prefix/suffix, then runs an LCS table on what is left.
 */
function diffLines(a, b) {
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    let endA = a.length, endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }

    const midA = a.slice(start, endA);
    const midB = b.slice(start, endB);
    const n = midA.length, m = midB.length;
    const ops = [];
    for (let i = 0; i < start; i++) ops.push({ type: ' ', line: a[i] });

    if (n * m > 60_000_000) {
        // Too big for the LCS table; report as a full replacement.
        for (const line of midA) ops.push({ type: '-', line });
        for (const line of midB) ops.push({ type: '+', line });
    } else {
        // lcs[i][j] = LCS length of midA[i..] and midB[j..], rows of Uint16/Uint32.
        const Row = Math.min(n, m) < 65535 ? Uint16Array : Uint32Array;
        const lcs = new Array(n + 1);
        for (let i = 0; i <= n; i++) lcs[i] = new Row(m + 1);
        for (let i = n - 1; i >= 0; i--) {
            const row = lcs[i], next = lcs[i + 1], ai = midA[i];
            for (let j = m - 1; j >= 0; j--) {
                row[j] = ai === midB[j] ? next[j + 1] + 1 : Math.max(next[j], row[j + 1]);
            }
        }
        let i = 0, j = 0;
        while (i < n && j < m) {
            if (midA[i] === midB[j]) { ops.push({ type: ' ', line: midA[i] }); i++; j++; }
            else if (lcs[i + 1][j] >= lcs[i][j + 1]) ops.push({ type: '-', line: midA[i++] });
            else ops.push({ type: '+', line: midB[j++] });
        }
        while (i < n) ops.push({ type: '-', line: midA[i++] });
        while (j < m) ops.push({ type: '+', line: midB[j++] });
    }

    for (let i = endA; i < a.length; i++) ops.push({ type: ' ', line: a[i] });
    return ops;
}

/** Unified-style hunks from diff ops, keeping `context` lines around changes. */
function formatHunks(ops, context, maxLines) {
    const keep = new Uint8Array(ops.length);
    ops.forEach((op, i) => {
        if (op.type === ' ') return;
        for (let k = Math.max(0, i - context); k <= Math.min(ops.length - 1, i + context); k++) keep[k] = 1;
    });
    const out = [];
    let prevKept = true;
    for (let i = 0; i < ops.length; i++) {
        if (!keep[i]) { prevKept = false; continue; }
        if (!prevKept && out.length) out.push('@@');
        prevKept = true;
        out.push(ops[i].type + ' ' + ops[i].line);
        if (out.length >= maxLines) {
            out.push(`... (truncated at ${maxLines} lines)`);
            break;
        }
    }
    return out.join('\n');
}

function main() {
    const opts = parseArgs(process.argv.slice(2));

    const engineFiles = new Map(); // basename -> engine path
    for (const file of walkJs(path.join(opts.engine, 'global', 'collections'))) {
        engineFiles.set(path.basename(file), file);
    }
    if (engineFiles.size === 0) {
        console.error(`No engine files found under ${opts.engine}/global/collections`);
        process.exit(1);
    }

    // basename -> { engine, engineLines, copies: [{ project, file, lines, hash, added, removed, ops }] }
    const shadowed = new Map();
    const projectNames = opts.projects.map(p => path.basename(p));

    for (const project of opts.projects) {
        const projectName = path.basename(project);
        const files = walkJs(path.join(project, 'collections'));
        if (files.length === 0) console.warn(`warning: no collections/*.js in ${project}`);
        for (const file of files) {
            const name = path.basename(file);
            const engineFile = engineFiles.get(name);
            if (!engineFile) continue;

            let entry = shadowed.get(name);
            if (!entry) {
                const engineLines = normalizedLines(engineFile);
                entry = { engine: engineFile, engineLines, engineHash: hashLines(engineLines), copies: [] };
                shadowed.set(name, entry);
            }
            const lines = normalizedLines(file);
            const hash = hashLines(lines);
            let added = 0, removed = 0, ops = null;
            if (hash !== entry.engineHash) {
                ops = diffLines(entry.engineLines, lines);
                for (const op of ops) {
                    if (op.type === '+') added++;
                    else if (op.type === '-') removed++;
                }
            }
            entry.copies.push({ project: projectName, file, lines, hash, added, removed, ops });
        }
    }

    const names = [...shadowed.keys()].sort((x, y) => {
        const churn = n => shadowed.get(n).copies.reduce((s, c) => s + c.added + c.removed, 0);
        return churn(y) - churn(x);
    });

    // Copies that are identical across projects share a variant letter (A, B, ...),
    // so "Descent=A Kingdom=A" means both carry the same fork.
    const variantOf = entry => {
        const letters = new Map();
        for (const c of entry.copies) {
            if (c.hash === entry.engineHash) continue;
            if (!letters.has(c.hash)) letters.set(c.hash, String.fromCharCode(65 + letters.size));
        }
        return letters;
    };

    // --- console summary ---
    const col = Math.max(24, ...names.map(n => n.length + 2));
    console.log(`\nEngine: ${opts.engine}`);
    console.log(`Shadowed engine files: ${names.length}\n`);
    console.log('file'.padEnd(col) + 'engine'.padStart(7) + '  ' + projectNames.map(p => p.slice(0, 18).padEnd(20)).join(''));
    let identical = 0, diverged = 0;
    for (const name of names) {
        const entry = shadowed.get(name);
        const letters = variantOf(entry);
        const cells = projectNames.map(p => {
            const c = entry.copies.find(c => c.project === p);
            if (!c) return '-'.padEnd(20);
            if (c.hash === entry.engineHash) { identical++; return '= engine'.padEnd(20); }
            diverged++;
            return `${letters.get(c.hash)} +${c.added} -${c.removed}`.padEnd(20);
        });
        console.log(name.padEnd(col) + String(entry.engineLines.length).padStart(7) + '  ' + cells.join(''));
    }
    console.log(`\n${identical} copies identical to engine (deleting them falls back to the engine copy), ${diverged} diverged.`);
    console.log('Same letter in a row = identical copies across projects.\n');

    // --- markdown report ---
    if (opts.out) {
        const md = [];
        md.push('# Fork diff report', '');
        md.push(`Engine: \`${opts.engine}\`  `);
        md.push(`Projects: ${projectNames.join(', ')}  `);
        md.push(`Generated: ${new Date().toISOString()}`, '');
        md.push('Lines compared after normalizing line endings, trailing whitespace and blank lines.', '');
        md.push('| file | engine lines | ' + projectNames.join(' | ') + ' |');
        md.push('|---|---:|' + projectNames.map(() => '---').join('|') + '|');
        for (const name of names) {
            const entry = shadowed.get(name);
            const letters = variantOf(entry);
            const cells = projectNames.map(p => {
                const c = entry.copies.find(c => c.project === p);
                if (!c) return '';
                if (c.hash === entry.engineHash) return '= engine';
                return `${letters.get(c.hash)} +${c.added} −${c.removed}`;
            });
            md.push(`| ${name} | ${entry.engineLines.length} | ${cells.join(' | ')} |`);
        }
        md.push('');

        for (const name of names) {
            const entry = shadowed.get(name);
            const letters = variantOf(entry);
            if (letters.size === 0) continue;
            md.push(`## ${name}`, '');
            md.push(`Engine: \`${path.relative(opts.engine, entry.engine)}\``, '');
            for (const [hash, letter] of letters) {
                const copies = entry.copies.filter(c => c.hash === hash);
                const c = copies[0];
                md.push(`### Variant ${letter} (+${c.added} −${c.removed}): ${copies.map(c => c.project).join(', ')}`, '');
                md.push('```diff', formatHunks(c.ops, opts.context, opts.maxHunkLines), '```', '');
            }
        }
        fs.mkdirSync(path.dirname(opts.out), { recursive: true });
        fs.writeFileSync(opts.out, md.join('\n'));
        console.log(`Report written to ${opts.out}`);
    }
}

if (require.main === module) main();

module.exports = { walkJs, normalizedLines, hashLines, diffLines };
