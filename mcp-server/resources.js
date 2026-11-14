// AE Portal — MCP resources.
// Exposes the bundled knowledge base as readable resources.

const fs = require('fs');
const path = require('path');

const LOCAL_KNOWLEDGE_DIR = path.join(__dirname, '..', 'knowledge');

// Use the bundled copy. Override via env only (no personal-path default).
const KNOWLEDGE_DIR = process.env.AE_PORTAL_KNOWLEDGE_DIR || LOCAL_KNOWLEDGE_DIR;

function knowledgeFiles() {
    if (!fs.existsSync(KNOWLEDGE_DIR)) return [];
    return fs.readdirSync(KNOWLEDGE_DIR)
        .filter(f => /\.md$/i.test(f))
        .sort()
        .map(f => ({
            name: f,
            file: path.join(KNOWLEDGE_DIR, f),
            uri: 'aeportal://knowledge/' + f
        }));
}

function describeKnowledge(filename) {
    // First-line description heuristic
    const map = {
        '3d-rig-templates.md':       'Pre-built 3D rig setups (cube/sphere/extruded text) and their property graphs',
        'accessibility-commands.md': 'Voice / text command vocabulary the AE Agent recognises',
        'ae-features-2024-2026.md':  'New AE features added in 2024-2026 (3D mesh layers, env light, mocha integration, etc.)',
        'dan-ebberts-expressions.md':'Dan Ebberts\' expression patterns library',
        'defensive-effects.md':      'Effect application patterns that handle missing plugins gracefully',
        'effect-match-names.md':     'Canonical AE effect matchNames (use these in apply_effect)',
        'effect-templates.md':       'Common effect-stack recipes (looks, treatments, fixes)',
        'expression-standards.md':   'Project conventions for writing expressions',
        'expressions-library.md':    'Expression snippets indexed by behaviour (wiggle, loop, smooth, etc.)',
        'instant-commands.md':       'Single-word commands that map directly to AE actions',
        'keyboard-shortcuts.md':     'AE keyboard shortcut reference',
        'layer-methods.md':          'AE layer object methods + properties (scripting reference)',
        'motion-design-concepts.md': 'Motion design vocabulary + principles (timing, weight, anticipation)',
        'operation-templates.md':    'Common multi-step JSX patterns (rig, parent, organise)',
        'property-match-names.md':   'Canonical AE property matchNames (Transform, Effects, Mask, etc.)',
        'scripting-api-reference.md':'AE ExtendScript API quick reference',
        'tips-library.md':           'One-line tips/gotchas the agent surfaces to the user',
        'troubleshooting.md':        'Common AE scripting errors and how to fix them'
    };
    return map[filename] || 'Knowledge base entry';
}

async function list() {
    const out = [];
    for (const f of knowledgeFiles()) {
        out.push({
            uri: f.uri,
            name: f.name.replace(/\.md$/, '').replace(/-/g, ' '),
            description: describeKnowledge(f.name),
            mimeType: 'text/markdown'
        });
    }
    return out;
}

async function read(uri) {
    const m = uri.match(/^aeportal:\/\/knowledge\/(.+)$/);
    if (m) {
        const filename = m[1];
        // sanity: prevent path traversal
        if (filename.indexOf('/') !== -1 || filename.indexOf('..') !== -1) {
            throw new Error('invalid resource path: ' + filename);
        }
        const fullPath = path.join(KNOWLEDGE_DIR, filename);
        if (!fs.existsSync(fullPath)) throw new Error('resource not found: ' + uri);
        const text = fs.readFileSync(fullPath, 'utf8');
        return [{ uri, mimeType: 'text/markdown', text }];
    }
    throw new Error('unknown resource uri: ' + uri);
}

module.exports = { list, read };
