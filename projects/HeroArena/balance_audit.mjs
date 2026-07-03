// Data-driven balance audit for HeroArena.
//
//   node projects/HeroArena/balance_audit.mjs           → report only
//   node projects/HeroArena/balance_audit.mjs --apply   → also rewrite unit
//     stats (scaled toward the power target) and tech costs (from mechanic
//     tag points) in the collections JSON.
//
// Every number comes from collections/data/balanceWeights/weights.json —
// change what a mechanic is WORTH there and re-run to re-balance everything
// that uses it.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const UNITS_DIR = path.join(ROOT, 'collections/spawns/units');
const TECHS_DIR = path.join(ROOT, 'collections/data/unitTechs');
const W = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'collections/data/balanceWeights/weights.json'), 'utf8'));

const APPLY = process.argv.includes('--apply');

// Mirrors ArmyShopSystem tiering.
const T1_SET = new Set(['0_skeleton']);
const T2_SET = new Set(['fairy']);
const T3_SET = new Set(['0_golemStone', '0_golemFire', '0_golemIce', 'ballista']);
const T4_SET = new Set(['dragon_red', '4_ancientTreant', 'dragon_red_flying']);
const EXCLUDE = new Set(['peasant', '4_archmage', 'sentry']);
const TIER_PRICE = { 1: 7, 2: 14, 3: 21, 4: 28 };
const SPLASH_PROJECTILES = new Set(['fireball']);

function tierOf(id) {
    if (EXCLUDE.has(id)) return null;
    if (T4_SET.has(id)) return 4;
    if (T3_SET.has(id)) return 3;
    if (T2_SET.has(id)) return 2;
    if (T1_SET.has(id)) return 1;
    if (/^1_/.test(id)) return 1;
    if (/^2_/.test(id)) return 2;
    return null;
}

const UNRESISTABLE = new Set(['holy', 'shadow', 'poison']);
const BYPASS_ARMOR = new Set(['fire', 'cold', 'lightning']);

function unitPower(def) {
    const U = W.unitPower;
    const members = Math.max(1, (def.squadWidth || 1) * (def.squadHeight || 1));
    const range = def.range || 1;

    let elemMult = 1;
    if (UNRESISTABLE.has(def.element)) elemMult += U.elementUnresistable;
    else if (BYPASS_ARMOR.has(def.element)) elemMult += U.elementBypassArmor;

    const rangeMult = 1 + Math.max(0, range - 30) / 100 * U.rangePer100;
    const splashMult = SPLASH_PROJECTILES.has(def.projectile) ? 1 + U.splashOnHit : 1;
    const aaMult = def.canTargetAir ? 1 + U.antiAir : 1;
    const dps = (def.damage || 0) * (def.attackSpeed || 1) * members
        * elemMult * rangeMult * splashMult * aaMult;

    const armorMult = 1 + (def.armor || 0) / U.armorRefHit;
    const evasionMult = 1 + (def.evasion || 0) / 100 * U.evasionPer100;
    const flyMult = def.isFlying ? 1 + U.flying : 1;
    const swarmMult = Math.max(0.5, 1 - U.swarmSplashVulnPerMember * (members - 1));
    const ehp = (def.hp || 1) * members * armorMult * evasionMult * flyMult * swarmMult;

    const speedMult = 1 + ((def.speed || 45) - 45) / 100 * U.speedPer100;
    return Math.sqrt(dps * ehp) * speedMult;
}

function techCost(tech, tier) {
    const P = W.techPricing;
    const tags = [];
    if (tech.unlockAbility) tags.push(...(W.abilityTags[tech.unlockAbility] || ['statMajor']));
    for (const [field, t] of Object.entries(W.mechanicTags)) {
        if (tech[field]) tags.push(...t);
    }
    if (tech.statModifiers) {
        for (const stat of Object.keys(tech.statModifiers)) {
            tags.push(...(W.statModTags[stat] || W.statModTags.default));
        }
    }
    const pts = tags.reduce((s, t) => s + (P.tagPoints[t] || 5), 0);
    return (P.tierBase[String(tier)] || 8) + pts;
}

// ── Audit units ──────────────────────────────────────────────────────────────
const rows = [];
for (const f of fs.readdirSync(UNITS_DIR).sort()) {
    if (!f.endsWith('.json')) continue;
    const id = f.slice(0, -5);
    const tier = tierOf(id);
    if (!tier) continue;
    const p = path.join(UNITS_DIR, f);
    const def = JSON.parse(fs.readFileSync(p, 'utf8'));
    const price = TIER_PRICE[tier];
    const power = unitPower(def);
    const target = price * W.unitPower.goldPowerTarget;
    const ratio = power / target;
    rows.push({ id, tier, price, power, ratio, def, path: p });
}

console.log('\nUNIT POWER AUDIT  (target = price x ' + W.unitPower.goldPowerTarget + ')');
console.log('ratio < 1 under-tuned, > 1 over-tuned; --apply rescales toward 1.00\n');
console.log('unit                      T  price   power  target  ratio');
for (const r of rows.sort((a, b) => a.ratio - b.ratio)) {
    const flag = r.ratio < 0.9 ? ' ▼' : r.ratio > 1.1 ? ' ▲' : '';
    console.log(
        r.id.padEnd(25) + ' ' + r.tier + '  ' + String(r.price).padStart(4)
        + '  ' + String(Math.round(r.power)).padStart(6)
        + '  ' + String(Math.round(r.price * W.unitPower.goldPowerTarget)).padStart(6)
        + '   ' + r.ratio.toFixed(2) + flag);
}

// ── Audit techs ──────────────────────────────────────────────────────────────
console.log('\nTECH COST AUDIT  (cost = tierBase + mechanic tag points)\n');
const techChanges = [];
for (const f of fs.readdirSync(TECHS_DIR).sort()) {
    if (!f.endsWith('.json')) continue;
    const p = path.join(TECHS_DIR, f);
    const page = JSON.parse(fs.readFileSync(p, 'utf8'));
    const tier = tierOf(page.unit) || 2;
    let changed = false;
    for (const t of page.techs || []) {
        const want = techCost(t, tier);
        const mark = want !== t.cost ? `  ${t.cost}g -> ${want}g` : '';
        console.log(`${page.unit.padEnd(22)} ${t.id.padEnd(18)} ${String(t.cost).padStart(3)}g  fair ${String(want).padStart(3)}g${mark}`);
        if (want !== t.cost) { t.cost = want; changed = true; }
    }
    if (changed) techChanges.push({ p, page });
}

// ── Apply ────────────────────────────────────────────────────────────────────
if (APPLY) {
    let tuned = 0;
    for (const r of rows) {
        if (r.ratio >= 0.93 && r.ratio <= 1.07) continue;
        // Scale hp and damage by sqrt(target/power): preserves the unit's
        // dps/ehp SHAPE while moving total power onto the price curve.
        const k = Math.sqrt(1 / r.ratio);
        r.def.hp = Math.max(10, Math.round(r.def.hp * k / 5) * 5);
        r.def.damage = Math.max(2, Math.round(r.def.damage * k));
        fs.writeFileSync(r.path, JSON.stringify(r.def, null, 2));
        tuned++;
        console.log(`tuned ${r.id}: hp -> ${r.def.hp}, damage -> ${r.def.damage} (was ratio ${r.ratio.toFixed(2)})`);
    }
    for (const { p, page } of techChanges) {
        fs.writeFileSync(p, JSON.stringify(page, null, 1));
    }
    console.log(`\napplied: ${tuned} units rescaled, ${techChanges.length} tech pages repriced`);
} else {
    console.log('\n(dry run — pass --apply to write changes)');
}
