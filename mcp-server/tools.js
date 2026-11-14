// AE Portal — MCP tool catalog. Each tool's `panelMethod` is the message the
// CEP panel will dispatch (either to JSX via MarkHost.dispatch, or to a panel-side
// handler like whisper_transcribe / reload_host).

const knowledge = require('./knowledge');

// ---------- 1.2: host-liveness passthrough (list_instances / ping) ----------
// server.js exposes `process.__aePortalHostMeta(instanceId)` — a single,
// mixed-version-safe lookup ({ lastHostOkAt, clients } or null) shared by both call
// sites below, so tools.js never has to know how discovery/pool routing works.
function hostMetaFor(instanceId) {
    try {
        const fn = process.__aePortalHostMeta;
        return (typeof fn === 'function') ? fn(instanceId) : null;
    } catch (_) { return null; }
}
// Mixed-version contract: `lastHostOkAt`/`clients` are OPTIONAL on the panel's
// discovery JSON. When absent, OMIT the derived fields entirely — never report a
// misleading `hostResponsive:false` or `clients:0` for an old panel that doesn't
// send them.
function withHostResponsive(obj, meta) {
    if (!obj || typeof obj !== 'object') return obj;
    if (meta && meta.lastHostOkAt != null) {
        obj.hostResponsive = (Date.now() - meta.lastHostOkAt) < 10000;
    }
    if (meta && meta.clients != null) {
        obj.clients = meta.clients;
    }
    return obj;
}

// Common JSON Schema fragments
// Stable-id addressing: `{ id: N }` targets a comp/layer by its immutable numeric id
// (CompItem.id / Layer.id, stable since AE 22) — duplicate-name-SAFE, and a DISTINCT
// form from name (string) or 1-based index (integer). Ids are surfaced by
// get_project_map, describe_layer, get_selection, list_compositions, get_layer_bounds.
const idRef      = { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'], additionalProperties: false };
const compRef    = { oneOf: [{ type: 'string' }, idRef], description: 'Comp: name (string), or { id: N } for duplicate-name-safe stable-id addressing. Defaults to active comp.' };
// compRefIdx — like compRef but also accepts a bare integer id (kept for tools that
// already accepted `type:["string","integer"]`; the integer routes through the same
// id-or-name resolver as a numeric string, so this stays backward-compatible).
const compRefIdx = { oneOf: [{ type: 'string' }, { type: 'integer' }, idRef], description: 'Comp: name, numeric id, or { id: N } for duplicate-name-safe stable-id addressing.' };
const layerRef   = { oneOf: [{ type: 'string' }, { type: 'integer' }, idRef], description: 'Layer: name (string), 1-based index (integer), or { id: N } for duplicate-name-safe stable-id addressing.' };
const layersRef  = { oneOf: [{ type: 'array', items: layerRef }, layerRef], description: 'One or many layers (each: name, 1-based index, or { id: N }). If omitted, uses currently selected layers.' };
const propPath   = { type: 'string', description: 'Property: a transform alias ("Position","Scale","Rotation","Opacity","Anchor Point","X Rotation","Y Rotation","Orientation"), an ADBE matchName ("ADBE Position", "ADBE Effect Parade.ADBE Gaussian Blur 2.ADBE Blurriness"), or a dotted display path ("Effects.Gaussian Blur.Blurriness").' };

const TOOLS = [
    {
        name: 'ping',
        description: 'Health check — confirms the panel is connected and AE is responsive. Returns AE version, build, project file, uptime. Use first when unsure.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        panelMethod: 'ping'
    },
    {
        name: 'run_jsx',
        description:
            'Escape hatch — run arbitrary ExtendScript inside AE and return its value. Wrap in (function(){...})(). Prefer dedicated tools when one fits.',
        inputSchema: {
            type: 'object',
            properties: {
                script: { type: 'string', description: 'ExtendScript source. Should evaluate to a JSON-serializable value.' },
                description: { type: 'string', description: 'A few words on what the script does, e.g. "Delete the test layers in Safari UI". Shown in the AE panel\'s Log tab so the user can follow along.' },
                force: { type: 'boolean', description: 'Bypass the safety lint hard-blocks (executeCommand/callSystem/newProject/open). Use only when you know why the pattern is safe here.' }
            },
            required: ['script'],
            additionalProperties: false
        },
        panelMethod: 'run_jsx'
    },

    // -------- introspection --------
    {
        name: 'get_project_map',
        description:
            'Project map. ' +
            'mode="light" (default, <500ms): comp tree, layer counts, fonts, fps, durations, active comp, basic per-layer info (type, parent, track matte, audio presence, text content). ' +
            'mode="deep": adds per-layer transform keyframes + easing, full effect stacks with property values + expressions, parent chains, masks, layer styles, shape contents (recursive groups/paths/fills/strokes/repeaters/trim), text animators (range selectors + animator properties), comp + layer markers. ' +
            'mode="comp": same as deep but for a single comp by name/id (param: comp). Cheaper than full deep for big projects. ' +
            'Toggle off heavy parts with includeShapeContents/includeTextAnimators/includeMasks/includeLayerStyles. ' +
            'Every comp and layer carries a stable numeric `id` — pass it back to any tool as `{ id: N }` (comp or layer param) for duplicate-name-safe addressing. ' +
            'Start with light; only deep-map when you need keyframes/values/structure.',
        inputSchema: {
            type: 'object',
            properties: {
                mode: { type: 'string', enum: ['light', 'deep', 'comp'], default: 'light' },
                comp: compRef,
                includeKeyframes:     { type: 'boolean', default: true },
                includeEffects:       { type: 'boolean', default: true },
                includeMasks:         { type: 'boolean', default: true },
                includeLayerStyles:   { type: 'boolean', default: true },
                includeShapeContents: { type: 'boolean', default: true },
                includeTextAnimators: { type: 'boolean', default: true },
                includeMarkers:       { type: 'boolean', default: true },
                maxLayers:            { type: 'integer', default: 500, description: 'Cap layers per comp.' },
                maxTreeDepth:         { type: 'integer', default: 8, description: 'Recursion cap inside groups/shape contents/text animators.' }
            },
            additionalProperties: false
        },
        panelMethod: 'get_project_map'
    },
    {
        name: 'get_selection',
        description: 'Returns active comp, currently selected timeline layers, and project panel selection. Cheap — call before mutations to know what user has selected.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        panelMethod: 'get_selection'
    },
    {
        name: 'list_compositions',
        description: 'Quick list of all comps in the project — id, name, dimensions, fps, duration. Lighter than get_project_map.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        panelMethod: 'list_compositions'
    },
    {
        name: 'list_effects',
        description: 'List of all installed effects (display name, matchName, category). Optional substring filter. Use to find correct matchName before apply_effect.',
        inputSchema: {
            type: 'object',
            properties: {
                filter: { type: 'string', description: 'Case-insensitive substring filter against name/matchName/category.' },
                refresh: { type: 'boolean', description: 'Bypass the session cache and rescan app.effects.' }
            },
            additionalProperties: false
        },
        panelMethod: 'list_effects'
    },

    // -------- easing (never F9/33% unless asked) --------
    {
        name: 'set_easing',
        description:
            'Apply nice easing on a property\'s keyframes. Modes: ' +
            '"in" (linear→bezier-in) for animation-in; ' +
            '"out" (bezier-out→linear) for animation-out; ' +
            '"inout" (bezier on both ends) for snap-in-and-out. ' +
            'Default influence 75 (range 70–80 — DO NOT use AE\'s default 33%/F9 unless the user explicitly asks). ' +
            'range="all" applies to first/last (and middle, for inout); range="selected" uses the keyframes selected in AE\'s timeline.',
        inputSchema: {
            type: 'object',
            properties: {
                comp:      compRef,
                layer:     layerRef,
                prop:      propPath,
                mode:      { type: 'string', enum: ['in', 'out', 'inout'], default: 'in' },
                influence: { type: 'number', default: 75, minimum: 0, maximum: 100, description: 'Bezier influence percent. Default 75 per project rules.' },
                range:     { oneOf: [{ type: 'string', enum: ['all', 'selected'] }, { type: 'object', properties: { start: { type: 'integer' }, end: { type: 'integer' } }, required: ['start', 'end'] }], default: 'all' }
            },
            required: ['layer', 'prop'],
            additionalProperties: false
        },
        panelMethod: 'set_easing'
    },
    {
        name: 'get_easing',
        description: 'Read keyframes + easing for one property: each key\'s time/frame/value/inInterp/outInterp/easeIn/easeOut. Use this to preserve easing when changing keyframe values.',
        inputSchema: {
            type: 'object',
            properties: { comp: compRef, layer: layerRef, prop: propPath },
            required: ['layer', 'prop'],
            additionalProperties: false
        },
        panelMethod: 'get_easing'
    },

    // -------- effects --------
    {
        name: 'apply_effect',
        description:
            'Apply an effect to one or more layers. `effect` accepts display name ("Gaussian Blur"), matchName ("ADBE Gaussian Blur 2"), or pseudo-effect path. ' +
            'Set initial property values via `properties` (key = property display name or matchName). ' +
            'If unsure of the name, call lookup_effect(query) FIRST — it\'s an in-memory lookup of 213 effects, faster than list_effects (which queries AE).',
        inputSchema: {
            type: 'object',
            properties: {
                comp:    compRef,
                layers:  layersRef,
                effect:  { type: 'string' },
                properties: { type: 'object', additionalProperties: true, description: 'Optional initial property values, keyed by display name or matchName.' },
                force: { type: 'boolean', description: 'Required to apply ADBE Numbers2 (Numbers), which always opens a blocking font dialog.' }
            },
            required: ['effect'],
            additionalProperties: false
        },
        panelMethod: 'apply_effect'
    },

    // -------- layer creation --------
    {
        name: 'add_solid',
        description: 'Add a solid layer. Defaults to comp dimensions and full duration.',
        inputSchema: {
            type: 'object',
            properties: {
                comp:     compRef,
                name:     { type: 'string' },
                color:    { type: 'array', items: { type: 'number', minimum: 0, maximum: 1 }, minItems: 3, maxItems: 3, description: '[r,g,b] each 0–1' },
                width:    { type: 'integer' },
                height:   { type: 'integer' },
                duration: { type: 'number' }
            },
            additionalProperties: false
        },
        panelMethod: 'add_solid'
    },
    {
        name: 'add_null',
        description: 'Add a null object. Useful as a parent rig.',
        inputSchema: {
            type: 'object',
            properties: { comp: compRef, name: { type: 'string' }, duration: { type: 'number' } },
            additionalProperties: false
        },
        panelMethod: 'add_null'
    },
    {
        name: 'add_text',
        description: 'Add a text layer. Optional font/fontSize/fillColor/justification/position.',
        inputSchema: {
            type: 'object',
            properties: {
                comp: compRef, text: { type: 'string' }, name: { type: 'string' },
                font: { type: 'string' }, fontSize: { type: 'number' },
                fillColor: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
                justification: { type: 'string', enum: ['LEFT_JUSTIFY','RIGHT_JUSTIFY','CENTER_JUSTIFY','FULL_JUSTIFY_LASTLINE_LEFT','FULL_JUSTIFY_LASTLINE_RIGHT','FULL_JUSTIFY_LASTLINE_CENTER','FULL_JUSTIFY_LASTLINE_FULL'] },
                position: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 3 }
            },
            additionalProperties: false
        },
        panelMethod: 'add_text'
    },
    {
        name: 'add_shape',
        description: 'Add an empty shape layer. Add contents afterwards via run_jsx or set_property.',
        inputSchema: { type: 'object', properties: { comp: compRef, name: { type: 'string' } }, additionalProperties: false },
        panelMethod: 'add_shape'
    },
    {
        name: 'add_adjustment',
        description: 'Add an adjustment layer at comp size and full duration.',
        inputSchema: { type: 'object', properties: { comp: compRef, name: { type: 'string' } }, additionalProperties: false },
        panelMethod: 'add_adjustment'
    },

    // -------- layer ops --------
    {
        name: 'delete_layer',
        description: 'Delete one or more layers. When names may collide, address by stable id (`{ id: N }`) so the right layer is hit.',
        inputSchema: { type: 'object', properties: { comp: compRef, layers: layersRef }, additionalProperties: false },
        panelMethod: 'delete_layer'
    },
    {
        name: 'duplicate_layer',
        description: 'Duplicate one or more layers.',
        inputSchema: { type: 'object', properties: { comp: compRef, layers: layersRef }, additionalProperties: false },
        panelMethod: 'duplicate_layer'
    },
    {
        name: 'set_property',
        description:
            'Set a property\'s value. If the property already has keyframes, this sets/creates a keyframe at `time` (or current comp time). Otherwise it sets the constant value. ' +
            'To preserve easing on existing keyframes, call get_easing first, change the value, and easing is kept automatically (we set the value at the same time as the existing key). ' +
            'comp/layer accept `{ id: N }` for duplicate-name-safe stable-id addressing.',
        inputSchema: {
            type: 'object',
            properties: {
                comp: compRef, layer: layerRef, prop: propPath,
                value: {
                    description: 'Property value. Number/string/boolean for scalars; array of numbers for vectors (e.g. Position [x,y,z], Scale [x,y,z], colors [r,g,b]).',
                    oneOf: [
                        { type: 'number' },
                        { type: 'string' },
                        { type: 'boolean' },
                        { type: 'array', items: { type: 'number' } }
                    ]
                },
                time: { type: 'number', description: 'Comp time in seconds; defaults to current.' }
            },
            required: ['layer', 'prop', 'value'],
            additionalProperties: false
        },
        panelMethod: 'set_property'
    },
    {
        name: 'add_keyframe',
        description: 'Add a keyframe to a property at the given time. Defaults the value to the property\'s value at that time, so easing stays clean. Pair with set_easing afterward.',
        inputSchema: {
            type: 'object',
            properties: {
                comp: compRef, layer: layerRef, prop: propPath,
                time: { type: 'number' },
                value: {
                    description: 'Optional explicit value (defaults to property\'s value at that time). Number/string/boolean for scalars; array of numbers for vectors.',
                    oneOf: [
                        { type: 'number' },
                        { type: 'string' },
                        { type: 'boolean' },
                        { type: 'array', items: { type: 'number' } }
                    ]
                }
            },
            required: ['layer', 'prop'],
            additionalProperties: false
        },
        panelMethod: 'add_keyframe'
    },
    {
        name: 'parent_layers',
        description: 'Set parent of one or more child layers. Pass parent=null to unparent.',
        inputSchema: {
            type: 'object',
            properties: { comp: compRef, children: layersRef, parent: { oneOf: [{ type: 'null' }, layerRef] } },
            required: ['children'],
            additionalProperties: false
        },
        panelMethod: 'parent_layers'
    },
    {
        name: 'set_track_matte',
        description: 'Set track matte type on a layer. Reads from the layer ABOVE it (AE\'s standard rule). type: NONE | ALPHA | ALPHA_INVERTED | LUMA | LUMA_INVERTED.',
        inputSchema: {
            type: 'object',
            properties: {
                comp: compRef, layer: layerRef,
                type: { type: 'string', enum: ['NONE','ALPHA','ALPHA_INVERTED','LUMA','LUMA_INVERTED'] }
            },
            required: ['layer', 'type'],
            additionalProperties: false
        },
        panelMethod: 'set_track_matte'
    },

    // -------- nav --------
    {
        name: 'set_active_comp',
        description: 'Open a comp in the viewer (sets the active comp).',
        inputSchema: { type: 'object', properties: { comp: compRef }, required: ['comp'], additionalProperties: false },
        panelMethod: 'set_active_comp'
    },
    {
        name: 'set_selected_layers',
        description: 'Set the timeline selection. Pass an array of layer indices/names — clears existing selection first.',
        inputSchema: {
            type: 'object',
            properties: { comp: compRef, layers: { type: 'array', items: layerRef } },
            required: ['layers'],
            additionalProperties: false
        },
        panelMethod: 'set_selected_layers'
    },
    {
        name: 'create_composition',
        description: 'Create a new composition. Defaults: 1920x1080, 30fps, 10s, pixelAspect 1.',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string' }, width: { type: 'integer' }, height: { type: 'integer' },
                duration: { type: 'number' }, fps: { type: 'number' },
                pixelAspect: { type: 'number' },
                bgColor: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
                openInViewer: { type: 'boolean', default: false }
            },
            additionalProperties: false
        },
        panelMethod: 'create_composition'
    },
    {
        name: 'open_project',
        description: 'Open a .aep project file.',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string' },
                force: { type: 'boolean', description: 'Proceed even if the current project has unsaved changes (a native Save dialog will block AE until dismissed).' }
            },
            required: ['path'],
            additionalProperties: false
        },
        panelMethod: 'open_project'
    },
    {
        name: 'close_project',
        description: 'Close the current project. save: "save" | "discard" | "prompt" (default).',
        inputSchema: {
            type: 'object',
            properties: {
                save: { type: 'string', enum: ['save','discard','prompt'] },
                force: { type: 'boolean', description: 'Proceed even if the current project has unsaved changes (a native Save dialog will block AE until dismissed).' }
            },
            additionalProperties: false
        },
        panelMethod: 'close_project'
    },
    {
        name: 'analyze_unused',
        description: 'Find project items (footage, comps) not used in any composition. Read-only — returns suggestions for cleanup.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        panelMethod: 'analyze_unused'
    },

    // -------- markers --------
    {
        name: 'list_markers',
        description: 'List markers on a layer (pass `layer`) or on the comp itself (omit `layer`). Returns time, frame, comment, duration, label.',
        inputSchema: {
            type: 'object',
            properties: { comp: compRef, layer: layerRef },
            additionalProperties: false
        },
        panelMethod: 'list_markers'
    },
    {
        name: 'add_marker',
        description: 'Add a marker on a layer or on the comp. Time can be seconds, or pass `frame`. Optional comment, duration, label (0–16, AE\'s color labels).',
        inputSchema: {
            type: 'object',
            properties: {
                comp: compRef, layer: layerRef,
                time: { type: 'number' }, frame: { type: 'integer' },
                comment: { type: 'string' }, duration: { type: 'number' },
                label: { type: 'integer', minimum: 0, maximum: 16 },
                chapter: { type: 'string' }, url: { type: 'string' },
                frameTarget: { type: 'string' }, cuePointName: { type: 'string' }
            },
            additionalProperties: false
        },
        panelMethod: 'add_marker'
    },
    {
        name: 'add_markers_batch',
        description: 'Add many markers at once. markers: [{time|frame, comment, duration?, label?}].',
        inputSchema: {
            type: 'object',
            properties: {
                comp: compRef, layer: layerRef,
                markers: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            time: { type: 'number' }, frame: { type: 'integer' },
                            comment: { type: 'string' }, duration: { type: 'number' },
                            label: { type: 'integer' }
                        }
                    }
                }
            },
            required: ['markers'],
            additionalProperties: false
        },
        panelMethod: 'add_markers_batch'
    },
    {
        name: 'delete_marker',
        description: 'Delete a marker by index (1-based), or by nearest time/frame.',
        inputSchema: {
            type: 'object',
            properties: { comp: compRef, layer: layerRef, index: { type: 'integer' }, time: { type: 'number' }, frame: { type: 'integer' } },
            additionalProperties: false
        },
        panelMethod: 'delete_marker'
    },
    {
        name: 'set_time',
        description: 'Move the playhead. Provide either time (seconds) or frame.',
        inputSchema: {
            type: 'object',
            properties: { comp: compRef, time: { type: 'number' }, frame: { type: 'integer' } },
            additionalProperties: false
        },
        panelMethod: 'set_time'
    },

    // -------- organize --------
    {
        name: 'suggest_renames',
        description: 'Inspect a comp and suggest cleaner layer names: text → content, shapes → "line"/"box", AV → source name. Skips already-good names. Read-only.',
        inputSchema: { type: 'object', properties: { comp: compRef }, additionalProperties: false },
        panelMethod: 'suggest_renames'
    },
    {
        name: 'rename_layers',
        description: 'Apply a rename map. renames is an array of {index, name}.',
        inputSchema: {
            type: 'object',
            properties: {
                comp: compRef,
                renames: { type: 'array', items: { type: 'object', properties: { index: { type: 'integer' }, name: { type: 'string' } }, required: ['index', 'name'] } }
            },
            required: ['renames'],
            additionalProperties: false
        },
        panelMethod: 'rename_layers'
    },
    {
        name: 'precompose',
        description: 'Precompose the given layers into a new comp. moveAllAttributes defaults true.',
        inputSchema: {
            type: 'object',
            properties: { comp: compRef, layers: layersRef, name: { type: 'string' }, moveAllAttributes: { type: 'boolean', default: true } },
            required: ['layers'],
            additionalProperties: false
        },
        panelMethod: 'precompose'
    },

    // -------- imports / project --------
    {
        name: 'import_files',
        description: 'Import one or more files. Optional intoFolder creates a new project folder. Set sequence=true for image sequences.',
        inputSchema: {
            type: 'object',
            properties: {
                paths: { type: 'array', items: { type: 'string' }, minItems: 1 },
                intoFolder: { type: 'string' },
                sequence: { type: 'boolean', default: false }
            },
            required: ['paths'],
            additionalProperties: false
        },
        panelMethod: 'import_files'
    },
    {
        name: 'import_folder',
        description: 'Import a folder of media. Walks recursively by default. extensions filter defaults to common AE-friendly types. Files import into a project bin named after the folder.',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Filesystem folder path.' },
                recursive: { type: 'boolean', default: true },
                extensions: { type: 'array', items: { type: 'string' }, description: 'Extension whitelist (e.g. [".png",".mp4"]). Default covers common image/video/audio.' },
                intoFolder: { type: 'string', description: 'Project bin name. Default: source folder name.' }
            },
            required: ['path'],
            additionalProperties: false
        },
        panelMethod: 'import_folder'
    },
    {
        name: 'list_installed_scripts',
        description: 'List scripts present in installed AE app(s) — Scripts/, ScriptUI Panels/, Startup/, and User Presets. Read-only filesystem scan.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        panelMethod: 'list_installed_scripts'
    },
    {
        name: 'list_installed_extensions',
        description: 'List CEP extensions installed system-wide and per-user. Read-only filesystem scan.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        panelMethod: 'list_installed_extensions'
    },
    {
        name: 'list_installed_plugins',
        description: 'List native plugins installed in the AE app(s) and Adobe Common MediaCore. Read-only filesystem scan.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        panelMethod: 'list_installed_plugins'
    },
    {
        name: 'replace_footage',
        description: 'Replace a footage item\'s underlying file. Pass either itemId or itemName. Composition usages auto-update.',
        inputSchema: {
            type: 'object',
            properties: { itemId: { type: 'integer' }, itemName: { type: 'string' }, path: { type: 'string' } },
            required: ['path'],
            additionalProperties: false
        },
        panelMethod: 'replace_footage'
    },
    {
        name: 'save_project',
        description: 'Save the project. If path is given, saves a copy at path; otherwise saves in place.',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } }, additionalProperties: false },
        panelMethod: 'save_project'
    },
    {
        name: 'version_up',
        description: 'Save the project as the next version (name_v01 → _v02, padding preserved). Suggest after big changes so alts are safe.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        panelMethod: 'version_up'
    },

    // -------- whisper VO timing (panel-side) --------
    {
        name: 'whisper_transcribe',
        description:
            'Transcribe a VO/audio layer with word-level timestamps, frame-aligned to the comp\'s frame rate. ' +
            'Pass either a layer (name/index in active comp) or a path to an audio file. ' +
            'Requires the `whisper` CLI on PATH (or set WHISPER_CMD). Returns words: [{word, time, start, end, frame, frameStart, frameEnd}].',
        inputSchema: {
            type: 'object',
            properties: {
                comp:    compRef,
                layer:   layerRef,
                path:    { type: 'string', description: 'Audio file path. If omitted, uses the resolved layer\'s source path.' },
                model:   { type: 'string', default: 'base', description: 'Whisper model: tiny|base|small|medium|large.' },
                language:{ type: 'string', description: 'BCP-47 language code, e.g. en, pt, es. Defaults to auto-detect.' }
            },
            additionalProperties: false
        },
        panelMethod: 'whisper_transcribe'
    },

    // -------- panel-side dev --------
    {
        name: 'reload_host',
        description: 'Re-evaluate the panel\'s host JSX from disk. Use after editing extension/host/*.jsx without restarting AE.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        panelMethod: 'reload_host'
    },

    // ============================================================
    // Tier A — vision, expressions, keyframe ops, geometry
    // ============================================================

    // -------- vision --------
    {
        name: 'render_frame',
        description: 'Render the active comp (or specified comp) at a given time, return as a PNG image content block. Pass time (seconds) or frame; defaults to current playhead. THE primary way to "see" what AE looks like — call this after visual mutations to verify results.',
        inputSchema: {
            type: 'object',
            properties: { comp: compRef, time: { type: 'number' }, frame: { type: 'integer' } },
            additionalProperties: false
        },
        panelMethod: 'render_frame'
    },
    {
        name: 'render_preview_strip',
        description:
            'Render N frames evenly across [start,end] into a single contact-sheet image so motion ' +
            'can be judged, not just one pose. Use this instead of repeated render_frame calls when ' +
            'checking easing, timing, a trim-path draw-on, a counter, or any change that only reads ' +
            'over time. Omit start/end to cover the comp\'s work area; omit comp for the active comp.',
        inputSchema: {
            type: 'object',
            properties: {
                comp: compRef,
                start: { type: 'number', description: 'Range start, in seconds. Defaults to the work area / comp start.' },
                end: { type: 'number', description: 'Range end, in seconds. Defaults to the work area / comp end.' },
                frames: { type: 'integer', minimum: 2, maximum: 24, default: 6, description: 'How many frames to sample evenly across the range. Default 6.' },
                downscale: { type: 'integer', default: 320, description: 'Target size in pixels (longest edge) per tile before assembling the contact sheet. Default 320.' },
                columns: { type: 'integer', description: 'Tiles per row in the contact sheet. Defaults to an auto layout (roughly square) when omitted.' }
            },
            additionalProperties: false
        },
        panelMethod: 'render_preview_strip'
    },

    // -------- expressions --------
    {
        name: 'set_expression',
        description: 'Set an expression on a property. Pass empty string to remove. Auto-enables if non-empty.',
        inputSchema: {
            type: 'object',
            properties: { comp: compRef, layer: layerRef, prop: propPath, expression: { type: 'string' } },
            required: ['layer', 'prop', 'expression'],
            additionalProperties: false
        },
        panelMethod: 'set_expression'
    },
    {
        name: 'remove_expression',
        description: 'Remove the expression from a property and disable expression-mode.',
        inputSchema: {
            type: 'object',
            properties: { comp: compRef, layer: layerRef, prop: propPath },
            required: ['layer', 'prop'],
            additionalProperties: false
        },
        panelMethod: 'remove_expression'
    },
    {
        name: 'toggle_expression',
        description: 'Toggle expressionEnabled on a property without losing the expression text.',
        inputSchema: {
            type: 'object',
            properties: { comp: compRef, layer: layerRef, prop: propPath },
            required: ['layer', 'prop'],
            additionalProperties: false
        },
        panelMethod: 'toggle_expression'
    },
    {
        name: 'check_expression_errors',
        description: 'Sweep for BROKEN expressions — every property whose expression failed to evaluate (non-empty expressionError; AE auto-disables these). Pass comp to scan one comp, omit to scan the whole project. Returns { errorCount, errors:[{comp, layer, prop, error, enabled}] }. set_expression already reports an `error` for the property it just set; use this to sweep everything or re-verify after edits.',
        inputSchema: {
            type: 'object',
            properties: { comp: { oneOf: [{ type: 'string' }, { type: 'integer' }, idRef], description: 'omit to scan the whole project; accepts name, id, or { id: N }' } },
            additionalProperties: false
        },
        panelMethod: 'check_expression_errors'
    },
    {
        name: 'apply_expression_preset',
        description:
            'Apply a preset expression. Library: ' +
            '`wiggle({freq, amp})` — random jitter; ' +
            '`loopOut({type: "cycle"|"pingpong"|"continue"|"offset", numKeyframes})`; ' +
            '`loopIn({...})`; ' +
            '`bounce({amp, freq, decay})` — physics-style bounce after last keyframe; ' +
            '`smooth({width, samples})` — averaging smooth; ' +
            '`time({rate, offset})` — value drives by time; ' +
            '`valueAtTime({offset})` — read this prop at offset time; ' +
            '`posterizeTime({rate})` — sample-and-hold timing; ' +
            '`inertialBounce()` — ease-out bounce; ' +
            '`autoFade({duration})` — opacity fade in/out at layer in/out points; ' +
            '`pingPong()` — short for loopOut pingpong.',
        inputSchema: {
            type: 'object',
            properties: {
                comp: compRef, layer: layerRef, prop: propPath,
                preset: { type: 'string', enum: ['wiggle','loopOut','loopIn','bounce','smooth','time','valueAtTime','posterizeTime','inertialBounce','autoFade','pingPong'] },
                params: { type: 'object', additionalProperties: true }
            },
            required: ['layer', 'prop', 'preset'],
            additionalProperties: false
        },
        panelMethod: 'apply_expression_preset'
    },
    {
        name: 'add_expression_control',
        description:
            'Add an expression control effect (Slider / Checkbox / Color / Point / 3D Point / Angle / Layer) to a layer — the backbone of a rig. ' +
            'Optionally rename it (name — this also becomes the effect("...") accessor name), set its initial value (value), and AUTO-LINK it: pass linkTo {layer, prop} to point that property\'s expression at this control. ' +
            'The link is force-evaluated and its expressionError is returned inline (empty string = it evaluated cleanly). The link target must be in the same comp as the control for it to resolve. ' +
            'Returns { effectName, type, valueStream, valueSet, linkedTo, expression, expressionError, linkEnabled }.',
        inputSchema: {
            type: 'object',
            properties: {
                comp: compRef,
                layer: layerRef,
                type: { type: 'string', enum: ['slider', 'checkbox', 'color', 'point', 'point3d', 'angle', 'layer'], description: 'Which control effect to add.' },
                name: { type: 'string', description: 'Rename the control effect. Also becomes the name used in the auto-link accessor (effect("<name>")).' },
                value: { description: 'Initial value for the control\'s value stream: number (slider/angle), 0|1 or boolean (checkbox), [r,g,b,a] 0..1 (color), [x,y] (point), [x,y,z] (point3d), 1-based layer index (layer).' },
                linkTo: {
                    type: 'object',
                    description: 'Optional. Target property whose expression will be set to reference this control. Must be in the same comp as the control.',
                    properties: { comp: compRef, layer: layerRef, prop: propPath },
                    required: ['layer', 'prop'],
                    additionalProperties: false
                }
            },
            required: ['layer', 'type'],
            additionalProperties: false
        },
        panelMethod: 'add_expression_control'
    },
    {
        name: 'link_properties',
        description:
            'One-call expression link: set the DEST property\'s expression to reference the SOURCE property. ' +
            'The source accessor is auto-derived for the standard transforms (position/scale/rotation/opacity/anchorPoint/orientation/x|yRotation) and for DIRECT effect params (effect("Effect")("Param")). ' +
            'For anything not auto-derivable (masks, nested shape/effect params) pass expressionTemplate explicitly — the handler will error rather than emit a link that silently fails. ' +
            'The result is force-evaluated and its expressionError returned inline. ' +
            'Returns { destLayer, destProp, expression, expressionError, enabled, derived }.',
        inputSchema: {
            type: 'object',
            properties: {
                comp: compRef,
                source: { type: 'object', properties: { layer: layerRef, prop: propPath }, required: ['layer', 'prop'], additionalProperties: false },
                dest:   { type: 'object', properties: { layer: layerRef, prop: propPath }, required: ['layer', 'prop'], additionalProperties: false },
                destComp: { oneOf: [{ type: 'string' }, idRef], description: 'Comp (name or { id: N }) for the dest layer if different from the source comp. Note: an expression can only reference layers within the dest\'s own comp, so a cross-comp link will report an expressionError.' },
                expressionTemplate: { type: 'string', description: 'Override the auto-derived link with an explicit expression string. Required when the source accessor can\'t be auto-derived (masks, deeply-nested params).' }
            },
            required: ['source', 'dest'],
            additionalProperties: false
        },
        panelMethod: 'link_properties'
    },

    // -------- keyframe time ops --------
    {
        name: 'shift_keyframes',
        description: 'Shift all keyframes on a property by a delta. Positive moves later. Provide deltaSeconds OR deltaFrames OR delta (seconds).',
        inputSchema: {
            type: 'object',
            properties: { comp: compRef, layer: layerRef, prop: propPath, deltaSeconds: { type: 'number' }, deltaFrames: { type: 'number' }, delta: { type: 'number' } },
            required: ['layer', 'prop'],
            additionalProperties: false
        },
        panelMethod: 'shift_keyframes'
    },
    {
        name: 'scale_keyframes',
        description: 'Stretch/squash keyframes in time around the first keyframe. factor>1 expands (slower), <1 compresses (faster).',
        inputSchema: {
            type: 'object',
            properties: { comp: compRef, layer: layerRef, prop: propPath, factor: { type: 'number', minimum: 0.0001 } },
            required: ['layer', 'prop', 'factor'],
            additionalProperties: false
        },
        panelMethod: 'scale_keyframes'
    },
    {
        name: 'reverse_keyframes',
        description: 'Reverse keyframe order in time. Mirrors easing too (in becomes out).',
        inputSchema: {
            type: 'object',
            properties: { comp: compRef, layer: layerRef, prop: propPath },
            required: ['layer', 'prop'],
            additionalProperties: false
        },
        panelMethod: 'reverse_keyframes'
    },
    {
        name: 'distribute_keyframes_evenly',
        description: 'Reposition middle keyframes so they\'re evenly spaced between the first and last keys. Values unchanged.',
        inputSchema: {
            type: 'object',
            properties: { comp: compRef, layer: layerRef, prop: propPath },
            required: ['layer', 'prop'],
            additionalProperties: false
        },
        panelMethod: 'distribute_keyframes_evenly'
    },
    {
        name: 'copy_keyframes',
        description:
            'Copy every keyframe from a source property to a destination property with FULL fidelity — time (optionally shifted by timeOffset), value, interpolation type (in/out), temporal ease (correct per-property array length), and spatial tangents + auto-bezier on spatial props (Position/Anchor Point). ' +
            'Dest can be in the same comp or another (destComp). clearExisting removes the dest\'s existing keyframes first. ' +
            'Source and dest value dimensionality must match (2D→2D, 3D→3D, scalar→scalar) or the call errors. ' +
            'Returns { copied, destLayer, destProp, destComp, spatial, easeArrayLength, timeOffset, clearedExisting }.',
        inputSchema: {
            type: 'object',
            properties: {
                comp: compRef,
                source: { type: 'object', properties: { layer: layerRef, prop: propPath }, required: ['layer', 'prop'], additionalProperties: false },
                dest:   { type: 'object', properties: { layer: layerRef, prop: propPath }, required: ['layer', 'prop'], additionalProperties: false },
                destComp: { oneOf: [{ type: 'string' }, idRef], description: 'Comp (name or { id: N }) for the dest layer if different from the source comp. Defaults to the source comp.' },
                timeOffset: { type: 'number', description: 'Seconds added to every copied key time (shift the copied keyframes). Default 0.' },
                clearExisting: { type: 'boolean', description: 'Remove all existing keyframes on the dest property before copying. Default false.' }
            },
            required: ['source', 'dest'],
            additionalProperties: false
        },
        panelMethod: 'copy_keyframes'
    },
    {
        name: 'sequence_layers',
        description: 'Stagger layers by setting their startTime to startTime + index*offset. Provide offsetSeconds OR offsetFrames. Optional startTime overrides the first layer\'s start.',
        inputSchema: {
            type: 'object',
            properties: {
                comp: compRef, layers: { type: 'array', items: layerRef, minItems: 2 },
                offsetSeconds: { type: 'number' }, offsetFrames: { type: 'number' },
                startTime: { type: 'number' }
            },
            required: ['layers'],
            additionalProperties: false
        },
        panelMethod: 'sequence_layers'
    },
    {
        name: 'time_stretch',
        description: 'Set layer.stretch percentage. 100 = original, 50 = 2x speed, 200 = half speed.',
        inputSchema: {
            type: 'object',
            properties: { comp: compRef, layer: layerRef, percent: { type: 'number', minimum: 0.01 } },
            required: ['layer', 'percent'],
            additionalProperties: false
        },
        panelMethod: 'time_stretch'
    },
    {
        name: 'time_remap_enable',
        description: 'Enable/disable time remapping on an AVLayer. Required before setting time-remap keyframes.',
        inputSchema: {
            type: 'object',
            properties: { comp: compRef, layer: layerRef, enabled: { type: 'boolean', default: true } },
            required: ['layer'],
            additionalProperties: false
        },
        panelMethod: 'time_remap_enable'
    },
    {
        name: 'freeze_frame_at',
        description: 'Freeze a layer to display a single frame across its duration. Enables time remapping and sets two HOLD keys.',
        inputSchema: {
            type: 'object',
            properties: { comp: compRef, layer: layerRef, time: { type: 'number' }, frame: { type: 'integer' } },
            required: ['layer'],
            additionalProperties: false
        },
        panelMethod: 'freeze_frame_at'
    },

    // -------- geometry --------
    {
        name: 'center_anchor',
        description: 'Move anchor point to a named position on the layer. Compensates position (and all keyframes) so the layer doesn\'t jump. anchor: "center" (default), "top", "bottom", "left", "right", "top-left", "top-right", "bottom-left", "bottom-right". Use "bottom" for squash-and-stretch on bouncing/landing objects.',
        inputSchema: {
            type: 'object',
            properties: {
                comp: compRef,
                layers: layersRef,
                anchor: { type: 'string', enum: ['center','top','bottom','left','right','top-left','top-right','bottom-left','bottom-right'], default: 'center' }
            },
            additionalProperties: false
        },
        panelMethod: 'center_anchor'
    },
    {
        name: 'fit_to_comp',
        description: 'Scale layers to fit the comp. mode: cover (fills, may crop), contain (fits inside, may letterbox), fill (stretches non-uniformly).',
        inputSchema: {
            type: 'object',
            properties: { comp: compRef, layers: layersRef, mode: { type: 'string', enum: ['cover','contain','fill'], default: 'cover' } },
            additionalProperties: false
        },
        panelMethod: 'fit_to_comp'
    },
    {
        name: 'align_layers',
        description: 'Align layers to an edge. edge: left|right|top|bottom|center-h|center-v. reference: "comp" (default) | "first" | "last" | layer name/index.',
        inputSchema: {
            type: 'object',
            properties: {
                comp: compRef, layers: layersRef,
                edge: { type: 'string', enum: ['left','right','top','bottom','center-h','center-v'] },
                reference: { oneOf: [{ type: 'string' }, { type: 'integer' }, idRef], default: 'comp', description: '"comp" | "first" | "last", or a layer (name, 1-based index, or { id: N }).' }
            },
            required: ['edge'],
            additionalProperties: false
        },
        panelMethod: 'align_layers'
    },
    {
        name: 'distribute_layers',
        description: 'Evenly distribute layers between first and last on the chosen axis.',
        inputSchema: {
            type: 'object',
            properties: { comp: compRef, layers: layersRef, axis: { type: 'string', enum: ['x','y'], default: 'x' } },
            additionalProperties: false
        },
        panelMethod: 'distribute_layers'
    },
    {
        name: 'match_size',
        description: 'Scale `target` so its rendered size matches `source`\'s rendered size.',
        inputSchema: {
            type: 'object',
            properties: { comp: compRef, source: layerRef, target: layerRef },
            required: ['source', 'target'],
            additionalProperties: false
        },
        panelMethod: 'match_size'
    },
    {
        name: 'match_position',
        description: 'Set `target`\'s position to match `source`\'s position.',
        inputSchema: {
            type: 'object',
            properties: { comp: compRef, source: layerRef, target: layerRef },
            required: ['source', 'target'],
            additionalProperties: false
        },
        panelMethod: 'match_position'
    },
    {
        name: 'align_to_targets',
        description: 'Batch paired alignment: center each layer\'s comp-space visual center onto its target layer\'s center, plus an optional offset. Unlike align_layers (own-transform only), this walks the FULL parent chain, so labels/numbers parented to scaled or rotated nulls/buttons resolve to true comp coordinates and land correctly. Pair via pairs:[{layer,target}] or parallel layers[]+targets[]. offset [dx,dy] is comp px added to every target center (same offset on all pairs = uniform "normalize"). axis locks an axis (x/y/both). Solves each layer\'s LOCAL position from the comp-space target, so non-uniform/animated parent scale is handled exactly. Skips layers whose Position has an active expression. 2D layers only (3D/camera not projected). e.g. center "Num N" on "Key N" with offset [0,-23], then "Letters N" on "Key N" with [0,50].',
        inputSchema: {
            type: 'object',
            properties: {
                comp: compRef,
                pairs: {
                    type: 'array',
                    description: 'Explicit (layer, target) pairs.',
                    items: { type: 'object', properties: { layer: layerRef, target: layerRef }, required: ['layer', 'target'], additionalProperties: false }
                },
                layers: layersRef,
                targets: { oneOf: [{ type: 'array', items: layerRef }, layerRef], description: 'Reference layer(s), zipped 1:1 with layers[] when pairs is omitted.' },
                offset: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: 'comp-space [dx,dy] added to each target center. default [0,0].' },
                axis: { type: 'string', enum: ['both', 'x', 'y'], default: 'both' },
                time: { type: 'number' },
                frame: { type: 'integer' }
            },
            additionalProperties: false
        },
        panelMethod: 'align_to_targets'
    },

    // -------- text content --------
    {
        name: 'set_text',
        description: 'Replace the text content of a text layer (without recreating it).',
        inputSchema: {
            type: 'object',
            properties: { comp: compRef, layer: layerRef, text: { type: 'string' } },
            required: ['layer', 'text'],
            additionalProperties: false
        },
        panelMethod: 'set_text'
    },
    {
        name: 'set_text_style',
        description: 'Update text styling on an existing text layer. Any subset of font, fontSize, fillColor, strokeColor, strokeWidth, tracking, leading, applyFill, applyStroke, fauxBold, fauxItalic, allCaps, smallCaps, justification.',
        inputSchema: {
            type: 'object',
            properties: {
                comp: compRef, layer: layerRef,
                font: { type: 'string' }, fontSize: { type: 'number' },
                fillColor: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
                strokeColor: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
                strokeWidth: { type: 'number' }, tracking: { type: 'number' }, leading: { type: 'number' },
                applyFill: { type: 'boolean' }, applyStroke: { type: 'boolean' },
                fauxBold: { type: 'boolean' }, fauxItalic: { type: 'boolean' },
                allCaps: { type: 'boolean' }, smallCaps: { type: 'boolean' },
                justification: { type: 'string', enum: ['LEFT_JUSTIFY','RIGHT_JUSTIFY','CENTER_JUSTIFY'] }
            },
            required: ['layer'],
            additionalProperties: false
        },
        panelMethod: 'set_text_style'
    },

    // ============================================================
    // Tier B — layer state, razor/work area, reveal, undo
    // ============================================================
    {
        name: 'toggle_layer_state',
        description: 'Toggle (or set) a boolean-ish layer property in batch. prop: enabled|solo|shy|locked|threeDLayer|motionBlur|adjustmentLayer|guideLayer|collapseTransformation. If `value` provided, sets to that; otherwise toggles.',
        inputSchema: {
            type: 'object',
            properties: {
                comp: compRef, layers: layersRef,
                prop: { type: 'string', enum: ['enabled','solo','shy','locked','threeDLayer','motionBlur','adjustmentLayer','guideLayer','collapseTransformation'] },
                value: { type: 'boolean' }
            },
            required: ['prop'],
            additionalProperties: false
        },
        panelMethod: 'toggle_layer_state'
    },
    {
        name: 'set_color_label',
        description: 'Set AE color label (0–16). Either pass project itemIds (footage/comps) OR comp+layers (timeline layers).',
        inputSchema: {
            type: 'object',
            properties: {
                label: { type: 'integer', minimum: 0, maximum: 16 },
                comp: compRef, layers: layersRef,
                itemIds: { type: 'array', items: { type: 'integer' } }
            },
            required: ['label'],
            additionalProperties: false
        },
        panelMethod: 'set_color_label'
    },
    {
        name: 'set_in_out',
        description: 'Set a layer\'s in/out points. Either time (seconds) or frame for each.',
        inputSchema: {
            type: 'object',
            properties: {
                comp: compRef, layer: layerRef,
                inTime: { type: 'number' }, inFrame: { type: 'integer' },
                outTime: { type: 'number' }, outFrame: { type: 'integer' }
            },
            required: ['layer'],
            additionalProperties: false
        },
        panelMethod: 'set_in_out'
    },
    {
        name: 'set_layer_blend_mode',
        description: 'Set blending mode. Common modes: NORMAL, MULTIPLY, SCREEN, OVERLAY, ADD, LIGHTEN, DARKEN, COLOR_DODGE, COLOR_BURN, SOFT_LIGHT, HARD_LIGHT, DIFFERENCE, EXCLUSION, HUE, SATURATION, COLOR, LUMINOSITY, ALPHA_ADD.',
        inputSchema: {
            type: 'object',
            properties: { comp: compRef, layers: layersRef, mode: { type: 'string' } },
            required: ['mode'],
            additionalProperties: false
        },
        panelMethod: 'set_layer_blend_mode'
    },
    {
        name: 'set_quality',
        description: 'Set layer quality: BEST | DRAFT | WIREFRAME.',
        inputSchema: {
            type: 'object',
            properties: { comp: compRef, layers: layersRef, quality: { type: 'string', enum: ['BEST','DRAFT','WIREFRAME'] } },
            required: ['quality'],
            additionalProperties: false
        },
        panelMethod: 'set_quality'
    },

    // -------- razor / work area --------
    {
        name: 'split_layer_at_time',
        description: 'Split (razor) layers at the given time. Each layer is duplicated; original ends at time, duplicate starts at time.',
        inputSchema: {
            type: 'object',
            properties: { comp: compRef, layers: layersRef, time: { type: 'number' }, frame: { type: 'integer' } },
            additionalProperties: false
        },
        panelMethod: 'split_layer_at_time'
    },
    {
        name: 'set_work_area',
        description: 'Set comp work area in/out (seconds or frames).',
        inputSchema: {
            type: 'object',
            properties: { comp: compRef, inTime: { type: 'number' }, inFrame: { type: 'integer' }, outTime: { type: 'number' }, outFrame: { type: 'integer' } },
            additionalProperties: false
        },
        panelMethod: 'set_work_area'
    },
    {
        name: 'set_work_area_to_selection',
        description: 'Set comp work area to span the in/out points of the currently selected layers.',
        inputSchema: { type: 'object', properties: { comp: compRef }, additionalProperties: false },
        panelMethod: 'set_work_area_to_selection'
    },
    {
        name: 'trim_to_work_area',
        description: 'Trim the comp duration to its work area, shifting layers so work-area start becomes time 0.',
        inputSchema: { type: 'object', properties: { comp: compRef }, additionalProperties: false },
        panelMethod: 'trim_to_work_area'
    },

    // -------- cameras / lights --------
    {
        name: 'add_camera',
        description: 'Add a camera. oneNode=true makes it free (no point of interest). Default position: comp center, 1777.78 back.',
        inputSchema: {
            type: 'object',
            properties: { comp: compRef, name: { type: 'string' }, oneNode: { type: 'boolean', default: false }, position: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 } },
            additionalProperties: false
        },
        panelMethod: 'add_camera'
    },
    {
        name: 'add_light',
        description: 'Add a light. type: PARALLEL | SPOT | POINT | AMBIENT.',
        inputSchema: {
            type: 'object',
            properties: {
                comp: compRef, name: { type: 'string' },
                type: { type: 'string', enum: ['PARALLEL','SPOT','POINT','AMBIENT'], default: 'POINT' },
                position: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 3 },
                intensity: { type: 'number' },
                color: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }
            },
            additionalProperties: false
        },
        panelMethod: 'add_light'
    },

    // -------- presets --------
    {
        name: 'apply_preset_ffx',
        description: 'Apply a .ffx animation preset to a layer.',
        inputSchema: {
            type: 'object',
            properties: { comp: compRef, layer: layerRef, path: { type: 'string' } },
            required: ['layer', 'path'],
            additionalProperties: false
        },
        panelMethod: 'apply_preset_ffx'
    },
    {
        name: 'apply_mogrt',
        description: 'Import a .mogrt motion graphics template into the comp at position/time.',
        inputSchema: {
            type: 'object',
            properties: { comp: compRef, path: { type: 'string' }, position: { type: 'array', items: { type: 'number' } }, time: { type: 'number' } },
            required: ['path'],
            additionalProperties: false
        },
        panelMethod: 'apply_mogrt'
    },

    // -------- render queue --------
    {
        name: 'render_queue_add',
        description: 'Add a comp to the render queue. Optional outputPath (per first output module), templateName (render settings), outputModuleTemplate.',
        inputSchema: {
            type: 'object',
            properties: { comp: compRef, outputPath: { type: 'string' }, templateName: { type: 'string' }, outputModuleTemplate: { type: 'string' } },
            additionalProperties: false
        },
        panelMethod: 'render_queue_add'
    },
    {
        name: 'start_render',
        description: 'Start rendering the queue. Blocks AE until done — use render_queue_status to poll progress from another conversation.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        panelMethod: 'start_render'
    },
    {
        name: 'render_queue_status',
        description: 'Read render queue status: items, status per item, output paths.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        panelMethod: 'render_queue_status'
    },
    {
        name: 'clear_render_queue',
        description: 'Remove all items from the render queue.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        panelMethod: 'clear_render_queue'
    },
    {
        name: 'list_om_templates',
        description: 'List Output Module templates available in AE (names you can pass as outputModuleTemplate). AE 2026 cannot script codec/Format changes — codec must come from a saved OM template.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        panelMethod: 'list_om_templates'
    },
    {
        name: 'list_rs_templates',
        description: 'List Render Settings templates available in AE (names you can pass as templateName to render_queue_add).',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        panelMethod: 'list_rs_templates'
    },
    {
        name: 'save_om_template',
        description: 'Save the currently-selected render queue item\'s OutputModule(1) settings as a new Output Module template. Use after manually configuring an OM in AE (e.g. ProRes 422 + audio off) so future renders can apply it by name via render_queue_add. Optional itemIndex (default: last queued item).',
        inputSchema: {
            type: 'object',
            properties: { name: { type: 'string', description: 'Template name (e.g. "ProRes 422 No Audio")' }, itemIndex: { type: 'integer', description: '1-based render queue item index. Defaults to last.' } },
            required: ['name'],
            additionalProperties: false
        },
        panelMethod: 'save_om_template'
    },
    {
        name: 'render_queue_add_batch',
        description: 'Queue multiple comps in one call with the same Render Settings + Output Module template + output directory. Filename derives from comp name + optional suffix + .ext from template. Skips comps not found. Returns per-comp result.',
        inputSchema: {
            type: 'object',
            properties: {
                comps: { type: 'array', items: compRef, description: 'List of comp names or ids.' },
                outputDir: { type: 'string', description: 'Directory for output files. Created if missing.' },
                templateName: { type: 'string', description: 'Render Settings template (e.g. "Best Settings").' },
                outputModuleTemplate: { type: 'string', description: 'Output Module template (e.g. "ProRes 422 No Audio").' },
                filenameSuffix: { type: 'string', description: 'Appended before extension. Optional.' },
                extension: { type: 'string', description: 'Override file extension (without dot). If omitted, kept from template.' }
            },
            required: ['comps', 'outputDir'],
            additionalProperties: false
        },
        panelMethod: 'render_queue_add_batch'
    },

    // -------- project hygiene actions --------
    {
        name: 'reduce_project',
        description: 'Delete all unused project items (footage/comps with empty usedIn). Read analyze_unused first to preview.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        panelMethod: 'reduce_project'
    },
    {
        name: 'consolidate_footage',
        description: 'Merge duplicate footage items in the project. Returns count consolidated.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        panelMethod: 'consolidate_footage'
    },
    {
        name: 'collect_files',
        description: 'AE has no scripted Collect Files API; this returns guidance. For real collect-files, use AE\'s File menu.',
        inputSchema: { type: 'object', properties: { targetPath: { type: 'string' } }, additionalProperties: false },
        panelMethod: 'collect_files'
    },
    {
        name: 'find_missing_footage',
        description: 'List footage items currently flagged as missing (offline media).',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        panelMethod: 'find_missing_footage'
    },

    // -------- undo / redo --------
    {
        name: 'undo',
        description: 'Trigger AE\'s Undo (Cmd+Z equivalent). Use cautiously — undoes the last AE action regardless of source.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        panelMethod: 'undo'
    },
    {
        name: 'redo',
        description: 'Trigger AE\'s Redo.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        panelMethod: 'redo'
    },

    // -------- reveal --------
    {
        name: 'reveal_in_finder',
        description: 'Open Finder with the layer\'s source file selected. Pass either path (filesystem path) or layer (in active comp).',
        inputSchema: {
            type: 'object',
            properties: { path: { type: 'string' }, layer: layerRef },
            additionalProperties: false
        },
        panelMethod: 'reveal_in_finder'
    },
    {
        name: 'reveal_project_in_finder',
        description: 'Open Finder with the AE project file selected.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        panelMethod: 'reveal_project_in_finder'
    },

    // -------- knowledge fast lookups (in-memory, zero latency) --------
    {
        name: 'lookup_effect',
        description: 'Fast lookup of AE effect matchNames (213 effects). Returns top matches by displayName / matchName / category. Use this BEFORE apply_effect when unsure of the exact name — it\'s faster than reading the whole knowledge resource.',
        inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' }, limit: { type: 'integer', default: 10 } },
            required: ['query'],
            additionalProperties: false
        },
        panelMethod: async (_t, args) => knowledge.lookupEffect(args.query, args.limit || 10)
    },
    {
        name: 'lookup_property',
        description: 'Fast lookup of AE property matchNames (108 properties: transforms, masks, layer styles, text, shape contents, 3D extrusion). Returns matchName + displayName + access path. Does NOT cover individual EFFECT parameters — for those use apply_effect\'s properties arg or a dotted display path like "Effects.Gaussian Blur.Blurriness".',
        inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' }, limit: { type: 'integer', default: 10 } },
            required: ['query'],
            additionalProperties: false
        },
        panelMethod: async (_t, args) => knowledge.lookupProperty(args.query, args.limit || 10)
    },
    {
        name: 'lookup_expression',
        description: 'Fast lookup of expression snippets (188 entries: wiggle/loop/bounce variants, Dan Ebberts patterns, effect-templates, operation-templates). Returns ready-to-paste expression code.',
        inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' }, limit: { type: 'integer', default: 5 } },
            required: ['query'],
            additionalProperties: false
        },
        panelMethod: async (_t, args) => knowledge.lookupExpression(args.query, args.limit || 5)
    },
    {
        name: 'knowledge_search',
        description: 'Full-text search across all 18 knowledge files (effect/property matchnames, expressions, layer methods, motion design concepts, scripting API reference, troubleshooting, AE features, keyboard shortcuts, etc.). Returns file + line + snippet. Use when none of the structured lookups fit.',
        inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' }, limit: { type: 'integer', default: 10 } },
            required: ['query'],
            additionalProperties: false
        },
        panelMethod: async (_t, args) => knowledge.knowledgeSearch(args.query, args.limit || 10)
    },

    // -------- live events --------
    {
        name: 'get_recent_events',
        description: 'Return events the panel has pushed since `since` (epoch ms; defaults to all buffered, max 100). Events: project_opened, comp_opened, selection_changed, items_changed, dirty_changed.',
        inputSchema: {
            type: 'object',
            properties: { since: { type: 'integer', description: 'Epoch ms cursor. Returns events after this time.' } },
            additionalProperties: false
        },
        panelMethod: async (transport, args) => {
            const since = Number(args.since) || 0;
            const ev = process.__aePortalEvents;
            if (!ev) return { events: [], serverTime: Date.now() };
            return {
                serverTime: Date.now(),
                count: ev.buffer.length,
                events: since ? ev.since(since) : ev.buffer.slice()
            };
        }
    },

    // -------- batch / inspection / timing --------
    {
        name: 'set_property_batch',
        description: 'Set a property across MANY layers (or comps) in ONE undo step. Broadcast form: {comp?, layers, prop, value, time?} applies the same value to every listed layer. Targets form: {targets:[{comp?, layer, prop, value, time?}, ...]} for per-target values. Returns per-target {ok,error}. Use instead of calling set_property N times (stat-card / box-rig work).',
        inputSchema: {
            type: 'object',
            properties: {
                comp: { oneOf: [{ type: 'string' }, { type: 'integer' }, idRef], description: 'comp name, id, or { id: N } (broadcast form)' },
                layers: { type: 'array', description: 'layer names/indices (broadcast form)' },
                prop: { type: 'string', description: 'property path or matchName (broadcast form)' },
                value: { description: 'value to set (number, array, color, etc.)' },
                time: { type: 'number', description: 'seconds; only used if the property is keyframed' },
                targets: { type: 'array', description: 'per-target list: [{comp?,layer,prop,value,time?}]', items: { type: 'object' } }
            },
            additionalProperties: false
        },
        panelMethod: 'set_property_batch'
    },
    {
        name: 'batch',
        description:
            'Run many portal tools in ONE round-trip and ONE undo group (atomic: a single Undo reverts the whole batch). ' +
            'stopOnError (default true) halts at the first failing op. ' +
            'Only JSX-routed mutation/read tools are allowed — not render_frame, whisper, import_folder, run_jsx, reload_host, or batch itself. ' +
            'Returns per-op results plus appliedCount/failedAt.',
        inputSchema: {
            type: 'object',
            properties: {
                operations: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 500,
                    description: 'Ordered ops to run in one undo group. Each: { tool: <portal tool name>, args: <that tool\'s arguments> }.',
                    items: {
                        type: 'object',
                        properties: {
                            tool: { type: 'string', description: 'Name of a JSX-routed portal tool to run.' },
                            args: { type: 'object', description: 'Arguments for that tool. Validated against the tool\'s own schema before sending; a per-op `instance` is not allowed.' }
                        },
                        required: ['tool'],
                        additionalProperties: false
                    }
                },
                stopOnError: { type: 'boolean', default: true, description: 'When true (default), the batch stops at the first failing op and reports failedAt + notAttempted; when false, every op is attempted and per-op errors are collected.' }
            },
            required: ['operations'],
            additionalProperties: false
        },
        panelMethod: 'batch'
    },
    {
        name: 'get_layer_bounds',
        description: 'Read a layer\'s rendered bounds at a time: sourceRectAtTime (left/top/width/height in layer space) + Position/Anchor/Scale + the comp-space visual center. includeExtents:true also returns the on-screen bounding box (corners transformed to comp space). The measurement primitive behind responsive-box and counter-centering rigs.',
        inputSchema: {
            type: 'object',
            properties: {
                comp: compRefIdx,
                layer: layerRef,
                time: { type: 'number' },
                frame: { type: 'integer' },
                includeExtents: { type: 'boolean' }
            },
            required: ['layer'],
            additionalProperties: false
        },
        panelMethod: 'get_layer_bounds'
    },
    {
        name: 'describe_layer',
        description: 'Full snapshot of ONE layer: type, enabled/3D, in/out/startTime/stretch, blend mode, track matte, parent chain, transform (with keyframes), effects, markers, source rect — optionally masks/shapeContents/textAnimators. Cheaper than deep-mapping a whole comp when you only need one layer before a targeted edit.',
        inputSchema: {
            type: 'object',
            properties: {
                comp: compRefIdx,
                layer: layerRef,
                includeTransform: { type: 'boolean', description: 'default true' },
                includeEffects: { type: 'boolean', description: 'default true' },
                includeKeyframes: { type: 'boolean', description: 'default true' },
                includeMasks: { type: 'boolean' },
                includeShapeContents: { type: 'boolean' },
                includeTextAnimators: { type: 'boolean' }
            },
            required: ['layer'],
            additionalProperties: false
        },
        panelMethod: 'describe_layer'
    },
    {
        name: 'sample_property',
        description: 'Sample a property\'s VALUE over time (post-expression) as a {time,frame,value} series. Verify expression-driven motion — counters, wiggle, slider-driven box growth — numerically without rendering pixels. Defaults to the layer in→out range at 1-frame steps; pass step (seconds) or frames (sample count). Capped at 500 samples.',
        inputSchema: {
            type: 'object',
            properties: {
                comp: compRefIdx,
                layer: layerRef,
                prop: { type: 'string' },
                startTime: { type: 'number' }, endTime: { type: 'number' },
                startFrame: { type: 'integer' }, endFrame: { type: 'integer' },
                step: { type: 'number', description: 'seconds between samples' },
                frames: { type: 'integer', description: 'number of samples across the range' }
            },
            required: ['layer', 'prop'],
            additionalProperties: false
        },
        panelMethod: 'sample_property'
    },
    {
        name: 'markers_to_keyframes',
        description: 'Turn timed markers into animation — closes the caption pipeline after whisper_transcribe + add_markers_batch. mode="inout" (default): set each target layer\'s in/out points to consecutive marker times (per-word/per-line reveals). mode="keyframe": drop a key on `prop` at every marker time (value from `value`, or the sampled current value), optionally HOLD-interpolated. Markers read from markerLayer, else comp markers.',
        inputSchema: {
            type: 'object',
            properties: {
                comp: compRefIdx,
                layers: { type: 'array', description: 'target layers (names/indices)' },
                markerLayer: { oneOf: [{ type: 'string' }, { type: 'integer' }, idRef], description: 'layer to read markers from (name, index, or { id: N }); omit for comp markers' },
                mode: { type: 'string', enum: ['inout', 'keyframe'] },
                prop: { type: 'string', description: 'mode=keyframe: property to key' },
                value: { description: 'mode=keyframe: value to set (else samples current)' },
                hold: { type: 'boolean', description: 'mode=keyframe: HOLD interpolation' },
                lastDuration: { type: 'number', description: 'mode=inout: last layer out = its in + this (else comp end)' }
            },
            required: ['layers'],
            additionalProperties: false
        },
        panelMethod: 'markers_to_keyframes'
    },
    {
        name: 'audit_fonts',
        description: 'Audit fonts across the project (or one comp): which fonts are used, by which text layers, and which appear SUBSTITUTED/missing (requested PostScript name ≠ resolved font). A pre-render and handoff safety check. Returns missingFonts[] + a per-font usage map.',
        inputSchema: {
            type: 'object',
            properties: { comp: { oneOf: [{ type: 'string' }, { type: 'integer' }, idRef], description: 'omit to audit the whole project; accepts name, id, or { id: N }' } },
            additionalProperties: false
        },
        panelMethod: 'audit_fonts'
    },

    // -------- geometry: mask & shape paths --------
    {
        name: 'get_path',
        description: 'Read a mask or shape path\'s geometry. Target a mask via `mask` (name or 1-based index) OR a shape-layer path via `shapePath` (a dotted display path like "Contents.Shape 1.Path", or an ADBE matchName resolving to / containing an "ADBE Vector Shape") / `shapeIndex` (1-based group index inside Contents). Pass time/frame to sample a keyframed path; otherwise the static value is read. Tangents are [x,y] RELATIVE to their vertex. Returns {vertices,inTangents,outTangents,closed,numKeys}.',
        inputSchema: {
            type: 'object',
            properties: {
                comp: compRefIdx,
                layer: layerRef,
                mask: { oneOf: [{ type: 'string' }, { type: 'integer' }], description: 'Mask target: mask name or 1-based index.' },
                shapePath: { type: 'string', description: 'Shape target: dotted display path or ADBE matchName resolving to (or containing) an ADBE Vector Shape.' },
                shapeIndex: { type: 'integer', description: 'Shape target: 1-based group index in Root Vectors Group (Contents).' },
                time: { type: 'number', description: 'seconds — sample a keyframed path' },
                frame: { type: 'integer', description: 'frame — sample a keyframed path' }
            },
            required: ['layer'],
            additionalProperties: false
        },
        panelMethod: 'get_path'
    },
    {
        name: 'set_path',
        description: 'Write a mask or shape path\'s geometry. Same target selector as get_path (mask / shapePath / shapeIndex). `vertices` is required (array of [x,y] in layer space). inTangents/outTangents are optional (each [x,y] relative to its vertex) and default to zero — straight corners — and must match the vertex count when given. closed defaults true. With time/frame the path is keyframed at that time; otherwise it is set statically (or keyed at the current time if the path is already keyframed). Returns a read-back {kind,mode,vertices,closed,numKeys}.',
        inputSchema: {
            type: 'object',
            properties: {
                comp: compRefIdx,
                layer: layerRef,
                mask: { oneOf: [{ type: 'string' }, { type: 'integer' }], description: 'Mask target: mask name or 1-based index.' },
                shapePath: { type: 'string', description: 'Shape target: dotted display path or ADBE matchName.' },
                shapeIndex: { type: 'integer', description: 'Shape target: 1-based group index in Contents.' },
                vertices: { type: 'array', items: { type: 'array' }, description: 'Array of [x,y] vertex pairs (layer space).' },
                inTangents: { type: 'array', items: { type: 'array' }, description: 'Optional [x,y] in-tangents relative to each vertex; defaults to zeros.' },
                outTangents: { type: 'array', items: { type: 'array' }, description: 'Optional [x,y] out-tangents relative to each vertex; defaults to zeros.' },
                closed: { type: 'boolean', description: 'default true' },
                time: { type: 'number', description: 'seconds — keyframe the path here' },
                frame: { type: 'integer', description: 'frame — keyframe the path here' }
            },
            required: ['layer', 'vertices'],
            additionalProperties: false
        },
        panelMethod: 'set_path'
    },
    {
        name: 'add_mask',
        description: 'Create a mask on a layer. mode maps to MaskMode (add/subtract/intersect/difference/none; default add). `shape` is optional: an explicit {vertices,inTangents,outTangents,closed} OR a primitive {rect:[x,y,w,h]} / {ellipse:[x,y,w,h]} with a top-left origin (a 4-point rect or a 4-anchor bezier ellipse is generated). feather ([x,y] or a single number), expansion (px), and opacity (0-100) are optional. Returns {mask,index,mode,closed}.',
        inputSchema: {
            type: 'object',
            properties: {
                comp: compRefIdx,
                layer: layerRef,
                name: { type: 'string' },
                mode: { type: 'string', enum: ['add', 'subtract', 'intersect', 'difference', 'none'] },
                shape: {
                    type: 'object',
                    description: 'Explicit vertices/tangents OR a rect/ellipse primitive.',
                    properties: {
                        vertices: { type: 'array', items: { type: 'array' } },
                        inTangents: { type: 'array', items: { type: 'array' } },
                        outTangents: { type: 'array', items: { type: 'array' } },
                        closed: { type: 'boolean' },
                        rect: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4, description: '[x,y,w,h] top-left origin' },
                        ellipse: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4, description: '[x,y,w,h] bounding box' }
                    },
                    additionalProperties: false
                },
                feather: { oneOf: [{ type: 'number' }, { type: 'array', items: { type: 'number' } }], description: 'Mask feather: a number (applied to x and y) or [x,y].' },
                expansion: { type: 'number', description: 'Mask expansion in px.' },
                opacity: { type: 'number', minimum: 0, maximum: 100 }
            },
            required: ['layer'],
            additionalProperties: false
        },
        panelMethod: 'add_mask'
    },

    // -------- watch mode --------
    {
        name: 'watch_start',
        description: 'Start watch mode (Stage A fidelity). Hooks view.onSync in AE — on every real edit the active comp is snapshotted (keyed by stable layer.id) and diffed. Detects: comp-wide layer add/delete; transform + Orientation value/keyframe changes; keyframe ease/interp changes; which key TIMES were deleted; effect param changes (keyed by index+matchName so rename/reorder is not misattributed); mask + shape-layer PATH point drags; and parenting / blend mode / in-out / enabled / text (font,size,text) / text-animator changes. Selection, solo, shy, view and scrub changes are filtered out. Use watch_get_log to retrieve entries.',
        inputSchema: {
            type: 'object',
            properties: {
                scope: { type: 'string', enum: ['selected', 'comp'], description: 'Which layers get the deep value/path/meta diff each tick. "selected" (default) is cheapest — only currently-selected layers. "comp" deep-diffs every layer in the comp (capped at 24) so parenting/blend/path edits on unselected layers are caught, at higher onSync cost. Layer add/delete is always comp-wide regardless.' }
            },
            additionalProperties: false
        },
        panelMethod: 'watch_start'
    },
    {
        name: 'watch_stop',
        description: 'Stop watch mode and remove the onSync hook.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        panelMethod: 'watch_stop'
    },
    {
        name: 'watch_get_log',
        description: 'Get watch log entries since a given index (default 0). Returns { entries, total }. Each entry: { ts, comp, layer, prop, change, value?, old?, time? }. change values: "value" (static or effect-param change) | "key_add" (+ time,value) | "key_del" (+ count, times[] of removed key times) | "key_mod" (+ time, old, value) | "key_ease" (interp/temporal-ease change; + time, keyIndex) | "path_change" (mask/shape path point drag; + vertexCount; prop names the target e.g. "mask:Mask 1" or "shape#1") | "layer_add" (+ id, index) | "layer_del" (+ id) | "parent" | "blend" | "in_point" | "out_point" | "enabled" | "text" | "font" | "font_size" | "text_animator" (each with old/value) | "log_full" (cap reached).',
        inputSchema: {
            type: 'object',
            properties: { since: { type: 'integer', description: 'Return only entries at or after this index.' } },
            additionalProperties: false
        },
        panelMethod: 'watch_get_log'
    },
    {
        name: 'watch_clear',
        description: 'Clear the watch log.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        panelMethod: 'watch_clear'
    },
    {
        name: 'watch_status',
        description: 'Returns { active, entries, rev, scope } — whether watch is running, how many entries are in the log, and the deep-diff scope ("selected" | "comp").',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        panelMethod: 'watch_status'
    },
    {
        name: 'watch_get_replay',
        description: 'Convert the current watch recording into an ordered batch of portal tool calls that reproduces what was done — feed the returned operations straight to the `batch` tool. Layer/comp targets use {id} addressing. Returns { operations:[{tool,args}], count, unmapped:[...] } (plus deltas[] when relative:true). Mapping: value edits → set_property; key_add/key_mod → add_keyframe; path_change → set_path; parent → parent_layers; blend → set_layer_blend_mode; in_point/out_point → set_in_out; enabled → toggle_layer_state; text → set_text; layer_del → delete_layer. Non-reproducible edits (layer_add, key_del, key_ease with no recorded ease values, font/font_size/text_animator) go to unmapped with a human note — never fabricated. dedupe (default true) collapses a drag\'s many intermediate value samples to the final value per layer+prop.',
        inputSchema: {
            type: 'object',
            properties: {
                relative: { type: 'boolean', description: 'When true, also return deltas[] (old→value change) for transform Position/Anchor Point value ops so the caller can retarget them onto another layer. operations stay ABSOLUTE — set_property sets absolute values.' },
                dedupe: { type: 'boolean', default: true, description: 'When true (default), collapse repeated value edits on the same layer+prop to the final value (a drag emits many). Set false to keep every recorded intermediate value.' }
            },
            additionalProperties: false
        },
        panelMethod: 'watch_get_replay'
    },

    // -------- multi-instance --------
    {
        name: 'list_instances',
        description: 'List the After Effects instances the portal can currently reach (discovered automatically — one per AE that has the AE Portal panel open). Each entry shows its id (the AE year, e.g. "2026"), port, AE version, open project, and whether it is connected. Use this when more than one AE is open so you know what to pass as the `instance` argument.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        panelMethod: (transport) => {
            if (typeof transport.list === 'function') {
                const instances = transport.list().map(inst => withHostResponsive(Object.assign({}, inst), hostMetaFor(inst.id)));
                return { mode: 'discovery', instances };
            }
            return { mode: 'single', instances: [withHostResponsive({ id: 'default', connected: true }, hostMetaFor(null))] };
        }
    },
    {
        name: 'use_instance',
        description: 'Set the default After Effects instance that subsequent commands target when they don\'t pass their own `instance`. Accepts an instance id ("2026"/"2025"), an AE major ("26"), or a port. A per-call `instance` argument always overrides this. Useful when two AEs are open and you want to work in one for a while without repeating `instance` on every call.',
        inputSchema: {
            type: 'object',
            properties: { instance: { type: 'string', description: 'e.g. "2026", "2025", "26", or a port number' } },
            required: ['instance'],
            additionalProperties: false
        },
        panelMethod: (transport, args) => (typeof transport.setActive === 'function')
            ? { active: transport.setActive(args.instance) }
            : { active: 'default', note: 'single-instance server; nothing to switch' }
    },

    // ============================================================
    // Tier-1B — text-motion + shape verbs (v0.3.0)
    // ============================================================
    {
        name: 'add_text_animator',
        description:
            'Add a Text Animator (with an explicit Range Selector) to a text layer in one call — the missing text-motion verb for typewriter / cascade / word-reveal builds. ' +
            '`properties` maps any of position [x,y], opacity, scale [x,y], rotation, tracking, blur to their animated values. ' +
            '`basedOn` sets the selector units (characters/word/line). Optional static `range` {start,end,offset} (percent). ' +
            'For a sweep, pass `revealFrom`/`revealTo` (seconds): the selector Offset is keyframed for a left-to-right reveal (inverted ramp; band defaults to Start=0,End=25 if `range` omitted), with optional `ease` (in/out/inout, influence 75).',
        inputSchema: {
            type: 'object',
            properties: {
                comp:  compRef,
                layer: layerRef,
                properties: {
                    type: 'object',
                    properties: {
                        position: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 3, description: '[x,y] (z optional)' },
                        opacity:  { type: 'number', description: '0–100' },
                        scale:    { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 3, description: '[x,y] percent' },
                        rotation: { type: 'number', description: 'degrees' },
                        tracking: { type: 'number' },
                        blur:     { oneOf: [{ type: 'number' }, { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }], description: 'scalar or [x,y]' }
                    },
                    additionalProperties: false,
                    description: 'Animated values for the animator. Provide any subset.'
                },
                basedOn: { type: 'string', enum: ['characters', 'charactersExcludingSpaces', 'words', 'lines'], description: 'Range selector units.' },
                range: {
                    type: 'object',
                    properties: { start: { type: 'number' }, end: { type: 'number' }, offset: { type: 'number' } },
                    additionalProperties: false,
                    description: 'Static selector band (percent). Ignored offset when a keyframed reveal is used.'
                },
                revealFrom: { type: 'number', description: 'Reveal start time (seconds) — keyframes selector Offset.' },
                revealTo:   { type: 'number', description: 'Reveal end time (seconds).' },
                ease: { type: 'string', enum: ['in', 'out', 'inout'], description: 'Easing for the reveal Offset keyframes (influence 75).' },
                name: { type: 'string', description: 'Optional animator name.' }
            },
            required: ['layer'],
            additionalProperties: false
        },
        panelMethod: 'add_text_animator'
    },
    {
        name: 'animate_trim_paths',
        description:
            'Add + keyframe a Trim Paths modifier on a shape/path layer — the classic draw-on. Animates the chosen trim prop from `from` to `to` (percent) across the `over` [startSec,endSec] window. ' +
            '`mode` picks which prop: "end" (default, draw-on), "start", or "offset". Optional `ease` (in/out/inout, influence 75).',
        inputSchema: {
            type: 'object',
            properties: {
                comp:  compRef,
                layer: layerRef,
                from:  { type: 'number', default: 0, description: 'Start value % (default 0).' },
                to:    { type: 'number', default: 100, description: 'End value % (default 100).' },
                over:  { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: '[startSec, endSec] keyframe times.' },
                mode:  { type: 'string', enum: ['end', 'start', 'offset'], default: 'end', description: 'Which trim property to animate.' },
                ease:  { type: 'string', enum: ['in', 'out', 'inout'] }
            },
            required: ['layer', 'over'],
            additionalProperties: false
        },
        panelMethod: 'animate_trim_paths'
    },
    {
        name: 'set_shape_style',
        description:
            'Style a shape group\'s fill and/or stroke in one call — Fill/Stroke are found or ADDED as needed. ' +
            'Colors accept a hex string ("#rrggbb"/"#rgb") or an [r,g,b] array (0–1 or 0–255, auto-normalized). ' +
            '`group` targets a shape group by name or 1-based index (default: first group). ' +
            'Optional fillOpacity/strokeOpacity (0–100), strokeWidth, and `dash` (array of numbers or [dash,gap] pairs; up to 3 pairs). Returns the read-back fill/stroke/width.',
        inputSchema: {
            type: 'object',
            properties: {
                comp:  compRef,
                layer: layerRef,
                group: { oneOf: [{ type: 'string' }, { type: 'integer' }], description: 'Shape group name or 1-based index. Default first group.' },
                fill:  { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 4 }], description: 'Hex or [r,g,b(,a)].' },
                fillOpacity:   { type: 'number', minimum: 0, maximum: 100 },
                stroke: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 4 }], description: 'Hex or [r,g,b(,a)].' },
                strokeWidth:   { type: 'number', minimum: 0 },
                strokeOpacity: { type: 'number', minimum: 0, maximum: 100 },
                dash: { type: 'array', items: { oneOf: [{ type: 'number' }, { type: 'array', items: { type: 'number' }, minItems: 1, maxItems: 2 }] }, description: 'Dash pattern: numbers or [dash,gap] pairs.' }
            },
            required: ['layer'],
            additionalProperties: false
        },
        panelMethod: 'set_shape_style'
    },
    {
        name: 'fit_box_to_text',
        description:
            'Create (or update) a rounded-rectangle background shape that tracks a text layer\'s bounds + padding, placed directly BEHIND the text. ' +
            'mode="expression" (default) live-links the box Size + Position to the text\'s sourceRectAtTime every frame, so the box follows edits and animation; mode="bake" computes once at the current comp time and sets static values. ' +
            '`padding` is a number (all sides), [x,y], or [left,top,right,bottom] px. `corner` = rounded-corner radius. `color` (hex "#rrggbb"/"#rgb" or [r,g,b(,a)], 0–1 or 0–255, auto-normalized) + `opacity` (0–100) style the fill (default black). ' +
            'Pass `boxLayer` to update an existing box instead of creating a new one. Returns { boxLayer, mode, expressionError }.',
        inputSchema: {
            type: 'object',
            properties: {
                comp:      compRef,
                textLayer: layerRef,
                padding:   { oneOf: [{ type: 'number' }, { type: 'array', items: { type: 'number' }, minItems: 1, maxItems: 4 }], description: 'px: number (all sides), [x,y], or [left,top,right,bottom].' },
                corner:    { type: 'number', minimum: 0, description: 'Rounded-corner radius (px).' },
                color:     { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 4 }], description: 'Fill color: hex or [r,g,b(,a)]. Default black.' },
                opacity:   { type: 'number', minimum: 0, maximum: 100, description: 'Fill opacity %. Default 100.' },
                mode:      { type: 'string', enum: ['expression', 'bake'], default: 'expression', description: 'expression = live-linked; bake = static at current time.' },
                boxLayer:  { oneOf: [{ type: 'string' }, { type: 'integer' }, idRef], description: 'Existing box layer to update (name, 1-based index, or { id: N }). Omit to create a new one.' },
                name:      { type: 'string', description: 'Name for a newly created box (default "<text> BG").' }
            },
            required: ['textLayer'],
            additionalProperties: false
        },
        panelMethod: 'fit_box_to_text'
    },
    {
        name: 'add_counter',
        description:
            'Number counter driven A→B by a keyframed Slider control feeding a source-text expression — the responsive-counter primitive. ' +
            'Target an existing text `layer`, or pass create:true (+ optional `position`, `fontSize`, `name`) to make a new one. ' +
            'A slider (named by `sliderName`, default "Counter") is keyframed `from`→`to` across `over` [startSec,endSec], with optional `ease`. ' +
            'The source-text expression (built WITHOUT toFixed) applies `decimals`, optional `thousands` separators (`separator` char, default ","), `prefix`, and `suffix`. Returns { layer, slider, from, to, over, expression, expressionError }.',
        inputSchema: {
            type: 'object',
            properties: {
                comp:       compRef,
                layer:      layerRef,
                create:     { type: 'boolean', description: 'Create a new text layer instead of targeting `layer`.' },
                position:   { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 3, description: 'Position for a created layer.' },
                fontSize:   { type: 'number', minimum: 0, description: 'Font size for a created layer.' },
                name:       { type: 'string', description: 'Name for a created layer.' },
                from:       { type: 'number', default: 0, description: 'Slider start value.' },
                to:         { type: 'number', default: 100, description: 'Slider end value.' },
                over:       { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: '[startSec, endSec] keyframe times.' },
                ease:       { type: 'string', enum: ['in', 'out', 'inout'], description: 'Easing for the slider keyframes (influence 75).' },
                decimals:   { type: 'integer', minimum: 0, maximum: 12, default: 0, description: 'Decimal places.' },
                thousands:  { type: 'boolean', default: false, description: 'Insert thousands separators.' },
                separator:  { type: 'string', default: ',', description: 'Thousands separator character.' },
                prefix:     { type: 'string', description: 'Text before the number (e.g. "$").' },
                suffix:     { type: 'string', description: 'Text after the number (e.g. "%").' },
                sliderName: { type: 'string', default: 'Counter', description: 'Name of the Slider control.' }
            },
            required: ['over'],
            additionalProperties: false
        },
        panelMethod: 'add_counter'
    },
    {
        name: 'find_replace_text',
        description:
            'Find/replace text across TextLayers, project-wide or scoped to one `comp`. ' +
            'dryRun defaults to TRUE — it reports every match (comp, layer, before, after, count) WITHOUT changing anything; pass dryRun:false to apply. ' +
            '`matchCase` (default false) and `wholeWord` (manual word-boundary test — no regex) refine matching. ' +
            'Replacement preserves the text layer\'s document properties (uniform styling); keyframed source-text layers are reported but skipped. Returns { scanned, matches, replaced, dryRun }.',
        inputSchema: {
            type: 'object',
            properties: {
                comp:      compRef,
                find:      { type: 'string', description: 'Substring to search for (non-empty).' },
                replace:   { type: 'string', description: 'Replacement text (default empty = delete matches).' },
                matchCase: { type: 'boolean', default: false },
                wholeWord: { type: 'boolean', default: false, description: 'Only match when bounded by non-word chars.' },
                dryRun:    { type: 'boolean', default: true, description: 'Report matches without changing (default true).' }
            },
            required: ['find'],
            additionalProperties: false
        },
        panelMethod: 'find_replace_text'
    },

    // -------- effect stacks + expression-safe rename --------
    {
        name: 'copy_effects',
        description:
            'Clone an effect stack from a source layer to one or more dest layers. For each effect it adds the effect by matchName, then copies every settable parameter value, its keyframes (full fidelity — interp/ease/spatial tangents), and any expressions. ' +
            'Copies ALL source effects by default; pass `effects` (names and/or 1-based indices) to copy a subset (in source order). ' +
            '`clearExisting` removes each dest layer\'s existing effects first (rejected when a dest is the source layer itself). Dest layers may live in another comp via `destComp`. ' +
            'CUSTOM_VALUE / ARB parameters (e.g. Curves curves, Colorama gradients) are NOT script-copyable — they are skipped and listed in `skippedParams` ("Effect > Param"). ' +
            'Returns { copiedTo:[{layer,index,effects,failed?}], effectsCopied, skippedParams, effectsNotFound? }.',
        inputSchema: {
            type: 'object',
            properties: {
                comp:   compRef,
                source: { type: 'object', properties: { layer: layerRef }, required: ['layer'], additionalProperties: false },
                dest:   layersRef,
                destComp: { oneOf: [{ type: 'string' }, idRef], description: 'Comp (name or { id: N }) for the dest layer(s) if different from the source comp. Defaults to the source comp.' },
                effects: { oneOf: [{ type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'integer' }] } }, { type: 'string' }, { type: 'integer' }], description: 'Effect names and/or 1-based indices to copy. Omit to copy every effect.' },
                clearExisting: { type: 'boolean', description: 'Remove all existing effects on each dest layer before copying. Default false.' }
            },
            required: ['source', 'dest'],
            additionalProperties: false
        },
        panelMethod: 'copy_effects'
    },
    {
        name: 'reorder_effects',
        description:
            'Reorder effects on a layer within its Effect Parade (1-based indices). ' +
            'Single move: pass `effect` (name or 1-based index) + `toIndex`. ' +
            'Full reorder: pass `order` (the desired list of effect names) and every named effect is moved into that sequence. ' +
            'Returns { effect, fromIndex, toIndex } for a single move, or { reordered:[{effect,fromIndex,toIndex}|{effect,error}] } for a full reorder.',
        inputSchema: {
            type: 'object',
            properties: {
                comp:    compRef,
                layer:   layerRef,
                effect:  { oneOf: [{ type: 'string' }, { type: 'integer' }], description: 'Effect name or 1-based index (single-move mode).' },
                toIndex: { type: 'integer', minimum: 1, description: '1-based target index (single-move mode).' },
                order:   { type: 'array', items: { type: 'string' }, description: 'Full desired order of effect names — reorders the whole stack.' }
            },
            required: ['layer'],
            additionalProperties: false
        },
        panelMethod: 'reorder_effects'
    },
    {
        name: 'safe_rename',
        description:
            'Expression-safe rename of a LAYER (or a comp). A plain rename silently breaks name-based expression references — this runs the 5-step: ' +
            '(1) scan every comp for expressions referencing layer("oldName"), (2) build the update map, (3) rewrite oldName->newName in those expressions FIRST, (4) rename the layer, (5) force re-enable any expression AE disabled during the change. ' +
            'dryRun (default false) reports which expressions WOULD change without touching anything. ' +
            'For a comp rename pass `renameComp` instead of `layer`; the comp is renamed but cross-comp comp("oldName") references are NOT auto-updated (called out in the result note). ' +
            'Returns { renamed, from, to, kind, expressionsUpdated:[{comp,layer,prop}], reEnabled:[...], dryRun, note? }.',
        inputSchema: {
            type: 'object',
            properties: {
                comp:       compRef,
                layer:      layerRef,
                renameComp: { oneOf: [{ type: 'string' }, idRef], description: 'Rename a COMP (by name, id, or { id: N }) instead of a layer. Mutually exclusive with `layer`.' },
                newName:    { type: 'string', description: 'The new name.' },
                dryRun:     { type: 'boolean', default: false, description: 'Report affected expressions without changing anything.' }
            },
            required: ['newName'],
            additionalProperties: false
        },
        panelMethod: 'safe_rename'
    },

    // -------- audit / brand / captions --------
    {
        name: 'search_project',
        description:
            'READ-ONLY project-wide search — a delivery-audit tool. Walks every comp (by id) → layers → the surface named by `by`, WITHOUT changing anything. ' +
            '`by`: "effect" (layers whose Effect Parade has an effect whose name/matchName contains `query`), "expression" (properties whose expression text contains `query`), ' +
            '"font" (TextLayers whose font contains `query`), "text" (TextLayers whose text contains `query`), "footage" (FootageItems whose name/path contains `query`, with the comps they are used in), ' +
            'or "missing" (FootageItems flagged footageMissing — `query` optional/ignored). Matching is case-insensitive substring. ' +
            'Returns { by, query, hits:[{comp, layer|item, detail}], count }.',
        inputSchema: {
            type: 'object',
            properties: {
                by:    { type: 'string', enum: ['effect', 'expression', 'font', 'text', 'footage', 'missing'], description: 'Which surface to search.' },
                query: { type: 'string', description: 'Case-insensitive substring. Optional only when by="missing".' }
            },
            required: ['by'],
            additionalProperties: false
        },
        panelMethod: 'search_project'
    },
    {
        name: 'swap_color',
        description:
            'Find/replace a color across the project — the client brand-color-change primitive. `from`/`to` accept a hex string ("#rrggbb"/"#rgb") or an [r,g,b(,a)] array (0–1 or 0–255, auto-normalized). ' +
            'A color matches when every RGB channel is within `tolerance` (0–1 per-channel, default 0.02) of `from`. dryRun defaults to TRUE — it reports every match WITHOUT changing anything; pass dryRun:false to apply. ' +
            '`scope` limits to one comp (name or id); omit for the whole project. `include` selects which color surfaces to touch (solids, shapeFill, shapeStroke, textFill, effectColor); omit for all. ' +
            'Setting a SOLID recolors every layer sharing that footage item (swapped once, flagged shared:true, called out in `note`). Keyframed colors are matched but SKIPPED (setValue would delete keys). ' +
            'Returns { from, to, tolerance, matches:[{comp, layer, surface, was, ...}], matchCount, swapped, dryRun, note? }.',
        inputSchema: {
            type: 'object',
            properties: {
                from:      { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 4 }], description: 'Color to find: hex or [r,g,b(,a)].' },
                to:        { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 4 }], description: 'Replacement color: hex or [r,g,b(,a)].' },
                tolerance: { type: 'number', minimum: 0, maximum: 1, default: 0.02, description: 'Per-channel RGB match tolerance (0–1).' },
                scope:     { oneOf: [{ type: 'string' }, idRef], description: 'Comp (name, id, or { id: N }) to limit the swap to. Omit for whole project.' },
                dryRun:    { type: 'boolean', default: true, description: 'Report matches without changing (default true).' },
                include:   { type: 'array', items: { type: 'string', enum: ['solids', 'shapeFill', 'shapeStroke', 'textFill', 'effectColor'] }, description: 'Color surfaces to include. Omit for all.' }
            },
            required: ['from', 'to'],
            additionalProperties: false
        },
        panelMethod: 'swap_color'
    },
    {
        name: 'build_captions',
        description:
            'Turn a transcript into timed, wrapped, styled caption text layers — closes the whisper→captions loop. Provide `segments` ([{text,start,end}] in seconds) OR `srt` (raw SRT string; "HH:MM:SS,mmm --> HH:MM:SS,mmm" blocks are parsed). ' +
            'mode="layers" (default) creates one text layer per segment timed to [start,end]; mode="single" creates ONE layer with a source-text expression that shows the active segment by `time` from an embedded table. ' +
            '`maxCharsPerLine` word-wraps long lines (0 = no wrap). `style` = { font, fontSize, fillColor (hex or [r,g,b(,a)]), position [x,y], justification, box (true or [w,h] for paragraph/box text) } — captions default to centered near the lower third. ' +
            'Returns { mode, created, layers:[...] } (single mode also returns expression + expressionError).',
        inputSchema: {
            type: 'object',
            properties: {
                comp:            compRef,
                segments:        { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, start: { type: 'number' }, end: { type: 'number' } }, required: ['text', 'start', 'end'], additionalProperties: false }, description: 'Caption segments in seconds.' },
                srt:             { type: 'string', description: 'Raw SRT text (parsed instead of `segments`).' },
                mode:            { type: 'string', enum: ['layers', 'single'], default: 'layers', description: 'layers = one timed layer per segment; single = one expression-driven layer.' },
                maxCharsPerLine: { type: 'integer', minimum: 0, default: 0, description: 'Word-wrap width in characters (0 = no wrap).' },
                name:            { type: 'string', description: 'Layer name (single mode).' },
                style: {
                    type: 'object',
                    properties: {
                        font:          { type: 'string' },
                        fontSize:      { type: 'number', minimum: 0 },
                        fillColor:     { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 4 }], description: 'Hex or [r,g,b(,a)].' },
                        position:      { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 3 },
                        justification: { type: 'string', description: 'ParagraphJustification key, e.g. CENTER_JUSTIFY / LEFT_JUSTIFY / RIGHT_JUSTIFY.' },
                        box:           { oneOf: [{ type: 'boolean' }, { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }], description: 'Paragraph/box text: true (auto size) or [w,h].' }
                    },
                    additionalProperties: false
                }
            },
            additionalProperties: false
        },
        panelMethod: 'build_captions'
    }
];

// Per-tool transport timeouts (ms). Anything not listed uses the 60s default.
// These operations legitimately run longer than 60s, so without a bigger
// timeout the TCP layer would reject mid-flight while the panel is still working.
const SLOW_TOOLS = {
    whisper_transcribe: 600000,
    start_render: 600000,
    render_frame: 180000,
    render_preview_strip: 180000,
    open_project: 120000,
    import_folder: 120000,
    get_project_map: 120000,
    // 2.2: a batch can fan out to many mutations/reads in a single round-trip, so
    // give it a generous ceiling well past the 60s default.
    batch: 180000
};

// ---------- 2.2: batch pre-flight support ----------
// Name → tool index, so the batch handler can resolve each sub-op's referenced
// tool the same way server.js's tools/call does (TOOLS.find by name).
const TOOLS_BY_NAME = {};
for (const t of TOOLS) TOOLS_BY_NAME[t.name] = t;
// Tools that CANNOT appear inside a batch. The host runs every op in ONE undo
// group on the JSX thread, so a batch op must be a JSX-routed tool. This explicit
// list covers panel-side tools (render_frame), the escape hatch (run_jsx), dev
// reload (reload_host), long panel-side jobs (whisper/imports), the modal-risking
// project ops (open/close_project), and batch itself (no recursion). Server-local
// FUNCTION tools (panelMethod is a function) are rejected separately at dispatch
// time — they run in Node and never reach the host, so they can't be batched.
const BATCH_DISALLOWED = new Set([
    'run_jsx', 'reload_host', 'render_frame', 'whisper_transcribe',
    'import_folder', 'import_files', 'open_project', 'close_project', 'batch'
]);

// A batch of many big reads can produce a response approaching the 64MB socket
// frame cap. If the serialized batch result exceeds this, replace bulky per-op
// `result` payloads with a short note (keeping i/tool/ok/error) while leaving
// appliedCount/failedAt/note and the failed ops intact.
const BATCH_RESULT_MAX_BYTES = 4 * 1024 * 1024;
function guardBatchResultSize(out) {
    if (!out || typeof out !== 'object' || !Array.isArray(out.results)) return out;
    let bytes;
    try { bytes = Buffer.byteLength(JSON.stringify(out), 'utf8'); }
    catch (_) { return out; }               // unserializable — leave as-is
    if (bytes <= BATCH_RESULT_MAX_BYTES) return out;
    out.results = out.results.map(function (r) {
        if (r && typeof r === 'object' && r.ok === true && r.result !== undefined) {
            let rb = 0;
            try { rb = Buffer.byteLength(JSON.stringify(r.result), 'utf8'); } catch (_) { rb = 0; }
            return { i: r.i, tool: r.tool, ok: true, resultOmitted: true, bytes: rb };
        }
        return r;                            // failed ops (ok/error/tool/i) kept verbatim
    });
    out.resultsTruncated = true;
    out.truncationNote = 'Per-op result payloads omitted: batch response exceeded ' + BATCH_RESULT_MAX_BYTES + ' bytes.';
    return out;
}

// ---------- tiny built-in JSON-Schema validator ----------
// Covers only the keywords the tool schemas actually use: type (single or a
// union array, incl. integer/null), required, enum, additionalProperties:false,
// properties, items, minItems/maxItems, minimum/maximum, and oneOf/anyOf (matched
// leniently as "any branch"). Anything it doesn't understand is ignored rather
// than rejected, so it never blocks a valid call.
function schemaTypeOk(value, type) {
    switch (type) {
        case 'string':  return typeof value === 'string';
        case 'number':  return typeof value === 'number' && isFinite(value);
        case 'integer': return typeof value === 'number' && isFinite(value) && Math.floor(value) === value;
        case 'boolean': return typeof value === 'boolean';
        case 'array':   return Array.isArray(value);
        case 'null':    return value === null;
        case 'object':  return value !== null && typeof value === 'object' && !Array.isArray(value);
        default:        return true;   // unknown type keyword → don't block
    }
}
function typeName(v) { return Array.isArray(v) ? 'array' : (v === null ? 'null' : typeof v); }
// Returns an error string, or null if valid.
function validateAgainst(value, schema, pathName) {
    if (!schema || typeof schema !== 'object') return null;
    const where = pathName || 'value';

    const branches = schema.oneOf || schema.anyOf;
    if (Array.isArray(branches) && branches.length) {
        for (const b of branches) if (validateAgainst(value, b, pathName) === null) return null;
        return where + ' does not match any allowed form';
    }

    if (schema.type !== undefined) {
        const types = Array.isArray(schema.type) ? schema.type : [schema.type];
        let ok = false;
        for (const t of types) if (schemaTypeOk(value, t)) { ok = true; break; }
        if (!ok) return where + ' must be ' + types.join(' or ') + ' (got ' + typeName(value) + ')';
    }

    if (Array.isArray(schema.enum)) {
        let inEnum = false;
        for (const e of schema.enum) if (e === value) { inEnum = true; break; }
        if (!inEnum) return where + ' must be one of: ' + schema.enum.join(', ');
    }

    if (typeof value === 'number') {
        if (typeof schema.minimum === 'number' && value < schema.minimum) return where + ' must be >= ' + schema.minimum;
        if (typeof schema.maximum === 'number' && value > schema.maximum) return where + ' must be <= ' + schema.maximum;
    }

    if (Array.isArray(value)) {
        if (typeof schema.minItems === 'number' && value.length < schema.minItems) return where + ' must have at least ' + schema.minItems + ' item(s)';
        if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) return where + ' must have at most ' + schema.maxItems + ' item(s)';
        if (schema.items) {
            for (let i = 0; i < value.length; i++) {
                const e = validateAgainst(value[i], schema.items, where + '[' + i + ']');
                if (e) return e;
            }
        }
    }

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const props = schema.properties || null;
        if (Array.isArray(schema.required)) {
            for (const r of schema.required) {
                if (value[r] === undefined) return where + ' is missing required property "' + r + '"';
            }
        }
        if (schema.additionalProperties === false && props) {
            for (const k in value) {
                if (Object.prototype.hasOwnProperty.call(value, k) && !Object.prototype.hasOwnProperty.call(props, k)) {
                    return 'unexpected property "' + k + '"' + (pathName ? ' in ' + where : '');
                }
            }
        }
        if (props) {
            for (const k in props) {
                if (Object.prototype.hasOwnProperty.call(value, k) && value[k] !== undefined) {
                    const e = validateAgainst(value[k], props[k], (pathName ? pathName + '.' : '') + k);
                    if (e) return e;
                }
            }
        }
    }

    return null;
}
function validateArgs(schema, args) {
    return validateAgainst(args || {}, schema || { type: 'object' }, '');
}

// ---------- run_jsx safety lint (item 0.1) ----------
// Cheap regex heuristics only — a static scan can't prove intent (a bounded
// while(...) and an unbounded one look the same to a regex; a string literal
// that happens to contain "app.open(" looks the same as a real call). That's
// acceptable because the hard-blocks below are all override-able with
// force:true, and the warn-only class never blocks at all.
const RUN_JSX_HARD_BLOCKS = [
    {
        re: /app\.executeCommand\s*\(/,
        found: 'app.executeCommand(',
        reason: 'unstable command IDs caused data loss (2026-05-29 incident) — command IDs are undocumented and can shift across AE versions/builds.',
        alternative: 'use a dedicated portal tool for the action you want; if you truly need a menu command, resolve its id at runtime via findMenuCommandId instead of hardcoding one.'
    },
    {
        re: /system\.callSystem\s*\(/,
        found: 'system.callSystem(',
        reason: "forking a process from inside AE's own process can deadlock the malloc lock under macOS 26's xzone allocator.",
        alternative: 'shell out from the CEP/Node side (panel-side spawn) instead of from ExtendScript.'
    },
    {
        re: /app\.newProject\s*\(/,
        found: 'app.newProject(',
        reason: 'pops a native Save-changes modal on a dirty project that blocks AE until a human dismisses it.',
        alternative: 'use the open_project tool, which has a dirty-project guard (pass force:true on that tool to proceed anyway).'
    },
    {
        re: /app\.open\s*\(/,
        found: 'app.open(',
        reason: 'pops a native Save-changes modal on a dirty project that blocks AE until a human dismisses it.',
        alternative: 'use the open_project tool, which has a dirty-project guard (pass force:true on that tool to proceed anyway).'
    }
];

// Warn-only: never blocks the call, just gets attached to the result. A static
// regex can't prove a loop is unbounded (the repo's own JSX uses legit bounded
// while/do loops) — this is a speed bump, not proof of danger.
const RUN_JSX_WARN_PATTERNS = [
    {
        re: /\b(while\s*\(|do\s*\{)/,
        warning: "unbounded loops freeze AE's single thread uninterruptibly and a bridge timeout does NOT stop the script — ensure every loop has a hard iteration cap."
    },
    {
        // .remove( inside what looks like an ascending index for-loop — a common
        // trap (removing while iterating forward skips elements / reindexes mid-loop).
        re: /for\s*\(\s*var\s+\w+\s*=\s*0[\s\S]{0,80}?\.remove\s*\(/,
        warning: '.remove( found inside what looks like an ascending for-loop — removing while iterating forward skips elements as the collection reindexes; iterate in reverse instead.'
    }
];

// Mark chat (AE_PORTAL_MARK_CHAT=1, set only by the Mark panel's own chat): the
// hard-blocks above can't be overridden with force:true, and scripts that touch
// files on disk are refused. Claude Code / Codex talking to the Portal directly
// are unaffected. A regex can't sandbox ExtendScript; this closes the obvious doors.
const MARK_CHAT = process.env.AE_PORTAL_MARK_CHAT === '1';
const MARK_CHAT_FILE_RE = /\b(File|Folder)\s*[.(]/;
const MARK_CHAT_FILE_WRITE_RE = /\.(remove|rename|write|writeln|execute|copy|create)\s*\(|\.open\s*\(\s*["'][wae]/;
function markChatBlocks(script) {
    if (!MARK_CHAT) return [];
    if (MARK_CHAT_FILE_RE.test(script) && MARK_CHAT_FILE_WRITE_RE.test(script)) {
        return ['Blocked in the Mark chat: this script writes, deletes, renames or runs files on disk.\n' +
            'Why: the chat panel is meant to change the After Effects project only.\n' +
            'Safer alternative: use a dedicated tool (import_files, save_project, collect_files, render_queue_add), or ask the user to do the file step.'];
    }
    return [];
}

function lintRunJsxScript(script) {
    const blocks = [];
    for (const p of RUN_JSX_HARD_BLOCKS) {
        if (p.re.test(script)) {
            blocks.push(
                'Blocked: found "' + p.found + '" in the script.\n' +
                'Why: ' + p.reason + '\n' +
                'Safer alternative: ' + p.alternative + '\n' +
                "Override: pass force:true on this run_jsx call if you're certain this is safe here."
            );
        }
    }
    const warnings = [];
    for (const p of RUN_JSX_WARN_PATTERNS) {
        if (p.re.test(script)) warnings.push(p.warning);
    }
    return { blocks, warnings };
}

// Attaches warn-only lint findings to a tool result without changing its shape
// where avoidable: plain objects get a `_lintWarnings` array; anything else
// (string/array/primitive) gets the warnings prepended as `[lint warning] ...`
// text lines ahead of the serialized result.
function attachLintWarnings(result, warnings) {
    if (!warnings || !warnings.length) return result;
    if (result !== null && typeof result === 'object' && !Array.isArray(result)) {
        result._lintWarnings = warnings;
        return result;
    }
    const prefix = warnings.map(function (w) { return '[lint warning] ' + w; }).join('\n') + '\n';
    return prefix + (typeof result === 'string' ? result : JSON.stringify(result));
}

async function dispatchTool(transport, tool, args) {
    args = args || {};
    // `instance` is a routing hint for the discovery pool — strip it so it's
    // never forwarded to the panel/JSX (which doesn't expect it).
    const instance = args.instance;
    let params = args;
    if (instance !== undefined) {
        params = {};
        for (const k in args) {
            if (k !== 'instance' && Object.prototype.hasOwnProperty.call(args, k)) params[k] = args[k];
        }
    }
    // Validate the (instance-stripped) args against the tool's declared schema
    // BEFORE touching the panel. On failure raise JSON-RPC -32602 (invalid params).
    const verr = validateArgs(tool.inputSchema, params);
    if (verr) {
        const e = new Error('Invalid params for ' + tool.name + ': ' + verr);
        e.code = -32602;
        throw e;
    }

    // ---- 0.1: run_jsx safety lint — runs after validation, before dispatch ----
    let lintWarnings = null;
    if (tool.name === 'run_jsx' && typeof params.script === 'string') {
        const lint = lintRunJsxScript(params.script);
        const markBlocks = markChatBlocks(params.script);
        if (markBlocks.length) lint.blocks.push.apply(lint.blocks, markBlocks);
        if (lint.blocks.length && (params.force !== true || MARK_CHAT)) {
            const e = new Error(
                'run_jsx blocked by safety lint (' + lint.blocks.length + ' issue' + (lint.blocks.length > 1 ? 's' : '') + '):\n\n' +
                lint.blocks.join('\n\n')
            );
            e.code = -32602;
            throw e;
        }
        if (lint.warnings.length) lintWarnings = lint.warnings;
    }

    // ---- 2.2: batch pre-flight — validate & gate EVERY sub-op before sending ----
    // The host runs all ops in one undo group, so a single bad op must fail the
    // whole batch here — nothing may partially execute. For each op we resolve the
    // referenced tool, reject un-batchable ones (server-local function tools +
    // panel-side / escape-hatch / recursive tools), validate its args against its
    // own inputSchema, and forbid a per-op `instance` (the batch routes as a whole).
    if (tool.name === 'batch') {
        const ops = Array.isArray(params.operations) ? params.operations : [];
        for (let i = 0; i < ops.length; i++) {
            const op = ops[i] || {};
            const sub = TOOLS_BY_NAME[op.tool];
            if (!sub) {
                const e = new Error('batch operation ' + i + ' references unknown tool "' + op.tool + '".');
                e.code = -32602;
                throw e;
            }
            if (typeof sub.panelMethod === 'function' || BATCH_DISALLOWED.has(sub.name)) {
                const e = new Error('batch operation ' + i + ' tool "' + sub.name + '" is not batchable — batch supports JSX-routed tools only (not server-local, panel-side, escape-hatch, or nested-batch tools).');
                e.code = -32602;
                throw e;
            }
            const opArgs = (op.args && typeof op.args === 'object') ? op.args : {};
            if (Object.prototype.hasOwnProperty.call(opArgs, 'instance')) {
                const e = new Error('batch operation ' + i + ' (' + sub.name + ') must not set a per-op "instance" — route the whole batch with a top-level instance instead.');
                e.code = -32602;
                throw e;
            }
            const oerr = validateArgs(sub.inputSchema, opArgs);
            if (oerr) {
                const e = new Error('batch operation ' + i + ' (' + sub.name + '): ' + oerr);
                e.code = -32602;
                throw e;
            }
        }
    }

    if (typeof tool.panelMethod === 'function') {
        const result = await tool.panelMethod(transport, args);
        return attachLintWarnings(result, lintWarnings);
    }
    const opts = {};
    if (instance !== undefined && instance !== null && String(instance).trim() !== '') opts.instance = instance;
    if (SLOW_TOOLS[tool.name]) opts.timeout = SLOW_TOOLS[tool.name];
    // 2.2: batch sends only {operations, stopOnError} to the host (routed by the
    // batch call's own `instance` via opts), then its response is size-guarded so a
    // large multi-read batch can't approach the socket frame cap or blow the client.
    if (tool.name === 'batch') {
        const batchOut = await transport.call('batch', { operations: params.operations, stopOnError: params.stopOnError }, opts);
        return attachLintWarnings(guardBatchResultSize(batchOut), lintWarnings);
    }
    const result = await transport.call(tool.panelMethod, params, opts);
    // 1.2: ping's hostResponsive comes from discovery meta, not the panel's own
    // reply — enrich after the call, same optional/omit-if-absent contract as
    // list_instances above.
    if (tool.name === 'ping') withHostResponsive(result, hostMetaFor(instance));
    return attachLintWarnings(result, lintWarnings);
}

module.exports = { TOOLS, dispatchTool };
