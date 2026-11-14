// AE Portal — MCP-server-side TCP client.
// Connects to the CEP panel's localhost TCP server. Reconnects on drop.
//
// Two shapes are exported:
//   TransportClient — one socket to one AE panel (legacy single-instance path).
//   TransportPool   — many clients, one per discovered AE, routed by `instance`.
// Both expose .call(method, params, opts) so tools.js dispatch is shape-agnostic.

const net = require('net');
const crypto = require('crypto');

// Cap on a single accumulated newline-delimited frame. Prevents a stuck or
// hostile peer from growing _buf without bound. Set high because legitimate
// responses (render_frame base64 PNGs, deep project maps) can be several MB.
const MAX_LINE_BYTES = Number(process.env.AE_PORTAL_MAX_LINE) || (64 * 1024 * 1024);

// 2.7: how long call() waits for an in-progress (re)connect to land before
// failing the "not connected" error outright — see TransportClient.call().
const RECONNECT_GRACE_MS = Number(process.env.AE_PORTAL_RECONNECT_GRACE_MS) || 1500;

// Mark: who this MCP server is talking for (app, project folder, local or SSH), so the
// panel's Log tab can name each session. Sent as a {"hello":{...}} frame right after
// auth on every connect, and again to every live socket when it changes (the app name
// is only known after the MCP initialize). Older panels ignore the frame.
let identity = null;
const liveClients = new Set();
function setIdentity(info) {
    identity = info || null;
    for (const c of liveClients) c._sendHello();
}

class TransportClient {
    // autoReconnect: when true the client reschedules its own reconnect on drop
    // (legacy single-instance). The pool sets it false and drives reconnection
    // from its discovery scan instead, so dead ports aren't hammered forever.
    // token: shared secret read from the panel's discovery file. When present it
    // is sent as the FIRST framed message on connect so the panel can authenticate
    // this connection before honoring any command.
    constructor({ host = '127.0.0.1', port = 38967, log = () => {}, onEvent = null, autoReconnect = true, token = null } = {}) {
        this.host = host;
        this.port = port;
        this.token = token || null;
        this.log = log;
        this.onEvent = onEvent;     // (eventName, data) => void
        this.autoReconnect = autoReconnect;
        this.socket = null;
        this.connected = false;
        this.connecting = false;
        this.pending = new Map();
        this._buf = '';
        this._retry = 0;
        this._retryTimer = null;
        this._refusedStreak = 0;    // consecutive ECONNREFUSED — used to quiet logs
        liveClients.add(this);
    }

    connect() {
        if (this.connected || this.connecting) return;
        this.connecting = true;
        const sock = net.createConnection({ host: this.host, port: this.port });
        this.socket = sock;

        sock.once('connect', () => {
            this.connecting = false;
            this.connected = true;
            this._retry = 0;
            this._refusedStreak = 0;
            try { sock.setNoDelay(true); } catch (_) {}   // kill Nagle: ~40ms off every RPC round trip
            // Authenticate FIRST, before any command frame. If the discovery file
            // carried no token (older panel) we connect without one and the panel
            // accepts unauthenticated during the mixed-version transition.
            if (this.token) {
                try { sock.write(JSON.stringify({ auth: this.token }) + '\n'); } catch (_) {}
            }
            this._sendHello();
            this.log('panel connected at ' + this.host + ':' + this.port);
        });
        sock.on('data', (chunk) => this._onData(chunk));
        sock.on('error', (err) => {
            // ECONNREFUSED just means no panel is listening yet — log it once, not every retry.
            if (err && err.code === 'ECONNREFUSED') {
                if (this._refusedStreak === 0) this.log('no panel on :' + this.port + ' yet (will retry)');
                this._refusedStreak++;
            } else {
                this.log('socket error: ' + err.message);
            }
        });
        sock.on('close', () => {
            const wasConnected = this.connected;
            this.connecting = false;
            this.connected = false;
            this.socket = null;
            for (const [, p] of this.pending) {
                clearTimeout(p.t);
                p.reject(new Error('panel disconnected'));
            }
            this.pending.clear();
            if (wasConnected) this.log('panel disconnected');
            if (this.autoReconnect) this._scheduleReconnect();
        });
    }

    _sendHello() {
        if (!identity || !this.connected || !this.socket) return;
        try { this.socket.write(JSON.stringify({ hello: identity }) + '\n'); } catch (_) {}
    }

    _scheduleReconnect() {
        if (this._retryTimer) return;
        const delay = Math.min(5000, 250 * Math.pow(1.6, this._retry++));
        this._retryTimer = setTimeout(() => {
            this._retryTimer = null;
            this.connect();
        }, delay);
    }

    // Tear down for good: stop reconnecting, drop the socket, reject in-flight calls.
    stop() {
        liveClients.delete(this);
        this.autoReconnect = false;
        if (this._retryTimer) { clearTimeout(this._retryTimer); this._retryTimer = null; }
        const sock = this.socket;
        this.socket = null;
        this.connected = false;
        this.connecting = false;
        for (const [, p] of this.pending) { clearTimeout(p.t); p.reject(new Error('instance removed')); }
        this.pending.clear();
        if (sock) { try { sock.destroy(); } catch (_) {} }
    }

    _onData(chunk) {
        this._buf += chunk.toString('utf8');
        if (this._buf.length > MAX_LINE_BYTES) {
            // Runaway frame — abandon the buffer, fail in-flight calls cleanly, and
            // drop the socket so the reconnect path can recover.
            this.log('response frame exceeded ' + MAX_LINE_BYTES + ' bytes — resetting connection');
            this._buf = '';
            for (const [, p] of this.pending) { clearTimeout(p.t); p.reject(new Error('response exceeded max frame size (' + MAX_LINE_BYTES + ' bytes)')); }
            this.pending.clear();
            try { if (this.socket) this.socket.destroy(); } catch (_) {}
            return;
        }
        let nl;
        while ((nl = this._buf.indexOf('\n')) !== -1) {
            const line = this._buf.slice(0, nl).trim();
            this._buf = this._buf.slice(nl + 1);
            if (!line) continue;
            try {
                const msg = JSON.parse(line);
                this._handle(msg);
            } catch (e) {
                this.log('bad JSON from panel: ' + e.message);
            }
        }
    }

    _handle(msg) {
        if (msg && msg.id != null && this.pending.has(msg.id)) {
            const p = this.pending.get(msg.id);
            clearTimeout(p.t);
            this.pending.delete(msg.id);
            if (msg.ok) p.resolve(msg.result);
            else p.reject(new Error(msg.error || 'panel error'));
            return;
        }
        if (msg && msg.event && this.onEvent) {
            try { this.onEvent(msg.event, msg.data); } catch (_) {}
        }
    }

    // 2.7: waits (poll) for `connected` to flip true, up to `ms`. Used only to
    // give an ALREADY-in-flight connect() time to land — this never itself
    // schedules reconnects, so it can't fight the pool's discovery-scan-driven
    // reconnect cadence (pool clients run with autoReconnect:false).
    _waitForConnect(ms) {
        if (this.connected) return Promise.resolve(true);
        return new Promise((resolve) => {
            const deadline = Date.now() + ms;
            const poll = () => {
                if (this.connected) return resolve(true);
                if (Date.now() >= deadline) return resolve(false);
                setTimeout(poll, 50);
            };
            poll();
        });
    }

    async call(method, params, { timeout = 60000 } = {}) {
        if (!this.connected) {
            // Right after a panel reload/reconnect the first call can arrive while
            // the socket is still mid-handshake. connect() is a no-op if one is
            // already in flight (it bails when connecting/connected); give that
            // attempt a short grace window to land before failing outright instead
            // of rejecting instantly (was: instant fail, no wait).
            this.connect();
            const landed = await this._waitForConnect(RECONNECT_GRACE_MS);
            if (!landed) {
                throw new Error(
                    'AE Portal panel is not connected. In After Effects: Window > Extensions > AE Portal.'
                );
            }
        }
        const id = crypto.randomBytes(8).toString('hex');
        return new Promise((resolve, reject) => {
            const t = setTimeout(() => {
                this.pending.delete(id);
                // 0.5: a bridge timeout does NOT stop a running script — the most
                // common real-world cause is AE sitting behind a modal it can't
                // dismiss itself. Steer the human away from a mid-modal force-kill.
                reject(new Error('command "' + method + '" timed out after ' + timeout + 'ms. ' +
                    'AE may be blocked by a modal dialog (font dialog / save prompt / startup recovery) — ' +
                    'a timeout does NOT stop a running script. Do not force-kill AE mid-modal (it SIGABRTs); ' +
                    'dismiss the dialog instead.'));
            }, timeout);
            this.pending.set(id, { resolve, reject, t });
            this.socket.write(JSON.stringify({ id, method, params: params || {} }) + '\n');
        });
    }
}

// ---------------------------------------------------------------------------
// TransportPool — one TransportClient per discovered AE instance.
//
// The set of instances is reconciled from a discovery list via sync() (the
// server calls it on an interval after scanning ~/.mark/instances). Each
// instance has a stable id authored by the panel itself (its AE version), so
// routing identity is panel-reported, not inferred from a guessed port map.
//
// Routing: each tool call may pass opts.instance; if omitted and exactly one
// AE is connected it's used; if 2+ are connected we REFUSE to guess (throw and
// list the choices) rather than silently picking one.
// ---------------------------------------------------------------------------
class TransportPool {
    constructor({ log = () => {}, onEvent = null } = {}) {
        this.log = log;
        this.onEvent = onEvent;     // (eventName, data, instanceId, meta) => void
        this.byId = new Map();      // id -> { id, port, meta, client }
        this.activeId = null;       // explicit sticky target (convenience only)
    }

    // Reconcile against a fresh discovery list: [{ id, port, meta }].
    sync(discovered) {
        const seen = new Set();
        for (const inst of discovered) {
            const id = String(inst.id);
            seen.add(id);
            const token = inst.token || null;
            const existing = this.byId.get(id);
            if (existing && existing.port === inst.port && existing.token === token) {
                existing.meta = inst.meta || existing.meta;
                // Reconnect a dropped client (the scan, not the client, drives this).
                if (!existing.client.connected && !existing.client.connecting) existing.client.connect();
                continue;
            }
            // Port OR token changed (e.g. panel restarted and minted a fresh token) → rebuild.
            if (existing) { existing.client.stop(); this.byId.delete(id); }
            const client = new TransportClient({
                port: inst.port,
                token: token,
                autoReconnect: false,
                log: (...a) => this.log('[' + id + ']', ...a),
                onEvent: this.onEvent
                    ? (name, data) => this.onEvent(name, data, id, this.byId.get(id) ? this.byId.get(id).meta : null)
                    : null
            });
            this.byId.set(id, { id, port: inst.port, token: token, meta: inst.meta || {}, client });
            client.connect();
        }
        // Drop instances whose discovery file vanished (panel closed / stale).
        for (const id of [...this.byId.keys()]) {
            if (!seen.has(id)) {
                this.byId.get(id).client.stop();
                this.byId.delete(id);
                if (this.activeId === id) this.activeId = null;
            }
        }
    }

    connect() { for (const e of this.byId.values()) e.client.connect(); }
    stop() { for (const e of this.byId.values()) e.client.stop(); this.byId.clear(); }

    connectedIds() {
        return [...this.byId.values()].filter(e => e.client.connected).map(e => e.id);
    }

    // Strict resolution — no fuzzy substring matching (that mis-routed in the
    // prior attempt: '2' matched '2025', port digits leaked). Accepts: exact id,
    // exact port, exact AE major ('26'), exact full version. Ambiguity throws.
    _normalizeId(idLike) {
        if (idLike == null) return null;
        const s = String(idLike).trim();
        if (this.byId.has(s)) return s;                         // exact id, e.g. '2026'
        const cands = new Set();
        for (const e of this.byId.values()) {
            if (String(e.port) === s) return e.id;              // exact port → unambiguous
            const m = e.meta || {};
            if (m.major != null && String(m.major) === s) cands.add(e.id);     // '26'
            if (m.aeVersion && String(m.aeVersion) === s) cands.add(e.id);     // '26.0.1'
        }
        const uniq = [...cands];
        if (uniq.length === 1) return uniq[0];
        if (uniq.length > 1) {
            throw new Error('ambiguous instance "' + s + '": matches ' + uniq.join(', ') + ' — use the exact id');
        }
        return null;
    }

    setActive(idLike) {
        const id = this._normalizeId(idLike);
        if (!id) throw new Error('Unknown AE instance "' + idLike + '". Known: ' + ([...this.byId.keys()].join(', ') || '(none)'));
        if (!this.byId.get(id).client.connected) {
            throw new Error('AE instance "' + id + '" is not connected — open the AE Portal panel in that After Effects.');
        }
        this.activeId = id;
        return id;
    }

    resolve(idLike) {
        if (idLike != null && String(idLike).trim() !== '') {
            const id = this._normalizeId(idLike);
            if (!id) {
                throw new Error('Unknown AE instance "' + idLike + '". Connected: ' + (this.connectedIds().join(', ') || '(none)'));
            }
            const e = this.byId.get(id);
            if (!e.client.connected) {
                throw new Error('AE instance "' + id + '" is not connected (open the AE Portal panel in that After Effects).');
            }
            return e.client;
        }
        // No explicit instance.
        const conn = this.connectedIds();
        if (this.activeId && this.byId.get(this.activeId) && this.byId.get(this.activeId).client.connected) {
            return this.byId.get(this.activeId).client;
        }
        if (conn.length === 1) return this.byId.get(conn[0]).client;
        if (conn.length === 0) {
            throw new Error('No AE Portal panel connected. In After Effects: Window > Extensions > AE Portal.');
        }
        // Two or more connected and no target chosen — refuse to guess.
        throw new Error('Multiple AE instances connected (' + conn.join(', ') +
            '). Pass an "instance" argument (e.g. instance:"' + conn[0] + '") or call use_instance first.');
    }

    call(method, params, opts = {}) {
        return this.resolve(opts && opts.instance).call(method, params, opts);
    }

    list() {
        const conn = this.connectedIds();
        return [...this.byId.values()].map(e => ({
            id: e.id,
            port: e.port,
            aeVersion: e.meta ? e.meta.aeVersion : null,
            project: e.meta ? (e.meta.project || null) : null,
            connected: e.client.connected,
            active: e.id === this.activeId,
            isSoleConnected: conn.length === 1 && conn[0] === e.id
        }));
    }
}

module.exports = TransportClient;
module.exports.TransportClient = TransportClient;
module.exports.TransportPool = TransportPool;
module.exports.setIdentity = setIdentity;
