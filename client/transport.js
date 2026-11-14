// AE Portal — Panel-side TCP transport (Node net module, built-in)
// Hosts a localhost server. MCP server connects as a client.
// Protocol: newline-delimited JSON.
//   Request:      {"id": "<hex>", "method": "<name>", "params": {...}}
//   Response:     {"id": "<hex>", "ok": true,  "result": <any>}
//                 {"id": "<hex>", "ok": false, "error": "<msg>"}
//   Notification: {"event": "<name>", "data": {...}}            (server -> all clients)
//   Hello (Mark): {"hello": {app, project, via, from, pid}}      (client -> panel, no reply)

const net = require('net');

// Cap a single accumulated frame so a stuck/hostile client can't grow the buffer
// without bound. Requests are small, so this is generous headroom.
const MAX_LINE_BYTES = Number((typeof process !== 'undefined' && process.env && process.env.AE_PORTAL_MAX_LINE)) || (16 * 1024 * 1024);

class Transport {
    // token: shared secret written into this AE's discovery file. When set, the
    // FIRST framed message from every connecting client MUST be {"auth":<token>}
    // with a matching value, otherwise the socket is destroyed. When null (token
    // generation failed) auth is not enforced.
    constructor({ port, onCommand, onStatus, token, onClients }) {
        this.port = port;
        this.token = token || null;
        this.onCommand = onCommand;            // async (msg, client) => result
        this.onStatus = onStatus || (() => {});
        this.onClients = onClients || (() => {});   // Mark: a client connected, said hello or left
        this._nextCid = 0;
        this.server = null;
        this.clients = new Set();
    }

    // Constant-time-ish string compare (avoids trivial early-exit timing leaks).
    _tokenEquals(a) {
        var b = this.token;
        if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
        var r = 0;
        for (var i = 0; i < a.length; i++) r |= (a.charCodeAt(i) ^ b.charCodeAt(i));
        return r === 0;
    }

    start() {
        if (this.server) return;
        this._listenAttempt = 0;
        this._tryListen(this.port);
    }

    _tryListen(port) {
        const server = net.createServer((socket) => this._handleClient(socket));
        server.on('error', (err) => {
            // Another panel (e.g. a second instance of the same AE version) already
            // owns this port — bump to the next one instead of going silently dead.
            if (err && err.code === 'EADDRINUSE' && this._listenAttempt < 20) {
                this._listenAttempt++;
                try { server.close(); } catch (_) {}
                this.onStatus({ level: 'info', message: 'port ' + port + ' in use, trying ' + (port + 1) });
                this._tryListen(port + 1);
                return;
            }
            this.onStatus({ level: 'error', message: 'TCP server: ' + err.message });
            this.server = null;
        });
        server.listen(port, '127.0.0.1', () => {
            this.server = server;
            this.port = port;   // the ACTUAL bound port (may differ from the requested one)
            this.onStatus({ level: 'ok', message: 'listening on 127.0.0.1:' + port, port: port });
        });
    }

    stop() {
        try { if (this.server) this.server.close(); } catch (_) {}
        for (const c of this.clients) { try { c.destroy(); } catch (_) {} }
        this.clients.clear();
        this.server = null;
    }

    clientCount() { return this.clients.size; }

    // Mark: what the Log tab shows about each connected client.
    clientList() {
        return [...this.clients].filter((c) => c._authed).map((c) => ({
            cid: c._cid, info: c._info || null, connectedAt: c._connectedAt, lastAt: c._lastAt || 0, calls: c._calls || 0
        }));
    }

    broadcast(event, data) {
        const line = JSON.stringify({ event, data: data || null }) + '\n';
        for (const c of this.clients) {
            if (!c.destroyed) c.write(line);
        }
    }

    _handleClient(socket) {
        try { socket.setNoDelay(true); } catch (_) {}   // kill Nagle: ~40ms off every RPC round trip
        this.clients.add(socket);
        socket._cid = ++this._nextCid;
        socket._connectedAt = Date.now();
        // With no token we can't authenticate — accept (mixed-version transition).
        socket._authed = !this.token;
        this.onStatus({ level: 'ok', message: 'client connected (' + this.clients.size + ')' });

        let buf = '';
        socket.on('data', (chunk) => {
            buf += chunk.toString('utf8');
            if (buf.length > MAX_LINE_BYTES) {
                this.onStatus({ level: 'error', message: 'frame exceeded ' + MAX_LINE_BYTES + ' bytes — dropping connection' });
                this._send(socket, { ok: false, error: 'frame exceeded max size (' + MAX_LINE_BYTES + ' bytes)' });
                this.clients.delete(socket);
                try { socket.destroy(); } catch (_) {}
                buf = '';
                return;
            }
            let nl;
            while ((nl = buf.indexOf('\n')) !== -1) {
                const line = buf.slice(0, nl).trim();
                buf = buf.slice(nl + 1);
                if (!line) continue;
                if (!socket._authed) {
                    // First frame must be a valid auth handshake.
                    if (!this._tryAuth(socket, line)) return;   // socket destroyed on failure
                    continue;
                }
                this._dispatch(socket, line);
            }
        });
        socket.on('close', () => {
            this.clients.delete(socket);
            this.onStatus({ level: 'info', message: 'client disconnected (' + this.clients.size + ')' });
            this.onClients('closed', socket);
        });
        socket.on('error', () => { /* close fires next */ });
    }

    // Validate the first frame as an auth handshake. Returns true if authenticated
    // (dispatch may proceed), false if the socket was rejected + destroyed.
    _tryAuth(socket, line) {
        let msg = null;
        try { msg = JSON.parse(line); } catch (_) { msg = null; }
        if (msg && typeof msg.auth === 'string' && this._tokenEquals(msg.auth)) {
            socket._authed = true;
            this.onStatus({ level: 'ok', message: 'client authenticated' });
            this.onClients('authed', socket);
            return true;
        }
        // Wrong token, or a non-auth first frame from an unauthenticated caller
        // (e.g. an older MCP server that predates token auth). Refuse it — restart
        // the MCP server so it re-reads the token and sends the handshake.
        this.onStatus({ level: 'error', message: 'client failed authentication — connection rejected' });
        try { this._send(socket, { ok: false, error: 'authentication required' }); } catch (_) {}
        this.clients.delete(socket);
        try { socket.destroy(); } catch (_) {}
        return false;
    }

    async _dispatch(socket, line) {
        let msg;
        try { msg = JSON.parse(line); }
        catch (e) {
            this._send(socket, { ok: false, error: 'invalid JSON: ' + e.message });
            return;
        }
        // Mark: a client naming itself. Not a command, so no reply.
        if (msg && msg.hello && typeof msg.hello === 'object' && !msg.method) {
            socket._info = msg.hello;
            this.onClients('hello', socket);
            return;
        }
        const id = msg && msg.id;
        socket._lastAt = Date.now();
        socket._calls = (socket._calls || 0) + 1;
        try {
            const result = await this.onCommand(msg, socket);
            this._send(socket, { id, ok: true, result });
        } catch (err) {
            const msg = (err && err.message) ? err.message : String(err);
            this._send(socket, { id, ok: false, error: msg });
        }
    }

    _send(socket, obj) {
        if (!socket || socket.destroyed) return;
        socket.write(JSON.stringify(obj) + '\n');
    }
}

module.exports = Transport;
