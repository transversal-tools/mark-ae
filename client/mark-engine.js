// Mark — chat engine.
// Runs the Claude Code CLI headless (`claude -p --output-format stream-json`) with
// this repo's MCP server as its only toolset, and turns the JSON stream into
// simple events for the chat UI. Because it is the real Claude Code binary, it
// signs in exactly like the terminal does: the claude.ai subscription by default,
// or an Anthropic API key when one is passed in the environment.
//
// Plain Node (no deps) so it loads in CEP's node context and in a bare `node` test.

const { spawn, execFile, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const paths = require('./mark-paths.js');
const IS_WIN = paths.IS_WIN;
// AE launched from the Dock / Start menu does not get the login shell's PATH, so
// the CLIs and node are looked up in the usual install dirs first.
const BIN_DIRS = paths.BIN_DIRS;

const WORKSPACE = path.join(paths.DATA, 'workspace');
const MCP_NAME = 'mark';
const KEYCHAIN_SERVICE = 'Mark - Anthropic API key';

const SYSTEM_PROMPT = [
    'You are Mark, a chat panel docked inside Adobe After Effects.',
    'The user is a motion designer talking to you from inside AE. Reply in the language they write in, short and plain, result first.',
    'Use only the mcp__' + MCP_NAME + '__ tools to read and change the open After Effects project; you have no shell or file tools here.',
    'Before a change that affects many layers or is hard to undo, say in one line what you will do.',
    'Never claim something worked unless a tool result confirmed it.',
    'A user message may start with "[AE context at send time: ...]". The panel writes that line, not the user: it is the project, active comp and selected layers at the moment they pressed send. Use it instead of calling get_selection just to learn what is selected; use tools for anything else you need.'
].join('\n');

// ---------- binaries ----------
const binCache = {};
function resolveBin(name) {
    if (binCache[name]) return binCache[name];
    const names = IS_WIN ? [name + '.exe', name + '.cmd'] : [name];
    for (const dir of BIN_DIRS) {
        for (const n of names) {
            const p = path.join(dir, n);
            try { fs.accessSync(p, IS_WIN ? fs.constants.F_OK : fs.constants.X_OK); return (binCache[name] = p); } catch (_) {}
        }
    }
    try {
        const out = IS_WIN
            ? execFileSync('where', [name], { encoding: 'utf8', timeout: 5000, windowsHide: true })
            : execFileSync('/bin/zsh', ['-lc', 'command -v ' + name], { encoding: 'utf8', timeout: 5000 });
        // `where` lists every match; prefer a real .exe over a .cmd shim.
        const found = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        const p = found.find((f) => /\.exe$/i.test(f)) || found[0];
        if (p) return (binCache[name] = p);
    } catch (_) {}
    return null;
}

// How to start Claude Code: { cmd, pre } (pre = args before Mark's own).
// On Windows an npm install is a claude.cmd shim; .cmd files cannot be spawned
// without a shell, and a shell would mangle the long system prompt, so run its
// cli.js with node instead.
function resolveClaude() {
    const bin = resolveBin('claude');
    if (!bin) return null;
    if (IS_WIN && /\.cmd$/i.test(bin)) {
        const cli = path.join(path.dirname(bin), 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
        const node = resolveBin('node');
        if (node && fs.existsSync(cli)) return { cmd: node, pre: [cli] };
        return null;
    }
    return { cmd: bin, pre: [] };
}

function baseEnv() {
    const env = Object.assign({}, process.env);
    const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
    const parts = (env[pathKey] || '').split(path.delimiter).filter(Boolean);
    env[pathKey] = BIN_DIRS.filter((d) => parts.indexOf(d) < 0).concat(parts).join(path.delimiter);
    // Never let a stray key, token or endpoint in AE's environment decide the
    // account, nor variables from a parent Claude session leak into the child.
    Object.keys(env).forEach((k) => {
        if (/^(ANTHROPIC_|CLAUDE_CODE_|CLAUDE_AGENT_SDK_)/.test(k) || k === 'CLAUDECODE') delete env[k];
    });
    return env;
}

// ---------- API key: macOS Keychain, or a DPAPI-encrypted file on Windows ----------
function keychainAccount() { try { return os.userInfo().username; } catch (_) { return 'mark'; } }

// Windows: the key is encrypted with the user's Windows login (DPAPI, via
// PowerShell's ConvertFrom-SecureString), so the file is useless on any other
// account or computer. The key goes through stdin, never the command line.
const WIN_KEYFILE = path.join(paths.DATA, 'api-key.dpapi');
function winPowerShell(script, input) {
    return new Promise((resolve, reject) => {
        const child = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
            { env: Object.assign({}, process.env, { MARK_KEYFILE: WIN_KEYFILE }), windowsHide: true },
            (err, out) => err ? reject(err) : resolve(String(out || '').trim()));
        if (input != null) child.stdin.end(String(input)); else child.stdin.end();
    });
}
const WIN = {
    has: () => Promise.resolve(fs.existsSync(WIN_KEYFILE)),
    get: () => fs.existsSync(WIN_KEYFILE)
        ? winPowerShell('$s = Get-Content -LiteralPath $env:MARK_KEYFILE | ConvertTo-SecureString; ' +
            '[Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))').catch(() => null)
        : Promise.resolve(null),
    set: (key) => { fs.mkdirSync(paths.DATA, { recursive: true });
        return winPowerShell('$k = [Console]::In.ReadToEnd().Trim(); ConvertTo-SecureString $k -AsPlainText -Force | ' +
            'ConvertFrom-SecureString | Set-Content -LiteralPath $env:MARK_KEYFILE -Encoding ASCII', key)
            .catch((e) => { throw new Error('Could not save the key: ' + e.message); }); },
    del: () => { try { fs.unlinkSync(WIN_KEYFILE); } catch (_) {} return Promise.resolve(); }
};

function hasApiKey() {
    if (IS_WIN) return WIN.has();
    return new Promise((resolve) => {
        execFile('/usr/bin/security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', keychainAccount()],
            (err) => resolve(!err));
    });
}

function getApiKey() {
    if (IS_WIN) return WIN.get();
    return new Promise((resolve) => {
        execFile('/usr/bin/security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', keychainAccount(), '-w'],
            (err, out) => resolve(err ? null : String(out).trim() || null));
    });
}

function setApiKey(key) {
    if (IS_WIN) return WIN.set(key);
    return new Promise((resolve, reject) => {
        execFile('/usr/bin/security', ['add-generic-password', '-U', '-s', KEYCHAIN_SERVICE, '-a', keychainAccount(),
            '-l', KEYCHAIN_SERVICE, '-w', String(key).trim()],
            (err) => err ? reject(new Error('Keychain: ' + err.message)) : resolve());
    });
}

function deleteApiKey() {
    if (IS_WIN) return WIN.del();
    return new Promise((resolve) => {
        execFile('/usr/bin/security', ['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', keychainAccount()],
            () => resolve());
    });
}

// ---------- MCP config ----------
// Written to a file (not passed inline) so paths with spaces survive untouched.
function writeMcpConfig(serverJs, serverEnv) {
    const node = resolveBin('node');
    if (!node) throw new Error('Node.js not found. Mark needs Node installed (the same one the Portal uses).');
    fs.mkdirSync(WORKSPACE, { recursive: true });
    // One file per AE: with AE 2025 and 2026 both open, a shared file let one
    // panel's chat end up driving the other AE.
    const port = (serverEnv && serverEnv.AE_PORTAL_PORT) || 'any';
    const file = path.join(WORKSPACE, 'mcp-' + port + '.json');
    // AE_PORTAL_MARK_CHAT: stricter run_jsx rules for the chat only (see tools.js).
    const server = { type: 'stdio', command: node, args: [serverJs], env: Object.assign({ AE_PORTAL_MARK_CHAT: '1' }, serverEnv || {}) };
    fs.writeFileSync(file, JSON.stringify({ mcpServers: { [MCP_NAME]: server } }, null, 2));
    return file;
}

// ---------- one chat turn ----------
// opts: { prompt, sessionId, mode: 'subscription'|'api', serverJs, serverEnv, model, effort, toolsOff, extraSystem, onEvent }
// Events: { type: 'session', id } | { type: 'text', text } (delta) | { type: 'tool', name, input }
//         | { type: 'tool_result', isError, text } | { type: 'done', sessionId, costUsd, isError, text }
//         | { type: 'error', message }
// Returns { cancel() }.
function runTurn(opts) {
    const onEvent = opts.onEvent || function () {};
    let child = null;
    let cancelled = false;
    let finished = false;
    const finish = (ev) => { if (finished) return; finished = true; onEvent(ev); };

    (async () => {
        const claude = resolveClaude();
        if (!claude) return finish({ type: 'error', message: 'Claude Code not found. Install Claude Code on this Mac and sign in once in Terminal.' });

        const env = baseEnv();
        if (opts.mode === 'api') {
            const key = await getApiKey();
            if (!key) return finish({ type: 'error', message: 'No API key saved. Add one in the settings menu, or switch to Subscription.' });
            env.ANTHROPIC_API_KEY = key;
        }
        if (cancelled) return;

        const args = claude.pre.concat(['-p',
            '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
            // ToolSearch only: the ~135 Portal tools stay deferred and load on demand,
            // which cuts each turn from ~73k to ~8k tokens (measured 2026-10-26).
            '--tools', 'ToolSearch',
            '--allowedTools', 'mcp__' + MCP_NAME,
            '--append-system-prompt', SYSTEM_PROMPT + (opts.extraSystem ? '\n\n' + opts.extraSystem : '')]);
        if (opts.toolsOff) {
            // Text-only turn (e.g. writing a recipe): no built-in tools, no MCP.
            args[args.indexOf('ToolSearch')] = '';
            args.push('--strict-mcp-config');
        } else if (opts.serverJs) {
            args.push('--mcp-config', writeMcpConfig(opts.serverJs, opts.serverEnv), '--strict-mcp-config');
        } else {
            args.push('--strict-mcp-config');
        }
        if (opts.sessionId) args.push('--resume', opts.sessionId);
        if (opts.model) args.push('--model', opts.model);
        if (opts.effort) args.push('--effort', opts.effort);

        fs.mkdirSync(WORKSPACE, { recursive: true });
        // The prompt goes through stdin: as an argument, a message starting with "-"
        // ("-5 frames on every layer") was parsed as an unknown CLI option.
        child = spawn(claude.cmd, args, { cwd: WORKSPACE, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
        child.stdin.on('error', () => {});
        child.stdin.end(String(opts.prompt || ''));

        let buf = '';
        let stderr = '';
        const streamed = {};      // message ids whose text already arrived as deltas
        let currentMsg = null;

        child.stdout.on('data', (chunk) => {
            buf += chunk.toString('utf8');
            let nl;
            while ((nl = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, nl).trim();
                buf = buf.slice(nl + 1);
                if (!line) continue;
                let msg;
                try { msg = JSON.parse(line); } catch (_) { continue; }
                handle(msg);
            }
        });
        child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString('utf8')).slice(-4000); });

        function handle(msg) {
            if (msg.type === 'system' && msg.subtype === 'init' && msg.session_id) {
                onEvent({ type: 'session', id: msg.session_id });
            } else if (msg.type === 'stream_event' && msg.event) {
                const e = msg.event;
                if (e.type === 'message_start' && e.message) currentMsg = e.message.id;
                if (e.type === 'content_block_delta' && e.delta && e.delta.type === 'text_delta') {
                    if (currentMsg) streamed[currentMsg] = true;
                    onEvent({ type: 'text', text: e.delta.text });
                }
            } else if (msg.type === 'assistant' && msg.message) {
                const id = msg.message.id;
                (msg.message.content || []).forEach((b) => {
                    if (b.type === 'text' && !streamed[id]) onEvent({ type: 'text', text: b.text });
                    if (b.type === 'tool_use') onEvent({ type: 'tool', name: String(b.name || '').replace('mcp__' + MCP_NAME + '__', ''), input: b.input });
                });
                onEvent({ type: 'text_end' });
            } else if (msg.type === 'user' && msg.message && Array.isArray(msg.message.content)) {
                msg.message.content.forEach((b) => {
                    if (b.type !== 'tool_result') return;
                    const text = Array.isArray(b.content)
                        ? b.content.map((c) => c.text || '').join('\n')
                        : String(b.content || '');
                    onEvent({ type: 'tool_result', isError: !!b.is_error, text });
                });
            } else if (msg.type === 'result') {
                finish({
                    type: 'done',
                    sessionId: msg.session_id,
                    costUsd: msg.total_cost_usd,
                    isError: !!msg.is_error,
                    text: msg.result || ''
                });
            }
        }

        child.on('error', (err) => finish({ type: 'error', message: 'Could not start Claude Code: ' + err.message }));
        child.on('close', (code) => {
            if (cancelled) return finish({ type: 'done', cancelled: true });
            if (!finished) {
                const tail = stderr.trim().split('\n').slice(-4).join('\n');
                finish({ type: 'error', message: friendlyError(tail) || ('Claude Code stopped with code ' + code) });
            }
        });
    })().catch((err) => finish({ type: 'error', message: err.message }));

    return {
        cancel() {
            cancelled = true;
            // Stopped before Claude Code even started (key lookup, setup): end the
            // turn here, or the panel would wait forever for a process that never runs.
            if (!child) return finish({ type: 'done', cancelled: true });
            if (!child.killed) {
                try { child.kill('SIGINT'); } catch (_) {}
                setTimeout(() => { try { if (child.exitCode === null) child.kill('SIGTERM'); } catch (_) {} }, 2000);
            }
        }
    };
}

function friendlyError(text) {
    if (!text) return '';
    if (/credit balance is too low/i.test(text)) return 'Your API credits ran out. Switch to Subscription or top up your credits.';
    if (/invalid x-api-key|authentication_error/i.test(text)) return 'The API key was rejected. Check the saved key or switch to Subscription.';
    if (/OAuth session expired|Failed to authenticate|not logged in|please run \/login|login required/i.test(text)) return 'Claude Code is signed out. Open Terminal, type claude, press Enter and sign in (/login). Then send again.';
    if (/No conversation found|session .*not found/i.test(text)) return 'This conversation can no longer be resumed. Click New chat to start over.';
    if (/usage limit|rate limit/i.test(text)) return 'Usage limit reached. Try again later or switch account.';
    return text;
}

module.exports = { runTurn, resolveBin, hasApiKey, getApiKey, setApiKey, deleteApiKey, friendlyError, WORKSPACE, MCP_NAME };
