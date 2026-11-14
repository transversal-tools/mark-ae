// Focus guard (macOS): keeps After Effects from taking the front while tools run.
//
// Some AE calls activate AE: switching the viewer to another comp (set_active_comp)
// and menu commands such as undo/redo (app.executeCommand). Measured 2026-10-28 on
// AE 2025 with TextEdit in front. Before each tool call we note the app in front.
// If it was not AE and AE is in front when the call ends (or a moment later), we hand
// the front back to that app. If AE was already in front when the call began, the
// user is working in it, so nothing is done.
//
// On by default on macOS. AE_PORTAL_KEEP_FOCUS=0 turns it off. Zero dependencies:
// lsappinfo reads the front app, and osascript activates the previous one through
// NSRunningApplication (no Apple event is sent to that app, so no permission prompt).
'use strict';

const { execFile } = require('child_process');

const ENABLED = process.platform === 'darwin' && process.env.AE_PORTAL_KEEP_FOCUS !== '0';
const LATE_CHECK_MS = 300;     // AE can take the front a moment after the call returns
const PULL_WINDOW_MS = 1500;   // AE in front this soon after a pull is still ours, not the user's

let aePattern = /^com\.adobe\.AfterEffects/i;
const infoCache = new Map();   // ASN -> { bundle, pid }
let lastPull = null;           // { app, at }: the app we handed the front back to
let restored = 0;

function run(cmd, args) {
    return new Promise((resolve) => {
        execFile(cmd, args, { timeout: 1500 }, (err, out) => resolve(err ? '' : String(out)));
    });
}

async function frontApp() {
    const asn = (await run('lsappinfo', ['front'])).trim();
    if (!asn) return null;
    let info = infoCache.get(asn);
    if (!info) {
        const text = await run('lsappinfo', ['info', asn]);
        const b = /bundleID="([^"]+)"/.exec(text);
        const p = /\bpid = (\d+)/.exec(text);
        info = { bundle: b ? b[1] : null, pid: p ? Number(p[1]) : null };
        if (info.pid) infoCache.set(asn, info);
    }
    return { asn, bundle: info.bundle, pid: info.pid };
}

function isAE(app) { return !!(app && app.bundle && aePattern.test(app.bundle)); }

function activate(app) {
    const js = "ObjC.import('AppKit'); var a = $.NSRunningApplication.runningApplicationWithProcessIdentifier(" +
        Number(app.pid) + '); a ? a.activateWithOptions(2) : false';   // 2 = ignoring other apps
    return run('osascript', ['-l', 'JavaScript', '-e', js]);
}

async function giveBack(before) {
    if (!isAE(await frontApp())) return false;
    lastPull = { app: before, at: Date.now() };
    await activate(before);
    restored++;
    return true;
}

// Run fn() (a tool call) under the guard. Never delays or changes its result: the
// front-app checks after the call run in the background.
async function guard(fn) {
    if (!ENABLED) return fn();
    let before = null;
    try { before = await frontApp(); } catch (_) {}
    if (isAE(before) && lastPull && Date.now() - lastPull.at < PULL_WINDOW_MS) before = lastPull.app;
    if (!before || !before.pid || isAE(before)) return fn();
    try {
        return await fn();
    } finally {
        giveBack(before)
            .then((done) => { if (!done) setTimeout(() => { giveBack(before).catch(() => {}); }, LATE_CHECK_MS); })
            .catch(() => {});
    }
}

module.exports = {
    guard,
    ENABLED,
    stats: () => ({ enabled: ENABLED, restored }),
    _setAppPatternForTest: (re) => { aePattern = re; }
};
