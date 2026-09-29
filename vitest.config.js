import { defineConfig } from 'vitest/config';
import fs from 'fs';
import path from 'path';

// Each game's tests run against THAT game's client bundle and boot the
// systems its scenes declare. Projects are forks with diverging copies of
// the same systems, so there is no shared fallback bundle: a project whose
// bundle isn't built fails setup (tests/setup.js). The default scene is the
// project game config's `testScene`; tests may pass their own.
const root = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const projectsDir = path.join(root, 'projects');

const hasTests = (dir, depth = 0) => {
  if (depth > 6) return false;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return false; }
  for (const e of entries) {
    if (!e.isDirectory() || e.name === 'node_modules' || e.name === 'dist') continue;
    const full = path.join(dir, e.name);
    if (e.name === 'tests' && fs.readdirSync(full).some(f => f.endsWith('.test.js'))) return true;
    if (hasTests(full, depth + 1)) return true;
  }
  return false;
};

const testSceneOf = (name) => {
  try {
    const cfg = JSON.parse(fs.readFileSync(
      path.join(projectsDir, name, 'collections/settings/configs/game.json'), 'utf8'));
    return cfg.testScene || '';
  } catch {
    return '';
  }
};

const names = fs.existsSync(projectsDir)
  ? fs.readdirSync(projectsDir).filter(n =>
      fs.statSync(path.join(projectsDir, n)).isDirectory() && hasTests(path.join(projectsDir, n)))
  : [];

export default defineConfig({
  test: {
    projects: names.map(name => ({
      test: {
        name,
        globals: true,
        environment: 'jsdom',
        include: [`projects/${name}/**/tests/*.test.js`],
        setupFiles: ['./tests/setup.js'],
        env: { GUTS_TEST_PROJECT: name, GUTS_TEST_SCENE: testSceneOf(name) }
      }
    }))
  }
});
