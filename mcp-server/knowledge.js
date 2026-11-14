// AE Portal — knowledge index.
// Parses the bundled knowledge files at startup into in-memory structures,
// then exposes fast lookup tools (effect matchnames, property matchnames, expressions).

const fs = require('fs');
const path = require('path');

const LOCAL_KNOWLEDGE_DIR = path.join(__dirname, '..', 'knowledge');
// Use the bundled copy. Override via env only (no personal-path default).
const KNOWLEDGE_DIR = process.env.AE_PORTAL_KNOWLEDGE_DIR || LOCAL_KNOWLEDGE_DIR;

let _effects = null;
let _properties = null;
let _expressions = null;
let _allKnowledge = null;

function readSafe(rel) {
    const full = path.join(KNOWLEDGE_DIR, rel);
    if (!fs.existsSync(full)) return null;
    return fs.readFileSync(full, 'utf8');
}

// ---------------- effect matchnames ----------------
function parseEffectMatchNames() {
    const text = readSafe('effect-match-names.md');
    if (!text) return [];
    const out = [];
    let category = '';
    const lines = text.split('\n');
    let inJsx = false;
    for (const line of lines) {
        const cat = line.match(/^##\s+(.+?)\s*$/);
        if (cat) { category = cat[1].trim(); continue; }
        if (/^```jsx/.test(line)) { inJsx = true; continue; }
        if (/^```/.test(line))    { inJsx = false; continue; }
        if (!inJsx) continue;
        // "ADBE matchName"   // Display Name (any padding)
        const m = line.match(/^\s*"([^"]+)"\s*\/\/\s*(.+?)\s*$/);
        if (m) {
            out.push({ matchName: m[1], displayName: m[2], category });
        }
    }
    return out;
}

// ---------------- property matchnames ----------------
function parsePropertyMatchNames() {
    const text = readSafe('property-match-names.md');
    if (!text) return [];
    const out = [];
    let category = '';
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const cat = line.match(/^##\s+(.+?)\s*$/);
        if (cat) { category = cat[1].trim(); continue; }
        // Markdown table rows: | UI Name | `ADBE matchName` | access |
        if (/^\s*\|/.test(line) && /\|/.test(line.slice(1))) {
            // skip header / separator
            if (/^\s*\|\s*-+/.test(line)) continue;
            if (/UI Name|Match Name|---/.test(line) && /Match Name|---/.test(line)) continue;
            const cells = line.split('|').map(s => s.trim()).filter(Boolean);
            if (cells.length < 2) continue;
            const ui = cells[0];
            // matchName might be wrapped in backticks
            const mnRaw = cells[1].replace(/`/g, '').trim();
            if (!mnRaw || ui.toLowerCase() === 'ui name') continue;
            out.push({
                displayName: ui,
                matchName: mnRaw,
                category,
                access: cells[2] || ''
            });
        }
    }
    return out;
}

// ---------------- expressions ----------------
function parseExpressions() {
    const sources = [
        'expressions-library.md',
        'dan-ebberts-expressions.md',
        'effect-templates.md',
        'operation-templates.md'
    ];
    const out = [];
    for (const src of sources) {
        const text = readSafe(src);
        if (!text) continue;
        let category = '';
        let title = '';
        let buf = [];
        let inCode = false;
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const cat = line.match(/^##\s+(.+?)\s*$/);
            const ttl = line.match(/^###\s+(.+?)\s*$/);
            if (cat) { category = cat[1].trim(); continue; }
            if (ttl) {
                if (buf.length) {
                    out.push({ source: src, category, name: title, code: buf.join('\n').trim() });
                    buf = [];
                }
                title = ttl[1].trim();
                continue;
            }
            const fence = line.match(/^```(\w*)/);
            if (fence) {
                if (!inCode) inCode = true;
                else {
                    if (buf.length) {
                        out.push({ source: src, category, name: title, code: buf.join('\n').trim() });
                        buf = [];
                    }
                    inCode = false;
                }
                continue;
            }
            if (inCode) buf.push(line);
        }
        if (buf.length && title) out.push({ source: src, category, name: title, code: buf.join('\n').trim() });
    }
    // dedupe by name+code-hash
    const seen = new Set();
    return out.filter(e => {
        const k = e.name + '|' + e.code.slice(0, 80);
        if (seen.has(k)) return false;
        seen.add(k);
        return e.name && e.code;
    });
}

// ---------------- scoring + search ----------------
function scoreMatch(haystack, needle) {
    if (!haystack) return 0;
    const h = String(haystack).toLowerCase();
    const n = String(needle).toLowerCase();
    if (h === n) return 100;
    if (h.startsWith(n)) return 80;
    if (h.indexOf(n) !== -1) return 50;
    // word-boundary match
    const words = h.split(/\s+|[._-]/);
    for (const w of words) if (w === n) return 70;
    return 0;
}
function bestScore(item, query, fields) {
    let best = 0;
    for (const f of fields) {
        const s = scoreMatch(item[f] || '', query);
        if (s > best) best = s;
    }
    return best;
}
function search(items, query, fields, limit = 10) {
    const q = String(query || '').trim();
    if (!q) return items.slice(0, limit);
    const scored = items
        .map(it => ({ item: it, score: bestScore(it, q, fields) }))
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(s => Object.assign({ _score: s.score }, s.item));
}

// ---------------- public API ----------------
function effects() {
    if (!_effects) _effects = parseEffectMatchNames();
    return _effects;
}
function properties() {
    if (!_properties) _properties = parsePropertyMatchNames();
    return _properties;
}
function expressions() {
    if (!_expressions) _expressions = parseExpressions();
    return _expressions;
}

// `count` is the MATCH count (results.length) — it used to be the corpus size, which
// callers reliably misread: `{ count: 108, results: [] }` looks like a broken tool
// rather than "no matches in a 108-item corpus". Corpus size is still reported, as
// `corpusSize`, so a caller can tell "nothing matched" from "nothing is loaded".
function withCounts(corpus, results, query) {
    return { count: results.length, corpusSize: corpus.length, query, results };
}
function lookupEffect(query, limit = 10) {
    const corpus = effects();
    return withCounts(corpus, search(corpus, query, ['displayName', 'matchName', 'category'], limit), query);
}
function lookupProperty(query, limit = 10) {
    const corpus = properties();
    return withCounts(corpus, search(corpus, query, ['displayName', 'matchName', 'category', 'access'], limit), query);
}
function lookupExpression(query, limit = 5) {
    const corpus = expressions();
    return withCounts(corpus, search(corpus, query, ['name', 'category', 'code'], limit), query);
}

// ---------------- file-content cache (knowledge_search) ----------------
// knowledgeSearch re-reads and re-splits every knowledge/*.md file on EVERY
// call (2.3) — the structured lookups above are memoized but this one isn't.
// Cache raw text keyed by filename, validated against mtimeMs so an edited
// file (e.g. self-learning writes) is picked up on the next call with no
// server restart; untouched files are served from memory instead of disk.
const _fileCache = new Map(); // filename -> { mtimeMs, text }
function readCachedFile(f) {
    const full = path.join(KNOWLEDGE_DIR, f);
    let st;
    try { st = fs.statSync(full); } catch (_) { _fileCache.delete(f); return null; } // deleted since readdir
    const cached = _fileCache.get(f);
    if (cached && cached.mtimeMs === st.mtimeMs) return cached.text;
    let text;
    try { text = fs.readFileSync(full, 'utf8'); } catch (_) { _fileCache.delete(f); return null; }
    _fileCache.set(f, { mtimeMs: st.mtimeMs, text });
    return text;
}

// fulltext grep across all .md files
function knowledgeSearch(query, limit = 10) {
    const q = String(query || '').toLowerCase();
    if (!q) return { results: [] };
    const out = [];
    if (!fs.existsSync(KNOWLEDGE_DIR)) return { results: [] };
    for (const f of fs.readdirSync(KNOWLEDGE_DIR)) {
        if (!/\.md$/i.test(f)) continue;
        const text = readCachedFile(f);
        if (!text) continue;
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().indexOf(q) === -1) continue;
            const start = Math.max(0, i - 2);
            const end   = Math.min(lines.length, i + 3);
            out.push({
                file: f,
                line: i + 1,
                snippet: lines.slice(start, end).join('\n').slice(0, 600),
                _score: scoreMatch(lines[i], q)
            });
            if (out.length >= limit * 4) break;
        }
        if (out.length >= limit * 4) break;
    }
    out.sort((a, b) => b._score - a._score);
    return { query, results: out.slice(0, limit) };
}

function stats() {
    return {
        knowledgeDir: KNOWLEDGE_DIR,
        effects: effects().length,
        properties: properties().length,
        expressions: expressions().length
    };
}

module.exports = {
    effects, properties, expressions,
    lookupEffect, lookupProperty, lookupExpression, knowledgeSearch,
    stats
};
