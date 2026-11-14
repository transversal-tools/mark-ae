// Mark — daily spend log.
// Adds up Claude Code's own per-turn cost (total_cost_usd) by local day and mode.
// On the subscription that number is an API-price equivalent (nothing is billed,
// it shows how fast the weekly limit is being used); on the API it is real money.
// Kept as a small JSON file next to recipes.json so it outlives panel reloads.

const fs = require('fs');
const os = require('os');
const path = require('path');

const FILE = path.join(require('./mark-paths.js').DATA, 'usage.json');

function dayKey(d) {
    d = d || new Date();
    const p = (n) => (n < 10 ? '0' : '') + n;
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function load() {
    try { return JSON.parse(fs.readFileSync(FILE, 'utf8')).days || {}; } catch (_) { return {}; }
}

function add(mode, usd) {
    if (!(usd > 0)) return;
    const days = load();
    const k = dayKey();
    const day = days[k] || { subscription: 0, api: 0, turns: 0 };
    day[mode === 'api' ? 'api' : 'subscription'] += usd;
    day.turns += 1;
    days[k] = day;
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, days }, null, 2));
    fs.renameSync(tmp, FILE);
}

function today() { return load()[dayKey()] || { subscription: 0, api: 0, turns: 0 }; }

module.exports = { FILE, add, today, dayKey };
