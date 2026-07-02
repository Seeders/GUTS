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
    args: ['--window-size=1280,800', '--enable-gpu', '--use-angle=default']
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
    await page.setViewport({ width: 1280, height: 800 });

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
        await waitSimTime(page, 0.5); // let spatial/vision register the teleport

        // Hold the attack for several sim seconds, re-aiming at the (moving)
        // enemy each pass — the AI skeleton walks toward/around the player.
        for (let i = 0; i < 5; i++) {
            const alive = await page.evaluate((eid) => {
                const game = window.game;
                const sys = game.playerControllerSystem;
                const et = game.getComponent(eid, 'transform');
                if (!et) return false;
                sys.aimPos = { x: et.position.x, y: et.position.y, z: et.position.z };
                sys.mouseDown.left = true;
                return true;
            }, attackSetup.eid);
            if (!alive) break;
            await waitSimTime(page, 1);
        }
        await page.evaluate(() => { window.game.playerControllerSystem.mouseDown.left = false; });

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

    // ── Phase B: stats / XP / leveling ────────────────────────────────────
    const sheetCheck = await page.evaluate(() => {
        const game = window.game;
        const pid = game.state.playerCharacterId;
        const sheet = game.getComponent(pid, 'characterSheet');
        return sheet ? {
            classId: sheet.classId, level: sheet.level, xp: sheet.experience,
            attrs: sheet.attributes, points: sheet.unspentAttributePoints
        } : null;
    });
    check('characterSheet exists', !!sheetCheck, JSON.stringify(sheetCheck));

    // Kill several enemies via direct damage and confirm XP + level up
    const xpResult = await page.evaluate(() => {
        const game = window.game;
        const pid = game.state.playerCharacterId;
        const sheetBefore = JSON.parse(JSON.stringify(game.getComponent(pid, 'characterSheet')));
        const applyDamage = game.getService('applyDamage');
        const enemies = game.getEntitiesWith('neutralMonster', 'health');
        let killed = 0;
        for (const eid of enemies.slice(0, 12)) {
            applyDamage(pid, eid, 99999, 0, { isMelee: true, weaponRange: 99999 });
            killed++;
        }
        return { killed, before: { level: sheetBefore.level, xp: sheetBefore.experience } };
    });
    await waitSimTime(page, 2); // let deaths/death events process

    const xpAfter = await page.evaluate(() => {
        const game = window.game;
        const pid = game.state.playerCharacterId;
        const sheet = game.getComponent(pid, 'characterSheet');
        const health = game.getComponent(pid, 'health');
        return {
            level: sheet.level, xp: sheet.experience, points: sheet.unspentAttributePoints,
            skillPoints: sheet.unspentSkillPoints, maxLife: health.max
        };
    });
    check('kills grant XP', xpAfter.xp > 0 || xpAfter.level > 1,
        `killed ${xpResult.killed}: lvl ${xpResult.before.level}→${xpAfter.level}, xp ${xpAfter.xp}`);
    check('level up grants points', xpAfter.level > 1 && xpAfter.points >= 5,
        `level ${xpAfter.level}, ${xpAfter.points} attr points, ${xpAfter.skillPoints} skill points`);

    // Allocate vitality and confirm max life increases
    const lifeBefore = xpAfter.maxLife;
    const allocResult = await page.evaluate(() => {
        const game = window.game;
        const ok = game.getService('allocateAttribute')('vitality', 1);
        const pid = game.state.playerCharacterId;
        return { ok, maxLife: game.getComponent(pid, 'health').max };
    });
    check('allocating vitality raises max life', allocResult.ok && allocResult.maxLife > lifeBefore,
        `maxLife ${lifeBefore} -> ${allocResult.maxLife}`);

    // ── Skill tree: learn Bash, verify grant + binding + cast ────────────
    const skillResult = await page.evaluate(() => {
        const game = window.game;
        const pid = game.state.playerCharacterId;
        const learn = game.getService('learnSkill')('bash');
        const sheet = game.getComponent(pid, 'characterSheet');
        const abilities = game.abilitySystem.getEntityAbilities(pid).map(a => a.id);
        return {
            learn,
            rank: sheet.allocatedSkills?.bash,
            points: sheet.unspentSkillPoints,
            bar: sheet.skillBar,
            abilities
        };
    });
    check('learnSkill(bash) succeeds', skillResult.learn?.success === true, JSON.stringify(skillResult.learn));
    check('bash grants BashAbility', skillResult.abilities.includes('BashAbility'),
        `abilities: ${skillResult.abilities.join(',')}`);
    check('bash auto-bound to skill bar', skillResult.bar?.rmb === 'bash', JSON.stringify(skillResult.bar));

    // Cast it at a nearby enemy via the controller path
    // (spawn the target first, then wait a sim beat so vision/spatial pick it up)
    await page.evaluate(() => {
        const game = window.game;
        const pid = game.state.playerCharacterId;
        const pt = game.getComponent(pid, 'transform');
        game.getService('createEntityFromPrefab')({
            prefab: 'unit', type: '0_skeleton', collection: 'units',
            team: game.getEnums().team.right,
            componentOverrides: { transform: { position: { x: pt.position.x + 50, y: pt.position.y, z: pt.position.z } } }
        });
    });
    await waitSimTime(page, 1);

    const castResult = await page.evaluate(() => {
        const game = window.game;
        const pid = game.state.playerCharacterId;
        const pt = game.getComponent(pid, 'transform');
        const sys = game.playerControllerSystem;
        sys.aimPos = { x: pt.position.x + 50, y: pt.position.y, z: pt.position.z };
        const poolBefore = game.getComponent(pid, 'resourcePool').mana;
        const ok = sys.castSkillSlot(pid, 'rmb');
        const poolAfter = game.getComponent(pid, 'resourcePool').mana;
        const queued = game.getComponent(pid, 'abilityQueue');
        return { ok, poolBefore, poolAfter, queued: !!queued };
    });
    check('casting bash via skill bar works', castResult.ok === true,
        `queued=${castResult.queued}, mana ${castResult.poolBefore} -> ${castResult.poolAfter}`);

    // Skill tree panel opens with T
    await page.keyboard.press('KeyT');
    await new Promise(r => setTimeout(r, 800));
    const treeState = await page.evaluate(() => {
        const panel = document.getElementById('arpgPanel_skilltree');
        const body = document.getElementById('arpgSkillTreeBody');
        return {
            visible: panel && !panel.classList.contains('hidden'),
            nodes: body ? body.querySelectorAll('.arpg-skill-node').length : 0
        };
    });
    check('skill tree panel opens (T) with nodes', treeState.visible && treeState.nodes >= 10,
        `${treeState.nodes} nodes`);
    await page.screenshot({ path: 'projects/Ashfall/test_skilltree.png' });
    await page.keyboard.press('KeyT');

    // Character panel opens with C
    await page.keyboard.press('KeyC');
    await new Promise(r => setTimeout(r, 800));
    const panelState = await page.evaluate(() => {
        const panel = document.getElementById('arpgPanel_character');
        const body = document.getElementById('arpgCharacterBody');
        return {
            visible: panel && !panel.classList.contains('hidden'),
            hasContent: body && body.innerHTML.length > 200
        };
    });
    check('character panel opens (C) and renders', panelState.visible && panelState.hasContent);
    await page.screenshot({ path: 'projects/Ashfall/test_character_panel.png' });
    await page.keyboard.press('KeyC');

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
