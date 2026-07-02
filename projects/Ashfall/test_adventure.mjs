// End-to-end smoke test for the Ashfall adventure mode.
// Usage: node projects/Ashfall/test_adventure.mjs   (server must be running on :3000)
import puppeteer from 'puppeteer';

const BASE = 'http://localhost:3000/index.html';
const results = [];
const errors = [];

function check(name, ok, detail = '') {
    results.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--window-size=800,600', '--use-gl=swiftshader', '--enable-unsafe-swiftshader']
});

// Wait until the sim clock advances by `simSeconds` (software rendering makes
// wall-clock waits unreliable — the sim may run far slower than realtime headless)
async function waitSimTime(page, simSeconds, maxWallMs = 120000) {
    const start = await page.evaluate(() => window.game.state.now);
    await page.waitForFunction(
        (s, d) => window.game.state.now >= s + d,
        { timeout: maxWallMs, polling: 250 },
        start, simSeconds
    );
}

try {
    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 600 });

    page.on('console', msg => {
        if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));

    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });

    // Wait for main menu
    await page.waitForSelector('#mainMenu_PlayGameBtn', { timeout: 60000 });
    check('main menu loads', true);

    await page.click('#mainMenu_PlayGameBtn');
    await page.waitForSelector('[data-mode="adventure"]', { timeout: 15000 });
    check('adventure mode card visible', true);

    await page.click('[data-mode="adventure"]');
    await page.waitForSelector('#arpgClassSelectDialog .arpg-class-card', { timeout: 10000 });
    const classCount = await page.$$eval('#arpgClassSelectDialog .arpg-class-card', els => els.length);
    check('class select shows 6 classes', classCount === 6, `found ${classCount}`);

    // Pick the first class (Barbarian)
    await page.click('#arpgClassSelectDialog .arpg-class-card');

    // Wait for adventure scene to finish loading (player character exists)
    await page.waitForFunction(() => {
        return window.game?.state?.isAdventure && window.game?.state?.playerCharacterId != null;
    }, { timeout: 90000, polling: 500 });
    check('adventure scene loads with player character', true);

    // Give the scene a moment to settle (sim time)
    await waitSimTime(page, 1.5);

    const snapshot = await page.evaluate(() => {
        const game = window.game;
        const pid = game.state.playerCharacterId;
        const t = game.getComponent(pid, 'transform');
        const pc = game.getComponent(pid, 'playerControlled');
        const health = game.getComponent(pid, 'health');
        const pool = game.getComponent(pid, 'resourcePool');
        const aiState = game.getComponent(pid, 'aiState');
        const enemies = game.getEntitiesWith('neutralMonster');
        return {
            pos: t ? { x: t.position.x, y: t.position.y, z: t.position.z } : null,
            hasPC: !!pc,
            hasAI: !!aiState,
            health: health ? { c: health.current, m: health.max } : null,
            mana: pool ? { c: pool.mana, m: pool.maxMana } : null,
            enemyCount: enemies.length,
            phase: game.state.phase,
            hudHealth: !!document.getElementById('arpgHealthFill'),
            hudMana: !!document.getElementById('arpgManaFill'),
            zoneName: document.getElementById('arpgZoneName')?.textContent
        };
    });

    check('player has playerControlled component', snapshot.hasPC);
    check('player has NO aiState (direct control)', !snapshot.hasAI);
    check('player has health', !!snapshot.health, JSON.stringify(snapshot.health));
    check('player has mana pool', !!snapshot.mana, JSON.stringify(snapshot.mana));
    check('enemies spawned', snapshot.enemyCount > 0, `${snapshot.enemyCount} monsters`);
    check('HUD globes present', snapshot.hudHealth && snapshot.hudMana);
    check('zone name shown', !!snapshot.zoneName, snapshot.zoneName);

    // ── WASD movement test ────────────────────────────────────────────────
    const before = snapshot.pos;
    await page.keyboard.down('KeyW');
    await page.keyboard.down('KeyD');
    await waitSimTime(page, 2);
    await page.keyboard.up('KeyW');
    await page.keyboard.up('KeyD');

    const after = await page.evaluate(() => {
        const game = window.game;
        const t = game.getComponent(game.state.playerCharacterId, 'transform');
        return { x: t.position.x, y: t.position.y, z: t.position.z };
    });
    const moved = Math.hypot(after.x - before.x, after.z - before.z);
    check('WASD moves the character', moved > 20,
        `moved ${moved.toFixed(1)} units (${before.x.toFixed(0)},${before.z.toFixed(0)}) -> (${after.x.toFixed(0)},${after.z.toFixed(0)})`);

    // ── Attack test: teleport a skeleton next to the player, hold LMB at it ──
    const attackSetup = await page.evaluate(() => {
        const game = window.game;
        const pid = game.state.playerCharacterId;
        const pt = game.getComponent(pid, 'transform');
        const enemies = game.getEntitiesWith('neutralMonster', 'health', 'transform');
        if (!enemies.length) return null;
        const eid = enemies[0];
        const et = game.getComponent(eid, 'transform');
        // Place enemy right in front of the player
        et.position.x = pt.position.x + 40;
        et.position.z = pt.position.z;
        const eh = game.getComponent(eid, 'health');
        return { eid, hp: eh.current, px: pt.position.x, pz: pt.position.z };
    });

    if (attackSetup) {
        // Aim at the enemy: project its world pos to screen via the camera
        const screenPos = await page.evaluate((eid) => {
            const game = window.game;
            const t = game.getComponent(eid, 'transform');
            const camera = game.getService('getCamera')();
            const v = new THREE.Vector3(t.position.x, t.position.y + 10, t.position.z);
            v.project(camera);
            const canvas = document.getElementById('gameCanvas');
            const rect = canvas.getBoundingClientRect();
            return {
                x: rect.left + (v.x + 1) / 2 * rect.width,
                y: rect.top + (-v.y + 1) / 2 * rect.height
            };
        }, attackSetup.eid);

        await page.mouse.move(screenPos.x, screenPos.y);
        await page.mouse.down();
        await waitSimTime(page, 4);
        await page.mouse.up();

        const hpAfter = await page.evaluate((eid) => {
            const game = window.game;
            const h = game.getComponent(eid, 'health');
            return h ? h.current : -999;   // -999: entity gone (killed + cleaned up)
        }, attackSetup.eid);

        const damaged = hpAfter === -999 || hpAfter < attackSetup.hp;
        check('basic attack damages enemy', damaged, `hp ${attackSetup.hp} -> ${hpAfter === -999 ? 'dead/removed' : hpAfter}`);
    } else {
        check('basic attack damages enemy', false, 'no enemy found for attack test');
    }

    await page.screenshot({ path: 'projects/Ashfall/test_adventure.png' });
    console.log('screenshot: projects/Ashfall/test_adventure.png');

} catch (e) {
    check('test run completed', false, e.message);
} finally {
    await browser.close();
}

const failed = results.filter(r => !r.ok);
const relevantErrors = errors.filter(e =>
    !e.includes('favicon') && !e.includes('WebGL') && !e.includes('GroupMarkerNotSet'));
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (relevantErrors.length) {
    console.log('\nConsole errors (first 15):');
    relevantErrors.slice(0, 15).forEach(e => console.log('  ', e.slice(0, 300)));
}
process.exit(failed.length ? 1 : 0);
