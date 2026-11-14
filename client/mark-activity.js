// Mark: the Log tab.
//
// Every call that reaches this panel, named by the session that sent it: each MCP
// server says who it is with a {"hello"} frame (app, project folder, local or SSH;
// see mcp-server/transport.js), so a line reads "Claude Code · my-project  run_jsx:
// Delete the test layers". The panel's own events (host reloaded, port in use...)
// come in as grey lines through main.js's log(). Loaded after main.js: it uses
// main.js's globals (transport, onCommand, log).
(function () {
    'use strict';
    const $ = (id) => document.getElementById(id);
    const el = {
        tab: document.querySelector('.mk-tab[data-tab="log"]'), view: $('mark-activity'),
        badge: $('mark-activity-n'), who: $('mk-a-who'), whoToggle: $('mk-a-who-toggle'), whoSum: $('mk-a-who-sum'),
        clients: $('mk-a-clients'), filter: $('mk-a-filter'), errOnly: $('mk-a-err-only'), sysOn: $('mk-a-sys'),
        log: $('mk-a-log'), copyErr: $('mk-a-copy-errors'), clear: $('mk-a-clear'), count: $('mk-a-count')
    };
    if (!el.view) return;

    const COLORS = ['--l-aqua', '--l-yellow', '--l-peach', '--l-lavender', '--l-seafoam', '--l-sand', '--l-blue'];   // AE label colours, red kept for errors
    const MAX_ENTRIES = 400;
    const ME = { _cid: 0, _info: { app: 'You', project: 'Log tab', via: 'local' } };   // "Run again"
    const entries = [];          // newest last
    const known = new Map();     // cid -> { cid, info, color, connected, lastAt, calls, connectedAt }
    const open = new Set();      // entry numbers shown expanded
    let seq = 0, colorNext = 0, filter = 'all', unseen = 0, renderQueued = false;

    const store = {
        get(k, d) { try { const v = localStorage.getItem('mark:activity:' + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
        set(k, v) { try { localStorage.setItem('mark:activity:' + k, JSON.stringify(v)); } catch (_) {} }
    };
    el.errOnly.checked = store.get('errOnly', false);
    el.sysOn.checked = store.get('sys', true);
    if (store.get('whoClosed', false)) el.who.classList.add('closed');

    // ---------- naming ----------
    function clientRec(sock) {
        const cid = sock ? sock._cid : 0;
        let rec = known.get(cid);
        if (!rec) {
            rec = { cid, info: null, color: COLORS[colorNext++ % COLORS.length], connected: true, lastAt: 0, calls: 0, connectedAt: Date.now() };
            known.set(cid, rec);
        }
        if (sock && sock._info) rec.info = sock._info;
        return rec;
    }
    function nameOf(rec) {
        const i = rec.info;
        if (!i) return { app: 'Session ' + rec.cid, rest: !CAN_IDENTIFY ? 'older server' : rec.unknown ? 'unknown' : 'identifying…' };
        const parts = [];
        if (i.project) parts.push(i.project);
        if (i.via === 'ssh') parts.push('via SSH' + (i.from ? ' ' + i.from : ''));
        return { app: i.app || 'MCP client', rest: parts.join(' · ') };
    }
    function fullName(rec) { const n = nameOf(rec); return n.app + (n.rest ? ' · ' + n.rest : ''); }

    // Older Mark servers never say hello. On macOS the panel can still tell who they
    // are: lsof finds the process at the other end of the socket (the Mark server),
    // its parent is the app (Claude Code or Codex) and its working folder is the
    // project. Done once per socket, in the background.
    const cp = (() => { try { return require('child_process'); } catch (_) { return null; } })();
    const CAN_IDENTIFY = !!cp && typeof process !== 'undefined' && process.platform === 'darwin';
    function run(cmd, args) {
        return new Promise((res) => cp.execFile(cmd, args, { timeout: 4000 }, (e, out) => res(e ? '' : String(out))));
    }
    let identifyQueue = Promise.resolve();   // one lookup at a time (~0.1 s each)
    function identify(sock) {
        if (!CAN_IDENTIFY || sock._info || sock._identifying || !sock.remotePort) return identifyQueue;
        sock._identifying = true;
        identifyQueue = identifyQueue.then(() => identifyNow(sock));
        return identifyQueue;
    }
    async function identifyNow(sock) {
        if (sock._info || sock.destroyed) return;
        const rec = clientRec(sock);
        try {
            const pids = ((await run('lsof', ['-b', '-w', '-nP', '-iTCP:' + sock.remotePort, '-sTCP:ESTABLISHED', '-Fp'])).match(/^p\d+/gm) || [])
                .map((l) => Number(l.slice(1))).filter((p) => p !== process.pid);
            for (const pid of pids) {
                const ps = (await run('ps', ['-o', 'ppid=,lstart=,command=', '-p', String(pid)])).trim();
                const m = /^(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.*)$/.exec(ps);
                if (!m || !/server\.js/.test(m[3])) continue;
                const parent = (await run('ps', ['-o', 'command=', '-p', m[1]])).trim();
                const cwd = (((await run('lsof', ['-b', '-w', '-a', '-p', String(pid), '-d', 'cwd', '-Fn'])).match(/^n(.*)$/m) || [])[1]) || '';
                const chat = /\/Mark\/workspace/.test(cwd);
                sock._info = {
                    app: chat ? 'Mark chat' : /codex/i.test(parent) ? 'Codex' : /claude/i.test(parent) ? 'Claude Code' : (parent.split(/[\/ ]/).filter(Boolean).pop() || 'MCP client'),
                    project: chat || !cwd ? null : cwd.split('/').filter(Boolean).pop(),
                    via: 'local', startedAt: Date.parse(m[2]) || null, pid, guessed: true
                };
                rec.info = sock._info;
                break;
            }
        } catch (_) {}
        if (!sock._info) rec.unknown = true;
        queueRender();
    }

    // What a call does, in one line: the agent's description for run_jsx, otherwise
    // the arguments that identify the target (comp, layer, prop, frame...).
    function short(v) {
        if (v == null) return String(v);
        if (typeof v === 'string') return '"' + (v.length > 40 ? v.slice(0, 40) + '…' : v) + '"';
        if (typeof v === 'object' && !Array.isArray(v) && v.id != null && Object.keys(v).length === 1) return '#' + v.id;
        const s = JSON.stringify(v);
        return s.length > 40 ? s.slice(0, 40) + '…' : s;
    }
    function describe(method, params) {
        params = params || {};
        if (method === 'run_jsx') {
            if (params.description) return String(params.description);
            const line = String(params.script || '').split('\n').map((l) => l.trim())
                .filter((l) => l && !/^\(?function\s*\(\)\s*\{?$/.test(l) && l !== '{')[0] || '';
            return line.replace(/^\/\/\s*/, '').slice(0, 90);
        }
        return Object.keys(params).filter((k) => k !== 'instance' && k !== 'script' && k !== 'description')
            .map((k) => k + ' ' + short(params[k])).join(', ').slice(0, 120);
    }
    // Answers can be big (base64 frames, deep maps): long strings are cut.
    function preview(v) {
        if (v === undefined) return '';
        let s;
        try { s = JSON.stringify(v, (k, x) => (typeof x === 'string' && x.length > 300) ? x.slice(0, 80) + '… (' + x.length + ' chars)' : x, 2); }
        catch (_) { s = String(v); }
        return s && s.length > 1500 ? s.slice(0, 1500) + '\n…' : (s || '');
    }
    function clock(t) { return new Date(t).toTimeString().slice(0, 5); }
    function ago(t) {
        if (!t) return 'no calls yet';
        const s = (Date.now() - t) / 1000;
        if (s < 60) return 'now';
        if (s < 3600) return Math.round(s / 60) + ' min ago';
        return 'idle ' + Math.round(s / 3600) + ' h';
    }

    // ---------- recording ----------
    function push(e) {
        e.n = ++seq;
        entries.push(e);
        while (entries.length > MAX_ENTRIES) open.delete(entries.shift().n);
        queueRender();
        return e;
    }
    function isVisible() { return el.view.classList.contains('mk-on'); }
    function bumpErrors() { if (!isVisible()) { unseen++; syncBadge(); } }
    function syncBadge() { el.badge.textContent = unseen ? String(unseen) : ''; }

    const api = {
        begin(msg, sock) {
            const rec = clientRec(sock);
            rec.lastAt = Date.now(); rec.calls++;
            const p = (msg && msg.params) || {};
            return push({
                t: Date.now(), cid: rec.cid, method: msg.method, what: describe(msg.method, p),
                script: typeof p.script === 'string' ? p.script.slice(0, 20000) : null,
                params: p.script ? null : p, running: true
            });
        },
        end(e, ok, out) {
            if (!e) return;
            e.running = false; e.ms = Date.now() - e.t; e.ok = ok;
            e.out = ok ? preview(out) : String(out || 'error');
            if (!ok) bumpErrors();
            queueRender();
        },
        clients(what, sock) {
            const rec = clientRec(sock);
            if (what === 'closed') {
                rec.connected = false;
                if (rec.info) push({ t: Date.now(), sys: fullName(rec) + ' disconnected' });
            } else if (what === 'authed') {
                setTimeout(() => identify(sock), 1500);   // a current server says hello first
            } else if (what === 'hello') {
                if (!rec.helloLogged) { rec.helloLogged = true; push({ t: Date.now(), sys: fullName(rec) + ' connected' }); }
                else push({ t: Date.now(), sys: 'Session ' + rec.cid + ' is ' + fullName(rec) });
            }
            queueRender();
        },
        sys(message, level) {
            const e = push({ t: Date.now(), sys: String(message), level: level || 'info' });
            if (e.level === 'err') bumpErrors();
        }
    };
    window.markActivity = api;

    // Panel events from main.js's log(); call lines are recorded by begin/end.
    if (typeof log === 'function') {
        const panelLog = log;
        log = function (message, level) {     // eslint-disable-line no-global-assign
            panelLog(message, level);
            if (!/^(← |✗ )/.test(String(message))) api.sys(message, level);
        };
    }
    // Lines main.js logged before this file loaded (panel loaded, host alive...).
    document.querySelectorAll('#console-log .line').forEach((l) => {
        const ts = l.querySelector('.ts');
        const text = l.textContent.slice(ts ? ts.textContent.length : 0);
        if (!/^(← |✗ |client )/.test(text)) push({ t: Date.now(), sys: text, level: l.classList.contains('err') ? 'err' : 'info' });
    });

    // ---------- rendering ----------
    function queueRender() {
        if (renderQueued) return;
        renderQueued = true;
        requestAnimationFrame(() => { renderQueued = false; if (isVisible()) render(); });
    }
    function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
    function liveClients() {
        const recs = [];
        try {
            (transport ? [...transport.clients] : []).filter((c) => c._authed).forEach((sock) => {
                const r = clientRec(sock); r.connected = true; recs.push(r);
                if (!sock._info && !sock._identifying) identify(sock);
            });
        } catch (_) {}
        return recs.sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0) || a.cid - b.cid);
    }
    const ACTIVE_MS = 30 * 60000;    // a session counts as active for 30 min after its last call
    let idleOpen = store.get('idleOpen', false);
    function clientRow(r, dup) {
        const n = nameOf(r), live = r.lastAt && Date.now() - r.lastAt < 60000;
        const since = dup && r.info && r.info.startedAt ? 'since ' + clock(r.info.startedAt) : '';
        const rest = [n.rest, since].filter(Boolean).join(' · ');
        return '<li class="mk-a-cl' + (!r.lastAt || Date.now() - r.lastAt > ACTIVE_MS ? ' idle' : '') + (filter === String(r.cid) ? ' sel' : '') +
            '" data-cid="' + r.cid + '" title="' + esc(fullName(r) + ' · ' + r.calls + ' calls' + (r.info && r.info.version ? ' · ' + r.info.version : '') +
            (r.info && r.info.guessed ? ' · named from its process (older server)' : '')) + '">' +
            '<span class="sw" style="background:var(' + r.color + ')"></span>' +
            '<span class="nm">' + esc(n.app) + (rest ? '<small>' + esc(rest) + '</small>' : '') + '</span>' +
            '<span class="st' + (live ? ' live' : '') + '">' + ago(r.lastAt) + '</span></li>';
    }
    function renderClients() {
        const recs = liveClients();
        const isActive = (r) => r.lastAt && Date.now() - r.lastAt < ACTIVE_MS;
        const active = recs.filter(isActive), idle = recs.filter((r) => !isActive(r));
        const names = {};
        recs.forEach((r) => { const k = fullName(r); names[k] = (names[k] || 0) + 1; });
        const dup = (r) => names[fullName(r)] > 1;
        el.whoSum.textContent = recs.length ? recs.length + (recs.length === 1 ? ' session' : ' sessions') + ', ' + active.length + ' active' : 'no sessions';
        el.clients.innerHTML = active.map((r) => clientRow(r, dup(r))).join('') +
            (idle.length ? '<li class="mk-a-idle-row" data-idle="1">' + (idleOpen ? '▾ ' : '▸ ') + idle.length + (idle.length === 1 ? ' idle session' : ' idle sessions') +
                '<small>no calls in 30 min</small></li>' + (idleOpen ? idle.map((r) => clientRow(r, dup(r))).join('') : '') : '');
        const opts = ['<option value="all">All sessions</option>'];
        const seen = new Set();
        recs.concat([...known.values()]).forEach((r) => {
            if (seen.has(r.cid) || !entries.some((e) => e.cid === r.cid)) return;
            seen.add(r.cid);
            opts.push('<option value="' + r.cid + '"' + (filter === String(r.cid) ? ' selected' : '') + '>' + esc(fullName(r)) + '</option>');
        });
        el.filter.innerHTML = opts.join('');
    }
    function renderLog() {
        const errOnly = el.errOnly.checked, sysOn = el.sysOn.checked;
        const atBottom = el.log.scrollHeight - el.log.scrollTop - el.log.clientHeight < 30;
        const rows = entries.filter((e) => {
            if (e.sys) return sysOn && filter === 'all' && (!errOnly || e.level === 'err');
            if (filter !== 'all' && String(e.cid) !== filter) return false;
            return !errOnly || e.ok === false;
        });
        el.log.innerHTML = rows.map((e) => {
            if (e.sys) {
                return '<div class="mk-a-ev sys' + (e.level === 'err' ? ' err' : '') + '"><span class="t" title="' + new Date(e.t).toTimeString().slice(0, 8) + '">' + clock(e.t) +
                    '</span><span></span><span class="what">' + esc(e.sys) + '</span><span></span></div>';
            }
            const rec = known.get(e.cid) || { color: '--l-aqua', cid: e.cid, info: null };
            const ms = e.running ? 'running' : e.ok === false ? 'failed' : (e.ms >= 1000 ? (e.ms / 1000).toFixed(1) + ' s' : e.ms + ' ms');
            let html = '<div class="mk-a-ev' + (e.running ? ' run' : e.ok === false ? ' err' : '') + (open.has(e.n) ? ' open' : '') + '" data-n="' + e.n +
                '" title="' + esc(fullName(rec)) + '"><span class="t" title="' + new Date(e.t).toTimeString().slice(0, 8) + '">' + clock(e.t) + '</span>' +
                '<span class="sw" style="background:var(' + rec.color + ')"></span>' +
                '<span class="what"><span class="tool">' + esc(e.method) + '</span> ' + esc(e.what) + '</span><span class="ms">' + ms + '</span></div>';
            if (open.has(e.n)) {
                html += '<div class="mk-a-detail"><div class="k">' + esc(fullName(rec)) + ' · ' + new Date(e.t).toTimeString().slice(0, 8) + '</div>' +
                    (e.script ? '<div class="k">Script</div><pre>' + esc(e.script) + '</pre>' : '') +
                    (e.params && Object.keys(e.params).length ? '<div class="k">Arguments</div><pre>' + esc(preview(e.params)) + '</pre>' : '') +
                    (e.running ? '<div class="k">Still running</div>' : e.ok === false ? '<div class="k">Error</div><pre class="err">' + esc(e.out) + '</pre>'
                        : (e.out ? '<div class="k">Answer</div><pre>' + esc(e.out) + '</pre>' : '')) +
                    '<div class="acts"><button class="mini" data-act="copy" data-n="' + e.n + '">Copy</button>' +
                    (e.script && !e.running ? '<button class="mini" data-act="rerun" data-n="' + e.n + '" title="Run this script in AE again">Run again</button>' : '') + '</div></div>';
            }
            return html;
        }).join('') || '<p class="mk-a-empty">' + (entries.length ? 'Nothing matches the filter.' : 'Calls from Claude Code, Codex and the Mark chat show up here.') + '</p>';
        if (atBottom) el.log.scrollTop = el.log.scrollHeight;
        el.count.textContent = entries.filter((e) => !e.sys).length + ' calls';
    }
    function render() { renderClients(); renderLog(); }
    function entryText(e) {
        const rec = known.get(e.cid);
        return new Date(e.t).toTimeString().slice(0, 8) + '  ' + (rec ? fullName(rec) : '') + '  ' + e.method + ': ' + e.what +
            (e.script ? '\n' + e.script : '') + (e.out ? '\n→ ' + e.out : '');
    }
    function copy(text) {
        try { navigator.clipboard.writeText(text); return; } catch (_) {}
        const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch (_) {}
        ta.remove();
    }

    // ---------- wiring ----------
    el.tab.addEventListener('click', () => { unseen = 0; syncBadge(); setTimeout(() => { render(); el.log.scrollTop = el.log.scrollHeight; }, 0); });
    el.whoToggle.addEventListener('click', () => { el.who.classList.toggle('closed'); store.set('whoClosed', el.who.classList.contains('closed')); });
    el.clients.addEventListener('click', (ev) => {
        if (ev.target.closest('.mk-a-idle-row')) { idleOpen = !idleOpen; store.set('idleOpen', idleOpen); renderClients(); return; }
        const li = ev.target.closest('.mk-a-cl'); if (!li) return;
        filter = filter === li.dataset.cid ? 'all' : li.dataset.cid; render();
    });
    el.filter.addEventListener('change', () => { filter = el.filter.value; render(); });
    el.errOnly.addEventListener('change', () => { store.set('errOnly', el.errOnly.checked); renderLog(); });
    el.sysOn.addEventListener('change', () => { store.set('sys', el.sysOn.checked); renderLog(); });
    el.log.addEventListener('click', async (ev) => {
        const btn = ev.target.closest('button[data-act]');
        if (btn) {
            const e = entries.find((x) => x.n === Number(btn.dataset.n)); if (!e) return;
            if (btn.dataset.act === 'copy') { copy(entryText(e)); btn.textContent = 'Copied'; return; }
            if (btn.dataset.act === 'rerun' && typeof onCommand === 'function') {
                const msg = { method: 'run_jsx', params: { script: e.script, description: 'Run again: ' + e.what } };
                const again = api.begin(msg, ME);
                try { api.end(again, true, await onCommand(msg)); } catch (err) { api.end(again, false, err.message); }
            }
            return;
        }
        const row = ev.target.closest('.mk-a-ev[data-n]'); if (!row) return;
        const n = Number(row.dataset.n);
        if (window.getSelection && String(window.getSelection()).length) return;   // selecting text, not toggling
        open.has(n) ? open.delete(n) : open.add(n);
        renderLog();
    });
    el.copyErr.addEventListener('click', () => {
        const errs = entries.filter((e) => e.ok === false || e.level === 'err');
        copy(errs.map((e) => e.sys ? new Date(e.t).toTimeString().slice(0, 8) + '  ' + e.sys : entryText(e)).join('\n\n') || 'No errors.');
        el.copyErr.textContent = errs.length ? 'Copied ' + errs.length : 'No errors';
        setTimeout(() => { el.copyErr.textContent = 'Copy errors'; }, 1500);
    });
    el.clear.addEventListener('click', () => { entries.length = 0; open.clear(); unseen = 0; syncBadge(); render(); });
    setInterval(() => { if (isVisible()) renderClients(); }, 15000);   // "2 min ago" ages
    render();
})();
