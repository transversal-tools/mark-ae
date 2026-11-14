// Mark — memory and learning.
// The chat runs without file tools, so Claude cannot write to disk itself. Instead
// it adds small hidden tags to its reply and the panel does the writing, only to
// two places:
//   <mark-remember>fact</mark-remember>   -> one line in memory.md (read every chat)
//   <mark-forget>words</mark-forget>      -> removes matching lines from memory.md
//   <mark-learn title="...">...</mark-learn> -> a lesson appended to the Portal's
//      knowledge/learned-templates.md, which knowledge_search already reads.

const fs = require('fs');
const os = require('os');
const path = require('path');

const FILE = path.join(require('./mark-paths.js').DATA, 'memory.md');
const MAX_CHARS = 4000;    // read with every message, so keep it short
const SEED = '';  // starts empty: the chat fills it as it learns about whoever uses it

function load() {
    try { return fs.readFileSync(FILE, 'utf8'); }
    catch (_) { save(SEED); return SEED; }
}

function save(text) {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, String(text || '').replace(/\s+$/, '') + '\n');
    fs.renameSync(tmp, FILE);
}

function lines(text) { return String(text || '').split('\n').filter((l) => l.trim()); }

function remember(fact) {
    fact = String(fact || '').replace(/\s+/g, ' ').trim();
    if (!fact) return false;
    const text = load();
    const key = fact.toLowerCase();
    if (lines(text).some((l) => l.replace(/^[-*]\s*/, '').trim().toLowerCase() === key)) return false;
    save((text.trim() ? text.replace(/\s+$/, '') + '\n' : '') + '- ' + fact);
    return true;
}

function forget(words) {
    const key = String(words || '').trim().toLowerCase();
    if (!key) return 0;
    const all = lines(load());
    const keep = all.filter((l) => l.toLowerCase().indexOf(key) < 0);
    if (keep.length !== all.length) save(keep.join('\n'));
    return all.length - keep.length;
}

// ---------- lessons (Portal knowledge base) ----------
function dayKey() {
    const d = new Date(), p = (n) => (n < 10 ? '0' : '') + n;
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// Same format as the Portal's own self-learning: ## heading + provenance marker.
function learn(learnFile, title, body) {
    title = String(title || '').replace(/\s+/g, ' ').trim() || 'Untitled lesson';
    body = String(body || '').trim();
    if (!body) return false;
    let text = '';
    try { text = fs.readFileSync(learnFile, 'utf8'); } catch (_) {}
    text = text.replace('<!-- No entries yet. The first user-confirmed reusable pattern will land here. -->\n', '');
    const entry = '\n## ' + title + '\n<!-- learned ' + dayKey() + ' (Mark chat) -->\n' + body + '\n';
    fs.writeFileSync(learnFile, text.replace(/\s+$/, '') + '\n' + entry);
    return true;
}

function lessons(learnFile) {
    let text = '';
    try { text = fs.readFileSync(learnFile, 'utf8'); } catch (_) { return []; }
    const out = [];
    const re = /^## (.+)\n<!-- learned (\d{4}-\d{2}-\d{2})/gm;
    let m;
    while ((m = re.exec(text))) out.push({ title: m[1].trim(), date: m[2] });
    return out;
}

// ---------- reply tags ----------
const TAG_RE = /<mark-(remember|forget)>([\s\S]*?)<\/mark-\1>|<mark-learn(?:\s+title="([^"]*)")?>([\s\S]*?)<\/mark-learn>/g;

function parse(text) {
    const out = { remember: [], forget: [], learn: [] };
    String(text || '').replace(TAG_RE, (all, kind, inner, title, body) => {
        if (kind === 'remember') out.remember.push(inner.trim());
        else if (kind === 'forget') out.forget.push(inner.trim());
        else out.learn.push({ title: title || '', body: (body || '').trim() });
        return '';
    });
    return out;
}

// Hide tags from what the user sees, including a tag still being streamed.
function strip(text) {
    return String(text || '')
        .replace(TAG_RE, '')
        .replace(/<mark-(remember|forget|learn)\b[\s\S]*$/, '')
        .replace(/<(?:m(?:a(?:r(?:k(?:-[a-z]*)?)?)?)?)?$/, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function systemPrompt(opts) {
    const parts = [];
    const mem = load().trim();
    parts.push('# Mark memory',
        'Lasting facts and preferences about this user. Follow them unless the user says otherwise in this chat:',
        '<memory>', mem.slice(0, MAX_CHARS), '</memory>',
        'When the user asks you to remember something, or states a lasting preference about how they work, save it with one hidden tag: <mark-remember>short fact, in English</mark-remember>.',
        'When they ask you to forget something: <mark-forget>a few words from that line</mark-forget>.',
        'Only lasting preferences, never one-off details of the current project. The panel hides these tags, so also say in plain words what you saved or removed.');
    if (opts && opts.learning) {
        parts.push('', '# Learning mode is on',
            'When you solve a non-trivial After Effects or ExtendScript problem, or the user explicitly confirms that an approach worked ("perfect", "that\'s it", "funcionou"), save it for next time with one hidden tag:',
            '<mark-learn title="short title">One line saying when to use it, then the fix or a ```jsx snippet.</mark-learn>',
            'Before saving, use knowledge_search on the topic and skip it if it is already known. Never save trivial things, one-off project details, or anything the user asked you to redo. Lessons go into the Portal knowledge base that knowledge_search reads.');
    }
    return parts.join('\n');
}

module.exports = { FILE, MAX_CHARS, load, save, remember, forget, learn, lessons, parse, strip, systemPrompt };
