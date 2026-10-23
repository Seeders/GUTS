// Preloaded into the quest probe's server: seeds Math.random and starts the clock at a fixed
// moment (it then runs at real speed), so time of day, routines and rolls start the same each run.
let seed = 987654321;
Math.random = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
const realNow = Date.now.bind(Date), start = realNow();
Date.now = () => 1767225600000 + (realNow() - start);
