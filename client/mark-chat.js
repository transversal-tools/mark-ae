// Mark — panel UI (chat, recipes, bridge).
// Loaded after main.js, so it reuses that file's globals (fsPathRelativeToPanel,
// SERVER_JS_PATH, PANEL_VERSION, discoveryPort, lastPong, cs, ui, log, escapeHtml,
// callJsxDispatch, manualHardBlockHit, PANEL_METHODS). All Mark code lives in the
// mark-* files so the original AE Portal files stay easy to merge.

(function () {
    // Fresh require: drop any cached copy so "Reload" always picks up edited files.
    function freshRequire(rel) {
        const p = fsPathRelativeToPanel(rel);
        try { delete require.cache[require.resolve(p)]; } catch (_) {}
        return require(p);
    }
    const engine = freshRequire('./mark-engine.js');
    const recipes = freshRequire('./mark-recipes.js');
    const usage = freshRequire('./mark-usage.js');
    const memory = freshRequire('./mark-memory.js');
    const LEARN_FILE = fsPathRelativeToPanel('../knowledge/learned-templates.md');
    const NOTES_FILE = fsPathRelativeToPanel('../knowledge/my-notes.md');
    const backup = freshRequire('./mark-backup.js');

    const $ = (id) => document.getElementById(id);
    const el = {
        tabs: document.querySelectorAll('.mk-tab'),
        views: { chat: $('mark-chat'), recipes: $('mark-recipes'), bridge: $('mark-bridge'), log: $('mark-activity') },
        log: $('mark-log'), input: $('mark-input'), send: $('mark-send'), grip: $('mark-grip'),
        cfg: $('mark-cfg'), cfgLabel: $('mark-cfg-label'), pop: $('mark-pop'), spend: $('mark-spend'),
        modeSeg: $('mark-mode-seg'), modelOpts: $('mark-model-opts'), effortSeg: $('mark-effort-seg'),
        key: $('mark-key'), keyInput: $('mark-key-input'), keySave: $('mark-key-save'),
        keyStatus: $('mark-key-status'), keyDel: $('mark-key-del'),
        newBtn: $('mark-new'),
        rlist: $('mark-rlist'), rsearch: $('mark-rsearch'), rcount: $('mark-recipe-count'),
        conn: $('mark-conn'), connLabel: $('mark-conn-label'),
        watchBtn: $('watch-btn'), watchLabel: $('mark-watch-label'),
        consoleLog: $('console-log'), consoleSum: $('mark-console-sum'),
        mem: $('mark-mem'), memSave: $('mark-mem-save'), memInfo: $('mark-mem-info'),
        learnBtn: $('mark-learn-btn'), learnLabel: $('mark-learn-label'), learnInfo: $('mark-learn-info'),
        lessonsBtn: $('mark-lessons-btn'), lessons: $('mark-lessons')
    };

    // ---------- persisted state ----------
    const store = {
        get(k, d) { try { const v = localStorage.getItem('mark:' + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
        set(k, v) { try { localStorage.setItem('mark:' + k, JSON.stringify(v)); } catch (_) {} }
    };
    const MAX_ITEMS = 200;
    // items: { kind: 'user'|'assistant'|'actions'|'error'|'note', text?, tools?: [{name, isError}] }
    let conv = store.get('conv', null) || { sessionId: null, items: [] };
    // Mark I/II stored one 'tool' item per action; fold runs of them into 'actions'.
    conv.items = conv.items.reduce((out, it) => {
        if (it.kind !== 'tool') { out.push(it); return out; }
        const last = out[out.length - 1];
        const t = { name: it.text, isError: !!it.isError };
        if (last && last.kind === 'actions') last.tools.push(t); else out.push({ kind: 'actions', tools: [t] });
        return out;
    }, []);
    let turn = null;          // running engine turn
    function saveConv() {
        if (conv.items.length > MAX_ITEMS) conv.items = conv.items.slice(-MAX_ITEMS);
        store.set('conv', conv);
    }

    // ---------- tabs ----------
    function showTab(name) {
        if (!el.views[name]) name = 'chat';
        el.tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
        Object.keys(el.views).forEach((k) => el.views[k].classList.toggle('mk-on', k === name));
        store.set('tab', name);
        if (name === 'recipes') renderRecipes();
        if (name === 'bridge' && typeof loadMemory === 'function') { loadMemory(); syncLearning(); }
        if (name === 'chat') setTimeout(() => el.input.focus(), 0);
    }
    el.tabs.forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

    // ---------- action labels: AE label colour per kind of tool ----------
    const LABELS = {
        get_project_map: 'Reading the project', get_selection: 'Checking the selection',
        list_compositions: 'Listing comps', describe_layer: 'Reading a layer', search_project: 'Searching the project',
        knowledge_search: 'Looking up how to do it', lookup_effect: 'Looking up an effect', lookup_property: 'Looking up a property',
        get_easing: 'Reading keyframes', set_easing: 'Easing', add_keyframe: 'Keyframe', set_property: 'Changing a property',
        set_property_batch: 'Changing properties', set_expression: 'Expression', apply_effect: 'Effect',
        add_text: 'New text layer', add_shape: 'New shape layer', add_solid: 'New solid', add_null: 'New null',
        add_adjustment: 'New adjustment layer', add_camera: 'New camera', add_light: 'New light',
        set_text: 'Changing text', set_text_style: 'Text style', rename_layers: 'Renaming layers',
        delete_layer: 'Deleting a layer', duplicate_layer: 'Duplicating a layer', precompose: 'Precomposing',
        parent_layers: 'Parenting', set_in_out: 'Layer trim', trim_to_work_area: 'Trim to work area',
        create_composition: 'New comp', run_jsx: 'Script in AE', batch: 'Several changes',
        render_frame: 'Looking at a frame', render_preview_strip: 'Looking at frames', save_project: 'Saving the project',
        undo: 'Undo', redo: 'Redo'
    };
    function toolLabel(name) {
        if (LABELS[name]) return LABELS[name];
        const s = String(name || '').replace(/_/g, ' ');
        return s.charAt(0).toUpperCase() + s.slice(1);
    }
    function toolColor(name) {
        if (/^(get_|list_|lookup_|describe_|search_|sample_|knowledge|find_|audit|analyze|check_|watch_get|render_frame|render_preview|ping)/.test(name)) return '--l-seafoam';
        if (/easing|keyframe/.test(name)) return '--l-yellow';
        if (/^add_|create_|duplicate|import/.test(name)) return '--l-peach';
        if (/effect|preset|expression/.test(name)) return '--l-lavender';
        if (name === 'run_jsx' || name === 'batch') return '--l-blue';
        if (/^delete|remove/.test(name)) return '--l-red';
        if (/in_out|trim|time|work_area|split/.test(name)) return '--l-sand';
        return '--l-aqua';
    }

    // ---------- rendering ----------
    function fmt(text) {
        let h = escapeHtml(text);
        h = h.replace(/`([^`\n]+)`/g, '<code>$1</code>');
        h = h.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
        return h;
    }
    function node(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
    function scrollDown() { el.log.scrollTop = el.log.scrollHeight; }
    function clearEmpty() { const e = el.log.querySelector('.mk-empty'); if (e) e.remove(); }
    function append(n) { clearEmpty(); el.log.appendChild(n); scrollDown(); return n; }

    // A run of actions: live timeline while working, one-line summary after.
    function makeTimeline() {
        const tl = node('div', 'mk-tl');
        const head = node('div', 'mk-head');
        tl.appendChild(head);
        let n = 0;
        return {
            node: tl,
            add(t) {
                const row = node('div', 'mk-row' + (t.isError ? ' err' : ''));
                const color = 'var(' + toolColor(t.name) + ')';
                const bar = node('span', 'bar'); bar.style.background = color; bar.style.right = (18 + ((n * 37) % 45)) + '%';
                const sw = node('span', 'sw'); sw.style.background = color;
                row.appendChild(bar); row.appendChild(sw); row.appendChild(node('span', 'lbl', toolLabel(t.name)));
                row.title = t.name;
                tl.insertBefore(row, head);
                head.style.left = (28 + ((n * 23) % 50)) + '%';
                n++;
                scrollDown();
                return row;
            }
        };
    }
    function collapsedActions(item, secs) {
        const wrap = node('div');
        const n = item.tools.length, bad = item.tools.filter((t) => t.isError).length;
        const sum = node('button', 'mk-sum' + (bad ? ' err' : ''),
            n + (n === 1 ? ' action' : ' actions') + ' in AE' + (bad ? ', ' + bad + ' failed' : '') + (secs ? ', ' + secs : ''));
        const tl = makeTimeline();
        item.tools.forEach((t) => tl.add(t));
        tl.node.classList.add('done');
        tl.node.hidden = true;
        sum.addEventListener('click', () => { tl.node.hidden = !tl.node.hidden; sum.classList.toggle('open', !tl.node.hidden); });
        wrap.appendChild(sum); wrap.appendChild(tl.node);
        return wrap;
    }

    function renderItem(item) {
        if (item.kind === 'user') return append(node('div', 'mk-user', item.text));
        if (item.kind === 'assistant') { const d = node('div', 'mk-ai'); d.innerHTML = fmt(item.text); return append(d); }
        if (item.kind === 'actions') return append(collapsedActions(item));
        if (item.kind === 'error') return append(node('div', 'mk-err', item.text));
        if (item.kind === 'note') return append(node('div', 'mk-note', item.text));
    }
    function push(item) { conv.items.push(item); saveConv(); syncNew(); return renderItem(item); }
    function syncNew() { el.newBtn.classList.toggle('empty', !conv.items.length); }

    const SUGGESTIONS = ['Ease out the selected layers', 'Trim comps to their content', 'Sort the comp layers by type'];
    function renderAll() {
        el.log.innerHTML = '';
        syncNew();
        if (!conv.items.length) {
            const e = node('div', 'mk-empty');
            e.innerHTML = '<h1>What should we do in AE?</h1><p>Ask in plain words. Mark reads the project, makes the change and shows what it did.</p>';
            const s = node('div', 'mk-sugg');
            SUGGESTIONS.forEach((t) => {
                const b = node('button', null, t);
                b.addEventListener('click', () => { el.input.value = t; syncSend(); el.input.focus(); });
                s.appendChild(b);
            });
            e.appendChild(s);
            el.log.appendChild(e);
            return;
        }
        conv.items.forEach(renderItem);
    }

    let thinkingNode = null;
    function setThinking(label) {
        if (thinkingNode) { thinkingNode.remove(); thinkingNode = null; }
        if (!label) return;
        thinkingNode = append(node('div', 'mk-thinking', label));
    }

    // ---------- composer ----------
    const ICON_SEND = '<svg viewBox="0 0 14 14"><path d="M7 12V2M2.5 6.5L7 2l4.5 4.5"/></svg>';
    const ICON_STOP = '<svg viewBox="0 0 14 14"><rect x="3.5" y="3.5" width="7" height="7" rx="1" style="fill:currentColor;stroke:none"/></svg>';
    function syncSend() {
        const busy = !!turn;
        el.send.disabled = !busy && !el.input.value.trim();
        el.send.classList.toggle('stop', busy);
        el.send.title = busy ? 'Stop' : 'Send (Enter)';
        el.send.innerHTML = busy ? ICON_STOP : ICON_SEND;
        el.cfg.disabled = busy;
        el.newBtn.disabled = busy;
        el.rlist.querySelectorAll('.mk-run').forEach((b) => { b.disabled = busy; });
        fitInput();
    }

    // Text box height: grows with the text up to 120px, unless the divider was
    // dragged, then it stays at that height (remembered).
    let userH = +store.get('inputH', 0) || 0;
    function fitInput() {
        if (userH) { el.input.style.maxHeight = 'none'; el.input.style.height = userH + 'px'; return; }
        el.input.style.maxHeight = ''; el.input.style.height = 'auto';
        el.input.style.height = Math.min(el.input.scrollHeight, 120) + 'px';
    }
    (function () {
        let y0 = 0, h0 = 0;
        el.grip.addEventListener('pointerdown', (e) => {
            y0 = e.clientY; h0 = el.input.offsetHeight; el.grip.classList.add('drag');
            try { el.grip.setPointerCapture(e.pointerId); } catch (_) {}
        });
        el.grip.addEventListener('pointermove', (e) => {
            if (!el.grip.classList.contains('drag')) return;
            const maxH = Math.max(60, document.body.clientHeight - 200);
            userH = Math.round(Math.min(maxH, Math.max(38, h0 + (y0 - e.clientY))));
            fitInput();
        });
        const end = () => { if (!el.grip.classList.contains('drag')) return; el.grip.classList.remove('drag'); store.set('inputH', userH); };
        el.grip.addEventListener('pointerup', end);
        el.grip.addEventListener('pointercancel', end);
        el.grip.addEventListener('dblclick', () => { userH = 0; store.set('inputH', 0); fitInput(); });
    })();

    el.input.addEventListener('input', syncSend);
    el.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!turn && el.input.value.trim()) send(); }
    });
    el.send.addEventListener('click', () => { if (turn) turn.cancel(); else send(); });

    // ---------- account / model / effort ----------
    const MODEL_NAMES = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku' };
    const EFFORTS = ['low', 'medium', 'high', 'max'];
    const DEFAULT_MODEL = { subscription: 'opus', api: 'sonnet' };
    const cfg = { mode: store.get('mode', 'subscription'), model: 'opus', effort: 'medium' };
    if (cfg.mode !== 'api') cfg.mode = 'subscription';
    function loadModel() {
        cfg.model = store.get('model:' + cfg.mode, DEFAULT_MODEL[cfg.mode]);
        if (!MODEL_NAMES[cfg.model]) cfg.model = DEFAULT_MODEL[cfg.mode];
        let ef = store.get('effort:' + cfg.mode, 'medium');
        if (ef === 'xhigh') ef = 'high';
        cfg.effort = EFFORTS.indexOf(ef) >= 0 ? ef : 'medium';
    }
    function pressed(container, value) {
        container.querySelectorAll('button[data-v]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === value)));
    }
    function syncCfg() {
        pressed(el.modeSeg, cfg.mode); pressed(el.modelOpts, cfg.model); pressed(el.effortSeg, cfg.effort);
        el.cfgLabel.innerHTML = (cfg.mode === 'api' ? '<span class="api">API</span> ' : '') + MODEL_NAMES[cfg.model] + ', ' + cfg.effort;
        el.cfg.title = (cfg.mode === 'api' ? 'Paying with API credits. ' : 'Using your Claude subscription. ') + 'Click to change account, model or effort.';
        el.key.hidden = cfg.mode !== 'api';
        updateSpend();
    }
    el.modeSeg.querySelectorAll('button').forEach((b) => b.addEventListener('click', async () => {
        cfg.mode = b.dataset.v; store.set('mode', cfg.mode); loadModel(); syncCfg();
        if (cfg.mode === 'api' && !(await refreshKeyStatus())) el.keyInput.focus();
    }));
    el.modelOpts.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        cfg.model = b.dataset.v; store.set('model:' + cfg.mode, cfg.model); syncCfg();
    }));
    el.effortSeg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        cfg.effort = b.dataset.v; store.set('effort:' + cfg.mode, cfg.effort); syncCfg();
    }));
    el.cfg.addEventListener('click', (e) => {
        e.stopPropagation();
        el.pop.classList.toggle('on');
        if (el.pop.classList.contains('on') && cfg.mode === 'api') refreshKeyStatus();
    });
    document.addEventListener('click', (e) => { if (!el.pop.contains(e.target) && !el.cfg.contains(e.target)) el.pop.classList.remove('on'); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') el.pop.classList.remove('on'); });

    async function refreshKeyStatus() {
        const has = await engine.hasApiKey();
        el.keyStatus.innerHTML = has ? '<span class="ok">Key saved in the macOS Keychain.</span>' : 'No key saved yet.';
        el.keyDel.hidden = !has;
        return has;
    }
    el.keySave.addEventListener('click', async () => {
        const k = el.keyInput.value.trim();
        if (!k) return;
        try { await engine.setApiKey(k); el.keyInput.value = ''; await refreshKeyStatus(); }
        catch (e) { el.keyStatus.textContent = e.message; }
    });
    el.keyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.keySave.click(); });
    el.keyDel.addEventListener('click', async () => { await engine.deleteApiKey(); refreshKeyStatus(); });

    function updateSpend() {
        const t = usage.today();
        const api = cfg.mode === 'api';
        el.spend.textContent = 'today $' + (api ? t.api : t.subscription).toFixed(2);
        el.spend.title = 'Spent today at API prices.\nSubscription: $' + t.subscription.toFixed(2) +
            ' (not billed; shows how fast the weekly limit goes)\nAPI credits: $' + t.api.toFixed(2) + ' (billed)' +
            (conv.sessionId ? '\n\nSession ' + conv.sessionId : '');
    }

    // ---------- AE context sent with each message ----------
    // A snapshot of project, active comp and selection, so Claude does not spend a
    // step (and tokens) asking AE what is selected.
    function withTimeout(p, ms) { return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]); }
    async function aeContext() {
        try {
            const s = await withTimeout(callJsxDispatch('get_quick_state', {}), 1500);
            if (!s || !s.open) return '[AE context at send time: no project open]';
            const parts = ['project ' + (s.projectFile ? s.projectFile.split(/[\\/]/).pop() : 'not saved yet') + (s.dirty ? ' (unsaved changes)' : '')];
            if (s.activeCompName) {
                parts.push('active comp "' + s.activeCompName + '" (id ' + s.activeCompId + ')' +
                    (s.compTime != null && isFinite(s.compTime) ? ' at ' + Number(s.compTime).toFixed(2) + ' s' : ''));
                const sel = s.selection || [];
                parts.push(sel.length
                    ? sel.length + (sel.length === 1 ? ' selected layer: ' : ' selected layers: ') +
                      sel.slice(0, 25).map((l) => l.index + ' "' + l.name + '"').join(', ') + (sel.length > 25 ? ', and more' : '')
                    : 'no layers selected');
            } else {
                parts.push('no comp active');
            }
            return '[AE context at send time: ' + parts.join('; ') + ']';
        } catch (_) { return ''; }
    }

    // ---------- one Ctrl+Z per answer (beta) ----------
    // Opens one AE undo group for the whole answer. Portal tools see _undoDepth > 0 and
    // join it instead of opening their own; run_jsx turns a script's own
    // begin/endUndoGroup into no-ops while it is open (patches in host/).
    let undoGroup = store.get('undoGroup', false);
    const UNDO_END = '(function(){ if (!$.global.__markUndoOpen) return "none"; $.global.__markUndoOpen = false; _undoDepth = 0; app.endUndoGroup(); return "closed"; })()';
    function undoBegin(label) {
        if (!undoGroup) return Promise.resolve(false);
        const script = '(function(){ if ($.global.__markUndoOpen || _undoDepth > 0) return "busy"; app.beginUndoGroup(' +
            JSON.stringify('Mark: ' + label.slice(0, 40)) + '); _undoDepth = 1; $.global.__markUndoOpen = true; return "open"; })()';
        return withTimeout(callJsxDispatch('run_jsx', { script }), 2000).then((r) => r === 'open', () => false);
    }
    function undoEnd() { return withTimeout(callJsxDispatch('run_jsx', { script: UNDO_END }), 2000).catch(() => null); }

    // ---------- sending ----------
    async function send() {
        const prompt = el.input.value.trim();
        if (!prompt || turn) return;
        el.input.value = '';
        el.pop.classList.remove('on');
        const oldOffer = el.log.querySelector('.mk-after');
        if (oldOffer) oldOffer.remove();
        push({ kind: 'user', text: prompt });
        setThinking('Thinking');
        // Placeholder while the AE snapshot is read, so Stop works from the first click.
        let aborted = false;
        turn = { cancel() { aborted = true; } };
        syncSend();
        const ctx = await aeContext();
        const grouped = await undoBegin(prompt);

        const serverEnv = {};
        // Pin the chat to the AE this panel lives in, so a second AE (2025 + 2026)
        // never makes the tools ask "which instance?".
        if (typeof discoveryPort !== 'undefined' && discoveryPort != null) serverEnv.AE_PORTAL_PORT = String(discoveryPort);

        const t0 = Date.now();
        const groups = [];          // { item, tl, rows } per run of actions
        let group = null;
        let live = null, liveText = '', allText = '';
        // Only a turn that changed something in AE (not just read it) is worth a recipe.
        const isRead = (name) => toolColor(name) === '--l-seafoam';
        let changes = 0;

        function endText() {
            const shown = memory.strip(liveText);
            if (live && shown) { live.innerHTML = fmt(shown); conv.items.push({ kind: 'assistant', text: shown }); saveConv(); }
            else if (live) live.remove();
            live = null; liveText = '';
        }

        const opts = {
            prompt: ctx ? ctx + '\n\n' + prompt : prompt,
            sessionId: conv.sessionId,
            mode: cfg.mode,
            model: cfg.model,
            effort: cfg.effort,
            serverJs: SERVER_JS_PATH,
            serverEnv,
            extraSystem: memory.systemPrompt({ learning }),
            onEvent(ev) {
                if (ev.type === 'session') {
                    conv.sessionId = ev.id; saveConv();
                } else if (ev.type === 'text') {
                    setThinking(null);
                    group = null;
                    if (!live) live = append(node('div', 'mk-ai'));
                    liveText += ev.text;
                    allText += ev.text;
                    live.innerHTML = fmt(memory.strip(liveText));
                    scrollDown();
                } else if (ev.type === 'text_end') {
                    endText();
                } else if (ev.type === 'tool' && ev.name === 'ToolSearch') {
                    // Loading a deferred Portal tool: plumbing, not an AE action.
                    endText();
                    if (!group) setThinking('Getting the right tool');
                } else if (ev.type === 'tool') {
                    endText();
                    setThinking(null);
                    if (!group) {
                        group = { item: { kind: 'actions', tools: [] }, tl: makeTimeline(), rows: [] };
                        groups.push(group);
                        conv.items.push(group.item);
                        append(group.tl.node);
                    }
                    const t = { name: ev.name, isError: false };
                    group.item.tools.push(t);
                    group.rows.push(group.tl.add(t));
                    if (!isRead(ev.name)) changes++;
                    saveConv();
                } else if (ev.type === 'tool_result') {
                    if (ev.isError && group && group.rows.length) {
                        const failed = group.item.tools[group.item.tools.length - 1];
                        failed.isError = true;
                        if (!isRead(failed.name)) changes--;
                        const row = group.rows[group.rows.length - 1];
                        row.classList.add('err'); row.title += '\n\n' + ev.text;
                        saveConv();
                    }
                } else if (ev.type === 'done' || ev.type === 'error') {
                    endText();
                    setThinking(null);
                    turn = null;
                    // Always close when the beta is on: a slow AE may have opened the group after the timeout.
                    if (grouped || undoGroup) undoEnd();
                    const secs = ((Date.now() - t0) / 1000).toFixed(1) + ' s';
                    // Fold each live timeline into its one-line summary.
                    groups.forEach((g, i) => {
                        g.tl.node.replaceWith(collapsedActions(g.item, i === groups.length - 1 ? secs : ''));
                    });
                    if (ev.type === 'error') {
                        push({ kind: 'error', text: ev.message });
                        if (typeof log === 'function') log('mark: ' + ev.message, 'err');
                    } else if (ev.cancelled) {
                        push({ kind: 'note', text: 'Stopped.' });
                    } else {
                        if (ev.sessionId) { conv.sessionId = ev.sessionId; saveConv(); }
                        try { usage.add(cfg.mode, ev.costUsd); } catch (_) {}
                        applyTags(allText);
                        if (ev.isError) push({ kind: 'error', text: engine.friendlyError(ev.text) || 'Something went wrong. Try again.' });
                        else if (changes > 0) showSaveOffer(prompt);
                    }
                    updateSpend();
                    syncSend();
                    backupSoon();
                    el.input.focus();
                }
            }
        };
        if (aborted) { turn = null; opts.onEvent({ type: 'done', cancelled: true }); return; }
        turn = engine.runTurn(opts);
        syncSend();
    }

    el.newBtn.addEventListener('click', () => {
        if (turn) return;
        conv = { sessionId: null, items: [] };
        saveConv();
        renderAll();
        updateSpend();
        showTab('chat');
        el.input.focus();
    });

    // ---------- save as recipe ----------
    function showSaveOffer(sourcePrompt) {
        const after = append(node('div', 'mk-after'));
        const btn = node('button', 'mk-chip', 'Save as recipe');
        btn.title = 'Turn this into a button that repeats it in AE, with no AI';
        after.appendChild(btn);
        btn.addEventListener('click', () => {
            after.innerHTML = '';
            const row = node('div', 'mk-saverow');
            const name = node('input'); name.placeholder = 'Recipe name';
            const ok = node('button', 'mk-chip', 'Save');
            row.appendChild(name); row.appendChild(ok); after.appendChild(row);
            name.focus();
            const go = () => { const n = name.value.trim(); if (n) { after.remove(); createRecipe(n, sourcePrompt); } };
            ok.addEventListener('click', go);
            name.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); if (e.key === 'Escape') after.remove(); });
        });
    }

    // One text-only turn in the same conversation: the AI writes the script but
    // has no tools, so it cannot touch AE while doing it.
    function createRecipe(name, sourcePrompt) {
        if (turn) return;
        setThinking('Writing the recipe');
        let text = '';
        turn = engine.runTurn({
            prompt: recipes.buildPrompt(name),
            sessionId: conv.sessionId,
            mode: cfg.mode,
            model: cfg.model,
            effort: cfg.effort,
            toolsOff: true,
            onEvent(ev) {
                if (ev.type === 'text') text += ev.text;
                if (ev.type !== 'done' && ev.type !== 'error') return;
                turn = null;
                setThinking(null);
                syncSend();
                if (ev.type === 'error') { push({ kind: 'error', text: ev.message }); return; }
                if (ev.cancelled) { push({ kind: 'note', text: 'Stopped.' }); return; }
                if (ev.sessionId) { conv.sessionId = ev.sessionId; saveConv(); }
                try { usage.add(cfg.mode, ev.costUsd); } catch (_) {}
                updateSpend();
                const script = recipes.extractScript(text || ev.text);
                if (!script) { push({ kind: 'error', text: 'Could not make the recipe: the reply was not a script. Try again.' }); return; }
                const hit = (typeof manualHardBlockHit === 'function') ? manualHardBlockHit({ script }) : null;
                if (hit) { push({ kind: 'error', text: 'Recipe refused: the script uses ' + hit.pat + ', which can freeze AE.' }); return; }
                recipes.add({ name, script, sourcePrompt });
                updateCount();
                backupSoon();
                conv.items.push({ kind: 'note', text: 'Recipe “' + name + '” saved.' }); saveConv();
                const n = append(node('div', 'mk-note', 'Recipe “' + name + '” saved. '));
                const a = node('a', null, 'Open in Recipes');
                a.addEventListener('click', () => showTab('recipes'));
                n.appendChild(a);
            }
        });
        syncSend();
    }

    // ---------- recipes tab ----------
    function fmtDate(iso) {
        try {
            const d = new Date(iso);
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' +
                d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        } catch (_) { return ''; }
    }
    function updateCount() { const n = recipes.load().length; el.rcount.textContent = n ? String(n) : ''; }

    function renderRecipes() {
        const all = recipes.load();
        updateCount();
        el.rsearch.hidden = all.length < 6;
        const q = el.rsearch.value.trim().toLowerCase();
        const list = all.slice().reverse().filter((r) => !q || r.name.toLowerCase().indexOf(q) >= 0 ||
            String(r.sourcePrompt || '').toLowerCase().indexOf(q) >= 0);
        el.rlist.innerHTML = '';
        if (!all.length) {
            el.rlist.innerHTML = '<div class="mk-rempty"><b>No recipes yet</b>When Mark does something you like, click “Save as recipe” under the reply. It becomes a button that repeats it without AI.</div>';
            return;
        }
        list.forEach((r) => el.rlist.appendChild(recipeRow(r)));
    }
    el.rsearch.addEventListener('input', renderRecipes);

    function recipeRow(r) {
        const row = node('div', 'mk-r');
        const name = node('span', 'mk-rname', r.name); name.title = r.name;
        const run = node('button', 'mk-run');
        run.innerHTML = '<svg viewBox="0 0 10 10"><path d="M2 1l7 4-7 4z"/></svg>Run';
        run.title = 'Run on the current selection. Ctrl+Z undoes it.';
        run.disabled = !!turn;
        const more = node('button', 'mk-ibtn');
        more.title = 'More';
        more.innerHTML = '<svg viewBox="0 0 16 16"><circle cx="3.5" cy="8" r=".6"/><circle cx="8" cy="8" r=".6"/><circle cx="12.5" cy="8" r=".6"/></svg>';
        row.appendChild(node('span', 'sw')); row.appendChild(name); row.appendChild(run); row.appendChild(more);
        if (r.sourcePrompt) { const sub = node('span', 'mk-rsub', '“' + r.sourcePrompt + '”'); sub.title = r.sourcePrompt; row.appendChild(sub); }
        if (r.lastRunAt) {
            row.appendChild(node('span', 'mk-rres ' + (r.lastRunOk ? 'ok' : 'err'),
                (r.lastRunOk ? '✓ ' : '✗ ') + (r.lastRunMessage || '') + ', ' + fmtDate(r.lastRunAt)));
        }

        run.addEventListener('click', async () => {
            run.disabled = true; run.textContent = 'Running…';
            const res = await runRecipe(r);
            recipes.markRun(r.id, res.ok, res.message);
            renderRecipes();
            backupSoon();
        });

        more.addEventListener('click', () => {
            const open = row.querySelector('.mk-rmenu');
            if (open) { open.remove(); const c = row.querySelector('.mk-rcode'); if (c) c.remove(); return; }
            const m = node('div', 'mk-rmenu');
            const code = node('button', 'mk-link', 'View script');
            const ren = node('button', 'mk-link', 'Rename');
            const del = node('button', 'mk-link danger', 'Delete');
            const meta = node('span', 'mk-rmeta', 'created ' + fmtDate(r.createdAt) +
                (r.runs ? ', used ' + r.runs + (r.runs === 1 ? ' time' : ' times') : ''));
            code.addEventListener('click', () => {
                const c = row.querySelector('.mk-rcode');
                if (c) { c.remove(); code.textContent = 'View script'; return; }
                row.appendChild(node('pre', 'mk-rcode', r.script)); code.textContent = 'Hide script';
            });
            ren.addEventListener('click', () => {
                const inp = node('input'); inp.value = r.name;
                name.textContent = ''; name.appendChild(inp); inp.focus(); inp.select();
                let done = false;
                const finish = (save) => {
                    if (done) return; done = true;
                    const n = inp.value.trim();
                    if (save && n && n !== r.name) { recipes.rename(r.id, n); backupSoon(); }
                    renderRecipes();
                };
                inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
                inp.addEventListener('blur', () => finish(true));
            });
            del.addEventListener('click', () => {
                // Two-step delete: first click arms, second (within 3 s) confirms.
                if (del.dataset.armed) { recipes.remove(r.id); renderRecipes(); backupSoon(); return; }
                del.dataset.armed = '1'; del.textContent = 'Confirm delete';
                setTimeout(() => { delete del.dataset.armed; del.textContent = 'Delete'; }, 3000);
            });
            m.appendChild(code); m.appendChild(ren); m.appendChild(del); m.appendChild(meta);
            row.appendChild(m);
        });
        return row;
    }

    async function runRecipe(r) {
        if (turn) return { ok: false, message: 'Wait for the chat reply to finish.' };
        const hit = (typeof manualHardBlockHit === 'function') ? manualHardBlockHit({ script: r.script }) : null;
        if (hit) return { ok: false, message: 'Blocked: uses ' + hit.pat };
        try {
            const res = await callJsxDispatch('run_jsx', { script: recipes.wrapForRun(r) });
            return { ok: true, message: (typeof res === 'string' && res) ? res : 'done' };
        } catch (e) {
            return { ok: false, message: String(e.message || e).replace(/^Error:\s*/, '') };
        }
    }

    // ---------- bridge: status in plain words ----------
    try { if (typeof PANEL_VERSION !== 'undefined') $('version-tag').textContent = PANEL_VERSION; } catch (_) {}
    function syncConn() {
        const dot = $('conn-dot');
        let label = 'AE';
        try {
            if (typeof lastPong !== 'undefined' && lastPong && lastPong.aeVersion) {
                const major = parseInt(String(lastPong.aeVersion), 10);
                if (major) label = 'AE ' + (2000 + major);
            }
        } catch (_) {}
        el.connLabel.textContent = label;
        el.conn.title = label + ': ' + (dot.classList.contains('ok') ? 'an AI client is connected right now (the chat, Claude Code or Codex).'
            : dot.classList.contains('warn') ? 'ready. No AI client is connected right now.'
            : 'the bridge is not running. Click Reload.');
    }
    setInterval(syncConn, 1500);
    syncConn();

    // Recording switch: main.js toggles .active on #watch-btn; mirror it in words.
    function syncWatch() {
        const on = el.watchBtn.classList.contains('active');
        el.watchBtn.setAttribute('aria-checked', String(on));
        el.watchLabel.textContent = on ? 'Recording your changes' : 'Recording off';
    }
    new MutationObserver(syncWatch).observe(el.watchBtn, { attributes: true, attributeFilter: ['class'] });
    syncWatch();

    // Console summary: how many errors are waiting there.
    function syncConsole() {
        const n = el.consoleLog.querySelectorAll('.line.err').length;
        el.consoleSum.textContent = n ? n + (n === 1 ? ' error' : ' errors') : '';
    }
    new MutationObserver(syncConsole).observe(el.consoleLog, { childList: true });
    syncConsole();

    // ---------- memory + learning ----------
    let learning = store.get('learning', true);
    function applyTags(text) {
        const t = memory.parse(text);
        t.remember.forEach((f) => { if (memory.remember(f)) push({ kind: 'note', text: 'Saved to memory: ' + f }); });
        t.forget.forEach((w) => { const n = memory.forget(w); if (n) push({ kind: 'note', text: 'Removed from memory: ' + w }); });
        if (learning) {
            t.learn.forEach((l) => {
                try { if (memory.learn(LEARN_FILE, l.title, l.body)) push({ kind: 'note', text: 'Learned: ' + (l.title || 'a new lesson') }); }
                catch (e) { push({ kind: 'error', text: 'Could not save the lesson: ' + e.message }); }
            });
        }
        if (t.remember.length || t.forget.length) loadMemory(true);
        if (t.learn.length) syncLearning();
    }

    let memDirty = false;
    function memStats() {
        const text = el.mem.value;
        const n = text.split('\n').filter((l) => l.trim()).length;
        const tokens = Math.round(text.length / 4);
        el.memInfo.innerHTML = n + (n === 1 ? ' line' : ' lines') + ', about ' + tokens + ' tokens per message' +
            (text.length > memory.MAX_CHARS ? '. <span class="warn">Too long: only the first ' + memory.MAX_CHARS + ' characters are used.</span>' : '');
    }
    function loadMemory(force) {
        if (memDirty && !force) return;
        try { el.mem.value = memory.load().replace(/\n$/, ''); } catch (e) { el.memInfo.textContent = e.message; return; }
        memDirty = false; el.memSave.disabled = true; memStats();
    }
    el.mem.addEventListener('input', () => { memDirty = true; el.memSave.disabled = false; memStats(); });
    el.memSave.addEventListener('click', () => {
        try { memory.save(el.mem.value); memDirty = false; el.memSave.disabled = true; memStats(); backupSoon(); }
        catch (e) { el.memInfo.textContent = 'Could not save: ' + e.message; }
    });

    function syncLearning() {
        el.learnBtn.classList.toggle('active', learning);
        el.learnBtn.setAttribute('aria-checked', String(learning));
        el.learnLabel.textContent = learning ? 'Learning on' : 'Learning off';
        const list = memory.lessons(LEARN_FILE);
        el.learnInfo.textContent = list.length ? list.length + (list.length === 1 ? ' lesson learned.' : ' lessons learned.') : 'No lessons yet.';
        el.lessonsBtn.hidden = !list.length;
        el.lessons.innerHTML = '';
        list.slice().reverse().forEach((l) => {
            const li = node('li', null, l.title + ' ');
            li.appendChild(node('span', null, l.date));
            el.lessons.appendChild(li);
        });
    }
    el.learnBtn.addEventListener('click', () => { learning = !learning; store.set('learning', learning); syncLearning(); });
    el.lessonsBtn.addEventListener('click', () => {
        el.lessons.hidden = !el.lessons.hidden;
        el.lessonsBtn.textContent = el.lessons.hidden ? 'Show' : 'Hide';
    });
    loadMemory();
    syncLearning();

    // ---------- backup ----------
    let backupTimer = null;
    function syncBackup(res) {
        const cell = $('mark-backup');
        if (!cell) return;
        if (res && !res.ok) { cell.textContent = 'Off: ' + res.reason; return; }
        const at = (res && res.at) || backup.last();
        cell.textContent = at ? 'Last copy ' + fmtDate(at) : 'No copy yet';
        cell.title = backup.DIR;
    }
    function backupSoon() {
        clearTimeout(backupTimer);
        backupTimer = setTimeout(() => {
            try { syncBackup(backup.run([LEARN_FILE, NOTES_FILE])); } catch (e) { const c = $('mark-backup'); if (c) c.textContent = 'Failed: ' + e.message; }
        }, 1500);
    }
    syncBackup();
    backupSoon();

    function syncUndo() {
        const b = $('mark-undo-btn');
        b.classList.toggle('active', undoGroup);
        b.setAttribute('aria-checked', String(undoGroup));
        $('mark-undo-label').textContent = undoGroup ? 'On: one Ctrl+Z undoes a whole answer' : 'Off';
    }
    $('mark-undo-btn').addEventListener('click', () => { undoGroup = !undoGroup; store.set('undoGroup', undoGroup); syncUndo(); });
    syncUndo();
    // A reload in the middle of an answer can leave the group open: close it now.
    undoEnd();

    // ---------- reload (like Vortex): host JSX + panel, no AE restart ----------
    async function reloadAll() {
        if (turn) { showTab('chat'); push({ kind: 'note', text: 'Wait for the reply to finish (or press Stop) before reloading.' }); return; }
        if (typeof ui !== 'undefined' && ui.reloadBtn) ui.reloadBtn.classList.add('spinning');
        try {
            if (typeof PANEL_METHODS !== 'undefined' && PANEL_METHODS.reload_host) await PANEL_METHODS.reload_host();
        } catch (e) {
            if (typeof log === 'function') log('reload_host: ' + e.message, 'err');
        }
        setTimeout(() => window.location.reload(), 50);
    }
    // Plain click on reload = host + panel; Alt+click keeps the Portal's host-only reload.
    const reloadBtn = $('reload-btn');
    reloadBtn.title = 'Reload Mark (no need to restart AE). Alt+click: reload only the AE scripts';
    reloadBtn.addEventListener('click', (e) => {
        if (e.altKey) return;
        e.stopImmediatePropagation();
        reloadAll();
    }, true);
    // Panel flyout menu (≡ at the panel's top-right corner), same as Vortex.
    const FLYOUT_RELOAD = 'mark.reload';
    try {
        if (typeof cs !== 'undefined' && cs.setPanelFlyoutMenu) {
            cs.setPanelFlyoutMenu('<Menu><MenuItem Id="' + FLYOUT_RELOAD + '" Label="Reload panel" Enabled="true"/></Menu>');
            cs.addEventListener('com.adobe.csxs.events.flyoutMenuClicked', (ev) => {
                const d = ev && ev.data;
                const id = typeof d === 'string' ? d : (d && d.menuId);
                if (id === FLYOUT_RELOAD) reloadAll();
            });
        }
    } catch (_) {}
    // A reload or panel close must not leave a Claude process running in the background.
    window.addEventListener('beforeunload', () => { try { if (turn) turn.cancel(); } catch (_) {} });

    // ---------- boot ----------
    loadModel();
    syncCfg();
    renderAll();
    updateCount();
    syncSend();
    const savedTab = store.get('tab', 'chat');
    showTab(savedTab === 'portal' ? 'bridge' : savedTab);
})();
