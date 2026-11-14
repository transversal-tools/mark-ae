/* global CSInterface */
// AE Portal — Panel main script.
// Owns: TCP server (transport.js), JSX bridge (CSInterface.evalScript), UI.

window.__aePortalBooted = true;  // sentinel for the inline diagnostic in index.html

// CEP sets __dirname to the extension root, NOT the script's folder.
// Resolve paths relative to the loaded HTML's URL instead — that's reliably correct.
function fsPathRelativeToPanel(relPath) {
    const url = new URL(relPath, window.location.href);
    let p = decodeURIComponent(url.pathname);
    // Windows: file:///C:/... gives a pathname of "/C:/..." — the leading slash
    // makes it an invalid path, so require()/fs both fail. Strip it. macOS paths
    // legitimately start at "/" and never match this shape, so they're untouched.
    if (/^\/[A-Za-z]:[\\/]/.test(p)) p = p.slice(1);
    return p;
}
const CLIENT_DIR  = fsPathRelativeToPanel('./');                      // .../client/
const HOST_JSX    = fsPathRelativeToPanel('../host/index.jsx');       // .../host/index.jsx
const TRANSPORT_  = fsPathRelativeToPanel('./transport.js');          // .../client/transport.js

let path, fs, Transport;
try {
    path = require('path');
    fs = require('fs');
    Transport = require(TRANSPORT_);
} catch (e) {
    const div = document.getElementById('fatal-error') || (() => {
        const d = document.createElement('div');
        d.id = 'fatal-error';
        d.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#1a0000;color:#ffb0b0;padding:14px;font-family:Menlo,monospace;font-size:11px;white-space:pre-wrap;overflow:auto;user-select:text;';
        document.body.appendChild(d);
        return d;
    })();
    const dirnameDiag = (typeof __dirname !== 'undefined') ? __dirname : '(undefined — Node context not injected)';
    div.textContent = 'REQUIRE FAILURE\n\n' + e.message + '\n\nTRANSPORT_=' + TRANSPORT_ + '\n__dirname=' + dirnameDiag + '\n\n' + (e.stack || '');
    throw e;
}

const cs = new CSInterface();

// ---------- version ----------
// Single-source the panel version from package.json so the status echo can't
// drift from the real release. TWO layouts have to work:
//   repo / dev symlink:  <repo>/extension/client/  -> ../../package.json
//   installed ZXP:       <bundle>/client/          -> ../package.json
// Try the repo layout first (that is what a developer runs), then the bundle
// layout. Getting this wrong is silent: the catch used to hand back a hardcoded
// string, so a ZXP install would cheerfully report the wrong version forever.
const PANEL_VERSION = (() => {
    for (const rel of ['../../package.json', '../package.json']) {
        try {
            const v = JSON.parse(fs.readFileSync(fsPathRelativeToPanel(rel), 'utf8')).version;
            if (v) return v;
        } catch (_) { /* try the next layout */ }
    }
    return 'unknown';
})();

// The absolute path to the MCP server, surfaced in Settings so it can be pasted
// into a client config. Worth showing rather than documenting, because where it
// lands depends on the install: a dev checkout, or a ZXP in either the system or
// the per-user CEP extensions dir, which also differs by platform.
const SERVER_JS_PATH = (() => {
    for (const rel of ['../../mcp-server/server.js', '../mcp-server/server.js']) {
        try {
            const p = fsPathRelativeToPanel(rel);
            if (fs.existsSync(p)) return p;
        } catch (_) { /* try the next layout */ }
    }
    return '';
})();

// ---------- auth token ----------
// A per-session shared secret. It is written into this AE's discovery file (0600)
// and the MCP server must echo it back as the first framed message before we honor
// any command — this is what stops an unauthenticated local process from driving AE.
// Prefer crypto (available in CEP's node context); fall back to a strong-ish blend
// of entropy sources if it's somehow missing.
function generateToken() {
    try {
        const crypto = require('crypto');
        if (crypto && crypto.randomBytes) return crypto.randomBytes(32).toString('hex');
    } catch (_) {}
    let s = '';
    for (let i = 0; i < 10; i++) s += Math.random().toString(36).slice(2);
    s += Date.now().toString(36) + '-' + ((typeof process !== 'undefined' && process.pid) ? process.pid : '');
    return s.replace(/[^a-z0-9]/gi, '').slice(0, 64);
}
let PANEL_TOKEN = null;
try { PANEL_TOKEN = generateToken(); } catch (_) { PANEL_TOKEN = null; }

// ---------- DOM refs ----------
const $ = (id) => document.getElementById(id);
const ui = {
    dot: $('conn-dot'),
    sPort: $('s-port'), sClients: $('s-clients'), sAe: $('s-ae'),
    sProject: $('s-project'), sLast: $('s-last'),
    watchBtn: $('watch-btn'), watchPane: $('watch-pane'),
    watchEntries: $('watch-entries'), watchCount: $('watch-count'),
    watchCopyMcp: $('watch-copy-mcp'), watchClearBtn: $('watch-clear-btn'),
    reloadBtn: $('reload-btn'),
    settingsBtn: $('settings-btn'), settingsPane: $('settings-pane'),
    manualPane: $('manual-pane'), manualToggle: $('manual-toggle'),
    cfgPort: $('cfg-port'), cfgAutoPort: $('cfg-auto-port'), cfgAutomap: $('cfg-automap'), restartBtn: $('restart-btn'),
    cfgServerPath: $('cfg-server-path'), copyServerPath: $('copy-server-path'),
    cmdInput: $('cmd-input'), cmdRun: $('cmd-run'),
    resultPane: $('result-pane'), copyResult: $('copy-result'),
    consoleLog: $('console-log'),
    consoleClear: $('console-clear'), consoleCopyErrors: $('console-copy-errors')
};

// ---------- logging ----------
const MAX_LOG = 200;
function log(message, level = 'info') {
    const ts = new Date().toLocaleTimeString('en-GB', { hour12: false });
    const line = document.createElement('div');
    line.className = 'line ' + level;
    line.innerHTML = '<span class="ts">' + ts + '</span>' + escapeHtml(message);
    ui.consoleLog.appendChild(line);
    while (ui.consoleLog.childNodes.length > MAX_LOG) ui.consoleLog.removeChild(ui.consoleLog.firstChild);
    ui.consoleLog.scrollTop = ui.consoleLog.scrollHeight;
}
function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// ---------- settings ----------
// Settings are namespaced per AE major version. The SAME extension bundle id
// loads in AE 2025 and AE 2026, so an un-namespaced key would let the two panels
// clobber each other's port (and trigger EADDRINUSE). The major is only known
// after the host ping, so we start on a base key and re-load per-version inside
// bootstrap() once app.version is in hand.
const DEFAULTS = { port: 38967, automap: 'light', portMode: 'auto', manualOpen: false };
let settingsMajor = null;               // AE major version once known (e.g. 26)
function settingsKey(major) { return 'ae-portal:settings' + (major != null ? ':' + major : ''); }
function loadSettings(major) {
    try {
        const raw = localStorage.getItem(settingsKey(major));
        if (!raw) return Object.assign({}, DEFAULTS);
        return Object.assign({}, DEFAULTS, JSON.parse(raw));
    } catch (e) { return Object.assign({}, DEFAULTS); }
}
function saveSettings(s) {
    localStorage.setItem(settingsKey(settingsMajor), JSON.stringify(s));
}
// Derive the TCP port from the AE major version so two AE versions never collide:
// 2025 -> 38967, 2026 -> 38968 (the AE Portal original uses 38947+, so both can run), etc. The discovery file records the ACTUAL bound
// port, so this number only needs to be collision-free, not globally agreed.
function portForVersion(verStr) {
    const major = parseInt(String(verStr || '').split('.')[0], 10);
    if (!major || isNaN(major) || major < 1) return DEFAULTS.port;
    const p = DEFAULTS.port + (major - 25);
    return (p >= 1024 && p <= 65535) ? p : DEFAULTS.port;
}
let settings = loadSettings(null);
ui.cfgPort.value = settings.port;
ui.cfgAutomap.value = settings.automap;
if (ui.cfgAutoPort) ui.cfgAutoPort.checked = (settings.portMode !== 'manual');
// The manual-command section is collapsed unless the user opened it before. It
// is applied here AND again in applyVersion(), because settings are re-loaded
// from the per-major key once app.version is known.
function applyManualOpen() {
    if (!ui.manualPane) return;
    ui.manualPane.classList.toggle('collapsed', !settings.manualOpen);
}
applyManualOpen();
if (ui.cfgServerPath) {
    ui.cfgServerPath.value = SERVER_JS_PATH || '(not found next to the panel)';
    ui.cfgServerPath.title = ui.cfgServerPath.value;
}

// ---------- evalScript bridge ----------
function evalAsync(code, { timeout = 60000 } = {}) {
    return new Promise((resolve, reject) => {
        let done = false;
        const t = setTimeout(() => {
            if (done) return;
            done = true;
            reject(new Error('evalScript timed out after ' + timeout + 'ms'));
        }, timeout);
        cs.evalScript(code, (raw) => {
            if (done) return;
            done = true;
            clearTimeout(t);
            resolve(raw);
        });
    });
}

function jsString(s) { return JSON.stringify(String(s)); }

// ---------- JSX dispatch in-flight gating ----------
// ExtendScript runs on AE's single main thread, so a poller tick that hits that
// thread contends with any real command already running on it. Count JSX
// dispatches in flight and let the pollers skip their tick while >0 — but never
// stay blind: if dispatches have been continuously in flight past the max-pause
// cap (a hang), let ticks through anyway so status can't freeze. Only JSX
// dispatches touch this counter; panel-side methods (whisper, etc.) do not.
let jsxInFlight = 0;
let jsxBusySince = 0;
const MAX_POLL_SUPPRESS_MS = 5000;
// 1.2 host-liveness: epoch ms of the last successful JSX dispatch (host answered).
// Stamped in callJsxDispatch and written into the discovery heartbeat so the server
// can report hostResponsive. Absent in old panels → server omits the field.
let lastHostOkAt = 0;
function pollersShouldSkip() {
    if (jsxInFlight <= 0) return false;
    if (jsxBusySince && (Date.now() - jsxBusySince) > MAX_POLL_SUPPRESS_MS) return false;
    return true;
}

// ---------- host self-recovery ----------
// In AE every CEP panel shares one ExtendScript engine ("main"), and MarkHost can
// vanish after it loaded: on 2026-10-28 the boot ping answered and the auto-map a
// moment later came back empty, while two other panels were starting. A missing
// MarkHost makes evalScript return "" in AE 26.5 ("EvalScript error." on other
// builds). Then a cheap probe tells "gone" from "present": if MarkHost is gone the
// dispatch ran nothing, so reload the host and repeat the call once. If it is
// present, never repeat (the call may have changed the project).
const HOST_RELOAD_MIN_GAP_MS = 5000;
const HOST_WATCH_MS = 10000;
let lastHostReloadAt = 0;
let hostRecovery = null;      // one recovery at a time; concurrent callers share it
function isEmptyJsxResult(raw) {
    return raw === undefined || raw === null || raw === '' || raw === 'undefined' || raw === 'EvalScript error.';
}
async function probeHost() {
    try { return String(await evalAsync('typeof MarkHost', { timeout: 5000 })); }
    catch (_) { return 'timeout'; }   // AE busy: unknown, never treated as missing
}
function recoverHost(reason) {
    if (hostRecovery) return hostRecovery;
    hostRecovery = (async () => {
        const probe = await probeHost();
        if (probe === 'object' || probe === 'timeout') return { recovered: false, probe };
        if (Date.now() - lastHostReloadAt < HOST_RELOAD_MIN_GAP_MS) {
            log('host lost (' + reason + ': typeof MarkHost = ' + JSON.stringify(probe) + '), reloaded less than 5 s ago, waiting', 'warn');
            return { recovered: false, probe };
        }
        lastHostReloadAt = Date.now();
        log('host lost (' + reason + ': typeof MarkHost = ' + JSON.stringify(probe) + '), reloading', 'warn');
        try {
            const r = await PANEL_METHODS.reload_host();
            const ok = /^ok:/.test(String(r.evalFileResult)) && !/MarkHost undefined/.test(String(r.evalFileResult));
            log(ok ? 'host reloaded (' + r.evalFileResult + ')' : 'host reload failed: ' + r.evalFileResult, ok ? 'ok' : 'err');
            return { recovered: ok, probe };
        } catch (e) {
            log('host reload failed: ' + e.message, 'err');
            return { recovered: false, probe };
        }
    })().finally(() => { hostRecovery = null; });
    return hostRecovery;
}
// Watchdog: when nothing has reached the host for a while, check MarkHost is still
// there. Shares the reload limit above, and is quiet while the host is healthy (the
// live-events poller keeps lastHostOkAt fresh).
function startHostWatchdog() {
    setInterval(() => {
        if (hostRecovery || pollersShouldSkip()) return;
        if (Date.now() - lastHostOkAt < HOST_WATCH_MS) return;
        recoverHost('watchdog');
    }, HOST_WATCH_MS);
}

async function callJsxDispatch(method, params) {
    try {
        return await dispatchOnce(method, params);
    } catch (e) {
        if (!e.hostEmpty) throw e;
        const r = await recoverHost(method);
        if (!r.recovered) throw e;
        log('repeating ' + method + ' after the host reload', 'info');
        return await dispatchOnce(method, params);
    }
}

async function dispatchOnce(method, params) {
    const paramsJson = JSON.stringify(params || {});
    const code = 'MarkHost.dispatch(' + jsString(method) + ', ' + jsString(paramsJson) + ')';
    // Mark this dispatch in-flight for poller gating. Pair the increment with the
    // finally decrement so a throwing, non-envelope, or timed-out call can't wedge
    // the counter (evalAsync always rejects on its timeout, so it can't hang here).
    if (jsxInFlight === 0) jsxBusySince = Date.now();
    jsxInFlight++;
    try {
        const raw = await evalAsync(code);
        if (isEmptyJsxResult(raw)) {
            const err = new Error('JSX returned no value (host not loaded?). Try reload_host.');
            err.hostEmpty = true;
            throw err;
        }
        // Key off the STRUCTURED envelope, never on string-sniffing. Every real host
        // response is a JSON object carrying the sentinel field `__ae:true`. Anything
        // that fails to parse is a CEP-level failure (compile error, host not loaded),
        // which is when evalScript returns the literal "EvalScript error." string — a
        // regex on that collided with legitimate results that merely started the same.
        let parsed;
        try { parsed = JSON.parse(raw); }
        catch (e) {
            throw new Error('JSX evaluation failed (host not loaded or script error): ' + String(raw).slice(0, 300));
        }
        // 2.6 temp-file handoff: payloads >256KB come back as a POINTER envelope
        // {__ae:true, ok:true, __aeFile:<fsName>, __aeBytes:N}. Read the REAL envelope
        // from that file (written UTF-8, may carry a leading BOM), delete the temp
        // file best-effort, then fall through to the normal ok/result handling below.
        if (parsed && typeof parsed.__aeFile === 'string') {
            const ptrFile = parsed.__aeFile;
            let contents;
            try { contents = fs.readFileSync(ptrFile, 'utf8'); }
            catch (e) { throw new Error('host temp-file payload unreadable (' + ptrFile + '): ' + e.message); }
            try { fs.unlinkSync(ptrFile); } catch (_) {}
            if (contents.charCodeAt(0) === 0xFEFF) contents = contents.slice(1);   // strip leading BOM
            try { parsed = JSON.parse(contents); }
            catch (e) { throw new Error('host temp-file payload unparseable (' + ptrFile + '): ' + e.message); }
        }
        if (!parsed || parsed.__ae !== true || typeof parsed.ok === 'undefined') {
            throw new Error('JSX returned an unexpected (non-envelope) response: ' + String(raw).slice(0, 300));
        }
        if (!parsed.ok) throw new Error(parsed.error || 'JSX error (no message)');
        // 1.2 host answered successfully — stamp liveness for the discovery heartbeat.
        lastHostOkAt = Date.now();
        return parsed.result;
    } finally {
        jsxInFlight--;
        if (jsxInFlight <= 0) { jsxInFlight = 0; jsxBusySince = 0; }
    }
}

// ---------- panel-side methods (bypass JSX) ----------
const PANEL_METHODS = {
    reload_host: async () => {
        const jsxPath = HOST_JSX.replace(/\\/g, '/');
        if (!fs.existsSync(jsxPath)) throw new Error('host file missing: ' + jsxPath);
        const code = '$.evalFile(File(' + jsString(jsxPath) + ')); "ok:" + (typeof MarkHost !== "undefined" ? MarkHost.version : "MarkHost undefined")';
        const out = await evalAsync(code);
        return { reloaded: true, evalFileResult: out };
    },
    panel_status: async () => ({
        port: settings.port,
        automap: settings.automap,
        clients: transport ? transport.clientCount() : 0,
        version: PANEL_VERSION,
        nodeVersion: process.versions.node
    }),
    whisper_transcribe:        async (params) => whisperTranscribe(params),
    import_folder:             async (params) => importFolderRecursive(params),
    list_installed_scripts:    async ()       => listInstalledScripts(),
    list_installed_extensions: async ()       => listInstalledExtensions(),
    list_installed_plugins:    async ()       => listInstalledPlugins(),
    render_frame:              async (params) => renderFrameAsImage(params),
    render_preview_strip:      async (params) => renderPreviewStrip(params),
    apply_expression_preset:   async (params) => applyExpressionPreset(params),
    reveal_in_finder:          async (params) => revealInFinder(params),
    reveal_project_in_finder:  async ()       => revealProjectInFinder()
};

// ---------- panel-side: shared render helpers (0.3 + render_preview_strip) ----------
// A Promise sleep on pure Node timers — never blocks the event loop or the JSX thread.
function sleepMs(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Off-thread flush poll: wait for a PNG the host just wrote to reach a STABLE
// non-zero size (two consecutive equal samples >=1 byte, ~intervalMs apart) up to a
// cap. The host now returns right after saveFrameToPng, so the flush completes here
// off the JSX thread. Returns the last observed byte size (0 if it never appeared).
async function waitForFileStable(filePath, capMs, intervalMs) {
    capMs = capMs || 3000; intervalMs = intervalMs || 40;
    const deadline = Date.now() + capMs;
    let prev = -1;
    while (Date.now() < deadline) {
        let size = 0;
        try { size = fs.statSync(filePath).size; } catch (_) { size = 0; }
        if (size >= 1 && size === prev) return size;   // two consecutive equal non-zero reads
        prev = size;
        await sleepMs(intervalMs);
    }
    try { return fs.statSync(filePath).size; } catch (_) { return 0; }
}

function md5Hex(buf) {
    const crypto = require('crypto');
    return crypto.createHash('md5').update(buf).digest('hex');
}

// Stale-cache ghost detection: AE's frame cache is comp-STATE-keyed, so a mutated
// comp can still re-serve the OLD frame. Remember the last render hash per
// compId+time in a small LRU and flag an identical re-render.
const RENDER_HASH_LRU = new Map();
const RENDER_HASH_LRU_CAP = 32;
function renderHashGet(key) { return RENDER_HASH_LRU.get(key); }
function renderHashSet(key, hash) {
    if (RENDER_HASH_LRU.has(key)) RENDER_HASH_LRU.delete(key);        // move-to-newest
    RENDER_HASH_LRU.set(key, hash);
    while (RENDER_HASH_LRU.size > RENDER_HASH_LRU_CAP) {
        RENDER_HASH_LRU.delete(RENDER_HASH_LRU.keys().next().value);  // evict oldest
    }
}

// The known all-white blank-frame PNG is ~2809 bytes; treat sub-3KB as suspect.
const BLANK_MIN_BYTES = 3000;
const RENDER_MAX_ATTEMPTS = 3;   // 1 initial + up to 2 retries

// Render ONE frame to a PNG path with off-thread flush polling + blank-frame retry.
// Shared by render_frame and render_preview_strip. Passes waitMs:150 so the host
// returns fast and the wait happens here. Returns { meta, preBytes, buf,
// blankSuspected }. THROWS if the frame never renders (0 bytes / missing after
// retries) — never a silent white image.
async function renderFrameToStablePng(dispatchParams, tmpPath) {
    let blankSuspected = false;
    let lastErr = null;
    for (let attempt = 1; attempt <= RENDER_MAX_ATTEMPTS; attempt++) {
        let meta = null;
        try {
            // The host opens a comp in the viewer only the first time; a retry forces it,
            // in case a blank or failed frame came from a comp whose viewer was closed.
            meta = await callJsxDispatch('render_frame_to_path',
                Object.assign({}, dispatchParams, { path: tmpPath, waitMs: 150, forceView: attempt > 1 }));
        } catch (e) {
            lastErr = e;
            continue;   // re-issue the whole render; the retry forces openInViewer
        }
        // If the host didn't already confirm the flush, poll the file off-thread.
        if (!meta || meta.flushed !== true) {
            await waitForFileStable(tmpPath, 3000, 40);
        }
        let size = 0, missing = false;
        try { size = fs.statSync(tmpPath).size; } catch (_) { missing = true; }
        if (missing || size === 0) {
            lastErr = new Error('render produced no frame (0 bytes / missing)');
            continue;   // retry the whole render
        }
        if (size < BLANK_MIN_BYTES) {
            // ~2809-byte all-white signature — retry, but if it persists don't
            // hard-fail (could be a genuinely tiny frame); flag it instead.
            blankSuspected = true;
            if (attempt < RENDER_MAX_ATTEMPTS) continue;
        } else {
            blankSuspected = false;
        }
        return { meta: meta || {}, preBytes: size, buf: fs.readFileSync(tmpPath), blankSuspected: blankSuspected };
    }
    throw new Error('render_frame failed after ' + RENDER_MAX_ATTEMPTS + ' attempts: ' +
        (lastErr ? lastErr.message : 'no frame produced'));
}

// Downscale a PNG in place to maxPx on the longest edge with sips (macOS built-in).
// Async (execFile) so the event loop isn't blocked; best-effort (leaves the original
// if sips is missing/fails).
function sipsDownscale(filePath, maxPx) {
    return new Promise((resolve) => {
        try {
            const { execFile } = require('child_process');
            execFile('sips', ['-Z', String(maxPx), filePath], () => resolve());
        } catch (_) { resolve(); }
    });
}

// Decode a data: URL into an <img> we can drawImage() onto a canvas. Awaits onload.
function loadImageFromDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('image decode failed'));
        img.src = dataUrl;
    });
}

// ---------- panel-side: render_frame ----------
async function renderFrameAsImage(params) {
    const tmpPath = path.join(os.tmpdir(), 'ae-portal-frame-' + Date.now() + '.png');
    const r = await renderFrameToStablePng(
        { comp: params.comp, time: params.time, frame: params.frame }, tmpPath);
    const meta = r.meta;

    // Stale-cache hash on the PRE-sips buffer, keyed by compId+time.
    const compId = (meta.compId != null) ? meta.compId
                 : (meta.activeCompId != null ? meta.activeCompId : null);
    const hashKey = String(compId) + ':' + String(meta.time != null ? meta.time : params.time);
    const hash = md5Hex(r.buf);
    const unchanged = (renderHashGet(hashKey) === hash);
    renderHashSet(hashKey, hash);

    // Downscale to max 1024px on the longest edge so large comps don't trip the
    // image API. Then read the (downscaled) PNG as base64 and clean up.
    await sipsDownscale(tmpPath, 1024);
    const data = fs.readFileSync(tmpPath).toString('base64');
    try { fs.unlinkSync(tmpPath); } catch (_) {}

    let text = 'frame render: comp="' + meta.comp + '" time=' + meta.time + 's frame=' + meta.frame +
        ' (' + r.preBytes + ' bytes) compId=' + compId;
    if (r.blankSuspected) text += ' blankSuspected:true';
    if (unchanged) text += ' unchangedSincePreviousRender:true';

    return {
        _mcpContent: [
            { type: 'image', data: data, mimeType: 'image/png' },
            { type: 'text',  text: text }
        ]
    };
}

// ---------- panel-side: render_preview_strip (contact sheet of N frames) ----------
// Renders N evenly-spaced frames across [start,end] SEQUENTIALLY (single JSX thread),
// downscales each with sips, then tiles them into one contact sheet via an offscreen
// <canvas> in the panel's Chromium DOM (zero npm deps). start defaults to 0; when end
// is omitted the comp duration is fetched from the host (list_compositions).
async function renderPreviewStrip(params) {
    params = params || {};
    const frames = Math.max(1, Math.min(64, params.frames != null ? Math.round(Number(params.frames)) : 9));
    const downscale = Math.max(16, Math.round(Number(params.downscale)) || 320);
    let start = (params.start != null) ? Number(params.start) : null;
    let end   = (params.end   != null) ? Number(params.end)   : null;
    let fps = null;
    let compLabel = (params.comp != null) ? String(params.comp) : '(active)';

    if (start == null) start = 0;
    if (end == null) {
        // Fetch comp duration. list_compositions is a confirmed light read:
        // { comps: [{ id, name, w, h, fps, dur }] }. Pick target by id/name, or the
        // active comp (via get_quick_state) when comp is omitted.
        let targetId = null;
        if (params.comp == null) {
            try {
                const qs = await callJsxDispatch('get_quick_state', {});
                targetId = qs ? qs.activeCompId : null;
                if (qs && qs.activeCompName) compLabel = qs.activeCompName;
            } catch (_) {}
        }
        try {
            const list = await callJsxDispatch('list_compositions', {});
            const comps = (list && list.comps) || [];
            let target = null;
            if (params.comp != null) {
                target = comps.filter(function (c) { return String(c.id) === String(params.comp) || c.name === params.comp; })[0];
            } else if (targetId != null) {
                target = comps.filter(function (c) { return String(c.id) === String(targetId); })[0];
            }
            if (target) { end = target.dur; fps = target.fps; compLabel = target.name; }
        } catch (_) {}
        if (end == null) end = start;   // last resort: a single-time strip at start
    }
    if (!(end >= start)) end = start;

    // Evenly-spaced sample times (inclusive of both ends).
    const times = [];
    if (frames === 1 || end === start) times.push(start);
    else for (let i = 0; i < frames; i++) times.push(start + (end - start) * (i / (frames - 1)));

    // Render sequentially (never parallel — one JSX thread). Blank/failed frames are
    // recorded but do not abort the whole sheet.
    const cells = [];       // { time, dataUrl|null, blankSuspected }
    const errors = [];
    const tmpFiles = [];
    for (let i = 0; i < times.length; i++) {
        const t = times[i];
        const tmpPath = path.join(os.tmpdir(), 'ae-portal-strip-' + Date.now() + '-' + i + '.png');
        tmpFiles.push(tmpPath);
        try {
            const r = await renderFrameToStablePng({ comp: params.comp, time: t }, tmpPath);
            await sipsDownscale(tmpPath, downscale);
            const b64 = fs.readFileSync(tmpPath).toString('base64');
            cells.push({ time: t, dataUrl: 'data:image/png;base64,' + b64, blankSuspected: r.blankSuspected });
        } catch (e) {
            cells.push({ time: t, dataUrl: null, blankSuspected: false });
            errors.push('t=' + (Math.round(t * 1000) / 1000) + 's: ' + e.message);
        }
    }
    for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch (_) {} }

    // Decode each PNG into an Image (parallel — pure DOM work, no JSX thread).
    const loaded = await Promise.all(cells.map(function (c) {
        return c.dataUrl ? loadImageFromDataUrl(c.dataUrl).catch(function () { return null; })
                         : Promise.resolve(null);
    }));

    // Tile into a contact sheet on an offscreen canvas.
    const columns = Math.max(1, params.columns ? Math.round(Number(params.columns)) : Math.ceil(Math.sqrt(times.length)));
    const rows = Math.ceil(times.length / columns);
    let tileW = downscale, tileH = downscale;
    for (const img of loaded) { if (img) { tileW = img.naturalWidth || downscale; tileH = img.naturalHeight || downscale; break; } }
    const canvas = document.createElement('canvas');
    canvas.width = columns * tileW;
    canvas.height = rows * tileH;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#101010';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < times.length; i++) {
        const col = i % columns, row = Math.floor(i / columns);
        const x = col * tileW, y = row * tileH;
        const img = loaded[i];
        if (img) {
            ctx.drawImage(img, x, y, tileW, tileH);
        } else {
            ctx.fillStyle = '#3a0000'; ctx.fillRect(x, y, tileW, tileH);
            ctx.fillStyle = '#ff9090'; ctx.font = '14px monospace';
            ctx.fillText('render failed', x + 8, y + 20);
        }
        // Frame-time label, bottom-left of each tile.
        const label = (Math.round(times[i] * 1000) / 1000) + 's';
        ctx.font = '12px monospace';
        const lw = ctx.measureText(label).width + 8;
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x + 4, y + tileH - 18, lw, 15);
        ctx.fillStyle = '#ffffff'; ctx.fillText(label, x + 8, y + tileH - 6);
    }
    const b64sheet = canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');

    let text = 'preview strip: comp=' + compLabel + ' frames=' + times.length + ' columns=' + columns +
        ' times=[' + times.map(function (t) { return Math.round(t * 1000) / 1000; }).join(', ') + ']';
    if (fps != null) text += ' fps=' + fps;
    if (cells.some(function (c) { return c.blankSuspected; })) text += ' blankSuspected(some):true';
    if (errors.length) text += ' errors=' + errors.length + ' [' + errors.join('; ') + ']';

    return { _mcpContent: [ { type: 'image', data: b64sheet, mimeType: 'image/png' }, { type: 'text', text: text } ] };
}

// ---------- panel-side: expression presets ----------
const EXPRESSION_PRESETS = {
    wiggle: ({ freq = 2, amp = 30 }) => `wiggle(${freq}, ${amp})`,
    loopOut: ({ type = 'cycle', numKeyframes = 0 }) => `loopOut(type="${type}", numKeyframes=${numKeyframes})`,
    loopIn:  ({ type = 'cycle', numKeyframes = 0 }) => `loopIn(type="${type}", numKeyframes=${numKeyframes})`,
    bounce:  ({ amp = 0.05, freq = 4.0, decay = 8.0 }) =>
`amp = ${amp}; freq = ${freq}; decay = ${decay};
n = 0;
if (numKeys > 0){
    n = nearestKey(time).index;
    if (key(n).time > time) n--;
}
if (n == 0){ t = 0; } else { t = time - key(n).time; }
if (n > 0){
    v = velocityAtTime(key(n).time - thisComp.frameDuration/10);
    value + v*amp*Math.sin(freq*t*2*Math.PI)/Math.exp(decay*t);
} else { value }`,
    smooth:  ({ width = 0.2, samples = 5 }) => `smooth(${width}, ${samples})`,
    time:    ({ rate = 1.0, offset = 0 }) => `time*${rate} + ${offset}`,
    valueAtTime: ({ offset = 0 }) => `valueAtTime(time + (${offset}))`,
    posterizeTime: ({ rate = 12 }) => `posterizeTime(${rate}); value`,
    inertialBounce: () =>
`n = 0;
if (numKeys > 0){
    n = nearestKey(time).index;
    if (key(n).time > time) n--;
}
if (n == 0){ t = 0; } else { t = time - key(n).time; }
if (n > 0 && t < 1){
    v = velocityAtTime(key(n).time - thisComp.frameDuration/10);
    amp = .05; freq = 4.0; decay = 8.0;
    value + v*amp*Math.sin(freq*t*2*Math.PI)/Math.exp(decay*t);
} else value`,
    autoFade: ({ duration = 0.5 }) =>
`linear(time, inPoint, inPoint + ${duration}, 0, 100) - linear(time, outPoint - ${duration}, outPoint, 0, 100)`,
    pingPong: () => `loopOut(type="pingpong")`
};
async function applyExpressionPreset(params) {
    const name = params.preset;
    if (!name) throw new Error('preset required');
    const fn = EXPRESSION_PRESETS[name];
    if (!fn) throw new Error('unknown preset "' + name + '". Available: ' + Object.keys(EXPRESSION_PRESETS).join(', '));
    const expr = fn(params.params || {});
    const r = await callJsxDispatch('set_expression', {
        comp: params.comp, layer: params.layer, prop: params.prop, expression: expr
    });
    return { ...r, preset: name, expression: expr };
}

// ---------- panel-side: reveal in finder ----------
async function revealInFinder(params) {
    let target = params.path;
    if (!target && params.layer != null) {
        // resolve through JSX
        const info = await callJsxDispatch('run_jsx', {
            script: '(function(){ var c = app.project.activeItem; if (!(c instanceof CompItem)) return null; var l = (typeof ' +
                JSON.stringify(params.layer) + ' === "number") ? c.layer(' + Number(params.layer) + ') : c.layer(' + JSON.stringify(String(params.layer)) + '); if (!l) return null; if (l.source && l.source.file) return l.source.file.fsName; if (l.source && l.source instanceof CompItem) return null; return null; })()'
        });
        target = info;
    }
    if (!target) throw new Error('no path or layer source resolvable');
    return revealPath(target);
}
async function revealProjectInFinder() {
    const info = await callJsxDispatch('run_jsx', { script: '(app.project.file ? app.project.file.fsName : null)' });
    if (!info) throw new Error('project not saved');
    return revealPath(info);
}
function revealPath(filepath) {
    return new Promise((resolve, reject) => {
        const cp = spawn('open', ['-R', filepath]);
        cp.on('error', reject);
        cp.on('close', (code) => {
            if (code === 0) resolve({ revealed: filepath });
            else reject(new Error('open -R exited ' + code));
        });
    });
}

// ---------- panel-side: live events ----------
// Adaptive poll: quick right after a change, decaying to idle when quiet. The
// JSX engine is single-threaded and shared with the user's session and every
// MCP command, so a fixed 600ms poll burned it forever and contended with real
// work. Fast only while something is happening.
let lastQuickState = null;
let liveEventsTimer = null;
let liveEventsStopped = false;
const POLL_FAST = 500, POLL_IDLE = 1500;
let pollDelay = POLL_IDLE;
let idleStreak = 0;
function startLiveEvents() {
    liveEventsStopped = false;
    if (liveEventsTimer) clearTimeout(liveEventsTimer);
    scheduleNextPoll(0);
}
function scheduleNextPoll(delay) {
    if (liveEventsStopped) return;
    liveEventsTimer = setTimeout(runPoll, delay);
}
async function runPoll() {
    // Skip while a JSX dispatch holds the AE thread (0.2), but keep the timer chain
    // alive so polling resumes the moment the thread frees up.
    if (pollersShouldSkip()) { scheduleNextPoll(POLL_FAST); return; }
    const changed = await pollQuickState();
    if (changed) { pollDelay = POLL_FAST; idleStreak = 0; }
    else if (++idleStreak >= 4) { pollDelay = POLL_IDLE; }
    scheduleNextPoll(pollDelay);
}
function stopLiveEvents() {
    liveEventsStopped = true;
    if (liveEventsTimer) { clearTimeout(liveEventsTimer); liveEventsTimer = null; }
}
async function pollQuickState() {
    if (!transport || transport.clientCount() === 0) return false;
    let s;
    try { s = await callJsxDispatch('get_quick_state', {}); }
    catch (e) { return false; }
    if (!s || !s.open) { lastQuickState = s; return false; }
    const events = [];
    if (!lastQuickState) {
        events.push({ type: 'project_opened', data: { file: s.projectFile } });
    } else {
        if (lastQuickState.projectFile !== s.projectFile) {
            events.push({ type: 'project_opened', data: { file: s.projectFile } });
        }
        if (lastQuickState.activeCompId !== s.activeCompId) {
            events.push({ type: 'comp_opened', data: { id: s.activeCompId, name: s.activeCompName } });
        }
        if (lastQuickState.selectionSig !== s.selectionSig) {
            events.push({ type: 'selection_changed', data: { selection: s.selection, comp: s.activeCompName } });
        }
        if (lastQuickState.numItems !== s.numItems) {
            events.push({ type: 'items_changed', data: { delta: s.numItems - lastQuickState.numItems, total: s.numItems } });
        }
        if (lastQuickState.dirty !== s.dirty) {
            events.push({ type: 'dirty_changed', data: { dirty: s.dirty } });
        }
    }
    lastQuickState = s;
    // Keep the discovery file's project name fresh (surfaced by list_instances).
    if (lastPong && s.projectFile !== lastPong.projectFile) lastPong.projectFile = s.projectFile;
    for (const ev of events) {
        try { transport.broadcast(ev.type, ev.data); } catch (_) {}
    }
    return events.length > 0;
}
document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopLiveEvents();
    else startLiveEvents();
});

// ---------- panel-side: recursive folder import ----------
async function importFolderRecursive(params) {
    if (!params || !params.path) throw new Error('path required');
    const root = params.path;
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error('not a folder: ' + root);
    const recursive = params.recursive !== false;
    const exts = (params.extensions || ['.png','.jpg','.jpeg','.tif','.tiff','.exr','.psd','.ai','.mp4','.mov','.aac','.mp3','.wav','.aiff','.aif','.json','.svg','.tga','.dpx']).map(s => s.toLowerCase());
    const files = [];
    function walk(dir) {
        for (const name of fs.readdirSync(dir)) {
            if (name.startsWith('.')) continue;
            const full = path.join(dir, name);
            const stat = fs.statSync(full);
            if (stat.isDirectory()) {
                if (recursive) walk(full);
            } else {
                const e = path.extname(name).toLowerCase();
                if (!exts.length || exts.indexOf(e) !== -1) files.push(full);
            }
        }
    }
    walk(root);
    if (!files.length) return { imported: [], note: 'no matching files in ' + root };
    return await callJsxDispatch('import_files', { paths: files, intoFolder: params.intoFolder || path.basename(root) });
}

// ---------- panel-side: installed AE assets ----------
const IS_WIN = (typeof process !== 'undefined' && process.platform === 'win32');
function aeAppDirs() {
    // Common AE install locations across versions. Returns the directory that
    // actually CONTAINS Scripts/ and Plug-ins/ — on Windows those sit one level
    // deeper, under "Support Files", so callers can join the same way on both.
    const out = [];
    const root = IS_WIN
        ? path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Adobe')
        : '/Applications';
    if (!fs.existsSync(root)) return out;
    for (const name of fs.readdirSync(root)) {
        if (!/^Adobe After Effects /.test(name)) continue;
        const base = path.join(root, name);
        out.push(IS_WIN ? path.join(base, 'Support Files') : base);
    }
    return out;
}
function listFolderShallow(dir, label) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true })
        .filter(e => !e.name.startsWith('.'))
        .map(e => ({ name: e.name, kind: e.isDirectory() ? 'folder' : 'file', path: path.join(dir, e.name), source: label }));
}
async function listInstalledScripts() {
    const items = [];
    for (const ae of aeAppDirs()) {
        items.push(...listFolderShallow(path.join(ae, 'Scripts'),               'AE.Scripts'));
        items.push(...listFolderShallow(path.join(ae, 'Scripts', 'ScriptUI Panels'), 'AE.ScriptUI Panels'));
        items.push(...listFolderShallow(path.join(ae, 'Scripts', 'Startup'),    'AE.Startup'));
    }
    for (const doc of userPresetDirs()) items.push(...listFolderShallow(doc, 'User.Presets'));
    return { count: items.length, items };
}
// User Presets live under the user's Documents folder on both platforms, but
// NEITHER half of that path is fixed, and the original version of this function
// got both wrong (so it had never returned a single dir, on either platform):
//   1. The AE folder is named "After Effects 2026" — no "Adobe " prefix — and
//      there are also "After Effects" / "After Effects (Beta)" variants. Match
//      the optional prefix and let the User Presets existence check filter.
//   2. "Documents" itself moves. On Windows it is routinely redirected into
//      OneDrive and localized: on a pt-BR machine the real path is
//      "%OneDrive%\\Documentos", so homedir()/Documents does not exist at all.
//      Probe the OneDrive roots plus the home dir and accept any child matching
//      /^Document/i (Documents, Documentos, Documenti, Dokumente...), which
//      avoids shelling out to the registry for the shell folder path — the panel
//      must not fork while ExtendScript may be allocating.
// Every step is a SHALLOW readdir, so this never walks into a cloud-synced tree.
function docsAdobeDirs() {
    const roots = [];
    const pushRoot = (p) => { if (p && roots.indexOf(p) === -1) roots.push(p); };
    if (IS_WIN) {
        pushRoot(process.env.OneDrive);
        pushRoot(process.env.OneDriveConsumer);
        pushRoot(process.env.OneDriveCommercial);
    }
    pushRoot(os.homedir());
    const out = [];
    for (const root of roots) {
        let entries;
        try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { continue; }
        for (const e of entries) {
            if (!e.isDirectory() || !/^Document/i.test(e.name)) continue;
            const adobe = path.join(root, e.name, 'Adobe');
            try { if (fs.existsSync(adobe) && out.indexOf(adobe) === -1) out.push(adobe); } catch (_) { /* unreadable */ }
        }
    }
    return out;
}
function userPresetDirs() {
    const dirs = [];
    for (const docs of docsAdobeDirs()) {
        let names;
        try { names = fs.readdirSync(docs); } catch (_) { continue; }
        for (const n of names) {
            if (!/^(Adobe )?After Effects\b/i.test(n)) continue;
            const d = path.join(docs, n, 'User Presets');
            try { if (fs.existsSync(d) && dirs.indexOf(d) === -1) dirs.push(d); } catch (_) { /* unreadable */ }
        }
    }
    return dirs;
}
async function listInstalledExtensions() {
    const items = [];
    if (IS_WIN) {
        const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
        items.push(...listFolderShallow(path.join(pf86, 'Common Files', 'Adobe', 'CEP', 'extensions'), 'system'));
        items.push(...listFolderShallow(path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Adobe', 'CEP', 'extensions'), 'user'));
    } else {
        items.push(...listFolderShallow('/Library/Application Support/Adobe/CEP/extensions', 'system'));
        items.push(...listFolderShallow(path.join(os.homedir(), 'Library/Application Support/Adobe/CEP/extensions'), 'user'));
    }
    return { count: items.length, items };
}
async function listInstalledPlugins() {
    const items = [];
    for (const ae of aeAppDirs()) {
        items.push(...listFolderShallow(path.join(ae, 'Plug-ins'), 'AE.Plug-ins'));
    }
    // Windows has no per-user MediaCore — the Program Files one is the only path AE scans.
    items.push(...listFolderShallow(
        IS_WIN
            ? path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Adobe', 'Common', 'Plug-ins', '7.0', 'MediaCore')
            : '/Library/Application Support/Adobe/Common/Plug-ins/7.0/MediaCore',
        'Common.MediaCore'));
    return { count: items.length, items };
}

// ---------- whisper VO timing ----------
const { spawn } = require('child_process');
const os = require('os');

function spawnAsync(cmd, args, { stdoutCapture = false, onStderr = null, timeoutMs = 600000 } = {}) {
    return new Promise((resolve, reject) => {
        let stdout = '', stderr = '';
        const child = spawn(cmd, args, { env: process.env });
        const timer = setTimeout(() => {
            try { child.kill('SIGKILL'); } catch (_) {}
            reject(new Error(cmd + ' timed out after ' + timeoutMs + 'ms'));
        }, timeoutMs);
        child.stdout.on('data', (d) => { if (stdoutCapture) stdout += d.toString('utf8'); });
        child.stderr.on('data', (d) => {
            const s = d.toString('utf8');
            stderr += s;
            if (onStderr) onStderr(s);
        });
        child.on('error', (err) => { clearTimeout(timer); reject(err); });
        child.on('close', (code) => {
            clearTimeout(timer);
            if (code === 0) resolve({ stdout, stderr });
            else reject(new Error(cmd + ' exited with code ' + code + ': ' + stderr.split('\n').filter(Boolean).slice(-5).join('\n')));
        });
    });
}

// ---------- ffmpeg silence-snap (1.5) ----------
// GUI-spawned children get a minimal PATH (no Homebrew), so resolve ffmpeg by
// ABSOLUTE path across the common install prefixes; return null if none is present.
function resolveFfmpegPath() {
    const cands = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/local/bin/ffmpeg'];
    for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch (_) {} }
    return null;
}
// Run ffmpeg silencedetect and parse the silence_start onsets (seconds) from stderr.
// silencedetect logs to stderr; -f null discards the decoded output.
async function detectSilenceStarts(ffmpegPath, audioPath) {
    const { stderr } = await spawnAsync(ffmpegPath, [
        '-hide_banner', '-nostats',
        '-i', audioPath,
        '-af', 'silencedetect=noise=-35dB:d=0.15',
        '-f', 'null', '-'
    ], { stdoutCapture: false });
    const starts = [];
    const re = /silence_start:\s*(-?[0-9.]+)/g;
    let m;
    while ((m = re.exec(stderr)) !== null) {
        const v = parseFloat(m[1]);
        if (!isNaN(v)) starts.push(v);
    }
    return starts;
}

async function whisperTranscribe(params) {
    let audioPath = params.path;
    let fps = 24;
    if (!audioPath) {
        if (!params.layer) throw new Error('whisper_transcribe needs either path or layer');
        const info = await callJsxDispatch('get_layer_audio_info', { comp: params.comp, layer: params.layer });
        audioPath = info.path;
        fps = info.fps;
    } else if (params.comp) {
        // try to resolve fps from comp; fall back to 24
        try {
            const list = await callJsxDispatch('list_compositions', {});
            const target = list.comps.find(c => String(c.id) === String(params.comp) || c.name === params.comp);
            if (target) fps = target.fps;
        } catch (_) {}
    }
    if (!fs.existsSync(audioPath)) throw new Error('audio file not found: ' + audioPath);

    const whisperCmd = process.env.WHISPER_CMD || 'whisper';
    const model = params.model || 'base';
    const outDir = path.join(os.tmpdir(), 'ae-portal-whisper-' + Date.now());
    fs.mkdirSync(outDir, { recursive: true });

    const cliArgs = [
        audioPath,
        '--model', model,
        '--output_format', 'json',
        '--word_timestamps', 'True',
        '--output_dir', outDir,
        '--verbose', 'False'
    ];
    if (params.language) cliArgs.push('--language', params.language);

    log('whisper: ' + whisperCmd + ' ' + cliArgs.join(' '), 'info');
    try {
        await spawnAsync(whisperCmd, cliArgs, {
            stdoutCapture: false,
            onStderr: (s) => { /* whisper writes its progress to stderr */ }
        });
    } catch (e) {
        if (/ENOENT/.test(e.message) || /not found|spawn/.test(e.message)) {
            throw new Error('whisper CLI not found. Install: pip install -U openai-whisper, or set WHISPER_CMD env var.');
        }
        throw e;
    }

    // read produced JSON
    const baseName = path.basename(audioPath).replace(/\.[^.]+$/, '');
    const jsonPath = path.join(outDir, baseName + '.json');
    if (!fs.existsSync(jsonPath)) throw new Error('whisper output missing: ' + jsonPath);
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

    const words = [];
    for (const seg of data.segments || []) {
        for (const w of (seg.words || [])) {
            const word = String(w.word || '').replace(/^\s+/, '');
            const start = Number(w.start);
            const end   = Number(w.end);
            words.push({
                word,
                start, end,
                duration: end - start,
                frame:      Math.round(start * fps),
                frameStart: Math.round(start * fps),
                frameEnd:   Math.round(end * fps),
                time: start
            });
        }
    }

    // 1.5 snapToSilence (opt-in): extend each word's end to the next real silence
    // onset, with a minimum 0.30s pad past Whisper's (early) end. Degrades to a note
    // if ffmpeg is absent or detection fails — never errors the transcription.
    let snapNote = null;
    if (params.snapToSilence && words.length) {
        const ffmpegPath = resolveFfmpegPath();
        if (!ffmpegPath) {
            snapNote = 'snapToSilence skipped: ffmpeg not found (/opt/homebrew/bin, /usr/local/bin, /opt/local/bin)';
        } else {
            try {
                const starts = await detectSilenceStarts(ffmpegPath, audioPath);
                const MIN_PAD = 0.30;
                for (let i = 0; i < words.length; i++) {
                    const w = words[i];
                    const nextStart = (i + 1 < words.length) ? words[i + 1].start : Infinity;
                    // first silence onset at/after this word's (early) Whisper end
                    let boundary = null;
                    for (let k = 0; k < starts.length; k++) {
                        if (starts[k] >= w.end) { boundary = starts[k]; break; }
                    }
                    let newEnd = w.end + MIN_PAD;                              // minimum pad
                    if (boundary != null && boundary > newEnd) newEnd = boundary;
                    if (newEnd > nextStart) newEnd = Math.max(w.end, nextStart); // never overlap next word
                    if (newEnd < w.end) newEnd = w.end;                        // never shorten
                    w.end = newEnd;
                    w.duration = w.end - w.start;
                    w.frameEnd = Math.round(w.end * fps);
                }
                snapNote = 'snapToSilence: applied (' + starts.length + ' silence onsets, min pad ' + MIN_PAD + 's)';
            } catch (e) {
                snapNote = 'snapToSilence skipped: silence detection failed: ' + e.message;
            }
        }
    }

    // cleanup output dir but keep json file path for debugging? Just remove all.
    try {
        for (const f of fs.readdirSync(outDir)) fs.unlinkSync(path.join(outDir, f));
        fs.rmdirSync(outDir);
    } catch (_) {}

    return {
        path: audioPath,
        fps,
        language: data.language || params.language || null,
        text: data.text || null,
        wordCount: words.length,
        duration: words.length ? words[words.length - 1].end : 0,
        snapToSilence: !!params.snapToSilence,
        snapNote: snapNote,
        words
    };
}

// ---------- main command dispatch (called by transport) ----------
async function onCommand(msg) {
    if (!msg || !msg.method) throw new Error('missing method');
    const m = msg.method;
    if (PANEL_METHODS[m]) return PANEL_METHODS[m](msg.params || {});
    return callJsxDispatch(m, msg.params || {});
}

// ---------- discovery file ----------
// Advertise this AE to the MCP server: write ~/.mark/instances/<port>.json
// with our AE version + the actual bound port. The single server scans that dir
// to discover every running AE — no hardcoded version→port map to keep in sync.
const DISCOVERY_DIR = path.join(os.homedir(), '.mark', 'instances');
let lastPong = null;                    // last successful host ping (version/project)
let discoveryPort = null;               // port our discovery file is written under
let discoveryHeartbeatTimer = null;
function discoveryFilePath(port) { return path.join(DISCOVERY_DIR, port + '.json'); }
function writeDiscoveryFile(port) {
    try {
        if (!fs.existsSync(DISCOVERY_DIR)) fs.mkdirSync(DISCOVERY_DIR, { recursive: true });
        const major = lastPong ? parseInt(String(lastPong.aeVersion || '').split('.')[0], 10) : null;
        const rec = {
            port: port,
            aeVersion: lastPong ? lastPong.aeVersion : null,
            major: (major && !isNaN(major)) ? major : null,
            buildName: lastPong ? lastPong.buildName : null,
            projectFile: lastPong ? lastPong.projectFile : null,
            bundleId: 'tools.transversal.mark',
            token: PANEL_TOKEN || null,
            pid: (typeof process !== 'undefined' && process.pid) ? process.pid : null,
            startedAt: Date.now(),
            heartbeat: Date.now(),
            // 1.2 host-liveness: last successful JSX dispatch. Server reports
            // hostResponsive from this; JSON.stringify drops `clients` when undefined,
            // so an old panel (no transport) degrades gracefully server-side.
            lastHostOkAt: lastHostOkAt || null,
            clients: transport ? transport.clientCount() : undefined
        };
        const fp = discoveryFilePath(port);
        fs.writeFileSync(fp, JSON.stringify(rec));
        // Restrict to owner — keeps the token out of other users' reach on shared machines.
        try { fs.chmodSync(fp, 0o600); } catch (_) {}
        discoveryPort = port;
    } catch (e) { log('discovery write failed: ' + e.message, 'warn'); }
}
function touchDiscoveryFile() {
    if (discoveryPort == null) return;
    try {
        const fp = discoveryFilePath(discoveryPort);
        if (!fs.existsSync(fp)) return writeDiscoveryFile(discoveryPort);
        const rec = JSON.parse(fs.readFileSync(fp, 'utf8'));
        rec.heartbeat = Date.now();
        rec.lastHostOkAt = lastHostOkAt || null;                  // 1.2 refresh host-liveness each beat
        if (transport) rec.clients = transport.clientCount();     // 1.2 live connected-client count
        if (lastPong) rec.projectFile = lastPong.projectFile;
        if (!rec.token && PANEL_TOKEN) rec.token = PANEL_TOKEN;   // keep the secret present across heartbeats
        fs.writeFileSync(fp, JSON.stringify(rec));
        try { fs.chmodSync(fp, 0o600); } catch (_) {}
    } catch (_) {}
}
function startDiscoveryHeartbeat() {
    if (discoveryHeartbeatTimer) clearInterval(discoveryHeartbeatTimer);
    discoveryHeartbeatTimer = setInterval(touchDiscoveryFile, 5000);
}
function removeDiscoveryFile() {
    if (discoveryHeartbeatTimer) { clearInterval(discoveryHeartbeatTimer); discoveryHeartbeatTimer = null; }
    if (discoveryPort == null) return;
    try { fs.unlinkSync(discoveryFilePath(discoveryPort)); } catch (_) {}
    discoveryPort = null;
}

// ---------- transport ----------
let transport = null;
function startTransport() {
    if (transport) { transport.stop(); transport = null; }
    removeDiscoveryFile();
    transport = new Transport({
        port: settings.port,
        token: PANEL_TOKEN,
        onCommand: async (msg, client) => {
            ui.sLast.textContent = msg.method;
            // Mark: the Log tab (client/mark-activity.js) records who called what.
            const act = (typeof window !== 'undefined' && window.markActivity) || null;
            const entry = act ? act.begin(msg, client) : null;
            try {
                const r = await onCommand(msg);
                if (act) act.end(entry, true, r); else log('← ' + msg.method, 'ok');
                return r;
            } catch (e) {
                if (act) act.end(entry, false, e.message);
                log('✗ ' + msg.method + ': ' + e.message, 'err');
                throw e;
            }
        },
        onClients: (what, client) => {
            if (typeof window !== 'undefined' && window.markActivity) window.markActivity.clients(what, client);
        },
        onStatus: (s) => {
            // Mark: connect/auth lines are shown by name in the Log tab instead.
            if (!/^client (connected|authenticated|disconnected)/.test(s.message)) {
                log(s.message, s.level === 'error' ? 'err' : (s.level === 'ok' ? 'ok' : 'info'));
            }
            // Server is listening: record the ACTUAL bound port (differs if the
            // derived port was taken by another same-version panel) and advertise it.
            if (s.level === 'ok' && s.port != null) {
                settings.port = s.port;
                ui.sPort.textContent = s.port;
                if (ui.cfgPort) ui.cfgPort.value = s.port;
                writeDiscoveryFile(s.port);
                startDiscoveryHeartbeat();
            }
            ui.sClients.textContent = transport ? transport.clientCount() : 0;
            updateConnDot();
        }
    });
    transport.start();
    if (!PANEL_TOKEN) log('WARNING: no auth token generated — connections are NOT authenticated', 'warn');
    ui.sPort.textContent = settings.port;
    updateConnDot();
}
function updateConnDot() {
    const n = transport ? transport.clientCount() : 0;
    ui.dot.classList.toggle('ok', n > 0);
    ui.dot.classList.toggle('warn', n === 0 && transport != null);
    if (n === 0 && transport == null) {
        ui.dot.classList.remove('ok'); ui.dot.classList.remove('warn');
    }
}

// Re-load settings under this AE version's key and derive the port BEFORE the
// transport binds — so the port is right on the first bind, with no flip/restart.
function applyVersion(pong) {
    lastPong = pong;
    settingsMajor = parseInt(String(pong.aeVersion || '').split('.')[0], 10) || null;
    settings = loadSettings(settingsMajor);
    ui.cfgAutomap.value = settings.automap;
    if (settings.portMode !== 'manual') settings.port = portForVersion(pong.aeVersion);
    ui.cfgPort.value = settings.port;
    if (ui.cfgAutoPort) ui.cfgAutoPort.checked = (settings.portMode !== 'manual');
    applyManualOpen();
}

// ---------- bootstrap: load host then start transport ----------
async function bootstrap() {
    log('panel loaded, node ' + process.versions.node);
    // The manifest's ScriptPath auto-loads host/index.jsx. Confirm with a ping, and keep
    // trying for about a minute: at AE start the host can be missing or busy while
    // other panels load (callJsxDispatch reloads it when it is missing).
    const BOOT_RETRY_MS = [1000, 2000, 4000, 8000, 15000, 15000, 15000];
    for (let attempt = 1; ; attempt++) {
        try {
            const pong = await callJsxDispatch('ping', {});
            ui.sAe.textContent = pong.aeVersion + (pong.buildName ? ' (' + pong.buildName + ')' : '');
            ui.sProject.textContent = pong.projectFile ? path.basename(pong.projectFile) : 'untitled';
            applyVersion(pong);
            log('host alive, AE ' + pong.aeVersion + ' (boot ping ' + attempt + ': ' + JSON.stringify(pong).slice(0, 160) + ')', 'ok');
            break;
        } catch (e) {
            const wait = BOOT_RETRY_MS[attempt - 1];
            log('boot ping ' + attempt + ' failed: ' + e.message + (wait ? ' Trying again in ' + (wait / 1000) + ' s.' : ' Giving up; the watchdog keeps checking.'), wait ? 'warn' : 'err');
            if (!wait) break;
            await sleepMs(wait);
        }
    }
    startTransport();
    startHostWatchdog();

    // Auto-map on open if configured
    if (settings.automap !== 'off') {
        try {
            const map = await callJsxDispatch('get_project_map', { mode: settings.automap });
            ui.sProject.textContent = (map.displayName || 'untitled') +
                ' · ' + map.compCount + ' comps · ' + (map.totalLayers || 0) + ' layers';
            log('auto-map (' + settings.automap + ') ok', 'ok');
        } catch (e) {
            log('auto-map failed: ' + e.message, 'warn');
        }
    }

    // Live event polling (selection_changed, comp_opened, etc.)
    startLiveEvents();
    log('live events polling (' + POLL_FAST + '–' + POLL_IDLE + 'ms adaptive)', 'info');

    // Restore watch log if JSX has entries from a previous session
    await loadExistingWatchLog();
}

// ---------- UI wiring ----------
ui.settingsBtn.addEventListener('click', (e) => {
    if (e.altKey) return openDebugOverlay();
    ui.settingsPane.classList.toggle('hidden');
});
ui.manualToggle.addEventListener('click', () => {
    const open = ui.manualPane.classList.contains('collapsed');
    settings.manualOpen = open;
    applyManualOpen();
    saveSettings(settings);
    if (open) ui.cmdInput.focus();
});
ui.restartBtn.addEventListener('click', () => {
    const auto = ui.cfgAutoPort ? ui.cfgAutoPort.checked : true;
    if (auto) {
        settings.portMode = 'auto';
        if (lastPong) settings.port = portForVersion(lastPong.aeVersion);
    } else {
        settings.portMode = 'manual';
        settings.port = parseInt(ui.cfgPort.value, 10) || DEFAULTS.port;
    }
    settings.automap = ui.cfgAutomap.value;
    saveSettings(settings);
    log('restarting transport on port ' + settings.port + ' (' + settings.portMode + ')');
    startTransport();
});
ui.cfgAutomap.addEventListener('change', () => {
    settings.automap = ui.cfgAutomap.value;
    saveSettings(settings);
});
if (ui.cfgAutoPort) {
    // Toggling auto previews the version-derived port; manual frees the field.
    ui.cfgAutoPort.addEventListener('change', () => {
        if (ui.cfgAutoPort.checked) {
            ui.cfgPort.value = lastPong ? portForVersion(lastPong.aeVersion) : DEFAULTS.port;
            ui.cfgPort.disabled = true;
        } else {
            ui.cfgPort.disabled = false;
        }
    });
}
// Clean up the discovery file when the panel closes so the server stops
// listing this AE immediately (crashes are covered by the heartbeat going stale).
window.addEventListener('beforeunload', () => {
    try { removeDiscoveryFile(); } catch (_) {}
    try { if (transport) transport.stop(); } catch (_) {}
});

ui.cmdRun.addEventListener('click', () => runManualCommand(ui.cmdInput.value));
ui.cmdInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runManualCommand(ui.cmdInput.value);
});
document.querySelectorAll('.cmd-shortcuts button').forEach((b) => {
    b.addEventListener('click', () => {
        ui.cmdInput.value = b.dataset.cmd;
        runManualCommand(b.dataset.cmd);
    });
});
ui.copyServerPath.addEventListener('click', () => {
    if (!SERVER_JS_PATH) return log('server path not found next to the panel', 'warn');
    ui.cfgServerPath.select();
    document.execCommand('copy');
    log('copied MCP server path');
});
ui.copyResult.addEventListener('click', () => {
    const sel = window.getSelection();
    sel.removeAllRanges();
    const range = document.createRange();
    range.selectNode(ui.resultPane);
    sel.addRange(range);
    document.execCommand('copy');
    sel.removeAllRanges();
    log('copied');
});

// Reload button:
//   - Click       → reload the CEP panel (full HTML/CSS/JS reload)
//   - Alt+click   → reload the JSX host only (re-eval index.jsx; faster for mark-actions.jsx edits)
ui.reloadBtn.addEventListener('click', async (ev) => {
    if (ui.reloadBtn.classList.contains('spinning')) return;
    if (ev.altKey){
        // Alt+click: legacy host-only reload
        ui.reloadBtn.classList.add('spinning');
        log('→ reload_host (Alt+click)');
        try {
            const r = await PANEL_METHODS.reload_host();
            log('✓ host reloaded · ' + (r.evalFileResult || 'ok'), 'ok');
            try {
                const pong = await callJsxDispatch('ping', {});
                ui.sAe.textContent = pong.aeVersion + (pong.buildName ? ' (' + pong.buildName + ')' : '');
                ui.sProject.textContent = pong.projectFile ? path.basename(pong.projectFile) : 'untitled';
            } catch (_) {}
        } catch (e) {
            log('✗ reload_host: ' + e.message, 'err');
        } finally {
            ui.reloadBtn.classList.remove('spinning');
        }
        return;
    }
    // Plain click: reload the panel itself
    log('→ reloading panel…');
    setTimeout(() => { window.location.reload(); }, 50);
});

ui.consoleClear.addEventListener('click', () => {
    while (ui.consoleLog.firstChild) ui.consoleLog.removeChild(ui.consoleLog.firstChild);
});

ui.consoleCopyErrors.addEventListener('click', () => {
    const lines = ui.consoleLog.querySelectorAll('.line.err, .line.warn');
    if (!lines.length) { log('no errors to copy', 'info'); return; }
    const text = Array.from(lines).map((el) => el.innerText).join('\n');
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
    document.body.removeChild(ta);
    log(ok ? ('copied ' + lines.length + ' line(s)') : 'copy failed', ok ? 'ok' : 'err');
});

// ---------- manual command hard-block lint (0.1 panel mirror) ----------
// Mirror the server-side run_jsx hard-block set for the manual box: a script body
// carrying one of these patterns is refused on the first Run, with a warning line
// naming the pattern and why. Click Run again with the same text within 10s to
// override (no modal, no extra UI — log lines only).
const MANUAL_HARD_BLOCK = [
    { pat: 'app.executeCommand(', why: 'undocumented menu IDs — caused data loss' },
    { pat: 'system.callSystem(',  why: 'forks a process inside AE — deadlock risk' },
    { pat: 'app.newProject(',     why: 'modal trap on a dirty project — freezes AE' },
    { pat: 'app.open(',           why: 'modal trap on a dirty project — freezes AE' }
];
const MANUAL_LINT_WINDOW_MS = 10000;
let manualLintArmed = null;             // { text, at } of the last flagged submission
function manualHardBlockHit(params) {
    // Only lint run_jsx-like commands: those carrying a script body.
    const script = (params && typeof params.script === 'string') ? params.script : '';
    if (!script) return null;
    for (const h of MANUAL_HARD_BLOCK) {
        if (script.indexOf(h.pat) !== -1) return h;
    }
    return null;
}

async function runManualCommand(text) {
    const trimmed = (text || '').trim();
    if (!trimmed) return;
    const sp = trimmed.indexOf(' ');
    const method = sp === -1 ? trimmed : trimmed.slice(0, sp);
    const argsRaw = sp === -1 ? '' : trimmed.slice(sp + 1).trim();
    let params = {};
    if (argsRaw) {
        try { params = JSON.parse(argsRaw); }
        catch (e) {
            ui.resultPane.textContent = 'Bad JSON args: ' + e.message;
            log('bad JSON args: ' + e.message, 'err');
            return;
        }
    }
    const hit = manualHardBlockHit(params);
    if (hit) {
        const now = Date.now();
        const armed = manualLintArmed && manualLintArmed.text === trimmed &&
            (now - manualLintArmed.at) < MANUAL_LINT_WINDOW_MS;
        if (!armed) {
            manualLintArmed = { text: trimmed, at: now };
            log('BLOCKED "' + hit.pat + '" — ' + hit.why + '. Click Run again within 10s to override.', 'warn');
            return;
        }
        manualLintArmed = null;
        log('override: sending "' + hit.pat + '" as requested', 'warn');
    }
    log('→ ' + method);
    ui.sLast.textContent = method;
    try {
        const r = await onCommand({ method, params });
        ui.resultPane.textContent = typeof r === 'string' ? r : JSON.stringify(r, null, 2);
        log('✓ ' + method, 'ok');
    } catch (e) {
        ui.resultPane.textContent = 'ERROR: ' + e.message;
        log('✗ ' + method + ': ' + e.message, 'err');
    }
}

// ---------- debug overlay (Alt+click on settings) ----------
function openDebugOverlay() {
    let overlay = document.getElementById('debug-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'debug-overlay';
        overlay.innerHTML =
            '<div style="display:flex;justify-content:space-between;align-items:center">' +
                '<span style="color:#888;font-size:10px">select all & copy (Cmd+A · Cmd+C)</span>' +
                '<button id="debug-close" style="background:none;border:1px solid #555;color:#aaa;padding:2px 8px;cursor:pointer;border-radius:3px">✕</button>' +
            '</div>' +
            '<textarea id="debug-ta" readonly></textarea>';
        document.body.appendChild(overlay);
        document.getElementById('debug-close').addEventListener('click', () => overlay.remove());
    }
    const ta = document.getElementById('debug-ta');
    ta.value = 'Loading…';
    callJsxDispatch('get_project_map', { mode: 'light' })
        .then((m) => { ta.value = JSON.stringify(m, null, 2); ta.focus(); ta.select(); })
        .catch((e) => { ta.value = 'ERROR: ' + e.message; });
}

// ---------- watch mode ----------
const watch = {
    active: false,
    readIndex: 0,
    timer: null,
    allEntries: []
};

function fmtVal(v) {
    if (Array.isArray(v)) return '[' + v.map((n) => (typeof n === 'number' ? Math.round(n * 100) / 100 : n)).join(', ') + ']';
    if (typeof v === 'number') return String(Math.round(v * 100) / 100);
    return String(v);
}

function renderWatchEntry(e) {
    const el = document.createElement('div');
    el.className = 'we';
    const badge = { value: 'val', key_add: '+key', key_del: '-key', key_mod: '~key' }[e.change] || e.change;
    const oldStr = (e.old != null) ? fmtVal(e.old) + ' → ' : '';
    const valStr = fmtVal(e.value != null ? e.value : (e.count != null ? e.count + 'x' : ''));
    const timeStr = (e.time != null) ? ' @' + (Math.round(e.time * 100) / 100) + 's' : '';
    el.innerHTML =
        '<span class="we-ts">' + e.ts + '</span>' +
        '<span class="we-layer">' + escapeHtml(e.layer) + '</span>' +
        '<span class="we-prop">› ' + escapeHtml(e.prop) + '</span>' +
        '<span class="we-badge ' + e.change + '">' + badge + '</span>' +
        '<span class="we-val">' + escapeHtml(oldStr + valStr + timeStr) + '</span>';
    return el;
}

function appendWatchEntries(entries) {
    for (const e of entries) {
        watch.allEntries.push(e);
        ui.watchEntries.appendChild(renderWatchEntry(e));
    }
    ui.watchEntries.scrollTop = ui.watchEntries.scrollHeight;
    ui.watchCount.textContent = watch.allEntries.length || '';
}

async function pollWatchLog() {
    // Skip while a JSX dispatch holds the AE thread (0.2); the interval fires again
    // in 400ms and the max-pause cap in pollersShouldSkip() prevents going blind.
    if (pollersShouldSkip()) return;
    try {
        const r = await callJsxDispatch('watch_get_log', { since: watch.readIndex });
        if (r.entries && r.entries.length) {
            appendWatchEntries(r.entries);
            watch.readIndex = r.total;
            for (const e of r.entries) {
                try { transport.broadcast('watch_change', e); } catch (_) {}
            }
        }
    } catch (_) {}
}

async function loadExistingWatchLog() {
    try {
        const r = await callJsxDispatch('watch_get_log', { since: 0 });
        if (r.total > 0) {
            watch.allEntries = [];
            while (ui.watchEntries.firstChild) ui.watchEntries.removeChild(ui.watchEntries.firstChild);
            appendWatchEntries(r.entries);
            watch.readIndex = r.total;
            ui.watchPane.classList.remove('hidden');
        }
    } catch (_) {}
}

async function startWatch() {
    try {
        // Load any entries already in the JSX log before activating
        await loadExistingWatchLog();
        await callJsxDispatch('watch_start', {});
        watch.active = true;
        ui.watchBtn.classList.add('active');
        ui.watchPane.classList.remove('hidden');
        log('watch started', 'ok');
        watch.timer = setInterval(pollWatchLog, 400);
    } catch (e) {
        log('watch_start failed: ' + e.message, 'err');
    }
}

async function stopWatch() {
    try { await callJsxDispatch('watch_stop', {}); } catch (_) {}
    watch.active = false;
    clearInterval(watch.timer);
    watch.timer = null;
    ui.watchBtn.classList.remove('active');
    // keep pane visible so the log stays readable after stopping
    log('watch stopped — ' + watch.allEntries.length + ' entries recorded', 'info');
}

ui.watchBtn.addEventListener('click', () => watch.active ? stopWatch() : startWatch());

ui.watchClearBtn.addEventListener('click', async () => {
    try { await callJsxDispatch('watch_clear', {}); } catch (_) {}
    watch.allEntries = [];
    watch.readIndex = 0;
    while (ui.watchEntries.firstChild) ui.watchEntries.removeChild(ui.watchEntries.firstChild);
    ui.watchCount.textContent = '';
});

ui.watchCopyMcp.addEventListener('click', () => {
    if (!watch.allEntries.length) { log('watch log is empty', 'info'); return; }
    const lines = watch.allEntries.map((e) => {
        if (e.change === 'key_add') {
            return `add_keyframe comp="${e.comp}" layer="${e.layer}" prop="${e.mn || e.prop}" time=${e.time} value=${JSON.stringify(e.value)}`;
        }
        if (e.change === 'key_mod') {
            return `set_property comp="${e.comp}" layer="${e.layer}" prop="${e.mn || e.prop}" time=${e.time} value=${JSON.stringify(e.value)}`;
        }
        if (e.change === 'value') {
            return `set_property comp="${e.comp}" layer="${e.layer}" prop="${e.mn || e.prop}" value=${JSON.stringify(e.value)}`;
        }
        return `# ${e.ts} ${e.layer} › ${e.prop}: ${e.change}`;
    });
    const text = lines.join('\n');
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) {}
    document.body.removeChild(ta);
    log(ok ? 'copied ' + lines.length + ' MCP call(s)' : 'copy failed', ok ? 'ok' : 'err');
});

// ---------- run ----------
window.addEventListener('error', (e) => log('JS error: ' + e.message, 'err'));
bootstrap().catch((e) => log('bootstrap failed: ' + e.message, 'err'));
