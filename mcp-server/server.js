#!/usr/bin/env node
// AE Portal MCP server.
// Hand-rolled JSON-RPC 2.0 over stdio. No external dependencies.
//
// stdin/stdout: JSON-RPC traffic with the MCP client.
// stderr:       human-readable logs (Claude Code shows these in the MCP panel).

const { TransportClient, TransportPool, setIdentity } = require('./transport');
const { TOOLS, dispatchTool } = require('./tools');
const RESOURCES = require('./resources');
const FOCUS = require('./focus-guard');
const INSTRUCTIONS = require('./instructions');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const PROTOCOL_VERSION = '2024-11-05';
// Single-source the version from package.json (repo root) so it never drifts from
// the published package. Fallback to the canonical 0.2.0 if the file can't be read.
let PKG_VERSION = '0.2.0';
try { PKG_VERSION = require('../package.json').version || PKG_VERSION; } catch (_) {}
const SERVER_INFO = { name: 'mark', version: PKG_VERSION };

const log = (...args) => {
    try { process.stderr.write('[mark] ' + args.join(' ') + '\n'); } catch (_) {}
};

// ---------- 1.1: orphan-server reaping ----------
// Multiple mcp-server processes legitimately attach to one AE Portal panel at once
// (concurrent Claude sessions each spawn their own server) — that is NOT a bug, and
// we must never kill a sibling just because "another server exists". We only ever
// reap true ORPHANS: a server whose real parent (the MCP client that spawned it)
// has died, reparenting this process to launchd (pid 1). `process.ppid` is a live
// read on this Node — a reparented child reads ppid===1 the instant its parent is
// gone (verified empirically on this runtime). Anything with ppid!==1 has a live
// parent and is left strictly alone.
// Kill-switch: set AE_PORTAL_NO_REAP to disable BOTH mechanisms below (test harness).
const NO_REAP = !!process.env.AE_PORTAL_NO_REAP;
const SELF_SERVER_PATH = path.join(__dirname, 'server.js');

// (a) Startup reap: enumerate other `server.js` processes and SIGTERM any that are
// BOTH ours (command line contains this exact absolute path) AND orphaned (ppid===1).
function reapOrphanServers() {
    try {
        // -ww disables ps's terminal-width truncation of the COMMAND column, which
        // would otherwise cut off the tail of a long absolute path. Args passed as
        // an array (no shell string) per the no-shell-injection rule.
        execFile('ps', ['-axwwo', 'pid,ppid,command'], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
            if (err || !stdout) return;   // best-effort; a ps failure is not fatal
            const lines = stdout.split('\n');
            for (let i = 1; i < lines.length; i++) {   // i=1 skips the header row
                const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(lines[i]);
                if (!m) continue;
                const pid = Number(m[1]);
                const ppid = Number(m[2]);
                const command = m[3];
                if (pid === process.pid) continue;                       // never touch self
                if (command.indexOf(SELF_SERVER_PATH) === -1) continue;  // not one of ours
                if (ppid !== 1) continue;                                // live parent = live session, leave it
                try {
                    process.kill(pid, 'SIGTERM');
                    log('startup reap: SIGTERM to orphaned server pid ' + pid + ' (ppid=1)');
                } catch (e) {
                    log('startup reap: failed to signal pid ' + pid + ': ' + e.message);
                }
            }
        });
    } catch (e) {
        log('startup reap error: ' + e.message);
    }
}
if (NO_REAP) log('orphan reaping disabled (AE_PORTAL_NO_REAP set)');
else reapOrphanServers();

// (b) Runtime self-exit (belt-and-suspenders). The normal shutdown path is the
// stdin 'end' handler further down, which fires the instant our real parent (the
// MCP client) closes the pipe — that already covers the common case. This only
// matters if that somehow didn't fire. Checked at low frequency (30s), requiring a
// SECOND confirmation 30s later (60s total) before acting, so a momentary read
// glitch can't cause a spurious exit.
let orphanDetectedAt = null;
let selfExitTimer = null;
const SELF_EXIT_CHECK_MS = 30000;
function selfExitCheck() {
    try {
        // Cheap guard: while stdin is still open/readable, our parent hasn't gone
        // through EOF yet — the 'end' handler owns shutdown in that case; don't
        // race it by also acting here.
        if (process.stdin.readable) { orphanDetectedAt = null; return; }
        if (process.ppid !== 1) { orphanDetectedAt = null; return; }
        if (orphanDetectedAt == null) {
            orphanDetectedAt = Date.now();
            log('ppid=1 detected (stdin already ended) — confirming over one more check before self-exit');
            return;
        }
        if (Date.now() - orphanDetectedAt >= SELF_EXIT_CHECK_MS) {
            log('confirmed orphaned (ppid=1 sustained ~' + SELF_EXIT_CHECK_MS + 'ms) — self-exiting');
            shutdown();
        }
    } catch (e) {
        log('self-exit check error: ' + e.message);
    }
}
if (!NO_REAP) selfExitTimer = setInterval(selfExitCheck, SELF_EXIT_CHECK_MS);

// ---------- event buffer (for get_recent_events tool) ----------
const MAX_EVENTS = 500;
const eventBuffer = [];
function pushEvent(name, data) {
    eventBuffer.push({ at: Date.now(), event: name, data: data || null });
    if (eventBuffer.length > MAX_EVENTS) eventBuffer.shift();
}
function emitEvent(name, data, instanceId) {
    // In discovery mode events are tagged with the instance that produced them.
    pushEvent(name, instanceId ? { instance: instanceId, payload: data } : data);
    send({ jsonrpc: '2.0', method: 'notifications/message', params: {
        level: 'info', logger: 'mark',
        data: instanceId ? { event: name, instance: instanceId, payload: data }
                         : { event: name, payload: data }
    }});
}

// ---------- discovery ----------
// Each panel writes ~/.mark/instances/<port>.json with its AE version and
// the actual bound port. The single server reads that dir to learn every
// running AE — no hardcoded version→port map to keep in sync (that mismatch is
// exactly what sank the earlier multi-instance attempt). The instance id is the
// AE marketing year (major 26 → '2026'), authored by the panel itself.
const DISCOVERY_DIR = process.env.AE_PORTAL_DISCOVERY_DIR
    || path.join(os.homedir(), '.mark', 'instances');
const DISCOVERY_STALE_MS = Number(process.env.AE_PORTAL_STALE_MS) || 20000;

// 1.2: parse the panel's OPTIONAL host-liveness fields off a discovery JSON blob.
// Mixed-version contract: an old panel omits both — downstream consumers must omit
// the derived `hostResponsive`/`clients` fields entirely rather than report a
// misleading false/0 when these come back null.
function parseHostMeta(j) {
    return {
        lastHostOkAt: (j && j.lastHostOkAt != null && isFinite(Number(j.lastHostOkAt))) ? Number(j.lastHostOkAt) : null,
        clients: (j && j.clients != null && isFinite(Number(j.clients))) ? Number(j.clients) : null
    };
}

function readDiscovery() {
    let files;
    try { files = fs.readdirSync(DISCOVERY_DIR); } catch (_) { return []; }
    const now = Date.now();
    const out = [];
    for (const fn of files) {
        if (!/\.json$/.test(fn)) continue;
        let j;
        try { j = JSON.parse(fs.readFileSync(path.join(DISCOVERY_DIR, fn), 'utf8')); } catch (_) { continue; }
        if (!j || !j.port) continue;
        const major = (j.major != null) ? Number(j.major)
            : (j.aeVersion ? parseInt(String(j.aeVersion), 10) : null);
        const beat = j.heartbeat || j.startedAt || 0;
        if (beat && (now - beat > DISCOVERY_STALE_MS)) continue;   // stale heartbeat → treat as dead
        const id = (major && !isNaN(major)) ? String(2000 + major) : String(j.port);
        // Shared-secret token authored by the panel. May be absent (older panel) —
        // then we connect without authenticating (mixed-version transition).
        out.push({ id, port: Number(j.port), token: (j.token ? String(j.token) : null), meta: Object.assign({
            major: (major && !isNaN(major)) ? major : null,
            aeVersion: j.aeVersion || null,
            project: j.projectFile || null
        }, parseHostMeta(j)) });
    }
    return out;
}

// ---------- transport: pinned single instance (legacy) vs discovery pool ----------
let transport;
let discoveryTimer = null;
let pinnedPort = null;   // set below when running pinned single-instance mode; hostMetaFor() needs it
// Best-effort: read the panel's discovery file for a port (token + optional
// host-liveness meta). Shared by pinned single-instance mode.
function readDiscoveryFileForPort(port) {
    try { return JSON.parse(fs.readFileSync(path.join(DISCOVERY_DIR, port + '.json'), 'utf8')); } catch (_) { return null; }
}
function tokenForPort(port) {
    const j = readDiscoveryFileForPort(port);
    return (j && j.token) ? String(j.token) : null;
}
function hostMetaForPort(port) {
    return parseHostMeta(readDiscoveryFileForPort(port));
}
// Mark: name this session for the panel's Log tab (see setIdentity in transport.js).
// The project is the folder the client started this server in. Over SSH that is the
// remote home folder, which says nothing, so the SSH client address is shown instead.
function appName(clientInfo) {
    if (process.env.AE_PORTAL_MARK_CHAT === '1') return 'Mark chat';
    const n = String((clientInfo && clientInfo.name) || '');
    if (/claude[-_ ]?code/i.test(n)) return 'Claude Code';
    if (/codex/i.test(n)) return 'Codex';
    if (/claude/i.test(n)) return 'Claude app';
    return n || 'MCP client';
}
const SERVER_STARTED_AT = Date.now();
function identityFor(clientInfo) {
    const ssh = String(process.env.SSH_CONNECTION || '').split(' ')[0] || null;
    return {
        app: appName(clientInfo),
        version: (clientInfo && clientInfo.version) || null,
        project: (ssh || process.env.AE_PORTAL_MARK_CHAT === '1') ? null : path.basename(process.cwd()),
        via: ssh ? 'ssh' : 'local',
        from: ssh,
        pid: process.pid,
        startedAt: SERVER_STARTED_AT
    };
}
setIdentity(identityFor(null));

if (process.env.AE_PORTAL_PORT) {
    pinnedPort = Number(process.env.AE_PORTAL_PORT) || 38967;
    transport = new TransportClient({
        host: process.env.AE_PORTAL_HOST || '127.0.0.1',
        port: pinnedPort,
        token: tokenForPort(pinnedPort),
        log,
        onEvent: (name, data) => emitEvent(name, data, null)
    });
    transport.connect();
    log('single-instance mode on :' + (Number(process.env.AE_PORTAL_PORT) || 38967));
} else {
    transport = new TransportPool({
        log,
        onEvent: (name, data, instanceId) => emitEvent(name, data, instanceId)
    });
    const tick = () => { try { transport.sync(readDiscovery()); } catch (e) { log('discovery scan error: ' + e.message); } };
    tick();
    discoveryTimer = setInterval(tick, Number(process.env.AE_PORTAL_SCAN_MS) || 2500);
    log('discovery mode, scanning ' + DISCOVERY_DIR);
}

// 1.2: resolves the SAME instance a routed tool call would target, and returns its
// optional host-liveness meta ({ lastHostOkAt, clients } or null). tools.js calls
// this (via process.__aePortalHostMeta) to derive `hostResponsive` on
// list_instances/ping without needing to know how discovery/pool routing works.
function hostMetaFor(idLike) {
    if (typeof transport.list === 'function') {
        // discovery pool mode — resolve the same instance a routed call would use.
        try {
            let id = null;
            if (idLike != null && String(idLike).trim() !== '') {
                id = transport._normalizeId(idLike);
            } else if (transport.activeId && transport.byId.has(transport.activeId)) {
                id = transport.activeId;
            } else {
                const conn = transport.connectedIds();
                if (conn.length === 1) id = conn[0];
            }
            if (id && transport.byId.has(id)) return transport.byId.get(id).meta || null;
        } catch (_) {}
        return null;
    }
    // pinned single-instance mode
    return pinnedPort ? hostMetaForPort(pinnedPort) : null;
}

// Expose for tools.js
process.__aePortalEvents = { buffer: eventBuffer, since: (ts) => eventBuffer.filter(e => e.at > ts) };
process.__aePortalHostMeta = hostMetaFor;

// ---------- stdio JSON-RPC framing ----------

let stdinBuf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
    stdinBuf += chunk;
    let nl;
    while ((nl = stdinBuf.indexOf('\n')) !== -1) {
        const line = stdinBuf.slice(0, nl).trim();
        stdinBuf = stdinBuf.slice(nl + 1);
        if (line) handleLine(line);
    }
});
process.stdin.on('end', () => process.exit(0));

function send(obj) {
    process.stdout.write(JSON.stringify(obj) + '\n');
}

function reply(id, result) {
    send({ jsonrpc: '2.0', id, result });
}

function replyError(id, code, message, data) {
    const error = { code, message };
    if (data !== undefined) error.data = data;
    send({ jsonrpc: '2.0', id, error });
}

async function handleLine(line) {
    let msg;
    try { msg = JSON.parse(line); }
    catch (e) {
        log('bad JSON from client:', e.message);
        return;
    }

    // Notification (no id) — process and don't reply.
    if (msg.id == null) {
        if (msg.method === 'notifications/initialized') return;
        if (msg.method === 'notifications/cancelled') return;
        return;
    }

    try {
        const result = await routeRequest(msg.method, msg.params || {});
        reply(msg.id, result);
    } catch (err) {
        const code = (err && err.code) || -32603;
        const message = (err && err.message) || String(err);
        replyError(msg.id, code, message);
    }
}

// ---------- MCP method routing ----------

// In discovery (pool) mode, advertise an optional `instance` arg on every
// panel-routed tool so clients can target a specific AE. Server-local tools
// (function panelMethods) don't route, so they're left untouched.
const INSTANCE_PROP = { type: 'string', description: 'Target a specific AE when more than one is connected (e.g. "2026", "2025", or a major like "26"). Omit when only one AE is open — see list_instances.' };
function withInstanceParam(tool) {
    if (typeof tool.panelMethod !== 'string') return tool.inputSchema;
    const schema = tool.inputSchema || { type: 'object' };
    if (schema.properties && schema.properties.instance) return schema;
    return Object.assign({}, schema, {
        type: schema.type || 'object',
        properties: Object.assign({}, schema.properties, { instance: INSTANCE_PROP })
    });
}

async function routeRequest(method, params) {
    switch (method) {
        case 'initialize':
            setIdentity(identityFor(params && params.clientInfo));
            return {
                protocolVersion: PROTOCOL_VERSION,
                capabilities: { tools: {}, resources: {} },
                serverInfo: SERVER_INFO,
                instructions: INSTRUCTIONS
            };

        case 'tools/list': {
            const poolMode = (typeof transport.list === 'function');
            return { tools: TOOLS.map(t => ({
                name: t.name,
                description: t.description,
                inputSchema: poolMode ? withInstanceParam(t) : t.inputSchema
            })) };
        }

        case 'resources/list':
            return { resources: await RESOURCES.list() };

        case 'resources/read': {
            const uri = params.uri;
            if (!uri) throw Object.assign(new Error('uri required'), { code: -32602 });
            const contents = await RESOURCES.read(uri);
            return { contents };
        }

        case 'tools/call': {
            const name = params.name;
            const args = params.arguments || {};
            const tool = TOOLS.find(t => t.name === name);
            if (!tool) {
                return {
                    content: [{ type: 'text', text: 'Unknown tool: ' + name }],
                    isError: true
                };
            }
            try {
                // Hand the front back if AE takes it during the call (macOS, focus-guard.js).
                const out = await FOCUS.guard(() => dispatchTool(transport, tool, args));
                // Tool can return MCP content directly via _mcpContent
                if (out && typeof out === 'object' && Array.isArray(out._mcpContent)) {
                    return { content: out._mcpContent };
                }
                let text;
                if (typeof out === 'string') {
                    text = out;
                } else {
                    // 2.1: compact-serialize first — results are model-read text, not
                    // human-formatted, so pretty-printing every result wastes tokens for
                    // no benefit past a few hundred bytes. Small results still get
                    // pretty-printed (null, 2) for readability; large ones stay compact.
                    const compact = JSON.stringify(out);
                    text = (Buffer.byteLength(compact, 'utf8') <= 4096) ? JSON.stringify(out, null, 2) : compact;
                }
                return { content: [{ type: 'text', text }] };
            } catch (err) {
                // Invalid-params (schema validation) is a protocol-level error, not a
                // tool-execution failure — surface it as a proper JSON-RPC -32602.
                if (err && err.code === -32602) throw err;
                const text = (err && err.message) ? err.message : String(err);
                return {
                    content: [{ type: 'text', text }],
                    isError: true
                };
            }
        }

        case 'ping':
            return {};

        case 'shutdown':
            return null;

        default:
            const e = new Error('Method not found: ' + method);
            e.code = -32601;
            throw e;
    }
}

function shutdown() {
    if (discoveryTimer) { clearInterval(discoveryTimer); discoveryTimer = null; }
    if (selfExitTimer) { clearInterval(selfExitTimer); selfExitTimer = null; }
    try { if (transport && typeof transport.stop === 'function') transport.stop(); } catch (_) {}
    process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
log('started, awaiting MCP client on stdio');
