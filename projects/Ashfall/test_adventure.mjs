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

    // ── Town: Emberrest ────────────────────────────────────────────────────
    const town = await page.evaluate(() => {
        const game = window.game;
        const inters = game.getEntitiesWith('interactable').map(id => {
            const i = game.getComponent(id, 'interactable');
            return { kind: i.kind, target: i.target };
        });
        return {
            zone: game.state.currentZoneId,
            monsters: game.getEntitiesWith('neutralMonster').length,
            npcs: inters.filter(i => i.kind === 'npc').map(i => i.target),
            hasStash: inters.some(i => i.kind === 'stash'),
            hasWaypoint: inters.some(i => i.kind === 'waypoint'),
            hasFieldsPortal: inters.some(i => i.kind === 'portal' && i.target === 'ashen_fields')
        };
    });
    check('adventure starts in Emberrest (town, safe)',
        town.zone === 'emberrest' && town.monsters === 0,
        `${town.monsters} monsters`);
    check('town NPCs present', ['kael', 'mira', 'rowan'].every(n => town.npcs.includes(n)),
        `npcs: ${town.npcs.join(',')}, stash: ${town.hasStash}, waypoint: ${town.hasWaypoint}`);
    check('portal to Ashen Fields in town', town.hasFieldsPortal);

    // Quest accept from Kael (via services)
    const questAccept = await page.evaluate(() => {
        const game = window.game;
        const actions = game.getService('getQuestActionsForNpc')('kael');
        const offer = actions.find(a => a.kind === 'offer');
        const started = offer ? game.getService('startQuest')(offer.questId) : false;
        return { actions, started, state: game.getService('getQuestState')('q1_bonecaller') };
    });
    check('Kael offers the first quest and it can be accepted',
        questAccept.started === true && questAccept.state?.state === 'active',
        JSON.stringify(questAccept.state));

    // Vendor: buy something from Mira
    const vendorTest = await page.evaluate(() => {
        const game = window.game;
        game.getService('addGold')(500);
        const stock = game.getService('getVendorStock')('mira');
        const res = stock.length ? game.getService('buyVendorItem')('mira', 0) : null;
        const pid = game.state.playerCharacterId;
        const inv = game.getComponent(pid, 'inventory');
        return { stockCount: stock.length, res, invCount: inv.items.length, gold: game.getService('getGold')() };
    });
    check('vendor stocks and sells items', vendorTest.stockCount > 0 && vendorTest.res?.success === true,
        `${vendorTest.stockCount} in stock, bought for ${vendorTest.res?.price}g, ${vendorTest.gold}g left`);

    await page.screenshot({ path: 'projects/Ashfall/test_town.png' });

    // Travel to Ashen Fields through the town portal
    await page.evaluate(() => {
        const game = window.game;
        const portals = game.getEntitiesWith('interactable').filter(id => {
            const i = game.getComponent(id, 'interactable');
            return i?.kind === 'portal' && i?.target === 'ashen_fields';
        });
        const pid = game.state.playerCharacterId;
        const pt = game.getComponent(pid, 'transform');
        const portalT = game.getComponent(portals[0], 'transform');
        pt.position.x = portalT.position.x;
        pt.position.z = portalT.position.z;
        game.zoneSystem.interactWith(portals[0]);
    });
    await page.waitForFunction(() =>
        window.game?.state?.currentZoneId === 'ashen_fields' &&
        window.game?.state?.playerCharacterId != null,
        { timeout: 120000, polling: 500 });
    check('town portal leads to Ashen Fields', true);
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
    check('zone name shown', snapshot.zoneName === 'Ashen Fields', snapshot.zoneName);

    // ── WFC zone checks ───────────────────────────────────────────────────
    const zoneCheck = await page.evaluate(() => {
        const game = window.game;
        const zoneId = game.state.currentZoneId;
        const zone = game.zoneSystem?.getZoneDef?.(zoneId);
        const levelKey = zone?.genSlot || zone?.fixedLevel;
        const level = game.getCollections().levels?.[levelKey];
        const interactables = game.getEntitiesWith('interactable').map(id => {
            const i = game.getComponent(id, 'interactable');
            return { kind: i.kind, target: i.target };
        });
        const bosses = game.getEntitiesWith('boss');
        const bossName = bosses.length ? game.enemyPackSystem?.getMonsterName?.(bosses[0]) : null;
        return {
            zoneId,
            levelSize: level?.tileMap?.size,
            hasArpgBlock: !!level?.arpg,
            packSpawns: level?.arpg?.packSpawns?.length,
            levelEntityCount: level?.tileMap?.levelEntities?.length,
            interactables,
            bossCount: bosses.length,
            bossName
        };
    });
    check('WFC zone generated (ashen_fields)', zoneCheck.zoneId === 'ashen_fields' &&
        zoneCheck.hasArpgBlock && zoneCheck.levelSize === 48,
        `size ${zoneCheck.levelSize}, ${zoneCheck.packSpawns} pack markers, ${zoneCheck.levelEntityCount} doodads`);
    check('exit portal spawned', zoneCheck.interactables.some(i => i.kind === 'portal' && i.target === 'charred_woods'),
        JSON.stringify(zoneCheck.interactables));
    check('zone boss spawned', zoneCheck.bossCount === 1, `boss: ${zoneCheck.bossName}`);

    // Kill the zone boss -> quest objective completes -> turn in for rewards
    const questFlow = await page.evaluate(() => {
        const game = window.game;
        const pid = game.state.playerCharacterId;
        const boss = game.getEntitiesWith('boss')[0];
        const apply = game.getService('applyDamage');
        for (let i = 0; i < 30 && game.getComponent(boss, 'health')?.current > 0; i++) {
            apply(pid, boss, 99999, 0, { isMelee: true, weaponRange: 999999 });
        }
        return { bossHp: game.getComponent(boss, 'health')?.current };
    });
    await waitSimTime(page, 1.5);
    const questDone = await page.evaluate(() => {
        const game = window.game;
        const state = JSON.parse(JSON.stringify(game.getService('getQuestState')('q1_bonecaller')));
        const goldBefore = game.getService('getGold')();
        const sheetBefore = game.getComponent(game.state.playerCharacterId, 'characterSheet').unspentSkillPoints;
        const turnIn = game.getService('turnInQuest')('q1_bonecaller');
        const sheet = game.getComponent(game.state.playerCharacterId, 'characterSheet');
        return {
            state, turnIn,
            goldGain: game.getService('getGold')() - goldBefore,
            skillPointGain: sheet.unspentSkillPoints - sheetBefore,
            after: game.getService('getQuestState')('q1_bonecaller')
        };
    });
    check('killing zone boss completes quest objective', questDone.state?.state === 'done',
        `bossHp ${questFlow.bossHp}, quest ${JSON.stringify(questDone.state)}`);
    check('quest turn-in grants rewards', questDone.turnIn === true &&
        questDone.goldGain >= 150 && questDone.skillPointGain >= 1 &&
        questDone.after?.state === 'turnedIn',
        `+${questDone.goldGain}g, +${questDone.skillPointGain} skill pts`);

    // ── WASD movement test (move toward map center to avoid border clamps) ──
    const before = snapshot.pos;
    const towardCenter = before.x + before.z < 0 ? ['KeyS', 'KeyD'] : ['KeyW', 'KeyA'];
    await page.keyboard.down(towardCenter[0]);
    await page.keyboard.down(towardCenter[1]);
    await waitSimTime(page, 2);
    await page.keyboard.up(towardCenter[0]);
    await page.keyboard.up(towardCenter[1]);

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
        // Weakest enemy (avoid armored bosses shrugging off starter damage)
        let eid = enemies[0], lowest = Infinity;
        for (const id of enemies) {
            const hp = game.getComponent(id, 'health')?.max ?? Infinity;
            if (hp < lowest) { lowest = hp; eid = id; }
        }
        // Duel arena: move player + target away from other packs, full heal
        pt.position.x = 0; pt.position.z = 0;
        const ph = game.getComponent(pid, 'health');
        ph.current = ph.max;
        let totalHp = 0;
        for (const id of enemies) totalHp += game.getComponent(id, 'health').current;
        const et = game.getComponent(eid, 'transform');
        // Place enemy right in front of the player
        et.position.x = pt.position.x + 40;
        et.position.z = pt.position.z;
        const eh = game.getComponent(eid, 'health');
        return { eid, hp: eh.current, totalHp, px: pt.position.x, pz: pt.position.z };
    });

    if (attackSetup) {
        await waitSimTime(page, 0.5); // let spatial/vision register the teleport

        // Hold the attack for several sim seconds, re-aiming at the (moving)
        // enemy each pass — the AI skeleton walks toward/around the player.
        for (let i = 0; i < 5; i++) {
            const alive = await page.evaluate((eid) => {
                const game = window.game;
                const sys = game.playerControllerSystem;
                const pid = game.state.playerCharacterId;
                const et = game.getComponent(eid, 'transform');
                if (!et) return false;
                // Keep the duel isolated: enemy pinned near the player, player healed
                const pt = game.getComponent(pid, 'transform');
                et.position.x = pt.position.x + 40;
                et.position.z = pt.position.z;
                const ph = game.getComponent(pid, 'health');
                if (ph) ph.current = ph.max;
                // Aim by moving the virtual mouse onto the enemy's screen position
                // (updateAim recomputes aimPos from mouseScreen every tick)
                const camera = game.getService('getCamera')();
                const v = new THREE.Vector3(et.position.x, (et.position.y || 0) + 10, et.position.z);
                v.project(camera);
                const canvas = document.getElementById('gameCanvas');
                const rect = canvas.getBoundingClientRect();
                sys.mouseScreen.x = rect.left + (v.x + 1) / 2 * rect.width;
                sys.mouseScreen.y = rect.top + (-v.y + 1) / 2 * rect.height;
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
            // Also count total enemy hp — held-LMB may hit whichever enemy is
            // nearest the cursor if others wandered in
            let total = 0;
            for (const id of game.getEntitiesWith('neutralMonster', 'health')) {
                total += game.getComponent(id, 'health').current;
            }
            return { pinned: h ? h.current : -999, total };
        }, attackSetup.eid);

        const damaged = hpAfter.pinned === -999 || hpAfter.pinned < attackSetup.hp ||
            hpAfter.total < (attackSetup.totalHp ?? Infinity);
        check('basic attack damages enemy', damaged,
            `pinned hp ${attackSetup.hp} -> ${hpAfter.pinned === -999 ? 'dead/removed' : hpAfter.pinned}, total ${attackSetup.totalHp} -> ${hpAfter.total}`);
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

    // ── Items: generation, drops, pickup, equip, gems ─────────────────────
    const itemGen = await page.evaluate(() => {
        const game = window.game;
        const gen = game.getService('generateItem');
        const results = { magic: null, rare: null, unique: null };
        results.magic = gen({ itemLevel: 5, rarity: 'magic' });
        results.rare = gen({ itemLevel: 10, rarity: 'rare' });
        results.unique = gen({ itemLevel: 10, rarity: 'unique' });
        return {
            magicAffixes: results.magic?.affixes?.length,
            magicName: results.magic?.name,
            rareAffixes: results.rare?.affixes?.length,
            rareName: results.rare?.name,
            uniqueName: results.unique?.name,
            uniqueIsUnique: results.unique?.rarity === 'unique'
        };
    });
    check('magic item generates with 1-2 affixes',
        itemGen.magicAffixes >= 1 && itemGen.magicAffixes <= 2,
        `"${itemGen.magicName}" (${itemGen.magicAffixes} affixes)`);
    check('rare item generates with 2-6 affixes',
        itemGen.rareAffixes >= 2 && itemGen.rareAffixes <= 6,
        `"${itemGen.rareName}" (${itemGen.rareAffixes} affixes)`);
    check('unique item generates', itemGen.uniqueIsUnique, `"${itemGen.uniqueName}"`);

    // Kill a monster with guaranteed loot and pick everything up
    const dropTest = await page.evaluate(() => {
        const game = window.game;
        const pid = game.state.playerCharacterId;
        const pt = game.getComponent(pid, 'transform');
        const eid = game.getService('createEntityFromPrefab')({
            prefab: 'unit', type: '0_skeleton', collection: 'units',
            team: game.getEnums().team.right,
            componentOverrides: { transform: { position: { x: pt.position.x + 60, y: pt.position.y, z: pt.position.z } } }
        });
        game.addComponent(eid, 'neutralMonster', {
            lootTable: 'boss', lootChance: 1, guaranteedLoot: true, monsterLevel: 5
        });
        game.getService('applyDamage')(pid, eid, 99999, 0, { isMelee: true, weaponRange: 99999 });
        return { eid };
    });
    await waitSimTime(page, 1.5);

    const lootState = await page.evaluate(() => {
        const game = window.game;
        const lootIds = game.getEntitiesWith('loot', 'lootVisual');
        const labels = document.querySelectorAll('.arpg-loot-label').length;
        // Pick up everything
        let pickedUp = 0;
        for (const id of lootIds) {
            if (game.getService('pickupGroundItem')(id)) pickedUp++;
        }
        const pid = game.state.playerCharacterId;
        const inv = game.getComponent(pid, 'inventory');
        return { dropped: lootIds.length, labels, pickedUp, invItems: inv.items.length, gold: game.getService('getGold')() };
    });
    check('boss kill drops loot', lootState.dropped >= 2, `${lootState.dropped} drops, ${lootState.labels} labels`);
    check('loot pickup works', lootState.pickedUp >= 2,
        `${lootState.pickedUp} picked up, ${lootState.invItems} in bag, ${lootState.gold} gold`);

    // Give a specific weapon and equip it; verify combat.damage changes
    const equipTest = await page.evaluate(() => {
        const game = window.game;
        const pid = game.state.playerCharacterId;
        const item = game.getService('generateItem')({ itemLevel: 3, rarity: 'magic', baseId: 'handAxe' });
        game.getService('giveItemToPlayer')(item);
        const combatBefore = { ...game.getComponent(pid, 'combat') };
        const res = game.getService('equipItem')(item.uid);
        const combatAfter = game.getComponent(pid, 'combat');
        const eq = game.getComponent(pid, 'arpgEquipment');
        return {
            res,
            equipped: eq.slots.mainHand?.name,
            dmgBefore: combatBefore.damage,
            dmgAfter: combatAfter.damage
        };
    });
    check('equipping a weapon works', equipTest.res?.success === true,
        `"${equipTest.equipped}" dmg ${equipTest.dmgBefore} -> ${equipTest.dmgAfter}`);

    // Socket a skill gem into an item with a socket, verify granted ability
    const gemTest = await page.evaluate(() => {
        const game = window.game;
        const pid = game.state.playerCharacterId;
        const its = game.itemSystem;
        // Craft a chest with a guaranteed socket + a fireball gem
        const chest = its.generateItem({ itemLevel: 3, rarity: 'normal', baseId: 'leatherArmor' });
        chest.sockets = [null, null];
        its.giveItemToPlayer(chest);
        const gem = its.generateGem(1);
        gem.gemId = 'gemFireball';
        gem.gem = { type: 'skill', ability: 'FireBallAbility', level: 1, damageModifiers: [], stats: {} };
        its.giveItemToPlayer(gem);
        const eqRes = its.equipItem(chest.uid);
        const socketRes = its.socketGem(gem.uid, chest.uid);
        const abilities = game.abilitySystem.getEntityAbilities(pid).map(a => a.id);
        return { eqRes, socketRes, abilities };
    });
    check('socketing a skill gem grants its ability',
        gemTest.socketRes?.success === true && gemTest.abilities.includes('FireBallAbility'),
        `abilities: ${gemTest.abilities.join(',')}`);

    // Potion pickup + drink
    const potionTest = await page.evaluate(() => {
        const game = window.game;
        const pid = game.state.playerCharacterId;
        const inv = game.getComponent(pid, 'inventory');
        inv.beltLife = 2;
        const health = game.getComponent(pid, 'health');
        health.current = Math.floor(health.max * 0.4);
        const before = health.current;
        const ok = game.getService('drinkPotion')('life');
        return { ok, before, after: game.getComponent(pid, 'health').current, belt: inv.beltLife };
    });
    check('life potion heals', potionTest.ok && potionTest.after > potionTest.before,
        `${potionTest.before} -> ${potionTest.after}, ${potionTest.belt} left`);

    // Inventory panel opens with I
    await page.keyboard.press('KeyI');
    await new Promise(r => setTimeout(r, 700));
    const invPanel = await page.evaluate(() => {
        const panel = document.getElementById('arpgPanel_inventory');
        const body = document.getElementById('arpgInventoryBody');
        return {
            visible: panel && !panel.classList.contains('hidden'),
            slots: body ? body.querySelectorAll('.arpg-eq-slot').length : 0,
            items: body ? body.querySelectorAll('.arpg-inv-item').length : 0
        };
    });
    check('inventory panel opens (I)', invPanel.visible && invPanel.slots === 10,
        `${invPanel.slots} equip slots, ${invPanel.items} bag items`);
    await page.screenshot({ path: 'projects/Ashfall/test_inventory.png' });
    await page.keyboard.press('KeyI');

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

    // ── Zone travel: use the exit portal to enter Charred Woods ───────────
    const travelStart = await page.evaluate(() => {
        const game = window.game;
        const portals = game.getEntitiesWith('interactable').filter(id => {
            const i = game.getComponent(id, 'interactable');
            return i?.kind === 'portal' && i?.target === 'charred_woods';
        });
        if (!portals.length) return false;
        // Teleport next to the portal and interact
        const pid = game.state.playerCharacterId;
        const portalT = game.getComponent(portals[0], 'transform');
        const pt = game.getComponent(pid, 'transform');
        pt.position.x = portalT.position.x + 20;
        pt.position.z = portalT.position.z + 20;
        return game.zoneSystem.interactWith(portals[0]);
    });
    if (travelStart) {
        try {
            await page.waitForFunction(() =>
                window.game?.state?.currentZoneId === 'charred_woods' &&
                window.game?.state?.playerCharacterId != null,
                { timeout: 120000, polling: 500 });
        } catch (e) {
            const stuck = await page.evaluate(() => ({
                zone: window.game?.state?.currentZoneId,
                pc: window.game?.state?.playerCharacterId,
                scene: window.game?.sceneManager?.currentSceneName,
                phase: window.game?.state?.phase
            })).catch(() => null);
            console.log('TRAVEL STUCK STATE:', JSON.stringify(stuck));
            throw e;
        }
        await waitSimTime(page, 1);
        const zone2 = await page.evaluate(() => {
            const game = window.game;
            const sheet = game.getComponent(game.state.playerCharacterId, 'characterSheet');
            const monsters = game.getEntitiesWith('neutralMonster').length;
            const waypoints = game.getEntitiesWith('interactable').filter(id =>
                game.getComponent(id, 'interactable')?.kind === 'waypoint').length;
            return { zone: game.state.currentZoneId, level: sheet?.level, xp: sheet?.experience, monsters, waypoints };
        });
        check('portal travel to Charred Woods works', zone2.zone === 'charred_woods',
            `${zone2.monsters} monsters, ${zone2.waypoints} waypoint(s)`);
        check('character progression persists across zones', zone2.level >= 2,
            `level ${zone2.level}, xp ${zone2.xp}`);
        await page.screenshot({ path: 'projects/Ashfall/test_zone2.png' });
    } else {
        check('portal travel to Charred Woods works', false, 'no portal found');
    }

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
