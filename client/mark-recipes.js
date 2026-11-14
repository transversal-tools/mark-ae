// Mark — recipes.
// A recipe is one ExtendScript the AI writes ONCE from a conversation the user
// approved; after that it runs from a button with no AI at all (no tokens, instant).
// Stored as JSON next to the chat workspace so it survives panel reloads and can be
// read or edited by hand.

const fs = require('fs');
const os = require('os');
const path = require('path');

const FILE = path.join(require('./mark-paths.js').DATA, 'recipes.json');

function load() {
    try {
        const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
        return Array.isArray(j.recipes) ? j.recipes : [];
    } catch (_) { return []; }
}

function save(recipes) {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, recipes }, null, 2));
    fs.renameSync(tmp, FILE);
}

function add(recipe) {
    const recipes = load().filter((r) => r.name.toLowerCase() !== recipe.name.toLowerCase());
    const r = Object.assign({ id: Date.now().toString(36), createdAt: new Date().toISOString() }, recipe);
    recipes.push(r);
    save(recipes);
    return r;
}

function remove(id) { save(load().filter((r) => r.id !== id)); }

function rename(id, name) {
    save(load().map((r) => (r.id === id ? Object.assign({}, r, { name }) : r)));
}

// Remember the last run so the Receitas tab can show it.
function markRun(id, ok, message) {
    save(load().map((r) => (r.id === id
        ? Object.assign({}, r, { lastRunAt: new Date().toISOString(), lastRunOk: ok, lastRunMessage: String(message || '').slice(0, 300), runs: (r.runs || 0) + 1 })
        : r)));
}

// The turn that writes the recipe runs with NO tools, so it cannot touch AE.
function buildPrompt(name) {
    return [
        'Turn what you just did in After Effects in this conversation into ONE reusable ExtendScript recipe called "' + name + '".',
        'It will run later from a button, without you, on whatever the user has active and selected at that moment.',
        'Rules:',
        '- A single expression: (function(){ ... })()',
        '- Work on app.project.activeItem and its selectedLayers (or, if the original request was about something else, find it generically). Never hard-code names, ids or indices of comps or layers from this project unless the user asked for those exact names.',
        '- If nothing suitable is active or selected, throw new Error("...") with a short English message saying what to select.',
        '- Do not call app.beginUndoGroup / app.endUndoGroup: the runner already wraps the recipe in one undo step.',
        '- No alert(), no dialogs, no file or system access, no app.executeCommand, app.open or app.newProject.',
        '- Plain ExtendScript (ES3): var, no arrow functions, no let/const, no template strings.',
        '- Return a short English string saying what changed, e.g. "3 layers eased out".',
        'Reply with only the code, in one ```jsx block.'
    ].join('\n');
}

function extractScript(text) {
    const m = /```(?:jsx|javascript|js|extendscript)?\s*\n([\s\S]*?)```/i.exec(text || '');
    const code = (m ? m[1] : '').trim();
    return /^\(?\s*function\s*\(/.test(code) ? code : null;
}

// Wrap for run_jsx: one undo step named after the recipe. withUndo is the Portal's
// own helper (host/mark-actions.jsx), already in run_jsx scope.
function wrapForRun(recipe) {
    return 'withUndo(' + JSON.stringify('Mark: ' + recipe.name) + ', function () { return ' + recipe.script + '; })';
}

module.exports = { FILE, load, add, remove, rename, markRun, buildPrompt, extractScript, wrapForRun };
