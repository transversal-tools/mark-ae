// Mark — backup of the user's data.
// recipes.json, memory.md and usage.json live in Mark's data folder (mark-paths.js),
// lessons in the repo's knowledge/learned-templates.md. This mirrors them to a
// backup folder, one subfolder per computer (two machines sharing a synced folder
// never overwrite each other): the latest copy of each file, plus one dated copy per
// day kept for 30 days, so a broken or emptied file can be recovered.
//
// The folder is <data folder>/Backup by default. To put it somewhere else (a synced
// folder, for example), write that folder's absolute path on the first line of
// <data folder>/backup-dir.txt, or set MARK_BACKUP_DIR in After Effects' environment.

const fs = require('fs');
const path = require('path');

const paths = require('./mark-paths.js');
const DATA = paths.DATA;

function backupRoot() {
    try {
        const line = fs.readFileSync(path.join(DATA, 'backup-dir.txt'), 'utf8').split(/\r?\n/)[0].trim();
        if (line) return line;
    } catch (_) {}
    if (process.env.MARK_BACKUP_DIR) return process.env.MARK_BACKUP_DIR;
    return path.join(DATA, 'Backup');
}
const DIR = path.join(backupRoot(), paths.machineName());
const KEEP_DAYS = 30;

function dayKey() {
    const d = new Date(), p = (n) => (n < 10 ? '0' : '') + n;
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// extraFiles: absolute paths of other files to include (e.g. learned-templates.md).
// Returns { ok, at, dir, copied }.
function run(extraFiles) {
    const files = ['recipes.json', 'memory.md', 'usage.json'].map((f) => path.join(DATA, f)).concat(extraFiles || []);
    const daily = path.join(DIR, 'daily', dayKey());
    fs.mkdirSync(daily, { recursive: true });
    let copied = 0;
    files.forEach((src) => {
        if (!fs.existsSync(src)) return;
        const name = path.basename(src);
        fs.copyFileSync(src, path.join(DIR, name));
        fs.copyFileSync(src, path.join(daily, name));
        copied++;
    });
    prune();
    const at = new Date().toISOString();
    try { fs.writeFileSync(path.join(DIR, 'last-backup.txt'), at + '\n' + copied + ' files\n'); } catch (_) {}
    return { ok: true, at, dir: DIR, copied };
}

function prune() {
    const root = path.join(DIR, 'daily');
    let days;
    try { days = fs.readdirSync(root).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort(); } catch (_) { return; }
    days.slice(0, Math.max(0, days.length - KEEP_DAYS)).forEach((d) => {
        const p = path.join(root, d);
        try { fs.readdirSync(p).forEach((f) => fs.unlinkSync(path.join(p, f))); fs.rmdirSync(p); } catch (_) {}
    });
}

function last() {
    try { return fs.readFileSync(path.join(DIR, 'last-backup.txt'), 'utf8').split('\n')[0] || null; } catch (_) { return null; }
}

module.exports = { DIR, run, last };
