// Full Act 1 playthrough test: town -> 4 quests -> ascension -> act boss.
// Drives zone travel and kills via services (fast-forward playthrough).
// Usage: node projects/Ashfall/test_act1.mjs   (server on :3000)
import puppeteer from 'puppeteer';

const results = [];
const errors = [];
function check(name, ok, detail = '') {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--window-size=1280,800', '--enable-gpu', '--use-angle=default']
});

try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
    page.on('console', msg => {
        if (msg.type() === 'error') errors.push(msg.text());
    });

    const waitZone = async (zoneId) => {
        await page.waitForFunction((z) =>
            window.game?.state?.currentZoneId === z && window.game?.state?.playerCharacterId != null,
            { timeout: 150000, polling: 500 }, zoneId);
        await new Promise(r => setTimeout(r, 2500));
    };

    const travel = async (zoneId) => {
        await page.evaluate((z) => window.game.zoneSystem.travelToZone(z), zoneId);
        await waitZone(zoneId);
    };

    const killBoss = async () => {
        return await page.evaluate(() => {
            const game = window.game;
            const pid = game.state.playerCharacterId;
            const apply = game.getService('applyDamage');
            const bosses = game.getEntitiesWith('boss', 'health');
            if (!bosses.length) return { ok: false, reason: 'no boss' };
            const boss = bosses[0];
            const name = game.enemyPackSystem?.getMonsterName?.(boss);
            for (let i = 0; i < 100 && game.getComponent(boss, 'health')?.current > 0; i++) {
                apply(pid, boss, 99999, 0, { isMelee: true, weaponRange: 9999999 });
            }
            return { ok: true, name };
        });
    };

    const questState = (id) => page.evaluate((q) =>
        JSON.parse(JSON.stringify(window.game.getService('getQuestState')(q))), id);

    const kaelAction = async (kind) => {
        return await page.evaluate((k) => {
            const game = window.game;
            const actions = game.getService('getQuestActionsForNpc')('kael');
            const a = actions.find(x => x.kind === k);
            if (!a) return { ok: false, actions };
            if (k === 'offer') return { ok: game.getService('startQuest')(a.questId), questId: a.questId };
            if (k === 'turnIn') return { ok: game.getService('turnInQuest')(a.questId), questId: a.questId };
            return { ok: false };
        }, kind);
    };

    // ── Boot into town ────────────────────────────────────────────────────
    await page.goto('http://localhost:3000/index.html', { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('#mainMenu_PlayGameBtn', { timeout: 60000 });
    await page.click('#mainMenu_PlayGameBtn');
    await page.waitForSelector('[data-mode="adventure"]', { timeout: 15000 });
    await page.click('[data-mode="adventure"]');
    await page.waitForSelector('#arpgClassSelectDialog .arpg-class-card', { timeout: 10000 });
    await page.click('#arpgClassSelectDialog .arpg-class-card'); // Barbarian
    await waitZone('emberrest');
    check('Act 1 begins in Emberrest', true);

    // ── Quest 1: The Bonecaller ───────────────────────────────────────────
    let r = await kaelAction('offer');
    check('q1 accepted from Kael', r.ok === true && r.questId === 'q1_bonecaller');

    await travel('ashen_fields');
    r = await killBoss();
    check('Bonecaller Maru slain', r.ok, r.name);
    await new Promise(res => setTimeout(res, 1500));
    check('q1 objective complete', (await questState('q1_bonecaller')).state === 'done');

    await travel('emberrest');
    r = await kaelAction('turnIn');
    check('q1 turned in', r.ok === true);

    // ── Quest 2: Pyre Totems ──────────────────────────────────────────────
    r = await kaelAction('offer');
    check('q2 accepted', r.ok === true && r.questId === 'q2_totems');

    await travel('charred_woods');
    const totems = await page.evaluate(() => {
        const game = window.game;
        const pid = game.state.playerCharacterId;
        const apply = game.getService('applyDamage');
        const objs = game.getEntitiesWith('questObject', 'health');
        for (const id of objs) {
            for (let i = 0; i < 50 && game.getComponent(id, 'health')?.current > 0; i++) {
                apply(pid, id, 99999, 0, { isMelee: true, weaponRange: 9999999 });
            }
        }
        return objs.length;
    });
    await new Promise(res => setTimeout(res, 1500));
    check('3 Pyre Totems destroyed', totems === 3 && (await questState('q2_totems')).state === 'done',
        `${totems} totems, state ${(await questState('q2_totems')).state}`);

    await travel('emberrest');
    r = await kaelAction('turnIn');
    check('q2 turned in', r.ok === true);

    // ── Quest 3: Stone Colossus ───────────────────────────────────────────
    r = await kaelAction('offer');
    check('q3 accepted', r.ok === true && r.questId === 'q3_colossus');

    await travel('cinder_quarry');
    const quarryCheck = await page.evaluate(() => {
        const game = window.game;
        const zone = game.zoneSystem.getZoneDef('cinder_quarry');
        const level = game.getCollections().levels[zone.genSlot];
        return { size: level?.tileMap?.size, set: zone.set, monsters: game.getEntitiesWith('neutralMonster').length };
    });
    check('Cinder Quarry generates (rock set)', quarryCheck.size === 64 && quarryCheck.monsters > 10,
        `size ${quarryCheck.size}, ${quarryCheck.monsters} monsters`);

    r = await killBoss();
    check('Stone Colossus slain', r.ok, r.name);
    await new Promise(res => setTimeout(res, 1500));
    await travel('emberrest');
    r = await kaelAction('turnIn');
    check('q3 turned in', r.ok === true);

    // ── Ascension at level 12 ─────────────────────────────────────────────
    const asc = await page.evaluate(() => {
        const game = window.game;
        const pid = game.state.playerCharacterId;
        const sheet = game.getComponent(pid, 'characterSheet');
        // Fast-forward XP to 12 if the run hasn't reached it naturally
        while (sheet.level < 12) game.getService('awardExperience')(pid, 5000);
        const res = game.getService('chooseAscension')('2_s_berserker');
        const newPid = game.state.playerCharacterId;
        const newSheet = game.getComponent(newPid, 'characterSheet');
        const unitType = game.getComponent(newPid, 'unitType');
        const unitDef = game.getUnitTypeDef(unitType);
        return {
            res, level: newSheet?.level, ascension: newSheet?.ascension,
            unitTitle: unitDef?.title
        };
    });
    check('ascension to Berserker at level 12+', asc.res?.success === true &&
        asc.ascension === '2_s_berserker' && String(asc.unitTitle).includes('Berserker'),
        `level ${asc.level}, now a ${asc.unitTitle}`);

    // ── Quest 4: The Ember Throne ─────────────────────────────────────────
    r = await kaelAction('offer');
    check('q4 accepted', r.ok === true && r.questId === 'q4_vazruk');

    await travel('keep_approach');
    const keepCheck = await page.evaluate(() => ({
        monsters: window.game.getEntitiesWith('neutralMonster').length,
        waypoint: window.game.getEntitiesWith('interactable').some(id =>
            window.game.getComponent(id, 'interactable')?.kind === 'waypoint')
    }));
    check('Keep Approach generates (brick set) with waypoint',
        keepCheck.monsters > 10 && keepCheck.waypoint, `${keepCheck.monsters} monsters`);

    await travel('ember_throne');
    r = await killBoss();
    check('Pyrelord Vazruk slain', r.ok, r.name);
    await new Promise(res => setTimeout(res, 1500));

    await travel('emberrest');
    r = await kaelAction('turnIn');
    check('q4 turned in — Act 1 complete', r.ok === true);

    await new Promise(res => setTimeout(res, 800));
    const finale = await page.evaluate(() => ({
        banner: !!document.getElementById('arpgActComplete'),
        act1: window.game.state.act1Complete === true,
        level: window.game.getComponent(window.game.state.playerCharacterId, 'characterSheet')?.level,
        gold: window.game.getService('getGold')()
    }));
    check('Act complete banner + state', finale.banner && finale.act1,
        `final level ${finale.level}, ${finale.gold} gold`);
    await page.screenshot({ path: 'projects/Ashfall/test_act1_complete.png' });

} catch (e) {
    check('act 1 playthrough completed', false, e.message);
} finally {
    await browser.close();
}

const failed = results.filter(r => !r.ok);
const relevantErrors = errors.filter(e => !e.includes('favicon') && !e.includes('404'));
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (relevantErrors.length) {
    console.log('Console errors (first 10):');
    relevantErrors.slice(0, 10).forEach(e => console.log('  ', e.slice(0, 250)));
}
process.exit(failed.length ? 1 : 0);
