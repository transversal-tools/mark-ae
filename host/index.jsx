// AE Portal host script (ExtendScript / ES3).
// Single global namespace: MarkHost (the AE Portal original uses AEPortal; a different name lets both
// panels share AE's one ExtendScript engine). The panel JS calls MarkHost.dispatch(method, paramsJson).
// Returns a JSON string: {"ok": true, "result": ...} or {"ok": false, "error": "..."}.

#target aftereffects

// ===================== ES3 polyfills =====================
if (typeof JSON === 'undefined' || !JSON.stringify || !JSON.parse) {
    JSON = (function () {
        // tiny stringify/parse — handles strings, numbers, booleans, null, arrays, plain objects.
        function esc(s) {
            // Skip-scan escaper: copy safe runs in bulk via substring instead of
            // appending char-by-char (avoids O(n^2) string concat on long strings).
            // Only " (34), \ (92) and control chars (<32) ever need escaping; the
            // named escapes (\n \r \t \b \f) are all control chars. Output is
            // byte-identical to the original per-char version.
            var n = s.length;
            var out = '';
            var runStart = 0;
            for (var i = 0; i < n; i++) {
                var code = s.charCodeAt(i);
                if (code < 32 || code === 34 || code === 92) {
                    if (i > runStart) out += s.substring(runStart, i);
                    if      (code === 92) out += '\\\\';
                    else if (code === 34) out += '\\"';
                    else if (code === 10) out += '\\n';
                    else if (code === 13) out += '\\r';
                    else if (code === 9)  out += '\\t';
                    else if (code === 8)  out += '\\b';
                    else if (code === 12) out += '\\f';
                    else {
                        var h = code.toString(16);
                        while (h.length < 4) h = '0' + h;
                        out += '\\u' + h;
                    }
                    runStart = i + 1;
                }
            }
            if (runStart < n) out += s.substring(runStart);
            return out;
        }
        function stringify(v) {
            if (v === null || typeof v === 'undefined') return 'null';
            var t = typeof v;
            if (t === 'number')  return isFinite(v) ? String(v) : 'null';
            if (t === 'boolean') return v ? 'true' : 'false';
            if (t === 'string')  return '"' + esc(v) + '"';
            if (v instanceof Array) {
                var parts = [];
                for (var i = 0; i < v.length; i++) parts.push(stringify(v[i]));
                return '[' + parts.join(',') + ']';
            }
            if (t === 'object') {
                var p = [];
                for (var k in v) if (v.hasOwnProperty(k)) {
                    var sv = stringify(v[k]);
                    if (sv !== undefined) p.push('"' + esc(k) + '":' + sv);
                }
                return '{' + p.join(',') + '}';
            }
            return 'null';
        }
        // Permissive parse via eval inside a guard. ExtendScript has eval; safer than nothing.
        function parse(s) {
            if (s === null || s === undefined || s === '') return null;
            // Quick sanity: must be a string starting with valid JSON token.
            var t = String(s);
            // Wrap in parens to force expression evaluation.
            return eval('(' + t + ')');
        }
        return { stringify: stringify, parse: parse };
    })();
}
if (!Array.prototype.indexOf) {
    Array.prototype.indexOf = function (needle) {
        for (var i = 0; i < this.length; i++) if (this[i] === needle) return i;
        return -1;
    };
}

// ===================== MarkHost namespace =====================
var MarkHost = (function () {
    var startTime = (new Date()).getTime();
    var version = '0.3.0';

    // ---- helpers ----
    // Every envelope carries the sentinel `__ae:true` so the panel can positively
    // identify a genuine host response (vs. a CEP-level "EvalScript error." string
    // or any other non-envelope output) by structure, not by string-matching.
    function ok(result) { return JSON.stringify({ __ae: true, ok: true, result: (typeof result === 'undefined') ? null : result }); }
    function err(message, extra) {
        var o = { __ae: true, ok: false, error: String(message) };
        if (extra) o.detail = extra;
        return JSON.stringify(o);
    }
    function safe(fn) { try { return fn(); } catch (e) { return null; } }
    function trackMatteName(t) {
        if (t === undefined || t === null) return 'NONE';
        if (TrackMatteType) {
            if (t === TrackMatteType.NO_TRACK_MATTE) return 'NONE';
            if (t === TrackMatteType.ALPHA)          return 'ALPHA';
            if (t === TrackMatteType.ALPHA_INVERTED) return 'ALPHA_INVERTED';
            if (t === TrackMatteType.LUMA)           return 'LUMA';
            if (t === TrackMatteType.LUMA_INVERTED)  return 'LUMA_INVERTED';
        }
        return String(t);
    }
    function detectLayerType(layer) {
        if (layer instanceof TextLayer)   return 'Text';
        if (layer instanceof ShapeLayer)  return 'Shape';
        if (layer instanceof CameraLayer) return 'Camera';
        if (layer instanceof LightLayer)  return 'Light';
        if (layer instanceof AVLayer) {
            var src = layer.source;
            if (src instanceof CompItem) return 'Precomp';
            if (src instanceof FootageItem) {
                if (src.mainSource instanceof SolidSource) return 'Solid';
                if (src.hasVideo && src.hasAudio) return 'Footage';
                if (src.hasAudio && !src.hasVideo) return 'Audio';
                return 'Footage';
            }
        }
        return 'AV';
    }
    function keysOf(obj) {
        var a = [];
        for (var k in obj) if (obj.hasOwnProperty(k)) a.push(k);
        return a;
    }

    // ===================== shared property helpers =====================
    // Recursion cap for the matchName walk. Property trees never nest this deep
    // (shape/text ~<10); matches the bounded-loop discipline used elsewhere
    // (e.g. parentChain hop<32, captureGenericTree maxDepth 8).
    var MAX_PROP_WALK_DEPTH = 32;
    // Transform-group child matchNames — routed straight to 'ADBE Transform Group'
    // so a raw transform matchName never wastes a walk of the Effect Parade.
    var TRANSFORM_MATCHNAMES = {
        'ADBE Anchor Point': 1, 'ADBE Position': 1,
        'ADBE Position_0': 1, 'ADBE Position_1': 1, 'ADBE Position_2': 1,
        'ADBE Scale': 1, 'ADBE Rotate X': 1, 'ADBE Rotate Y': 1,
        'ADBE Rotate Z': 1, 'ADBE Orientation': 1, 'ADBE Opacity': 1
    };
    function isLayerObject(o) {
        return safe(function () {
            return (o instanceof AVLayer) || (o instanceof TextLayer) ||
                   (o instanceof ShapeLayer) || (o instanceof CameraLayer) ||
                   (o instanceof LightLayer);
        }) === true;
    }
    // Depth-capped recursive matchName search over a single property subtree.
    // Identical semantics to the original whole-subtree walk (first match in
    // property-index order, depth-first), plus a recursion cap.
    function walkForMatchName(parent, matchName, depth) {
        if (depth > MAX_PROP_WALK_DEPTH) return null;
        for (var i = 1; i <= parent.numProperties; i++) {
            var p = parent.property(i);
            if (p.matchName === matchName) return p;
            if (p.numProperties > 0) {
                var f = walkForMatchName(p, matchName, depth + 1);
                if (f) return f;
            }
        }
        return null;
    }
    // Pick a scoping subtree root for a matchName: effect params -> Effect Parade,
    // masks -> Mask Parade, text -> Text Properties, transform -> Transform Group.
    // `scopeHint` (optional) overrides the prefix heuristic. Returns the root
    // PropertyGroup, or null when no confident scope applies.
    function scopeRootFor(layer, matchName, scopeHint) {
        var rootName = null;
        if (scopeHint) {
            if      (scopeHint === 'effect' || scopeHint === 'effects' || scopeHint === 'ADBE Effect Parade')  rootName = 'ADBE Effect Parade';
            else if (scopeHint === 'mask'   || scopeHint === 'masks'   || scopeHint === 'ADBE Mask Parade')    rootName = 'ADBE Mask Parade';
            else if (scopeHint === 'text'   || scopeHint === 'ADBE Text Properties')                           rootName = 'ADBE Text Properties';
            else if (scopeHint === 'transform' || scopeHint === 'ADBE Transform Group')                        rootName = 'ADBE Transform Group';
        }
        if (!rootName && matchName) {
            if      (TRANSFORM_MATCHNAMES[matchName])       rootName = 'ADBE Transform Group';
            else if (matchName.indexOf('ADBE Mask') === 0)  rootName = 'ADBE Mask Parade';
            else if (matchName.indexOf('ADBE Text') === 0)  rootName = 'ADBE Text Properties';
            // Effect parameter matchNames share no common prefix; any other
            // ADBE-prefixed stream is almost always an effect param -> Effect Parade.
            else if (matchName.indexOf('ADBE ') === 0)      rootName = 'ADBE Effect Parade';
        }
        if (!rootName) return null;
        return safe(function () { return layer.property(rootName); });
    }
    // Resolve a property by matchName. Back-compat: the original 2-arg
    // (parent, matchName) signature still works. When `parent` is a Layer, a
    // scoped subtree (Effect/Mask/Text/Transform) is searched first as a pure
    // optimization; on a scoped miss it falls back to the original whole-layer
    // walk, so the returned property is exactly what the full walk would return.
    // `scopeHint` is an optional caller override. No references are cached across
    // structural changes (addProperty/moveTo/remove invalidate property refs).
    function findPropByMatchName(parent, matchName, scopeHint) {
        if (isLayerObject(parent)) {
            var root = scopeRootFor(parent, matchName, scopeHint);
            if (root) {
                var hit = walkForMatchName(root, matchName, 0);
                if (hit) return hit;
            }
            return walkForMatchName(parent, matchName, 0);
        }
        return walkForMatchName(parent, matchName, 0);
    }
    function transformProp(layer, matchName) {
        var t = layer.property('ADBE Transform Group');
        return t ? t.property(matchName) : null;
    }
    function compByNameOrId(target) {
        if (target == null) return null;
        if (typeof target === 'number' || /^\d+$/.test(String(target))) {
            var id = Number(target);
            for (var i = 1; i <= app.project.numItems; i++) {
                var it = app.project.item(i);
                if (it instanceof CompItem && it.id === id) return it;
            }
        }
        for (var j = 1; j <= app.project.numItems; j++) {
            var item = app.project.item(j);
            if (item instanceof CompItem && item.name === String(target)) return item;
        }
        return null;
    }
    function activeComp() {
        var a = app.project.activeItem;
        if (a instanceof CompItem) return a;
        return null;
    }
    function interpName(t) {
        if (typeof KeyframeInterpolationType !== 'undefined') {
            if (t === KeyframeInterpolationType.LINEAR) return 'LINEAR';
            if (t === KeyframeInterpolationType.BEZIER) return 'BEZIER';
            if (t === KeyframeInterpolationType.HOLD)   return 'HOLD';
        }
        return String(t);
    }
    function captureKeyframes(prop, fps) {
        var keys = [];
        for (var k = 1; k <= prop.numKeys; k++) {
            var ki = prop.keyInTemporalEase(k);
            var ko = prop.keyOutTemporalEase(k);
            var t  = prop.keyTime(k);
            keys.push({
                index: k,
                time: t,
                frame: Math.round(t * fps),
                value: prop.keyValue(k),
                inInterp:  interpName(prop.keyInInterpolationType(k)),
                outInterp: interpName(prop.keyOutInterpolationType(k)),
                easeIn:  ki ? easesToArr(ki) : null,
                easeOut: ko ? easesToArr(ko) : null,
                inSpatialTangent:  safe(function () { return prop.keyInSpatialTangent(k);  }),
                outSpatialTangent: safe(function () { return prop.keyOutSpatialTangent(k); }),
                roving:    safe(function () { return prop.keyRoving(k);    }),
                temporalAutoBezier: safe(function () { return prop.keyTemporalAutoBezier(k); })
            });
        }
        return keys;
    }
    function easesToArr(easeArr) {
        var out = [];
        for (var i = 0; i < easeArr.length; i++) {
            out.push({ speed: easeArr[i].speed, influence: easeArr[i].influence });
        }
        return out;
    }
    function captureProperty(prop, fps, opts) {
        opts = opts || {};
        var info = {
            name: prop.name,
            matchName: prop.matchName,
            propertyValueType: prop.propertyValueType,
            isModified: safe(function () { return prop.isModified; }),
            numKeys: prop.numKeys,
            value: safe(function () { return prop.value; })
        };
        if (prop.expressionEnabled || (prop.expression && prop.expression.length > 0)) {
            info.expression = prop.expression;
            info.expressionEnabled = prop.expressionEnabled;
        }
        if (opts.includeKeyframes && prop.numKeys > 0) {
            info.keyframes = captureKeyframes(prop, fps);
        }
        return info;
    }
    function captureEffectStack(layer, fps, opts) {
        var fxs = [];
        var par = layer.property('ADBE Effect Parade');
        if (!par || par.numProperties === 0) return fxs;
        for (var i = 1; i <= par.numProperties; i++) {
            var ef = par.property(i);
            var props = [];
            for (var p = 1; p <= ef.numProperties; p++) {
                var sub = ef.property(p);
                // Skip the dynamic/group/stream selectors with no value (e.g. pseudo-effect-headers).
                if (sub.propertyType === PropertyType.PROPERTY) {
                    props.push(captureProperty(sub, fps, opts));
                } else {
                    props.push({ name: sub.name, matchName: sub.matchName, group: true });
                }
            }
            fxs.push({
                index: i,
                name: ef.name,
                matchName: ef.matchName,
                enabled: ef.enabled,
                properties: props
            });
        }
        return fxs;
    }
    function parentChain(layer) {
        var chain = [];
        var p = layer.parent;
        var hop = 0;
        while (p && hop < 32) {
            chain.push({ index: p.index, name: p.name });
            p = p.parent;
            hop++;
        }
        return chain;
    }

    // ---- generic property-tree walker (used for masks, shape contents, layer styles, text animators) ----
    function captureGenericTree(parent, fps, opts, depth) {
        depth = depth || 0;
        var maxDepth = opts.maxTreeDepth || 8;
        if (depth > maxDepth) return [{ truncated: true, depth: depth }];
        var out = [];
        for (var i = 1; i <= parent.numProperties; i++) {
            var p; try { p = parent.property(i); } catch (e) { continue; }
            if (!p) continue;
            var node = { name: p.name, matchName: p.matchName };
            try { node.enabled = p.enabled; } catch (e) {}
            try { if (p.elided) node.elided = true; } catch (e) {}
            var isLeaf = false;
            try { isLeaf = (p.numProperties === 0) || (p.propertyType === PropertyType.PROPERTY); }
            catch (e) { isLeaf = true; }
            if (isLeaf) {
                try { node.value = p.value; } catch (e) {}
                node.numKeys = safe(function () { return p.numKeys; }) || 0;
                if (safe(function () { return p.expressionEnabled; }) ||
                    (safe(function () { return p.expression; }) || '').length > 0) {
                    node.expression = safe(function () { return p.expression; });
                    node.expressionEnabled = safe(function () { return p.expressionEnabled; });
                }
                if (opts.includeKeyframes && node.numKeys > 0) {
                    node.keyframes = captureKeyframes(p, fps);
                }
            } else if (p.numProperties > 0) {
                node.children = captureGenericTree(p, fps, opts, depth + 1);
            }
            out.push(node);
        }
        return out;
    }
    function captureMasks(layer, fps, opts) {
        try {
            var mp = layer.property('ADBE Mask Parade');
            if (!mp || mp.numProperties === 0) return null;
            return captureGenericTree(mp, fps, opts);
        } catch (e) { return null; }
    }
    function captureLayerStyles(layer, fps, opts) {
        try {
            var ls = layer.property('ADBE Layer Styles');
            if (!ls || ls.numProperties <= 1) return null;  // 1 = Blending Options pseudo
            // Skip first child (Blending Options) — only return real styles
            var styles = [];
            for (var i = 2; i <= ls.numProperties; i++) {
                var s = ls.property(i);
                styles.push({
                    name: s.name,
                    matchName: s.matchName,
                    enabled: safe(function () { return s.enabled; }),
                    children: s.numProperties > 0 ? captureGenericTree(s, fps, opts) : null
                });
            }
            return { enabled: ls.enabled, styles: styles };
        } catch (e) { return null; }
    }
    function captureShapeContents(layer, fps, opts) {
        if (!(layer instanceof ShapeLayer)) return null;
        try {
            var rv = layer.property('ADBE Root Vectors Group');
            if (!rv) return null;
            return captureGenericTree(rv, fps, opts);
        } catch (e) { return null; }
    }
    function captureTextAnimators(layer, fps, opts) {
        if (!(layer instanceof TextLayer)) return null;
        try {
            var tp = layer.property('ADBE Text Properties');
            if (!tp) return null;
            var animators = tp.property('ADBE Text Animators');
            if (!animators || animators.numProperties === 0) return null;
            return captureGenericTree(animators, fps, opts);
        } catch (e) { return null; }
    }
    function captureMarkers(target, fps) {
        // target may be a Layer or a CompItem
        var src;
        try {
            if (target instanceof CompItem) src = target.markerProperty;
            else src = target.property('ADBE Marker');
        } catch (e) { return null; }
        if (!src || src.numKeys === 0) return null;
        var out = [];
        for (var k = 1; k <= src.numKeys; k++) {
            var t = src.keyTime(k);
            var mv = src.keyValue(k);
            out.push({
                index: k,
                time: t,
                frame: Math.round(t * fps),
                comment: mv.comment,
                duration: mv.duration,
                chapter: mv.chapter,
                url: mv.url,
                frameTarget: mv.frameTarget,
                cuePointName: mv.cuePointName,
                eventCuePoint: mv.eventCuePoint,
                label: safe(function () { return mv.label; })
            });
        }
        return out;
    }

    // ---- light project map ----
    function projectMapLight() {
        if (!app.project) return { open: false };
        var p = app.project;
        var fonts = {};
        var comps = [];
        var totalLayers = 0;

        for (var i = 1; i <= p.numItems; i++) {
            var item = p.item(i);
            if (!(item instanceof CompItem)) continue;

            var c = {
                id: item.id,
                name: item.name,
                width: item.width,
                height: item.height,
                pixelAspect: item.pixelAspect,
                fps: item.frameRate,
                duration: item.duration,
                durationFrames: Math.round(item.duration * item.frameRate),
                layerCount: item.numLayers,
                bgColor: item.bgColor,
                hasAudio: false,
                layers: []
            };
            totalLayers += item.numLayers;

            for (var j = 1; j <= item.numLayers; j++) {
                var layer = item.layer(j);
                var li = {
                    id: layer.id,
                    index: j,
                    name: layer.name,
                    type: detectLayerType(layer),
                    enabled: layer.enabled,
                    threeD: safe(function () { return layer.threeDLayer; }),
                    parentIndex: layer.parent ? layer.parent.index : null,
                    trackMatte: trackMatteName(layer.trackMatteType),
                    inPoint: layer.inPoint,
                    outPoint: layer.outPoint,
                    startTime: layer.startTime,
                    locked: layer.locked,
                    shy: layer.shy,
                    hasVideo: safe(function () { return layer.hasVideo; }),
                    hasAudio: safe(function () { return layer.hasAudio; })
                };
                if (li.hasAudio) c.hasAudio = true;

                if (layer instanceof TextLayer) {
                    try {
                        var td = layer.property('ADBE Text Properties').property('ADBE Text Document').value;
                        li.text = String(td.text);
                        li.font = String(td.font);
                        li.fontSize = td.fontSize;
                        fonts[String(td.font)] = true;
                    } catch (e) { /* ignore */ }
                }
                if (layer instanceof AVLayer && layer.source) {
                    li.sourceName = layer.source.name;
                    if (layer.source instanceof CompItem) li.sourceCompId = layer.source.id;
                }
                c.layers.push(li);
            }
            comps.push(c);
        }

        return {
            open: true,
            mode: 'light',
            file: p.file ? p.file.fsName : null,
            displayName: p.file ? p.file.displayName : 'Untitled',
            saved: !p.dirty,
            numItems: p.numItems,
            compCount: comps.length,
            totalLayers: totalLayers,
            fonts: keysOf(fonts),
            comps: comps,
            activeComp: (app.project.activeItem instanceof CompItem) ? {
                id: app.project.activeItem.id,
                name: app.project.activeItem.name
            } : null
        };
    }

    // ---- handlers ----
    function handle_ping() {
        return {
            pong: true,
            aeVersion: app.version,
            buildName: app.buildName,
            buildNumber: app.buildNumber,
            uptimeMs: (new Date()).getTime() - startTime,
            portalVersion: version,
            projectFile: (app.project && app.project.file) ? app.project.file.fsName : null,
            projectDirty: app.project ? app.project.dirty : null
        };
    }
    function handle_run_jsx(params) {
        if (!params || typeof params.script !== 'string') throw new Error('script param required');
        var script = params.script;
        // Mark: while the chat's per-answer undo group is open, a script's own
        // begin/endUndoGroup would nest groups (which corrupts AE's undo stack),
        // so those calls become no-ops for that script.
        var __markNoUndo = function () {};
        if ($.global.__markUndoOpen) script = script.replace(/app\s*\.\s*(begin|end)UndoGroup\s*\(/g, '__markNoUndo(');
        // Eval in a function so var declarations don't leak.
        var result = (function () { return eval(script); })();
        return (typeof result === 'undefined') ? null : result;
    }
    // ---- deep capture per layer ----
    function captureTransform(layer, fps, opts) {
        var t = layer.property('ADBE Transform Group');
        if (!t) return null;
        var out = {};
        var spec = [
            ['anchorPoint', 'ADBE Anchor Point'],
            ['position',    'ADBE Position'],
            ['scale',       'ADBE Scale'],
            ['rotation',    'ADBE Rotate Z'],
            ['opacity',     'ADBE Opacity']
        ];
        for (var i = 0; i < spec.length; i++) {
            var p = t.property(spec[i][1]);
            if (p) out[spec[i][0]] = captureProperty(p, fps, opts);
        }
        if (safe(function () { return layer.threeDLayer; })) {
            var rx = t.property('ADBE Rotate X'),
                ry = t.property('ADBE Rotate Y'),
                or = t.property('ADBE Orientation');
            if (rx) out.rotationX  = captureProperty(rx, fps, opts);
            if (ry) out.rotationY  = captureProperty(ry, fps, opts);
            if (or) out.orientation = captureProperty(or, fps, opts);
        }
        return out;
    }
    function baseLayerInfo(layer, fontsRef) {
        var li = {
            id: layer.id,
            index: layer.index,
            name: layer.name,
            type: detectLayerType(layer),
            enabled: layer.enabled,
            threeD: safe(function () { return layer.threeDLayer; }),
            parentIndex: layer.parent ? layer.parent.index : null,
            inPoint: layer.inPoint,
            outPoint: layer.outPoint,
            startTime: layer.startTime,
            locked: layer.locked,
            shy: layer.shy,
            solo: safe(function () { return layer.solo; }),
            hasVideo: safe(function () { return layer.hasVideo; }),
            hasAudio: safe(function () { return layer.hasAudio; })
        };
        if (layer instanceof TextLayer) {
            try {
                var td = layer.property('ADBE Text Properties').property('ADBE Text Document').value;
                li.text = String(td.text);
                li.font = String(td.font);
                li.fontSize = td.fontSize;
                li.fillColor = safe(function () { return td.fillColor; });
                li.justification = safe(function () { return String(td.justification); });
                if (fontsRef) fontsRef[String(td.font)] = true;
            } catch (e) {}
        }
        if (layer instanceof AVLayer && layer.source) {
            li.sourceName = layer.source.name;
            if (layer.source instanceof CompItem) li.sourceCompId = layer.source.id;
        }
        return li;
    }
    function captureCompDeep(comp, opts, fontsRef) {
        var fps = comp.frameRate;
        var maxLayers = opts.maxLayers || 500;
        var layers = [];
        var truncated = comp.numLayers > maxLayers;
        var end = Math.min(comp.numLayers, maxLayers);
        for (var j = 1; j <= end; j++) {
            var layer = comp.layer(j);
            var li = baseLayerInfo(layer, fontsRef);
            if (opts.includeKeyframes)      li.transform     = captureTransform(layer, fps, opts);
            if (opts.includeEffects)        li.effects       = captureEffectStack(layer, fps, opts);
            if (opts.includeMasks)          li.masks         = captureMasks(layer, fps, opts);
            if (opts.includeLayerStyles)    li.layerStyles   = captureLayerStyles(layer, fps, opts);
            if (opts.includeShapeContents)  li.shapeContents = captureShapeContents(layer, fps, opts);
            if (opts.includeTextAnimators)  li.textAnimators = captureTextAnimators(layer, fps, opts);
            if (opts.includeMarkers !== false) li.markers     = captureMarkers(layer, fps);
            if (layer.parent)               li.parentChain   = parentChain(layer);
            var tm = trackMatteName(layer.trackMatteType);
            if (tm !== 'NONE') li.trackMatte = { type: tm, byIndex: j - 1 };
            layers.push(li);
        }
        return {
            id: comp.id,
            name: comp.name,
            width: comp.width,
            height: comp.height,
            fps: fps,
            duration: comp.duration,
            durationFrames: Math.round(comp.duration * fps),
            layerCount: comp.numLayers,
            truncated: truncated,
            markers: captureMarkers(comp, fps),
            layers: layers
        };
    }
    function projectMapDeep(opts) {
        opts = opts || {};
        if (opts.includeKeyframes === undefined) opts.includeKeyframes = true;
        if (opts.includeEffects   === undefined) opts.includeEffects   = true;
        if (opts.maxLayers        === undefined) opts.maxLayers        = 500;

        if (!app.project) return { open: false };
        var p = app.project;
        var fonts = {};
        var comps = [];
        for (var i = 1; i <= p.numItems; i++) {
            var item = p.item(i);
            if (item instanceof CompItem) comps.push(captureCompDeep(item, opts, fonts));
        }
        return {
            open: true,
            mode: 'deep',
            file: p.file ? p.file.fsName : null,
            displayName: p.file ? p.file.displayName : 'Untitled',
            saved: !p.dirty,
            compCount: comps.length,
            fonts: keysOf(fonts),
            comps: comps
        };
    }
    function projectMapForComp(target, opts) {
        var c = compByNameOrId(target);
        if (!c) c = activeComp();
        if (!c) throw new Error('comp not found: ' + target);
        opts = opts || { includeKeyframes: true, includeEffects: true, maxLayers: 1000 };
        var fonts = {};
        return {
            mode: 'comp',
            comp: captureCompDeep(c, opts, fonts),
            fonts: keysOf(fonts)
        };
    }

    function buildOpts(params, defaultMaxLayers) {
        // For deep map: defaults to including most things. User can opt out per flag.
        return {
            includeKeyframes:     params.includeKeyframes     !== false,
            includeEffects:       params.includeEffects       !== false,
            includeMasks:         params.includeMasks         !== false,
            includeLayerStyles:   params.includeLayerStyles   !== false,
            includeShapeContents: params.includeShapeContents !== false,
            includeTextAnimators: params.includeTextAnimators !== false,
            includeMarkers:       params.includeMarkers       !== false,
            maxLayers:            params.maxLayers || defaultMaxLayers,
            maxTreeDepth:         params.maxTreeDepth || 8
        };
    }
    function handle_get_project_map(params) {
        params = params || {};
        var mode = params.mode || 'light';
        if (mode === 'light') return projectMapLight();
        if (mode === 'deep')  return projectMapDeep(buildOpts(params, 500));
        if (mode === 'comp')  return projectMapForComp(params.comp, buildOpts(params, 1000));
        throw new Error('unknown mode: ' + mode);
    }

    var handlers = {
        ping:            handle_ping,
        run_jsx:         handle_run_jsx,
        get_project_map: handle_get_project_map
    };

    // ===================== mutation handlers (mutate `handlers` map) =====================
    // Unique file name: AE resolves #include through one $.includePath shared by every
    // panel, so a plain "actions.jsx" could load another panel's copy (the AE Portal original).
    #include "mark-actions.jsx"

    // Some MCP clients serialize arrays/objects to JSON strings when a tool
    // input schema is permissive (`{}`). Recursively rehydrate any string that
    // looks like a JSON literal — guards every handler from that upstream quirk.
    function rehydrate(v) {
        if (typeof v === 'string' && v.length > 1) {
            var c0 = v.charAt(0);
            if (c0 === '[' || c0 === '{') {
                var last = v.charAt(v.length - 1);
                if ((c0 === '[' && last === ']') || (c0 === '{' && last === '}')) {
                    try { return rehydrate(JSON.parse(v)); } catch (_) {}
                }
            }
            return v;
        }
        if (v instanceof Array) {
            for (var i = 0; i < v.length; i++) v[i] = rehydrate(v[i]);
            return v;
        }
        if (v && typeof v === 'object') {
            for (var k in v) if (v.hasOwnProperty(k)) v[k] = rehydrate(v[k]);
            return v;
        }
        return v;
    }

    // ---- huge-payload temp-file handoff ----
    // A very large string returned from evalScript fails opaquely at the CEP
    // boundary ("EvalScript error."). Above TEMP_HANDOFF_BYTES we write the full
    // serialized envelope to a temp file and return a tiny pointer envelope
    // ({__aeFile, __aeBytes}) instead; the panel reads + parses + deletes it.
    var TEMP_HANDOFF_BYTES = 262144; // 256KB
    var tempPayloadCounter = 0;
    function writeTempPayload(payloadStr) {
        // Best-effort. Returns a small pointer-envelope string, or null on any
        // failure (caller then returns the big string inline as a fallback).
        try {
            tempPayloadCounter = (tempPayloadCounter + 1) % 1000000;
            var suffix = String((new Date()).getTime()) + '-' +
                         String(Math.floor(Math.random() * 1e9)) + '-' +
                         String(tempPayloadCounter);
            // macOS Folder.temp is the per-user private $TMPDIR (mode 700), so a
            // random filename there is not world-readable. ExtendScript can't
            // chmod, so file privacy relies on that directory's own permissions.
            var f = new File(Folder.temp.fsName + '/ae-portal-payload-' + suffix + '.json');
            f.open('w');
            f.encoding = 'UTF-8';
            var wrote = f.write(payloadStr);
            f.close();
            if (!wrote) return null;
            // This pointer envelope is tiny and is built directly (never routed
            // back through finalizeEnvelope) — guards against recursion.
            return JSON.stringify({ __ae: true, ok: true, __aeFile: f.fsName, __aeBytes: payloadStr.length });
        } catch (e) {
            return null;
        }
    }
    function finalizeEnvelope(payloadStr) {
        if (payloadStr && payloadStr.length > TEMP_HANDOFF_BYTES) {
            var ptr = writeTempPayload(payloadStr);
            if (ptr) return ptr;
            // write failed — fall through and return the inline big string
            // (better a large evalScript than a lost result).
        }
        return payloadStr;
    }

    function dispatch(method, paramsJson) {
        var params = {};
        if (paramsJson) {
            try { params = JSON.parse(paramsJson); }
            catch (e) { return err('invalid params JSON: ' + e.message); }
        }
        params = rehydrate(params);
        var fn = handlers[method];
        if (!fn) return err('unknown method: ' + method);
        try {
            return finalizeEnvelope(ok(fn(params)));
        } catch (e) {
            return err(e.toString() + (e.line ? ' (line ' + e.line + ')' : ''));
        }
    }

    return {
        dispatch: dispatch,
        version: version,
        startTime: startTime,
        _handlers: handlers   // exposed for future modules to register more
    };
})();

// Sentinel string the panel JS uses to confirm the host loaded.
"MarkHost v" + MarkHost.version + " loaded";
