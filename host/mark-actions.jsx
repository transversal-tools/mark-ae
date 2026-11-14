// AE Portal — actions module. Included inside the MarkHost IIFE in index.jsx (as mark-actions.jsx),
// so all helpers (compByNameOrId, activeComp, findPropByMatchName, captureProperty, etc.)
// are in lexical scope. Mutates the local `handlers` map.

// ===================== shared resolution =====================
function resolveComp(target) {
    if (target == null || target === '') {
        var ac = activeComp();
        if (!ac) throw new Error('no active comp; pass comp param');
        return ac;
    }
    // Stable-id object form { id: N } — match CompItem.id (immutable since AE 22).
    // A DISTINCT form from name (string) / numeric (id-or-name via compByNameOrId):
    // this is STRICT id with no name fallback, so duplicate comp names can't
    // mis-target. Bounded scan of project items.
    if (typeof target === 'object' && target.id != null) {
        var wantCompId = Number(target.id);
        var itemCap = app.project.numItems;
        if (itemCap > 20000) itemCap = 20000;
        for (var ci = 1; ci <= itemCap; ci++) {
            var cit = app.project.item(ci);
            if (cit instanceof CompItem && cit.id === wantCompId) return cit;
        }
        throw new Error('comp not found by id: ' + wantCompId);
    }
    var c = compByNameOrId(target);
    if (!c) throw new Error('comp not found: ' + target);
    return c;
}
function resolveLayer(comp, target) {
    if (target == null) throw new Error('layer required');
    // Stable-id object form { id: N } — match Layer.id (immutable since AE 22).
    // Checked BEFORE the numeric branch so a NUMBER stays a 1-based INDEX exactly as
    // before; only the { id: N } object addresses by stable id. Bounded scan.
    if (typeof target === 'object' && target.id != null) {
        var wantLayerId = Number(target.id);
        var layerCap = comp.numLayers;
        if (layerCap > 20000) layerCap = 20000;
        for (var li = 1; li <= layerCap; li++) {
            var lyr = comp.layer(li);
            if (lyr && lyr.id === wantLayerId) return lyr;
        }
        throw new Error('layer not found by id in "' + comp.name + '": ' + wantLayerId);
    }
    if (typeof target === 'number') {
        if (target < 1 || target > comp.numLayers) throw new Error('layer index out of range: ' + target);
        return comp.layer(target);
    }
    var layer = comp.layer(String(target));
    if (!layer) throw new Error('layer not found in "' + comp.name + '": ' + target);
    return layer;
}
function resolveLayers(comp, targets) {
    if (!targets) {
        // selected layers in this comp
        var sel = comp.selectedLayers;
        if (!sel || !sel.length) throw new Error('no layers passed and none selected');
        return sel;
    }
    if (!(targets instanceof Array)) targets = [targets];
    var out = [];
    for (var i = 0; i < targets.length; i++) out.push(resolveLayer(comp, targets[i]));
    return out;
}
// 2.2: batch owns a single undo group and raises _undoDepth so every inner withUndo
// runs its body in that ONE group. Nested begin/endUndoGroup corrupts AE's undo
// stack, so when we're already inside a batch (depth > 0) withUndo must NOT open a
// group of its own — it just runs fn() in the group the batch already opened.
var _undoDepth = 0;
function withUndo(label, fn) {
    if (_undoDepth > 0) {
        return fn();
    }
    app.beginUndoGroup(label || 'AE Portal');
    try {
        var r = fn();
        return r;
    } finally {
        try { app.endUndoGroup(); } catch (_) {}
    }
}

// app.effects is effectively static for a session; cache displayName→matchName
// (plus a lowercased view) once instead of scanning hundreds of effects — twice —
// on every apply_effect call. Each app.effects[i].displayName is a slow API hit.
var _effectMap = null, _effectMapLower = null;
function effectMatchName(displayName) {
    if (_effectMap === null) {
        _effectMap = {}; _effectMapLower = {};
        for (var i = 0; i < app.effects.length; i++) {
            var e = app.effects[i];
            _effectMap[e.displayName] = e.matchName;
            _effectMapLower[String(e.displayName).toLowerCase()] = e.matchName;
        }
    }
    if (_effectMap[displayName]) return _effectMap[displayName];
    return _effectMapLower[String(displayName).toLowerCase()] || null;
}

// list_effects re-walks app.effects (every displayName is a slow API hit) on every
// call; cache the full {name, matchName, category} list once for the session — same
// pattern as _effectMap above. list_effects's `refresh:true` busts it.
var _effectList = null;
function effectListCached() {
    if (_effectList === null) {
        _effectList = [];
        for (var i = 0; i < app.effects.length; i++) {
            var e = app.effects[i];
            _effectList.push({ name: e.displayName, matchName: e.matchName, category: e.category });
        }
    }
    return _effectList;
}

// ===================== easing =====================
// Default easing (never plain F9 33% unless asked):
//   in   — first key LINEAR-out, last key BEZIER-in   influence ~75 (70–80)
//   out  — first key BEZIER-out influence ~75, last key LINEAR-in
//   inout — both ends BEZIER with influence ~75   (a "to and from" snap)
//   middle keys (in inout, when more than 2 keys): BEZIER both sides influence ~75

var DEFAULT_INFLUENCE = 75;
var TAIL_INFLUENCE    = 16.67; // AE's default value for the non-eased side

function resolvePropByPath(layer, propPath) {
    // propPath may be:
    //   - matchName             e.g. 'ADBE Position'
    //   - dotted display path   e.g. 'Position'  or  'Effects.Gaussian Blur.Blurriness'
    //   - just a transform name 'Position' | 'Scale' | 'Rotation' | 'Opacity' | 'Anchor Point'
    var aliases = {
        'Position':     'ADBE Position',
        'Scale':        'ADBE Scale',
        'Rotation':     'ADBE Rotate Z',
        'Z Rotation':   'ADBE Rotate Z',
        'Opacity':      'ADBE Opacity',
        'Anchor Point': 'ADBE Anchor Point',
        'Anchor':       'ADBE Anchor Point',
        'X Rotation':   'ADBE Rotate X',
        'Y Rotation':   'ADBE Rotate Y',
        'Orientation':  'ADBE Orientation'
    };
    if (aliases[propPath]) {
        var t = layer.property('ADBE Transform Group');
        var p = t.property(aliases[propPath]);
        if (!p) throw new Error('transform property not found: ' + propPath);
        return p;
    }
    if (/^ADBE /.test(propPath)) {
        // matchName lookup recursive
        var found = findPropByMatchName(layer, propPath);
        if (!found) throw new Error('matchName not found on layer: ' + propPath);
        return found;
    }
    // dotted display path
    var parts = propPath.split('.');
    var cur = layer;
    for (var i = 0; i < parts.length; i++) {
        var next = cur.property(parts[i]);
        if (!next) throw new Error('property segment not found: ' + parts[i] + ' (in path "' + propPath + '")');
        cur = next;
    }
    return cur;
}
function easesArrFor(prop, speed, influence) {
    // temporal ease arrays match the property's value dimension count.
    var sample = prop.numKeys > 0 ? prop.keyInTemporalEase(1) : [new KeyframeEase(0, 16.67)];
    var dim = sample.length;
    var arr = [];
    for (var i = 0; i < dim; i++) arr.push(new KeyframeEase(speed, influence));
    return arr;
}
// Safe temporal-ease setter for run_jsx / custom rigs. Sizes the ease arrays to the
// property's REAL dimension count via keyInTemporalEase (spatial props like Position
// = 1 element regardless of 2D/3D; Scale = 3 even on a 2D shape layer; Color = 4).
// Using prop.value.length here is WRONG for spatial props and throws
// "Value array does not have N elements". Sets BEZIER interpolation, then the eases.
function setTemporalEaseSafe(prop, keyIndex, inSpeed, inInfluence, outSpeed, outInfluence) {
    var B = KeyframeInterpolationType.BEZIER;
    prop.setInterpolationTypeAtKey(keyIndex, B, B);
    prop.setTemporalEaseAtKey(keyIndex,
        easesArrFor(prop, inSpeed, inInfluence),
        easesArrFor(prop, outSpeed, outInfluence));
}
function applyEasingMode(prop, mode, influence, range) {
    if (prop.numKeys < 2) throw new Error('"' + prop.name + '" needs at least 2 keyframes (has ' + prop.numKeys + ')');
    var IT = KeyframeInterpolationType;
    var infl = influence;
    var tail = TAIL_INFLUENCE;

    var start, end;
    if (range === 'selected') {
        var sel = prop.selectedKeys;
        if (!sel || sel.length < 2) throw new Error('range="selected" but fewer than 2 keys are selected');
        start = sel[0]; end = sel[sel.length - 1];
    } else if (range && typeof range === 'object' && range.start && range.end) {
        start = range.start; end = range.end;
    } else {
        start = 1; end = prop.numKeys;
    }

    if (mode === 'in') {
        prop.setInterpolationTypeAtKey(start, IT.LINEAR, IT.LINEAR);
        prop.setInterpolationTypeAtKey(end,   IT.BEZIER, IT.LINEAR);
        prop.setTemporalEaseAtKey(end, easesArrFor(prop, 0, infl), easesArrFor(prop, 0, tail));
    } else if (mode === 'out') {
        prop.setInterpolationTypeAtKey(start, IT.LINEAR, IT.BEZIER);
        prop.setTemporalEaseAtKey(start, easesArrFor(prop, 0, tail), easesArrFor(prop, 0, infl));
        prop.setInterpolationTypeAtKey(end, IT.LINEAR, IT.LINEAR);
    } else if (mode === 'inout') {
        prop.setInterpolationTypeAtKey(start, IT.LINEAR, IT.BEZIER);
        prop.setTemporalEaseAtKey(start, easesArrFor(prop, 0, tail), easesArrFor(prop, 0, infl));
        for (var k = start + 1; k < end; k++) {
            prop.setInterpolationTypeAtKey(k, IT.BEZIER, IT.BEZIER);
            prop.setTemporalEaseAtKey(k, easesArrFor(prop, 0, infl), easesArrFor(prop, 0, infl));
        }
        prop.setInterpolationTypeAtKey(end, IT.BEZIER, IT.LINEAR);
        prop.setTemporalEaseAtKey(end, easesArrFor(prop, 0, infl), easesArrFor(prop, 0, tail));
    } else {
        throw new Error('unknown ease mode: ' + mode + ' (expected in/out/inout)');
    }
    return { keysAffected: end - start + 1, mode: mode, influence: infl };
}

handlers.set_easing = function (params) {
    var comp = resolveComp(params.comp);
    var layer = resolveLayer(comp, params.layer);
    var propPath = params.prop || 'Position';
    var mode = params.mode || 'in';
    var influence = params.influence != null ? Number(params.influence) : DEFAULT_INFLUENCE;
    if (influence < 0 || influence > 100) throw new Error('influence must be 0–100');
    var range = params.range || 'all';
    return withUndo('AE Portal: set_easing', function () {
        var prop = resolvePropByPath(layer, propPath);
        return applyEasingMode(prop, mode, influence, range);
    });
};
handlers.get_easing = function (params) {
    var comp = resolveComp(params.comp);
    var layer = resolveLayer(comp, params.layer);
    var prop = resolvePropByPath(layer, params.prop || 'Position');
    var fps = comp.frameRate;
    return {
        prop: prop.name,
        matchName: prop.matchName,
        numKeys: prop.numKeys,
        keyframes: captureKeyframes(prop, fps)
    };
};

// ===================== effects =====================
handlers.list_effects = function (params) {
    var filter = (params && params.filter) || '';
    // 2.9: serve from the session cache instead of rescanning app.effects each call.
    // refresh:true rebuilds it (also drops the apply_effect matchName caches, since
    // both derive from app.effects and a genuine refresh means the set changed).
    if (params && params.refresh === true) { _effectList = null; _effectMap = null; _effectMapLower = null; }
    var list = effectListCached();
    var out = [];
    for (var i = 0; i < list.length; i++) {
        var e = list[i];
        if (!filter || (e.name + ' ' + e.matchName + ' ' + e.category).toLowerCase().indexOf(filter.toLowerCase()) !== -1) {
            out.push({ name: e.name, matchName: e.matchName, category: e.category });
        }
    }
    return { count: out.length, effects: out };
};
handlers.apply_effect = function (params) {
    var comp = resolveComp(params.comp);
    var layers = resolveLayers(comp, params.layers || params.layer);
    var effect = params.effect;
    if (!effect) throw new Error('effect param required (display name or matchName)');
    var match = effect;
    if (!/^ADBE /.test(effect) && !/Pseudo\//.test(effect)) {
        var resolved = effectMatchName(effect);   // cached display name → matchName
        if (resolved) match = resolved;
    }
    // 0.5: Numbers effect always pops a blocking font dialog when added by script,
    // freezing AE's main thread (and the bridge). Refuse unless a human is present.
    if (match === 'ADBE Numbers2' && params.force !== true) {
        throw new Error('The Numbers effect always opens a blocking font dialog when added by script. Pass force:true if a human is present to dismiss it; otherwise add Numbers effects last via the AE UI.');
    }
    var props = params.properties || {};
    return withUndo('AE Portal: apply_effect', function () {
        var applied = [];
        for (var k = 0; k < layers.length; k++) {
            var layer = layers[k];
            var par = layer.property('ADBE Effect Parade');
            var fx = par.addProperty(match);
            // apply property values
            for (var key in props) {
                if (!props.hasOwnProperty(key)) continue;
                var pp = fx.property(key);
                if (pp) {
                    if (pp.numKeys > 0) pp.setValueAtTime(comp.time, props[key]);
                    else                 pp.setValue(props[key]);
                }
            }
            applied.push({ layer: layer.name, effect: fx.name, matchName: fx.matchName });
        }
        return { applied: applied };
    });
};

// ===================== layer ops =====================
handlers.add_solid = function (params) {
    var comp = resolveComp(params.comp);
    return withUndo('AE Portal: add_solid', function () {
        var color = params.color || [1, 1, 1];
        var w = params.width  || comp.width;
        var h = params.height || comp.height;
        var dur = params.duration != null ? params.duration : comp.duration;
        var name = params.name || 'Solid';
        var solid = comp.layers.addSolid(color, name, w, h, comp.pixelAspect, dur);
        return { name: solid.name, index: solid.index };
    });
};
handlers.add_null = function (params) {
    var comp = resolveComp(params.comp);
    return withUndo('AE Portal: add_null', function () {
        var dur = params.duration != null ? params.duration : comp.duration;
        var nl = comp.layers.addNull(dur);
        if (params.name) nl.name = params.name;
        return { name: nl.name, index: nl.index };
    });
};
handlers.add_text = function (params) {
    var comp = resolveComp(params.comp);
    return withUndo('AE Portal: add_text', function () {
        var t = comp.layers.addText(params.text != null ? String(params.text) : '');
        if (params.name) t.name = params.name;
        if (params.font || params.fontSize || params.fillColor || params.justification) {
            try {
                var docProp = t.property('ADBE Text Properties').property('ADBE Text Document');
                var doc = docProp.value;
                if (params.font)         doc.font     = params.font;
                if (params.fontSize)     doc.fontSize = params.fontSize;
                if (params.fillColor)    doc.fillColor = params.fillColor;
                if (params.justification) doc.justification = ParagraphJustification[params.justification];
                docProp.setValue(doc);
            } catch (e) {}
        }
        if (params.position) {
            var pos = t.property('ADBE Transform Group').property('ADBE Position');
            pos.setValue(params.position);
        }
        return { name: t.name, index: t.index };
    });
};
handlers.add_shape = function (params) {
    var comp = resolveComp(params.comp);
    return withUndo('AE Portal: add_shape', function () {
        var s = comp.layers.addShape();
        if (params.name) s.name = params.name;
        return { name: s.name, index: s.index };
    });
};
handlers.add_adjustment = function (params) {
    var comp = resolveComp(params.comp);
    return withUndo('AE Portal: add_adjustment', function () {
        var solid = comp.layers.addSolid([1,1,1], params.name || 'Adjustment', comp.width, comp.height, comp.pixelAspect, comp.duration);
        solid.adjustmentLayer = true;
        return { name: solid.name, index: solid.index };
    });
};

handlers.delete_layer = function (params) {
    var comp = resolveComp(params.comp);
    var layers = resolveLayers(comp, params.layers || params.layer);
    return withUndo('AE Portal: delete_layer', function () {
        var deleted = [];
        for (var i = 0; i < layers.length; i++) {
            deleted.push(layers[i].name);
            layers[i].remove();
        }
        return { deleted: deleted };
    });
};
handlers.duplicate_layer = function (params) {
    var comp = resolveComp(params.comp);
    var layers = resolveLayers(comp, params.layers || params.layer);
    return withUndo('AE Portal: duplicate_layer', function () {
        var dups = [];
        for (var i = 0; i < layers.length; i++) {
            var d = layers[i].duplicate();
            dups.push({ name: d.name, index: d.index });
        }
        return { duplicated: dups };
    });
};

handlers.set_property = function (params) {
    var comp = resolveComp(params.comp);
    var layer = resolveLayer(comp, params.layer);
    var propPath = params.prop;
    if (!propPath) throw new Error('prop param required');
    return withUndo('AE Portal: set_property', function () {
        var prop = resolvePropByPath(layer, propPath);
        var val = params.value;
        if (prop.numKeys > 0) {
            var time = params.time != null ? Number(params.time) : comp.time;
            prop.setValueAtTime(time, val);
            return { mode: 'keyframe', time: time, value: val };
        }
        prop.setValue(val);
        return { mode: 'value', value: val };
    });
};
handlers.add_keyframe = function (params) {
    var comp = resolveComp(params.comp);
    var layer = resolveLayer(comp, params.layer);
    var prop = resolvePropByPath(layer, params.prop);
    var time = params.time != null ? Number(params.time) : comp.time;
    return withUndo('AE Portal: add_keyframe', function () {
        if (params.value !== undefined) prop.setValueAtTime(time, params.value);
        else                             prop.setValueAtTime(time, prop.valueAtTime(time, false));
        return { time: time, numKeys: prop.numKeys };
    });
};

handlers.parent_layers = function (params) {
    var comp = resolveComp(params.comp);
    var children = resolveLayers(comp, params.children || params.child);
    var parent = params.parent != null ? resolveLayer(comp, params.parent) : null;
    return withUndo('AE Portal: parent_layers', function () {
        var done = [];
        var parents = [];
        for (var i = 0; i < children.length; i++) {
            children[i].parent = parent;
            done.push(children[i].name + ' → ' + (parent ? parent.name : 'none'));
            // 0.7: `parents` re-reads the actual resulting parent (name + index) so a
            // silently-unchanged parent is visible. `parented` strings kept as-is.
            var pl = children[i].parent;
            parents.push({ child: children[i].name, childIndex: children[i].index,
                           parent: pl ? pl.name : null, parentIndex: pl ? pl.index : null });
        }
        return { parented: done, parents: parents };
    });
};
handlers.set_track_matte = function (params) {
    var comp = resolveComp(params.comp);
    var layer = resolveLayer(comp, params.layer);
    var typeStr = String(params.type || 'ALPHA').toUpperCase();
    var typeMap = {
        'NONE':            TrackMatteType.NO_TRACK_MATTE,
        'ALPHA':           TrackMatteType.ALPHA,
        'ALPHA_INVERTED':  TrackMatteType.ALPHA_INVERTED,
        'LUMA':            TrackMatteType.LUMA,
        'LUMA_INVERTED':   TrackMatteType.LUMA_INVERTED
    };
    if (typeMap[typeStr] === undefined) throw new Error('unknown track matte type: ' + typeStr);
    return withUndo('AE Portal: set_track_matte', function () {
        layer.trackMatteType = typeMap[typeStr];
        // 0.7: read the resulting trackMatteType back as an int so a rejected set
        // (e.g. no layer above to matte against) is visible, not a bare ack.
        var tmt = Number(layer.trackMatteType);
        return { layer: layer.name, type: typeStr, trackMatteType: (isNaN(tmt) ? null : tmt) };
    });
};

// ===================== selection / nav =====================
handlers.get_selection = function () {
    var ac = activeComp();
    if (!ac) return { activeComp: null, layers: [], projectSelection: null };
    var layers = [];
    for (var i = 0; i < ac.selectedLayers.length; i++) {
        var l = ac.selectedLayers[i];
        layers.push({ id: l.id, index: l.index, name: l.name, type: detectLayerType(l) });
    }
    var projSel = [];
    for (var j = 0; j < app.project.selection.length; j++) {
        var item = app.project.selection[j];
        projSel.push({ id: item.id, name: item.name, typeName: item.typeName });
    }
    return {
        activeComp: { id: ac.id, name: ac.name, time: ac.time },
        layers: layers,
        projectSelection: projSel
    };
};
handlers.set_active_comp = function (params) {
    // resolveComp, NOT compByNameOrId: the latter only accepts a name string or a
    // numeric id, so the documented duplicate-name-safe { id: N } form arrived here
    // as an object and blew up in the concat below. This was the one comp-addressed
    // handler the stable-id sweep missed. resolveComp throws its own messages.
    var c = resolveComp(params.comp);
    c.openInViewer();
    markViewed(c);
    return { name: c.name, id: c.id };
};
handlers.set_time = function (params) {
    var comp = resolveComp(params.comp);
    var t = params.time != null ? Number(params.time) :
            params.frame != null ? Number(params.frame) / comp.frameRate :
            null;
    if (t == null) throw new Error('time or frame required');
    comp.time = t;
    return { time: t, frame: Math.round(t * comp.frameRate) };
};

// ===================== rename / organize =====================
function suggestNameForLayer(layer) {
    if (layer instanceof TextLayer) {
        try {
            var td = layer.property('ADBE Text Properties').property('ADBE Text Document').value;
            var t = String(td.text).replace(/\s+/g, ' ').replace(/[\r\n]/g, ' ').replace(/[^\w\s.\-]/g, '').replace(/^\s+|\s+$/g, '');
            if (t.length > 32) t = t.slice(0, 32);
            if (t) return t;
        } catch (e) {}
    }
    if (layer instanceof ShapeLayer) {
        // crude: if it's a thin line or a box, label accordingly
        try {
            var rect = layer.sourceRectAtTime(layer.containingComp.time, false);
            if (rect.width > 0 && rect.height > 0) {
                var ratio = rect.width / rect.height;
                if (ratio > 8 || ratio < 0.125) return 'line';
                return 'box';
            }
        } catch (e) {}
        return 'shape';
    }
    if (layer instanceof AVLayer && layer.source) return layer.source.name;
    return null;
}
function isSelfReferentialName(layerName, suggested) {
    if (!suggested) return false;
    var ln = layerName.toLowerCase();
    var s = suggested.toLowerCase();
    if (ln === s) return true;
    if (ln.indexOf(' (') > -1 && ln.split(' (')[0] === s) return true;
    return false;
}
handlers.suggest_renames = function (params) {
    var comp = resolveComp(params.comp);
    var suggestions = [];
    for (var i = 1; i <= comp.numLayers; i++) {
        var l = comp.layer(i);
        var sug = suggestNameForLayer(l);
        if (sug && sug !== l.name && !isSelfReferentialName(l.name, sug)) {
            suggestions.push({ index: i, current: l.name, suggested: sug, type: detectLayerType(l) });
        }
    }
    return { comp: comp.name, suggestions: suggestions };
};
handlers.rename_layers = function (params) {
    var comp = resolveComp(params.comp);
    var renames = params.renames || [];
    if (!renames.length) throw new Error('renames array required: [{index, name}, ...]');
    return withUndo('AE Portal: rename_layers', function () {
        var done = [];
        for (var i = 0; i < renames.length; i++) {
            var r = renames[i];
            var l = resolveLayer(comp, r.index != null ? r.index : r.layer);
            var old = l.name;
            l.name = String(r.name);
            done.push({ index: l.index, from: old, to: l.name });
        }
        return { renamed: done };
    });
};

// ===================== imports / project =====================
handlers.import_files = function (params) {
    var paths = params.paths;
    if (!paths || !paths.length) throw new Error('paths array required');
    return withUndo('AE Portal: import_files', function () {
        var folder = null;
        if (params.intoFolder) {
            folder = app.project.items.addFolder(params.intoFolder);
        }
        var imported = [];
        for (var i = 0; i < paths.length; i++) {
            var f = new File(paths[i]);
            if (!f.exists) { imported.push({ path: paths[i], error: 'not found' }); continue; }
            var io = new ImportOptions(f);
            if (params.sequence) io.sequence = true;
            try {
                var item = app.project.importFile(io);
                if (folder) item.parentFolder = folder;
                imported.push({ path: paths[i], id: item.id, name: item.name });
            } catch (e) {
                imported.push({ path: paths[i], error: e.message });
            }
        }
        return { imported: imported, folderId: folder ? folder.id : null };
    });
};
handlers.replace_footage = function (params) {
    if (!params.itemId && !params.itemName) throw new Error('itemId or itemName required');
    if (!params.path) throw new Error('path required');
    var newFile = new File(params.path);
    if (!newFile.exists) throw new Error('replacement not found: ' + params.path);
    return withUndo('AE Portal: replace_footage', function () {
        var item = null;
        if (params.itemId != null) {
            for (var i = 1; i <= app.project.numItems; i++) {
                if (app.project.item(i).id === params.itemId) { item = app.project.item(i); break; }
            }
        } else {
            for (var j = 1; j <= app.project.numItems; j++) {
                if (app.project.item(j).name === params.itemName) { item = app.project.item(j); break; }
            }
        }
        if (!item) throw new Error('item not found');
        if (!(item instanceof FootageItem)) throw new Error('item is not footage: ' + item.name);
        item.replace(newFile);
        return { id: item.id, name: item.name, replacedWith: newFile.fsName };
    });
};
handlers.save_project = function (params) {
    if (!app.project.file && !params.path) throw new Error('project never saved; provide path');
    if (params.path) app.project.save(new File(params.path));
    else app.project.save();
    return { file: app.project.file ? app.project.file.fsName : null };
};
handlers.version_up = function () {
    if (!app.project.file) throw new Error('project never saved; cannot version up');
    var f = app.project.file;
    var basePath = f.fsName;
    // patterns: name_v01.aep / name_v1.aep / name v01.aep / name v1.aep / name.aep (becomes _v01)
    var ver = /([_ ])v(\d+)(\.[^.]+)$/i;
    var newPath;
    if (ver.test(basePath)) {
        newPath = basePath.replace(ver, function (m, sep, num, ext) {
            var width = num.length;
            var n = parseInt(num, 10) + 1;
            var s = String(n);
            while (s.length < width) s = '0' + s;
            return sep + 'v' + s + ext;
        });
    } else {
        newPath = basePath.replace(/(\.[^.]+)$/, '_v02$1');
        // actually: original is unversioned, treat existing as v01 and bump to v02
    }
    // ensure the new path doesn't collide; if it does, bump again
    var tries = 0;
    while ((new File(newPath)).exists && tries < 50) {
        newPath = newPath.replace(ver, function (m, sep, num, ext) {
            var width = num.length;
            var n = parseInt(num, 10) + 1;
            var s = String(n);
            while (s.length < width) s = '0' + s;
            return sep + 'v' + s + ext;
        });
        tries++;
    }
    app.project.save(new File(newPath));
    return { newFile: newPath };
};

handlers.precompose = function (params) {
    var comp = resolveComp(params.comp);
    var layers = resolveLayers(comp, params.layers || params.layer);
    var indices = [];
    for (var i = 0; i < layers.length; i++) indices.push(layers[i].index);
    var name = params.name || (layers[0].name + ' Pre-comp');
    var moveAll = params.moveAllAttributes !== false;
    return withUndo('AE Portal: precompose', function () {
        var newComp = comp.layers.precompose(indices, name, moveAll);
        return { id: newComp.id, name: newComp.name };
    });
};

handlers.get_layer_audio_info = function (params) {
    var comp = resolveComp(params.comp);
    var layer = resolveLayer(comp, params.layer);
    if (!(layer instanceof AVLayer)) throw new Error('layer is not AV: ' + layer.name);
    if (!safe(function () { return layer.hasAudio; })) throw new Error('layer has no audio: ' + layer.name);
    var src = layer.source;
    var path = null;
    if (src instanceof FootageItem && src.file) path = src.file.fsName;
    if (!path) throw new Error('cannot resolve audio file path for layer: ' + layer.name);
    return {
        path: path,
        fps: comp.frameRate,
        inPoint: layer.inPoint,
        outPoint: layer.outPoint,
        startTime: layer.startTime,
        compName: comp.name,
        layerName: layer.name
    };
};

// ===================== composition / project ops =====================
handlers.create_composition = function (params) {
    var name = params.name || 'New Comp';
    var w = params.width  || 1920;
    var h = params.height || 1080;
    var par = params.pixelAspect || 1;
    var dur = params.duration || 10;
    var fps = params.fps || params.frameRate || 30;
    var bg  = params.bgColor;
    return withUndo('AE Portal: create_composition', function () {
        var comp = app.project.items.addComp(name, w, h, par, dur, fps);
        if (bg) comp.bgColor = bg;
        if (params.openInViewer) { comp.openInViewer(); markViewed(comp); }
        return { id: comp.id, name: comp.name, width: w, height: h, fps: fps, duration: dur };
    });
};

handlers.open_project = function (params) {
    if (!params.path) throw new Error('path required');
    var f = new File(params.path);
    if (!f.exists) throw new Error('project file not found: ' + params.path);
    // 0.4: opening another project while the current one is dirty pops a native Save
    // dialog that blocks AE's main thread. Never auto-save — surface the options and
    // let the human decide (force:true accepts the dialog).
    if (app.project && app.project.dirty && params.force !== true) {
        throw new Error('Current project has unsaved changes — opening another project would pop a native Save dialog that blocks AE. Options: call save_project first, or pass force:true to proceed and accept the dialog.');
    }
    app.open(f);
    return { file: app.project.file ? app.project.file.fsName : null };
};
handlers.close_project = function (params) {
    var opt = String(params.save || 'prompt').toLowerCase();
    var co;
    if (opt === 'save')        co = CloseOptions.SAVE_CHANGES;
    else if (opt === 'discard') co = CloseOptions.DO_NOT_SAVE_CHANGES;
    else                        co = CloseOptions.PROMPT_TO_SAVE_CHANGES;
    // 0.4: only the prompt path (save:"prompt", the default, and any unrecognized
    // value) pops a native Save dialog that blocks AE. The explicit save:"save" /
    // save:"discard" paths resolve without a modal and pass through untouched.
    if (co === CloseOptions.PROMPT_TO_SAVE_CHANGES && app.project && app.project.dirty && params.force !== true) {
        throw new Error('Current project has unsaved changes — closing with save:"prompt" would pop a native Save dialog that blocks AE. Options: pass save:"discard" to close without saving, save:"save" to save first, call save_project, or pass force:true to proceed and accept the dialog.');
    }
    app.project.close(co);
    return { closed: true };
};

handlers.analyze_unused = function () {
    var unused = [];
    for (var i = 1; i <= app.project.numItems; i++) {
        var item = app.project.item(i);
        if (item instanceof FolderItem) continue;
        var u = safe(function () { return item.usedIn; });
        if (u && u.length === 0) {
            unused.push({
                id: item.id,
                name: item.name,
                typeName: item.typeName,
                isComp: item instanceof CompItem,
                isFootage: item instanceof FootageItem,
                file: (item instanceof FootageItem && item.file) ? item.file.fsName : null
            });
        }
    }
    return { unused: unused, count: unused.length };
};

// ===================== markers =====================
function markerSourceFor(comp, layer) {
    if (layer != null) {
        var l = resolveLayer(comp, layer);
        return { src: l.property('ADBE Marker'), kind: 'layer', layer: l };
    }
    return { src: comp.markerProperty, kind: 'comp' };
}
handlers.list_markers = function (params) {
    var comp = resolveComp(params.comp);
    var ms = markerSourceFor(comp, params.layer);
    var fps = comp.frameRate;
    var out = [];
    for (var k = 1; k <= ms.src.numKeys; k++) {
        var t = ms.src.keyTime(k);
        var mv = ms.src.keyValue(k);
        out.push({
            index: k, time: t, frame: Math.round(t * fps),
            comment: mv.comment, duration: mv.duration,
            label: safe(function () { return mv.label; }),
            chapter: mv.chapter, url: mv.url, frameTarget: mv.frameTarget,
            cuePointName: mv.cuePointName
        });
    }
    return { kind: ms.kind, count: out.length, markers: out };
};
handlers.add_marker = function (params) {
    var comp = resolveComp(params.comp);
    var ms = markerSourceFor(comp, params.layer);
    var t = params.time != null ? Number(params.time) :
            params.frame != null ? Number(params.frame) / comp.frameRate :
            comp.time;
    return withUndo('AE Portal: add_marker', function () {
        var mv = new MarkerValue(params.comment != null ? String(params.comment) : '');
        if (params.duration != null) mv.duration = Number(params.duration);
        if (params.label    != null) mv.label    = Number(params.label);
        if (params.chapter)          mv.chapter  = String(params.chapter);
        if (params.url)              mv.url      = String(params.url);
        if (params.frameTarget)      mv.frameTarget = String(params.frameTarget);
        if (params.cuePointName)     mv.cuePointName = String(params.cuePointName);
        ms.src.setValueAtTime(t, mv);
        return { time: t, frame: Math.round(t * comp.frameRate), index: ms.src.nearestKeyIndex(t) };
    });
};
handlers.delete_marker = function (params) {
    var comp = resolveComp(params.comp);
    var ms = markerSourceFor(comp, params.layer);
    return withUndo('AE Portal: delete_marker', function () {
        var idx;
        if (params.index != null) idx = Number(params.index);
        else if (params.time != null) idx = ms.src.nearestKeyIndex(Number(params.time));
        else if (params.frame != null) idx = ms.src.nearestKeyIndex(Number(params.frame) / comp.frameRate);
        else throw new Error('index, time, or frame required');
        if (idx < 1 || idx > ms.src.numKeys) throw new Error('marker not found');
        ms.src.removeKey(idx);
        return { removedIndex: idx, remaining: ms.src.numKeys };
    });
};
handlers.add_markers_batch = function (params) {
    var comp = resolveComp(params.comp);
    var ms = markerSourceFor(comp, params.layer);
    var entries = params.markers || [];
    if (!entries.length) throw new Error('markers array required');
    return withUndo('AE Portal: add_markers_batch', function () {
        var added = [];
        for (var i = 0; i < entries.length; i++) {
            var e = entries[i];
            var t = e.time != null ? Number(e.time) :
                    e.frame != null ? Number(e.frame) / comp.frameRate :
                    null;
            if (t == null) continue;
            var mv = new MarkerValue(e.comment != null ? String(e.comment) : '');
            if (e.duration != null) mv.duration = Number(e.duration);
            if (e.label    != null) mv.label    = Number(e.label);
            ms.src.setValueAtTime(t, mv);
            added.push({ time: t, comment: mv.comment });
        }
        return { kind: ms.kind, addedCount: added.length };
    });
};

// ===================== selection control =====================
handlers.set_selected_layers = function (params) {
    var comp = resolveComp(params.comp);
    var indices = params.layers || [];
    if (!(indices instanceof Array)) indices = [indices];
    return withUndo('AE Portal: set_selected_layers', function () {
        // First clear all selection
        for (var i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = false;
        var selected = [];
        for (var j = 0; j < indices.length; j++) {
            var l = resolveLayer(comp, indices[j]);
            l.selected = true;
            selected.push({ index: l.index, name: l.name });
        }
        return { selected: selected };
    });
};

// ===================== folder import (recursive) =====================
handlers.import_folder_walk = function (params) {
    // JSX cannot easily recursively walk via Folder; the panel-side will do the walk
    // and call import_files. This handler is a fallback that imports a single folder
    // (non-recursive) using ImportAsType.FOOTAGE.
    if (!params.path) throw new Error('path required');
    var folder = new Folder(params.path);
    if (!folder.exists) throw new Error('folder not found: ' + params.path);
    return withUndo('AE Portal: import_folder_walk', function () {
        var prjFolder = app.project.items.addFolder(folder.name);
        var files = folder.getFiles();
        var imported = [];
        for (var i = 0; i < files.length; i++) {
            var f = files[i];
            if (f instanceof Folder) continue;
            try {
                var io = new ImportOptions(f);
                if (io.canImportAs(ImportAsType.FOOTAGE)) {
                    var item = app.project.importFile(io);
                    item.parentFolder = prjFolder;
                    imported.push({ id: item.id, name: item.name, path: f.fsName });
                }
            } catch (e) { imported.push({ path: f.fsName, error: e.message }); }
        }
        return { folder: prjFolder.name, imported: imported };
    });
};

handlers.list_compositions = function () {
    var out = [];
    for (var i = 1; i <= app.project.numItems; i++) {
        var it = app.project.item(i);
        if (it instanceof CompItem) out.push({
            id: it.id, name: it.name, w: it.width, h: it.height,
            fps: it.frameRate, dur: it.duration
        });
    }
    return { count: out.length, comps: out };
};

// ===================== expressions =====================
// 0.8: force-eval an expression property and read back its expressionError. AE
// evaluates expressions lazily — a broken one stays expressionEnabled=true until
// something reads the value, then AE disables it and fills expressionError. Reading
// valueAtTime here forces that eval so callers learn immediately whether the
// expression actually ran. Returns the error string, or '' when it evaluated cleanly
// (or the prop currently has no expression). Reused by every expression-writing tool
// (set_expression today; add_expression_control / link_properties in Wave 4).
function exprErrorFor(prop, compTime) {
    var ex = '';
    try { ex = String(prop.expression || ''); } catch (e0) { return ''; }
    if (!ex.length) return '';
    try { var _v = prop.valueAtTime(compTime, false); } catch (e1) {}
    try { return String(prop.expressionError || ''); } catch (e2) {}
    return '';
}
handlers.set_expression = function (params) {
    var comp = resolveComp(params.comp);
    var layer = resolveLayer(comp, params.layer);
    var prop = resolvePropByPath(layer, params.prop);
    var expr = String(params.expression || '');
    return withUndo('AE Portal: set_expression', function () {
        prop.expression = expr;
        prop.expressionEnabled = (expr.length > 0);
        // Force evaluation via the shared helper so the caller learns immediately
        // whether the expression actually ran (see exprErrorFor).
        var err = exprErrorFor(prop, comp.time);
        var enabled = (expr.length > 0) && !err;
        var out = { layer: layer.name, prop: prop.name, expression: prop.expression, enabled: enabled };
        if (err) out.error = err;
        return out;
    });
};
handlers.remove_expression = function (params) {
    var comp = resolveComp(params.comp);
    var layer = resolveLayer(comp, params.layer);
    var prop = resolvePropByPath(layer, params.prop);
    return withUndo('AE Portal: remove_expression', function () {
        prop.expression = '';
        prop.expressionEnabled = false;
        return { layer: layer.name, prop: prop.name };
    });
};
handlers.toggle_expression = function (params) {
    var comp = resolveComp(params.comp);
    var layer = resolveLayer(comp, params.layer);
    var prop = resolvePropByPath(layer, params.prop);
    return withUndo('AE Portal: toggle_expression', function () {
        prop.expressionEnabled = !prop.expressionEnabled;
        return { layer: layer.name, prop: prop.name, enabled: prop.expressionEnabled };
    });
};
// Shared expression-property walker (Wave 4). Depth/breadth-capped recursion over a
// layer/group property subtree; calls visit(prop, pathString, exprText) for every LEAF
// PROPERTY that can take an expression AND currently has a non-empty one. Extracted from
// check_expression_errors' original inner scan so it and safe_rename share ONE traversal
// instead of duplicating the tree walk. The caps (depth 32 / 20000 props per level) only
// bite on pathological trees — real AE property trees are shallow and narrow, so
// enumeration is identical to the original uncapped walk for every real project. visit()
// runs synchronously, so callers may close over the current comp/layer safely.
function eachExprProp(grp, path, visit, depth) {
    if (depth > 32) return;
    var n;
    try { n = grp.numProperties; } catch (e0) { return; }
    var CAP = 20000;
    if (n > CAP) n = CAP;
    for (var i = 1; i <= n; i++) {
        var p;
        try { p = grp.property(i); } catch (e1) { continue; }
        if (!p) continue;
        var name; try { name = p.name; } catch (e2) { name = '?'; }
        var sub = path ? (path + ' > ' + name) : name;
        var ptype; try { ptype = p.propertyType; } catch (e3) { ptype = null; }
        if (ptype === PropertyType.PROPERTY) {
            var canExpr = false;
            try { canExpr = p.canSetExpression; } catch (e4) {}
            if (!canExpr) continue;
            var ex = '';
            try { ex = String(p.expression || ''); } catch (e5) {}
            if (!ex.length) continue;
            visit(p, sub, ex);
        } else {
            eachExprProp(p, sub, visit, depth + 1); // INDEXED_GROUP / NAMED_GROUP — recurse
        }
    }
}
// Sweep for broken expressions: any property whose expression failed to evaluate
// (non-empty expressionError). Pass comp to scope to one comp; omit for the whole project.
handlers.check_expression_errors = function (params) {
    var comps = [];
    if (params.comp != null && params.comp !== '') {
        comps.push(resolveComp(params.comp));
    } else {
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (it instanceof CompItem) comps.push(it);
        }
    }
    var errors = [];
    var CAP_COMPS = 5000, CAP_LAYERS = 20000;
    var nC = (comps.length < CAP_COMPS) ? comps.length : CAP_COMPS;
    for (var c = 0; c < nC; c++) {
        var comp = comps[c];
        var nL = (comp.numLayers < CAP_LAYERS) ? comp.numLayers : CAP_LAYERS;
        for (var L = 1; L <= nL; L++) {
            var layer = comp.layer(L);
            var ctx = { comp: comp.name, layer: layer.name, time: comp.time };
            eachExprProp(layer, '', function (p, sub, ex) {
                try { var _v = p.value; } catch (e) {}   // force evaluation
                var err = '';
                try { err = String(p.expressionError || ''); } catch (e) {}
                if (err.length) {
                    // 1.4 stale-error double-pass: expressionError lags one eval cycle,
                    // so a property whose expression was just programmatically cleared can
                    // still carry the previous error string. If the expression now reads
                    // empty/blank, force one more valueAtTime eval and re-read
                    // expressionError — only report if it survives. Properties that still
                    // HAVE an expression keep the existing over-report bias.
                    var exNow = ex;
                    try { exNow = String(p.expression || ''); } catch (e) {}
                    if (!exNow.replace(/^\s+|\s+$/g, '').length) {
                        try { var _v2 = p.valueAtTime(ctx.time, false); } catch (e) {}
                        try { err = String(p.expressionError || ''); } catch (e) {}
                    }
                    if (err.length) {
                        var en = true; try { en = p.expressionEnabled; } catch (e) {}
                        errors.push({ comp: ctx.comp, layer: ctx.layer, prop: sub, enabled: en, error: err });
                    }
                }
            }, 0);
        }
    }
    return { compCount: comps.length, errorCount: errors.length, errors: errors };
};

// ===================== expression rigs (Wave 4) =====================
// Escape a string for embedding inside an AE expression's double-quoted accessor
// (layer names / effect names can contain " or \). ES3-safe, no template literals.
function exprQuote(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
// Expression-control catalog: matchName to addProperty, the value stream's matchName
// ('<matchName>-0001'), and a fallback display name for the accessor when the stream's
// live .name can't be read. (Point3D/Layer displays differ from their type key.)
var EXPR_CONTROL = {
    slider:   { mn: 'ADBE Slider Control',   stream: 'ADBE Slider Control-0001',   display: 'Slider'   },
    checkbox: { mn: 'ADBE Checkbox Control', stream: 'ADBE Checkbox Control-0001', display: 'Checkbox' },
    color:    { mn: 'ADBE Color Control',    stream: 'ADBE Color Control-0001',    display: 'Color'    },
    point:    { mn: 'ADBE Point Control',    stream: 'ADBE Point Control-0001',    display: 'Point'    },
    point3d:  { mn: 'ADBE Point3D Control',  stream: 'ADBE Point3D Control-0001',  display: '3D Point'  },
    angle:    { mn: 'ADBE Angle Control',    stream: 'ADBE Angle Control-0001',    display: 'Angle'    },
    layer:    { mn: 'ADBE Layer Control',    stream: 'ADBE Layer Control-0001',    display: 'Layer'    }
};
// Transform matchName to its expression accessor suffix (after `thisComp.layer("X").`).
var TRANSFORM_ACCESSOR = {
    'ADBE Position':     'transform.position',
    'ADBE Anchor Point': 'transform.anchorPoint',
    'ADBE Scale':        'transform.scale',
    'ADBE Rotate Z':     'transform.rotation',
    'ADBE Rotate X':     'transform.xRotation',
    'ADBE Rotate Y':     'transform.yRotation',
    'ADBE Orientation':  'transform.orientation',
    'ADBE Opacity':      'transform.opacity'
};
// Derive the expression accessor SUFFIX for a source property (the part after
// `thisComp.layer("Name").`). Handles the standard transforms and DIRECT effect
// params (effect("Effect")("Param")). Returns null when it can't derive a clean
// accessor (masks, deeply-nested shape/effect params) — the caller then requires an
// explicit expressionTemplate rather than emit a link that silently fails.
function exprAccessorFor(prop) {
    var mn = safe(function () { return prop.matchName; });
    if (mn && TRANSFORM_ACCESSOR[mn]) return TRANSFORM_ACCESSOR[mn];
    var g1 = safe(function () { return prop.propertyGroup(1); });
    if (g1) {
        var g1mn = safe(function () { return g1.matchName; });
        // prop is itself an effect sitting directly under the Effect Parade.
        if (g1mn === 'ADBE Effect Parade') return 'effect("' + exprQuote(prop.name) + '")';
        // prop is a direct parameter of effect g1 (g1's parent is the Effect Parade).
        var g2 = safe(function () { return prop.propertyGroup(2); });
        var g2mn = safe(function () { return g2 ? g2.matchName : null; });
        if (g2mn === 'ADBE Effect Parade') {
            return 'effect("' + exprQuote(g1.name) + '")("' + exprQuote(prop.name) + '")';
        }
    }
    return null;
}

// Add an expression control effect to a layer, optionally set its value, and
// optionally auto-link a target property's expression to it. Always force-evals the
// link via exprErrorFor (0.8) so a rig that "looks built but does nothing" is caught.
handlers.add_expression_control = function (params) {
    var comp = resolveComp(params.comp);
    var layer = resolveLayer(comp, params.layer);
    var type = String(params.type || '').toLowerCase();
    var info = EXPR_CONTROL[type];
    if (!info) throw new Error('unknown control type: ' + params.type + ' (slider|checkbox|color|point|point3d|angle|layer)');
    return withUndo('AE Portal: add_expression_control', function () {
        var parade = layer.property('ADBE Effect Parade');
        if (!parade) throw new Error('layer "' + layer.name + '" has no Effect Parade (not an AV layer?)');
        var fx = parade.addProperty(info.mn);   // new ref — never cache older ones
        if (params.name != null && String(params.name).length) {
            try { fx.name = String(params.name); } catch (eName) {}
        }
        var effName = fx.name;
        var valStream = fx.property(info.stream);
        if (!valStream) { valStream = safe(function () { return fx.property(1); }); }
        var valDisplay = (valStream && valStream.name) ? valStream.name : info.display;
        var valueSet = false;
        if (params.value != null && valStream) {
            var v = params.value;
            if (type === 'checkbox' && (v === true || v === false)) v = v ? 1 : 0;
            try { valStream.setValue(v); valueSet = true; } catch (eVal) {}
        }
        var out = { effectName: effName, type: type, valueStream: valDisplay, valueSet: valueSet };
        if (params.linkTo && params.linkTo.layer != null && params.linkTo.prop != null) {
            var tgtComp = comp;
            if (params.linkTo.comp != null && params.linkTo.comp !== '') tgtComp = resolveComp(params.linkTo.comp);
            var tgtLayer = resolveLayer(tgtComp, params.linkTo.layer);
            var tgtProp  = resolvePropByPath(tgtLayer, params.linkTo.prop);
            var expr = 'thisComp.layer("' + exprQuote(layer.name) + '").effect("' + exprQuote(effName) + '")("' + exprQuote(valDisplay) + '")';
            tgtProp.expression = expr;
            tgtProp.expressionEnabled = true;
            var exErr = exprErrorFor(tgtProp, tgtComp.time);
            out.linkedTo = { layer: tgtLayer.name, prop: tgtProp.name };
            out.expression = expr;
            out.expressionError = exErr;
            out.linkEnabled = !exErr;
        }
        return out;
    });
};

// One-call property to property expression link: set DEST's expression to reference
// SOURCE. Auto-derives the accessor for transforms + direct effect params; anything
// else requires an explicit expressionTemplate. Force-evals via exprErrorFor (0.8).
handlers.link_properties = function (params) {
    var comp = resolveComp(params.comp);
    var src = params.source || {};
    var dst = params.dest || {};
    if (src.layer == null || src.prop == null) throw new Error('source {layer, prop} required');
    if (dst.layer == null || dst.prop == null) throw new Error('dest {layer, prop} required');
    var srcLayer = resolveLayer(comp, src.layer);
    var srcProp  = resolvePropByPath(srcLayer, src.prop);
    var destComp = (params.destComp != null && params.destComp !== '') ? resolveComp(params.destComp) : comp;
    var destLayer = resolveLayer(destComp, dst.layer);
    var destProp  = resolvePropByPath(destLayer, dst.prop);
    return withUndo('AE Portal: link_properties', function () {
        var expr, derived;
        if (params.expressionTemplate != null && String(params.expressionTemplate).length) {
            expr = String(params.expressionTemplate);
            derived = false;
        } else {
            var accessor = exprAccessorFor(srcProp);
            if (!accessor) throw new Error('could not auto-derive an expression accessor for source prop "' + srcProp.name + '" (masks / nested params aren\'t auto-derivable); pass expressionTemplate explicitly, e.g. thisComp.layer("X").content("Group")("Y")');
            expr = 'thisComp.layer("' + exprQuote(srcLayer.name) + '").' + accessor;
            derived = true;
        }
        destProp.expression = expr;
        destProp.expressionEnabled = true;
        var exErr = exprErrorFor(destProp, destComp.time);
        return { destLayer: destLayer.name, destProp: destProp.name, expression: expr, expressionError: exErr, enabled: !exErr, derived: derived };
    });
};

// ===================== keyframe time ops =====================
function toSeconds(comp, params) {
    if (params.deltaSeconds != null) return Number(params.deltaSeconds);
    if (params.deltaFrames  != null) return Number(params.deltaFrames) / comp.frameRate;
    if (params.delta        != null) return Number(params.delta);
    return null;
}
// Remap every keyframe's time via mapFn(oldTime, index, total) → newTime.
// Captures value + easing + interpolation, removes all keys, re-adds at the new times,
// then restores easing/interp. AE Property has no setKeyTime, so this is the canonical pattern.
function remapKeyTimes(prop, mapFn) {
    var n = prop.numKeys;
    if (n === 0) return 0;
    var data = [];
    for (var k = 1; k <= n; k++) {
        data.push({
            newTime: mapFn(prop.keyTime(k), k, n),
            value: prop.keyValue(k),
            inI:  prop.keyInInterpolationType(k),
            outI: prop.keyOutInterpolationType(k),
            inE:  prop.keyInTemporalEase(k),
            outE: prop.keyOutTemporalEase(k)
        });
    }
    for (var d = n; d >= 1; d--) prop.removeKey(d);
    // Re-add in chronological order so the resulting key indices are 1..n in time order.
    data.sort(function (a, b) { return a.newTime - b.newTime; });
    for (var i = 0; i < data.length; i++) prop.setValueAtTime(data[i].newTime, data[i].value);
    for (var j = 0; j < data.length; j++) {
        var idx = j + 1;
        try { prop.setInterpolationTypeAtKey(idx, data[j].inI, data[j].outI); } catch (_) {}
        try { prop.setTemporalEaseAtKey(idx, data[j].inE, data[j].outE); } catch (_) {}
    }
    return n;
}

handlers.shift_keyframes = function (params) {
    var comp = resolveComp(params.comp);
    var layer = resolveLayer(comp, params.layer);
    var prop = resolvePropByPath(layer, params.prop);
    if (prop.numKeys === 0) throw new Error('property has no keyframes');
    var d = toSeconds(comp, params);
    if (d == null) throw new Error('delta required (deltaSeconds, deltaFrames, or delta)');
    return withUndo('AE Portal: shift_keyframes', function () {
        var n = remapKeyTimes(prop, function (t) { return t + d; });
        return { shiftedKeys: n, deltaSeconds: d };
    });
};
handlers.scale_keyframes = function (params) {
    var comp = resolveComp(params.comp);
    var layer = resolveLayer(comp, params.layer);
    var prop = resolvePropByPath(layer, params.prop);
    var factor = Number(params.factor);
    if (!isFinite(factor) || factor <= 0) throw new Error('factor must be positive');
    if (prop.numKeys < 2) throw new Error('need at least 2 keyframes');
    return withUndo('AE Portal: scale_keyframes', function () {
        var origin = prop.keyTime(1);
        remapKeyTimes(prop, function (t) { return origin + (t - origin) * factor; });
        return { factor: factor, originSec: origin };
    });
};
handlers.reverse_keyframes = function (params) {
    var comp = resolveComp(params.comp);
    var layer = resolveLayer(comp, params.layer);
    var prop = resolvePropByPath(layer, params.prop);
    if (prop.numKeys < 2) throw new Error('need at least 2 keyframes');
    return withUndo('AE Portal: reverse_keyframes', function () {
        // Read all keys
        var n = prop.numKeys;
        var first = prop.keyTime(1);
        var last = prop.keyTime(n);
        var data = [];
        for (var k = 1; k <= n; k++) {
            data.push({
                time: prop.keyTime(k),
                value: prop.keyValue(k),
                inI: prop.keyInInterpolationType(k),
                outI: prop.keyOutInterpolationType(k),
                inE: prop.keyInTemporalEase(k),
                outE: prop.keyOutTemporalEase(k)
            });
        }
        // Remove all keys (in reverse to preserve indices)
        for (var d = n; d >= 1; d--) prop.removeKey(d);
        // Re-add at mirrored times, swapping in/out
        for (var i = 0; i < data.length; i++) {
            var orig = data[i];
            var newTime = first + (last - orig.time);
            prop.setValueAtTime(newTime, orig.value);
        }
        // Apply mirrored interpolation (out becomes in, etc.)
        for (var j = 0; j < data.length; j++) {
            var orig2 = data[j];
            var idx = prop.numKeys - j;  // new index for mirrored position
            try {
                prop.setInterpolationTypeAtKey(idx, orig2.outI, orig2.inI);
                prop.setTemporalEaseAtKey(idx, orig2.outE, orig2.inE);
            } catch (e) {}
        }
        return { reversedKeys: prop.numKeys };
    });
};
handlers.distribute_keyframes_evenly = function (params) {
    var comp = resolveComp(params.comp);
    var layer = resolveLayer(comp, params.layer);
    var prop = resolvePropByPath(layer, params.prop);
    if (prop.numKeys < 3) throw new Error('need at least 3 keyframes');
    return withUndo('AE Portal: distribute_keyframes_evenly', function () {
        var n = prop.numKeys;
        var first = prop.keyTime(1);
        var last = prop.keyTime(n);
        var span = last - first;
        // Reposition keys 2..n-1 evenly between first and last
        var newTimes = [];
        for (var k = 1; k <= n; k++) {
            newTimes.push(first + (k - 1) * span / (n - 1));
        }
        // Apply in reverse to avoid overlap
        for (var i = n; i >= 1; i--) prop.setKeyTime(i, newTimes[i - 1]);
        return { distributed: n };
    });
};

// ===================== keyframe copy (Wave 4) =====================
function dimOf(v) { return (v instanceof Array) ? v.length : 1; }
// Resize a captured KeyframeEase[] to `targetLen`, repeating the last element when the
// source array is shorter. setTemporalEaseAtKey's array length is per-property: spatial
// props (Position/Anchor) = 1, else per-dimension (Scale = 3 even in a 2D comp, Color =
// 4, Rotation/Opacity = 1). We read the authoritative length back from the DEST's own
// first key after it exists, so AE's quirks are honoured without hardcoding them.
function fitEaseArray(easeArr, targetLen) {
    if (easeArr && easeArr.length === targetLen) return easeArr;
    var out = [];
    for (var i = 0; i < targetLen; i++) {
        var src = (easeArr && easeArr.length) ? easeArr[i < easeArr.length ? i : easeArr.length - 1] : null;
        out.push(src ? new KeyframeEase(src.speed, src.influence) : new KeyframeEase(0, 16.67));
    }
    return out;
}
// Copy every keyframe from a source property to a destination property with full
// fidelity — time (optionally offset), value, interpolation type (RAW INT in/out, never
// the enum object), temporal ease (array length sized to the dest's real dimension),
// and spatial tangents + auto-bezier when the property isSpatial. Reuses remapKeyTimes'
// capture pattern (keyTime/keyValue/keyIn|OutInterpolationType/keyIn|OutTemporalEase),
// extended with spatial tangents. Refs stay valid: the source is never mutated, and the
// dest is captured up front before any removeKey/setValueAtTime restructures it.
handlers.copy_keyframes = function (params) {
    var srcComp = resolveComp(params.comp);
    var src = params.source || {};
    var dst = params.dest || {};
    if (src.layer == null || src.prop == null) throw new Error('source {layer, prop} required');
    if (dst.layer == null || dst.prop == null) throw new Error('dest {layer, prop} required');
    var srcLayer = resolveLayer(srcComp, src.layer);
    var srcProp  = resolvePropByPath(srcLayer, src.prop);
    var destComp = (params.destComp != null && params.destComp !== '') ? resolveComp(params.destComp) : srcComp;
    var destLayer = resolveLayer(destComp, dst.layer);
    var destProp  = resolvePropByPath(destLayer, dst.prop);

    var n = srcProp.numKeys;
    if (n === 0) {
        return { copied: 0, destLayer: destLayer.name, destProp: destProp.name, note: 'source property has no keyframes' };
    }
    // Dimensionality guard — copying mismatched dimensions produces garbage values.
    var sDim = dimOf(safe(function () { return srcProp.value; }));
    var dDim = dimOf(safe(function () { return destProp.value; }));
    if (sDim !== dDim) {
        throw new Error('value dimensionality mismatch: source is ' + sDim + 'D but dest is ' + dDim + 'D (' + srcProp.name + ' -> ' + destProp.name + ')');
    }
    var offset  = (params.timeOffset != null) ? Number(params.timeOffset) : 0;
    var spatial = safe(function () { return srcProp.isSpatial === true; }) === true;
    var destSpatial = safe(function () { return destProp.isSpatial === true; }) === true;

    // Capture the full source key set up front (safe() runs synchronously, so `k` is
    // the current index inside each closure — same pattern as index.jsx captureKeyframes).
    var data = [];
    for (var k = 1; k <= n; k++) {
        data.push({
            time:  srcProp.keyTime(k) + offset,
            value: srcProp.keyValue(k),
            inI:   srcProp.keyInInterpolationType(k),    // RAW INT (6612 LINEAR / 6613 BEZIER / 6614 HOLD)
            outI:  srcProp.keyOutInterpolationType(k),
            inE:   srcProp.keyInTemporalEase(k),
            outE:  srcProp.keyOutTemporalEase(k),
            inTan:  spatial ? safe(function () { return srcProp.keyInSpatialTangent(k);  }) : null,
            outTan: spatial ? safe(function () { return srcProp.keyOutSpatialTangent(k); }) : null,
            sAuto:  spatial ? safe(function () { return srcProp.keySpatialAutoBezier(k); }) : null,
            sCont:  spatial ? safe(function () { return srcProp.keySpatialContinuous(k); }) : null,
            tAuto:  safe(function () { return srcProp.keyTemporalAutoBezier(k); })
        });
    }

    return withUndo('AE Portal: copy_keyframes', function () {
        if (params.clearExisting === true) {
            for (var c = destProp.numKeys; c >= 1; c--) destProp.removeKey(c);   // BOUNDED reverse loop, never while
        }
        // Pass 1 — create every key at its (offset) time with the source value.
        for (var a = 0; a < data.length; a++) destProp.setValueAtTime(data[a].time, data[a].value);
        // Authoritative ease-array length for THIS dest prop, read from its own key.
        var easeLen = dDim;
        try { easeLen = destProp.keyInTemporalEase(1).length; } catch (eLen) { easeLen = dDim; }
        // Pass 2 — restore interp (raw ints), temporal ease (length-fitted), spatial data.
        for (var j = 0; j < data.length; j++) {
            var d = data[j];
            var idx = destProp.nearestKeyIndex(d.time);
            try { destProp.setInterpolationTypeAtKey(idx, d.inI, d.outI); } catch (e1) {}
            try { destProp.setTemporalEaseAtKey(idx, fitEaseArray(d.inE, easeLen), fitEaseArray(d.outE, easeLen)); } catch (e2) {}
            if (destSpatial && d.inTan && d.outTan) {
                try { destProp.setSpatialTangentsAtKey(idx, d.inTan, d.outTan); } catch (e3) {}
                try { if (d.sAuto != null) destProp.setSpatialAutoBezierAtKey(idx, d.sAuto); } catch (e4) {}
                try { if (d.sCont != null) destProp.setSpatialContinuousAtKey(idx, d.sCont); } catch (e5) {}
            }
            try { if (d.tAuto != null) destProp.setTemporalAutoBezierAtKey(idx, d.tAuto); } catch (e6) {}
        }
        return {
            copied: data.length, destLayer: destLayer.name, destProp: destProp.name,
            destComp: destComp.name, spatial: destSpatial, easeArrayLength: easeLen,
            timeOffset: offset, clearedExisting: params.clearExisting === true
        };
    });
};

handlers.sequence_layers = function (params) {
    var comp = resolveComp(params.comp);
    var layers = resolveLayers(comp, params.layers);
    var offsetSec = params.offsetSeconds != null ? Number(params.offsetSeconds) :
                    params.offsetFrames  != null ? Number(params.offsetFrames) / comp.frameRate :
                    null;
    if (offsetSec == null) throw new Error('offsetSeconds or offsetFrames required');
    var startTime = params.startTime != null ? Number(params.startTime) : layers[0].startTime;
    return withUndo('AE Portal: sequence_layers', function () {
        var done = [];
        for (var i = 0; i < layers.length; i++) {
            var l = layers[i];
            var newStart = startTime + i * offsetSec;
            l.startTime = newStart;
            done.push({ name: l.name, startTime: newStart });
        }
        return { sequenced: done, offsetSec: offsetSec };
    });
};
handlers.time_stretch = function (params) {
    var comp = resolveComp(params.comp);
    var layer = resolveLayer(comp, params.layer);
    var pct = Number(params.percent);
    if (!isFinite(pct) || pct <= 0) throw new Error('percent must be positive (100 = original speed)');
    return withUndo('AE Portal: time_stretch', function () {
        layer.stretch = pct;
        return { layer: layer.name, stretch: pct };
    });
};
handlers.time_remap_enable = function (params) {
    var comp = resolveComp(params.comp);
    var layer = resolveLayer(comp, params.layer);
    if (!(layer instanceof AVLayer)) throw new Error('time remap requires AVLayer');
    return withUndo('AE Portal: time_remap_enable', function () {
        layer.timeRemapEnabled = params.enabled !== false;
        return { layer: layer.name, timeRemapEnabled: layer.timeRemapEnabled };
    });
};
handlers.freeze_frame_at = function (params) {
    var comp = resolveComp(params.comp);
    var layer = resolveLayer(comp, params.layer);
    var freezeTime = params.time != null ? Number(params.time) :
                     params.frame != null ? Number(params.frame) / comp.frameRate :
                     comp.time;
    return withUndo('AE Portal: freeze_frame_at', function () {
        if (!(layer instanceof AVLayer)) throw new Error('freeze frame requires AVLayer');
        layer.timeRemapEnabled = true;
        var tr = layer.property('ADBE Time Remapping');
        // Remove all existing keys and set a single value.
        // Bounded reverse loop — never `while (numKeys>0) removeKey(1)`:
        // on macOS 26 that pattern can wedge AE's main thread on a
        // fork-vs-malloc deadlock inside removeKey (see knowledge/).
        for (var _k = tr.numKeys; _k >= 1; _k--) tr.removeKey(_k);
        var localTime = freezeTime - layer.startTime;
        if (localTime < 0) localTime = 0;
        tr.setValueAtTime(layer.inPoint, localTime);
        tr.setValueAtTime(layer.outPoint, localTime);
        // Hold interpolation
        tr.setInterpolationTypeAtKey(1, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
        return { layer: layer.name, frozenAt: freezeTime, localFreezeTime: localTime };
    });
};

// ===================== geometry helpers =====================
function getLayerSize(layer, time) {
    if (layer instanceof AVLayer && layer.source && !(layer.source instanceof CompItem) && layer.source.mainSource instanceof SolidSource) {
        return { w: layer.source.width, h: layer.source.height, left: 0, top: 0 };
    }
    if (layer instanceof AVLayer && layer.source && layer.source.width) {
        return { w: layer.source.width, h: layer.source.height, left: 0, top: 0 };
    }
    // Fall back to sourceRectAtTime
    try {
        var r = layer.sourceRectAtTime(time, false);
        return { w: r.width, h: r.height, left: r.left, top: r.top };
    } catch (e) {
        return { w: 0, h: 0, left: 0, top: 0 };
    }
}
handlers.center_anchor = function (params) {
    var comp = resolveComp(params.comp);
    var layers = resolveLayers(comp, params.layers || params.layer);
    var pos = (params.anchor || 'center').toLowerCase();
    return withUndo('AE Portal: center_anchor', function () {
        var done = [];
        for (var i = 0; i < layers.length; i++) {
            var layer = layers[i];
            var t = comp.time;
            var sz = getLayerSize(layer, t);
            // X: left | center | right
            var ax = (pos.indexOf('left')  !== -1) ? sz.left :
                     (pos.indexOf('right') !== -1) ? sz.left + sz.w :
                                                     sz.left + sz.w / 2;
            // Y: top | center | bottom
            var ay = (pos.indexOf('top')    !== -1) ? sz.top :
                     (pos.indexOf('bottom') !== -1) ? sz.top + sz.h :
                                                      sz.top + sz.h / 2;
            var newAnchor;
            if (layer.threeDLayer) {
                newAnchor = [ax, ay, 0];
            } else {
                newAnchor = [ax, ay];
            }
            var anchorProp = layer.property('ADBE Transform Group').property('ADBE Anchor Point');
            var posProp    = layer.property('ADBE Transform Group').property('ADBE Position');
            var oldAnchor = anchorProp.value;
            // Compute world delta with scale
            var scale = layer.property('ADBE Transform Group').property('ADBE Scale').value;
            var dx = (newAnchor[0] - oldAnchor[0]) * (scale[0] / 100);
            var dy = (newAnchor[1] - oldAnchor[1]) * (scale[1] / 100);
            var dz = layer.threeDLayer ? (newAnchor[2] - (oldAnchor[2] || 0)) * ((scale[2] || 100) / 100) : 0;
            // Set anchor
            if (anchorProp.numKeys > 0) anchorProp.setValueAtTime(t, newAnchor);
            else anchorProp.setValue(newAnchor);
            // Compensate position
            if (posProp.numKeys > 0) {
                for (var k = 1; k <= posProp.numKeys; k++) {
                    var v = posProp.keyValue(k);
                    var nv = layer.threeDLayer ? [v[0] + dx, v[1] + dy, (v[2] || 0) + dz]
                                                : [v[0] + dx, v[1] + dy];
                    posProp.setValueAtKey(k, nv);
                }
            } else {
                var p = posProp.value;
                var np = layer.threeDLayer ? [p[0] + dx, p[1] + dy, (p[2] || 0) + dz]
                                            : [p[0] + dx, p[1] + dy];
                posProp.setValue(np);
            }
            done.push({ name: layer.name, anchor: newAnchor });
        }
        return { centered: done };
    });
};
handlers.fit_to_comp = function (params) {
    var comp = resolveComp(params.comp);
    var layers = resolveLayers(comp, params.layers || params.layer);
    var mode = params.mode || 'cover';   // cover | contain | fill
    return withUndo('AE Portal: fit_to_comp', function () {
        var out = [];
        for (var i = 0; i < layers.length; i++) {
            var layer = layers[i];
            var sz = getLayerSize(layer, comp.time);
            if (sz.w === 0 || sz.h === 0) { out.push({ name: layer.name, skipped: 'no size' }); continue; }
            var scaleX = comp.width / sz.w * 100;
            var scaleY = comp.height / sz.h * 100;
            var s;
            if (mode === 'fill')    s = [scaleX, scaleY];
            else if (mode === 'cover')   { var c = Math.max(scaleX, scaleY); s = [c, c]; }
            else /* contain */          { var ct = Math.min(scaleX, scaleY); s = [ct, ct]; }
            if (layer.threeDLayer) s.push(s[1]);
            var sp = layer.property('ADBE Transform Group').property('ADBE Scale');
            if (sp.numKeys > 0) sp.setValueAtTime(comp.time, s);
            else sp.setValue(s);
            out.push({ name: layer.name, scale: s, mode: mode });
        }
        return { fit: out };
    });
};
function layerCenter(layer, time) {
    var sz = getLayerSize(layer, time);
    var p = layer.property('ADBE Transform Group').property('ADBE Position').value;
    var a = layer.property('ADBE Transform Group').property('ADBE Anchor Point').value;
    var sc = layer.property('ADBE Transform Group').property('ADBE Scale').value;
    // Layer's visual center = position - anchor*scale + (size/2)*scale
    var cx = p[0] - a[0] * (sc[0] / 100) + (sz.left + sz.w / 2) * (sc[0] / 100);
    var cy = p[1] - a[1] * (sc[1] / 100) + (sz.top + sz.h / 2) * (sc[1] / 100);
    return { cx: cx, cy: cy, p: p, a: a, sc: sc, sz: sz };
}
handlers.align_layers = function (params) {
    var comp = resolveComp(params.comp);
    var layers = resolveLayers(comp, params.layers);
    var edge = params.edge || 'center-h';   // left | right | top | bottom | center-h | center-v
    var ref = params.reference || 'comp';   // comp | first | last | layer name/index
    return withUndo('AE Portal: align_layers', function () {
        var refBox;
        if (ref === 'comp') {
            refBox = { left: 0, top: 0, right: comp.width, bottom: comp.height,
                       cx: comp.width / 2, cy: comp.height / 2 };
        } else {
            var refLayer = ref === 'first' ? layers[0] :
                           ref === 'last'  ? layers[layers.length - 1] :
                           resolveLayer(comp, ref);
            var lc = layerCenter(refLayer, comp.time);
            refBox = {
                left: lc.cx - lc.sz.w / 2 * lc.sc[0] / 100,
                right: lc.cx + lc.sz.w / 2 * lc.sc[0] / 100,
                top: lc.cy - lc.sz.h / 2 * lc.sc[1] / 100,
                bottom: lc.cy + lc.sz.h / 2 * lc.sc[1] / 100,
                cx: lc.cx, cy: lc.cy
            };
        }
        var out = [];
        for (var i = 0; i < layers.length; i++) {
            var layer = layers[i];
            if (ref !== 'comp' && layer === (ref === 'first' ? layers[0] : ref === 'last' ? layers[layers.length - 1] : null)) continue;
            var lc2 = layerCenter(layer, comp.time);
            var w2 = lc2.sz.w * lc2.sc[0] / 100;
            var h2 = lc2.sz.h * lc2.sc[1] / 100;
            var newCx = lc2.cx, newCy = lc2.cy;
            if (edge === 'left')      newCx = refBox.left   + w2 / 2;
            else if (edge === 'right')    newCx = refBox.right  - w2 / 2;
            else if (edge === 'top')      newCy = refBox.top    + h2 / 2;
            else if (edge === 'bottom')   newCy = refBox.bottom - h2 / 2;
            else if (edge === 'center-h') newCx = refBox.cx;
            else if (edge === 'center-v') newCy = refBox.cy;
            var dx = newCx - lc2.cx, dy = newCy - lc2.cy;
            var posProp = layer.property('ADBE Transform Group').property('ADBE Position');
            var pv = posProp.value;
            var nv = layer.threeDLayer ? [pv[0] + dx, pv[1] + dy, pv[2]] : [pv[0] + dx, pv[1] + dy];
            if (posProp.numKeys > 0) posProp.setValueAtTime(comp.time, nv);
            else posProp.setValue(nv);
            out.push({ name: layer.name, position: nv });
        }
        return { aligned: out, edge: edge, reference: ref };
    });
};
handlers.distribute_layers = function (params) {
    var comp = resolveComp(params.comp);
    var layers = resolveLayers(comp, params.layers);
    if (layers.length < 3) throw new Error('need at least 3 layers');
    var axis = (params.axis || 'x').toLowerCase();
    return withUndo('AE Portal: distribute_layers', function () {
        // Sort layers by current center on the axis
        var data = [];
        for (var i = 0; i < layers.length; i++) {
            var lc = layerCenter(layers[i], comp.time);
            data.push({ layer: layers[i], lc: lc, key: axis === 'x' ? lc.cx : lc.cy });
        }
        data.sort(function (a, b) { return a.key - b.key; });
        var first = data[0].key, last = data[data.length - 1].key;
        var step = (last - first) / (data.length - 1);
        var out = [];
        for (var j = 1; j < data.length - 1; j++) {
            var d = data[j];
            var target = first + j * step;
            var dx = (axis === 'x' ? target - d.lc.cx : 0);
            var dy = (axis === 'y' ? target - d.lc.cy : 0);
            var posProp = d.layer.property('ADBE Transform Group').property('ADBE Position');
            var pv = posProp.value;
            var nv = d.layer.threeDLayer ? [pv[0] + dx, pv[1] + dy, pv[2]] : [pv[0] + dx, pv[1] + dy];
            if (posProp.numKeys > 0) posProp.setValueAtTime(comp.time, nv);
            else posProp.setValue(nv);
            out.push({ name: d.layer.name, axis: axis, target: target });
        }
        return { distributed: out, axis: axis };
    });
};
handlers.match_size = function (params) {
    var comp = resolveComp(params.comp);
    var src = resolveLayer(comp, params.source);
    var tgt = resolveLayer(comp, params.target);
    return withUndo('AE Portal: match_size', function () {
        var sSz = getLayerSize(src, comp.time);
        var sSc = src.property('ADBE Transform Group').property('ADBE Scale').value;
        var tSz = getLayerSize(tgt, comp.time);
        if (tSz.w === 0 || tSz.h === 0) throw new Error('target has zero size');
        var newScaleX = (sSz.w * sSc[0] / 100) / tSz.w * 100;
        var newScaleY = (sSz.h * sSc[1] / 100) / tSz.h * 100;
        var sp = tgt.property('ADBE Transform Group').property('ADBE Scale');
        var nv = tgt.threeDLayer ? [newScaleX, newScaleY, newScaleY] : [newScaleX, newScaleY];
        if (sp.numKeys > 0) sp.setValueAtTime(comp.time, nv);
        else sp.setValue(nv);
        return { target: tgt.name, scale: nv };
    });
};
handlers.match_position = function (params) {
    var comp = resolveComp(params.comp);
    var src = resolveLayer(comp, params.source);
    var tgt = resolveLayer(comp, params.target);
    return withUndo('AE Portal: match_position', function () {
        var v = src.property('ADBE Transform Group').property('ADBE Position').value;
        var sp = tgt.property('ADBE Transform Group').property('ADBE Position');
        var nv = tgt.threeDLayer ? [v[0], v[1], v[2] || 0] : [v[0], v[1]];
        if (sp.numKeys > 0) sp.setValueAtTime(comp.time, nv);
        else sp.setValue(nv);
        return { target: tgt.name, position: nv };
    });
};

// ===================== comp-space transform (parent-chain aware) =====================
// layerCenter() above is own-transform only. These walk the FULL parent chain so a
// layer parented to a scaled/rotated null (or another layer) resolves to true comp
// coordinates — the gap that forced bespoke JSX for parented label/button alignment.
function _deg2rad(d) { return d * Math.PI / 180; }
function _m2mul(A, B) {
    return [[A[0][0]*B[0][0] + A[0][1]*B[1][0], A[0][0]*B[0][1] + A[0][1]*B[1][1]],
            [A[1][0]*B[0][0] + A[1][1]*B[1][0], A[1][0]*B[0][1] + A[1][1]*B[1][1]]];
}
function _m2vec(A, v) { return [A[0][0]*v[0] + A[0][1]*v[1], A[1][0]*v[0] + A[1][1]*v[1]]; }
function _m2inv(A) {
    var det = A[0][0]*A[1][1] - A[0][1]*A[1][0];
    if (Math.abs(det) < 1e-9) det = (det < 0 ? -1e-9 : 1e-9);
    var i = 1 / det;
    return [[A[1][1]*i, -A[0][1]*i], [-A[1][0]*i, A[0][0]*i]];
}
// f_layer: maps a point in this layer's own content space -> its parent's content
// space.  parentPoint = A*content + b, with A = R(rotZ)*S(scale).
function _selfAffine(layer, t) {
    var tg = layer.property('ADBE Transform Group');
    var pos = tg.property('ADBE Position').valueAtTime(t, false);
    var anc = tg.property('ADBE Anchor Point').valueAtTime(t, false);
    var sc  = tg.property('ADBE Scale').valueAtTime(t, false);
    var rot = 0;
    try { rot = tg.property('ADBE Rotate Z').valueAtTime(t, false); } catch (e) {}
    var sx = sc[0] / 100, sy = sc[1] / 100, th = _deg2rad(rot);
    var cs = Math.cos(th), sn = Math.sin(th);
    var A = [[cs*sx, -sn*sy], [sn*sx, cs*sy]];
    var Aa = _m2vec(A, [anc[0], anc[1]]);
    return { A: A, b: [pos[0] - Aa[0], pos[1] - Aa[1]] };
}
// Compose f over [layer, layer.parent, ...] -> affine mapping the layer's own content
// space into comp space. threeD flags any 3D layer in the chain (result is 2D-only).
function _chainAffine(layer, t) {
    var f = _selfAffine(layer, t);
    var A = f.A, b = f.b, threeD = !!layer.threeDLayer;
    var p = layer.parent;
    while (p) {
        if (p.threeDLayer) threeD = true;
        var g = _selfAffine(p, t);
        A = _m2mul(g.A, A);
        b = [g.A[0][0]*b[0] + g.A[0][1]*b[1] + g.b[0],
             g.A[1][0]*b[0] + g.A[1][1]*b[1] + g.b[1]];
        p = p.parent;
    }
    return { A: A, b: b, threeD: threeD };
}
// sourceRect (visual) center of a layer in comp space.
function _compCenter(layer, t) {
    var sr = layer.sourceRectAtTime(t, false);
    var xc = [sr.left + sr.width/2, sr.top + sr.height/2];
    var m = _chainAffine(layer, t);
    return { c: [m.A[0][0]*xc[0] + m.A[0][1]*xc[1] + m.b[0],
                 m.A[1][0]*xc[0] + m.A[1][1]*xc[1] + m.b[1]], threeD: m.threeD };
}
// Linear part of the parent-only chain (immediate parent -> comp); identity if unparented.
function _parentLinear(layer, t) {
    if (!layer.parent) return [[1, 0], [0, 1]];
    return _chainAffine(layer.parent, t).A;
}
// Center each layer's comp-space visual center onto its target's center (+offset),
// solving the layer's LOCAL position through the parent chain (handles non-uniform /
// animated parent scale + rotation). 2D layers only.
handlers.align_to_targets = function (params) {
    var comp = resolveComp(params.comp);
    var t;
    if (params.time != null) t = Number(params.time);
    else if (params.frame != null) t = Number(params.frame) / comp.frameRate;
    else t = comp.time;
    var pairs = [];
    if (params.pairs && params.pairs.length) {
        for (var i = 0; i < params.pairs.length; i++)
            pairs.push({ layer: params.pairs[i].layer, target: params.pairs[i].target });
    } else if (params.layers != null && params.targets != null) {
        var ls = params.layers instanceof Array ? params.layers : [params.layers];
        var ts = params.targets instanceof Array ? params.targets : [params.targets];
        if (ls.length !== ts.length) throw new Error('layers and targets must be the same length');
        for (var j = 0; j < ls.length; j++) pairs.push({ layer: ls[j], target: ts[j] });
    } else {
        throw new Error('provide pairs:[{layer,target}] or parallel layers[]+targets[]');
    }
    var off = params.offset || [0, 0];
    var offX = Number(off[0]) || 0, offY = Number(off[1]) || 0;
    var axis = (params.axis || 'both').toLowerCase();
    var doX = axis === 'both' || axis === 'x';
    var doY = axis === 'both' || axis === 'y';

    return withUndo('AE Portal: align_to_targets', function () {
        var out = [], warn3D = false;
        for (var k = 0; k < pairs.length; k++) {
            var L = resolveLayer(comp, pairs[k].layer);
            var T = resolveLayer(comp, pairs[k].target);
            var posProp = L.property('ADBE Transform Group').property('ADBE Position');
            if (posProp.expression && posProp.expressionEnabled) {
                out.push({ layer: L.name, target: T.name, skipped: 'position has an active expression' });
                continue;
            }
            var cur = _compCenter(L, t);
            var tgt = _compCenter(T, t);
            if (cur.threeD || tgt.threeD) warn3D = true;
            var goal = [doX ? tgt.c[0] + offX : cur.c[0], doY ? tgt.c[1] + offY : cur.c[1]];
            var d = _m2vec(_m2inv(_parentLinear(L, t)), [goal[0] - cur.c[0], goal[1] - cur.c[1]]);
            var pv = posProp.valueAtTime(t, false);
            var nv = L.threeDLayer ? [pv[0] + d[0], pv[1] + d[1], pv[2]] : [pv[0] + d[0], pv[1] + d[1]];
            if (posProp.numKeys > 0) posProp.setValueAtTime(t, nv);
            else posProp.setValue(nv);
            out.push({ layer: L.name, target: T.name,
                       deltaComp: [Math.round((goal[0]-cur.c[0])*100)/100, Math.round((goal[1]-cur.c[1])*100)/100],
                       position: nv });
        }
        var res = { aligned: out, axis: axis, offset: [offX, offY], time: t };
        if (warn3D) res.warning = '3D layer/parent in chain — comp-space ignores Z + camera projection; verify visually.';
        return res;
    });
};

// ===================== text content =====================
function withTextDoc(layer, fn) {
    if (!(layer instanceof TextLayer)) throw new Error('not a text layer: ' + layer.name);
    var docProp = layer.property('ADBE Text Properties').property('ADBE Text Document');
    var doc = docProp.value;
    fn(doc);
    docProp.setValue(doc);
}
handlers.set_text = function (params) {
    var comp = resolveComp(params.comp);
    var layer = resolveLayer(comp, params.layer);
    return withUndo('AE Portal: set_text', function () {
        withTextDoc(layer, function (doc) { doc.text = String(params.text != null ? params.text : ''); });
        // 0.7: read the text back so a silent no-op (locked layer, wrong match) is
        // visible instead of a bare ack.
        var resultText = '';
        try { resultText = String(layer.property('ADBE Text Properties').property('ADBE Text Document').value.text); } catch (e) {}
        return { layer: layer.name, text: resultText };
    });
};
handlers.set_text_style = function (params) {
    var comp = resolveComp(params.comp);
    var layer = resolveLayer(comp, params.layer);
    return withUndo('AE Portal: set_text_style', function () {
        withTextDoc(layer, function (doc) {
            if (params.font != null)         doc.font          = String(params.font);
            if (params.fontSize != null)     doc.fontSize      = Number(params.fontSize);
            if (params.fillColor)            doc.fillColor     = params.fillColor;
            if (params.strokeColor)          doc.strokeColor   = params.strokeColor;
            if (params.strokeWidth != null)  doc.strokeWidth   = Number(params.strokeWidth);
            if (params.tracking != null)     doc.tracking      = Number(params.tracking);
            if (params.leading != null)      doc.leading       = Number(params.leading);
            if (params.applyFill != null)    doc.applyFill     = !!params.applyFill;
            if (params.applyStroke != null)  doc.applyStroke   = !!params.applyStroke;
            if (params.fauxBold != null)     doc.fauxBold      = !!params.fauxBold;
            if (params.fauxItalic != null)   doc.fauxItalic    = !!params.fauxItalic;
            if (params.allCaps != null)      doc.allCaps       = !!params.allCaps;
            if (params.smallCaps != null)    doc.smallCaps     = !!params.smallCaps;
            if (params.justification && ParagraphJustification[params.justification] !== undefined) {
                doc.justification = ParagraphJustification[params.justification];
            }
        });
        return { layer: layer.name };
    });
};

// ===================== layer state batch toggles =====================
handlers.toggle_layer_state = function (params) {
    var comp = resolveComp(params.comp);
    var layers = resolveLayers(comp, params.layers || params.layer);
    var prop = params.prop;
    if (!prop) throw new Error('prop required (enabled|solo|shy|locked|threeDLayer|motionBlur|adjustmentLayer|guideLayer)');
    var allowed = ['enabled','solo','shy','locked','threeDLayer','motionBlur','adjustmentLayer','guideLayer','collapseTransformation'];
    var has = false;
    for (var i = 0; i < allowed.length; i++) if (allowed[i] === prop) { has = true; break; }
    if (!has) throw new Error('unsupported prop: ' + prop + ' (allowed: ' + allowed.join(', ') + ')');
    return withUndo('AE Portal: toggle_layer_state', function () {
        var done = [];
        for (var j = 0; j < layers.length; j++) {
            var l = layers[j];
            var newVal;
            if (params.value !== undefined) newVal = !!params.value;
            else newVal = !l[prop];
            // 0.7: `result` is the attr re-read AFTER the set (vs `value`, the intended
            // value) so a silently-rejected toggle is visible.
            try {
                l[prop] = newVal;
                var readBack = newVal;
                try { readBack = l[prop]; } catch (er) {}
                done.push({ layer: l.name, prop: prop, value: newVal, result: readBack });
            }
            catch (e) { done.push({ layer: l.name, prop: prop, error: e.message }); }
        }
        return { results: done };
    });
};
handlers.set_color_label = function (params) {
    var label = Number(params.label);
    if (!isFinite(label) || label < 0 || label > 16) throw new Error('label must be 0–16');
    return withUndo('AE Portal: set_color_label', function () {
        var done = [];
        if (params.itemIds) {
            var ids = params.itemIds instanceof Array ? params.itemIds : [params.itemIds];
            for (var i = 0; i < ids.length; i++) {
                for (var j = 1; j <= app.project.numItems; j++) {
                    if (app.project.item(j).id === Number(ids[i])) {
                        app.project.item(j).label = label;
                        // 0.7: per-item `label` is the value re-read after the set.
                        done.push({ id: ids[i], name: app.project.item(j).name, label: app.project.item(j).label });
                        break;
                    }
                }
            }
        } else {
            var comp = resolveComp(params.comp);
            var layers = resolveLayers(comp, params.layers || params.layer);
            for (var k = 0; k < layers.length; k++) {
                layers[k].label = label;
                // 0.7: per-layer `label` is the value re-read after the set.
                done.push({ layer: layers[k].name, label: layers[k].label });
            }
        }
        return { labelled: done, label: label };
    });
};
handlers.set_in_out = function (params) {
    var comp = resolveComp(params.comp);
    var layer = resolveLayer(comp, params.layer);
    return withUndo('AE Portal: set_in_out', function () {
        if (params.inTime  != null) layer.inPoint  = Number(params.inTime);
        if (params.inFrame != null) layer.inPoint  = Number(params.inFrame) / comp.frameRate;
        if (params.outTime != null) layer.outPoint = Number(params.outTime);
        if (params.outFrame != null) layer.outPoint = Number(params.outFrame) / comp.frameRate;
        return { layer: layer.name, inPoint: layer.inPoint, outPoint: layer.outPoint };
    });
};
handlers.set_layer_blend_mode = function (params) {
    var comp = resolveComp(params.comp);
    var layers = resolveLayers(comp, params.layers || params.layer);
    var modeName = String(params.mode || '').toUpperCase().replace(/[^A-Z_]/g, '_');
    if (BlendingMode[modeName] === undefined) throw new Error('unknown blending mode: ' + params.mode);
    return withUndo('AE Portal: set_layer_blend_mode', function () {
        var done = [];
        for (var i = 0; i < layers.length; i++) {
            layers[i].blendingMode = BlendingMode[modeName];
            // 0.7: read the resulting blendingMode back as an int.
            var bmInt = Number(layers[i].blendingMode);
            done.push({ layer: layers[i].name, mode: modeName, blendingMode: (isNaN(bmInt) ? null : bmInt) });
        }
        return { applied: done };
    });
};
handlers.set_quality = function (params) {
    var comp = resolveComp(params.comp);
    var layers = resolveLayers(comp, params.layers || params.layer);
    var q = (params.quality || '').toUpperCase();
    var map = { 'BEST': LayerQuality.BEST, 'DRAFT': LayerQuality.DRAFT, 'WIREFRAME': LayerQuality.WIREFRAME };
    if (!map[q]) throw new Error('unknown quality: ' + params.quality + ' (BEST|DRAFT|WIREFRAME)');
    return withUndo('AE Portal: set_quality', function () {
        for (var i = 0; i < layers.length; i++) layers[i].quality = map[q];
        return { quality: q, count: layers.length };
    });
};

// ===================== razor / work area =====================
handlers.split_layer_at_time = function (params) {
    var comp = resolveComp(params.comp);
    var layers = resolveLayers(comp, params.layers || params.layer);
    var t = params.time != null ? Number(params.time) :
            params.frame != null ? Number(params.frame) / comp.frameRate :
            comp.time;
    return withUndo('AE Portal: split_layer_at_time', function () {
        var origCompTime = comp.time;
        comp.time = t;
        var splits = [];
        for (var i = 0; i < layers.length; i++) {
            var l = layers[i];
            try {
                var newL = l.duplicate();
                newL.inPoint = t;
                l.outPoint = t;
                splits.push({ from: l.name, into: newL.name });
            } catch (e) { splits.push({ from: l.name, error: e.message }); }
        }
        comp.time = origCompTime;
        return { splits: splits, time: t };
    });
};
handlers.set_work_area = function (params) {
    var comp = resolveComp(params.comp);
    var inT  = params.inTime  != null ? Number(params.inTime)  :
               params.inFrame != null ? Number(params.inFrame) / comp.frameRate : comp.workAreaStart;
    var outT = params.outTime != null ? Number(params.outTime) :
               params.outFrame != null ? Number(params.outFrame) / comp.frameRate :
               (comp.workAreaStart + comp.workAreaDuration);
    if (outT <= inT) throw new Error('outTime must be greater than inTime');
    return withUndo('AE Portal: set_work_area', function () {
        comp.workAreaStart = inT;
        comp.workAreaDuration = outT - inT;
        return { workAreaStart: inT, workAreaDuration: outT - inT };
    });
};
handlers.set_work_area_to_selection = function (params) {
    var comp = resolveComp(params.comp);
    var sel = comp.selectedLayers;
    if (!sel.length) throw new Error('no layers selected');
    var minIn = Infinity, maxOut = -Infinity;
    for (var i = 0; i < sel.length; i++) {
        if (sel[i].inPoint  < minIn)  minIn  = sel[i].inPoint;
        if (sel[i].outPoint > maxOut) maxOut = sel[i].outPoint;
    }
    return withUndo('AE Portal: set_work_area_to_selection', function () {
        // Clamp to comp boundaries: workAreaStart >= 0, end <= comp.duration.
        var start = Math.max(0, minIn);
        var end = Math.min(comp.duration, maxOut);
        var dur = Math.max(0, end - start);
        comp.workAreaStart = start;
        comp.workAreaDuration = dur;
        return { workAreaStart: start, workAreaDuration: dur };
    });
};
handlers.trim_to_work_area = function (params) {
    var comp = resolveComp(params.comp);
    return withUndo('AE Portal: trim_to_work_area', function () {
        var ws = comp.workAreaStart, wd = comp.workAreaDuration;
        comp.duration = wd;
        // Shift all layers so workArea starts at 0
        for (var i = 1; i <= comp.numLayers; i++) {
            var l = comp.layer(i);
            l.startTime = l.startTime - ws;
        }
        comp.workAreaStart = 0;
        return { newDuration: wd };
    });
};

// ===================== cameras / lights =====================
handlers.add_camera = function (params) {
    var comp = resolveComp(params.comp);
    return withUndo('AE Portal: add_camera', function () {
        var name = params.name || 'Camera';
        var pos = params.position || [comp.width / 2, comp.height / 2, -1777.78];
        var c = comp.layers.addCamera(name, pos);
        if (params.oneNode) c.autoOrient = AutoOrientType.NO_AUTO_ORIENT;
        else c.autoOrient = AutoOrientType.CAMERA_OR_POINT_OF_INTEREST;
        return { name: c.name, index: c.index };
    });
};
handlers.add_light = function (params) {
    var comp = resolveComp(params.comp);
    return withUndo('AE Portal: add_light', function () {
        var name = params.name || 'Light';
        var pos = params.position || [comp.width / 2, comp.height / 2];
        var l = comp.layers.addLight(name, pos);
        var typeMap = {
            'PARALLEL': LightType.PARALLEL, 'SPOT': LightType.SPOT,
            'POINT':    LightType.POINT,    'AMBIENT': LightType.AMBIENT
        };
        var t = (params.type || 'POINT').toUpperCase();
        if (typeMap[t]) l.lightType = typeMap[t];
        if (params.intensity != null) {
            try { l.property('ADBE Light Options Group').property('ADBE Light Intensity').setValue(Number(params.intensity)); } catch (e) {}
        }
        if (params.color) {
            try { l.property('ADBE Light Options Group').property('ADBE Light Color').setValue(params.color); } catch (e) {}
        }
        return { name: l.name, index: l.index, type: t };
    });
};

// ===================== presets =====================
handlers.apply_preset_ffx = function (params) {
    var comp = resolveComp(params.comp);
    var layer = resolveLayer(comp, params.layer);
    if (!params.path) throw new Error('path to .ffx required');
    var f = new File(params.path);
    if (!f.exists) throw new Error('preset not found: ' + params.path);
    return withUndo('AE Portal: apply_preset_ffx', function () {
        layer.applyPreset(f);
        return { layer: layer.name, preset: f.fsName };
    });
};
handlers.apply_mogrt = function (params) {
    var comp = resolveComp(params.comp);
    if (!params.path) throw new Error('path to .mogrt required');
    var f = new File(params.path);
    if (!f.exists) throw new Error('mogrt not found: ' + params.path);
    return withUndo('AE Portal: apply_mogrt', function () {
        var pos = params.position || [comp.width / 2, comp.height / 2];
        var time = params.time != null ? Number(params.time) : comp.time;
        var fl = comp.importMogrt ? comp.importMogrt(f, pos, time) : null;
        if (!fl) throw new Error('importMogrt not available; AE may not support this mogrt');
        return { layer: fl.name, index: fl.index };
    });
};

// ===================== render queue =====================
handlers.render_queue_add = function (params) {
    var comp = resolveComp(params.comp);
    return withUndo('AE Portal: render_queue_add', function () {
        var item = app.project.renderQueue.items.add(comp);
        if (params.outputPath) {
            try { item.outputModule(1).file = new File(params.outputPath); } catch (e) {}
        }
        if (params.templateName) {
            try { item.applyTemplate(params.templateName); } catch (e) {}
        }
        if (params.outputModuleTemplate) {
            try { item.outputModule(1).applyTemplate(params.outputModuleTemplate); } catch (e) {}
        }
        return { id: item.render ? 'queued' : 'added', index: app.project.renderQueue.numItems, comp: comp.name };
    });
};
handlers.start_render = function () {
    app.project.renderQueue.render();
    return { started: true };
};
handlers.render_queue_status = function () {
    var rq = app.project.renderQueue;
    var items = [];
    for (var i = 1; i <= rq.numItems; i++) {
        var it = rq.item(i);
        items.push({
            index: i, comp: it.comp.name, status: String(it.status),
            startTime: safe(function () { return it.startTime; }),
            elapsedSeconds: safe(function () { return it.elapsedSeconds; }),
            outputs: (function () {
                var arr = [];
                for (var k = 1; k <= it.numOutputModules; k++) {
                    var om = it.outputModule(k);
                    arr.push({ index: k, file: om.file ? om.file.fsName : null });
                }
                return arr;
            })()
        });
    }
    return { rendering: rq.rendering, count: items.length, items: items };
};
handlers.clear_render_queue = function () {
    var rq = app.project.renderQueue;
    var removed = 0;
    // Bounded reverse loop (never `while(numItems>0) item(1).remove()`).
    for (var _i = rq.numItems; _i >= 1; _i--) { rq.item(_i).remove(); removed++; }
    return { removed: removed };
};
handlers.list_om_templates = function () {
    var rq = app.project.renderQueue;
    var tmp = app.project.items.addComp('__omt_probe__', 16, 16, 1, 0.1, 30);
    var item = rq.items.add(tmp);
    var names = item.outputModule(1).templates;
    var arr = [];
    for (var i = 0; i < names.length; i++) {
        if (String(names[i]).indexOf('_HIDDEN') === 0) continue;
        arr.push(names[i]);
    }
    item.remove();
    tmp.remove();
    return { templates: arr, count: arr.length };
};
handlers.list_rs_templates = function () {
    var rq = app.project.renderQueue;
    var tmp = app.project.items.addComp('__rst_probe__', 16, 16, 1, 0.1, 30);
    var item = rq.items.add(tmp);
    var names = item.templates;
    var arr = [];
    for (var i = 0; i < names.length; i++) {
        if (String(names[i]).indexOf('_HIDDEN') === 0) continue;
        arr.push(names[i]);
    }
    item.remove();
    tmp.remove();
    return { templates: arr, count: arr.length };
};
handlers.save_om_template = function (params) {
    if (!params.name) throw new Error('name required');
    var rq = app.project.renderQueue;
    if (rq.numItems === 0) throw new Error('render queue is empty — queue an item first (with the OM configured in AE), then call save_om_template');
    var idx = params.itemIndex ? params.itemIndex : rq.numItems;
    if (idx < 1 || idx > rq.numItems) throw new Error('itemIndex out of range');
    var item = rq.item(idx);
    var om = item.outputModule(1);
    om.saveAsTemplate(params.name);
    return { saved: params.name, fromItem: idx, fromComp: item.comp.name };
};
handlers.render_queue_add_batch = function (params) {
    if (!params.comps || !params.comps.length) throw new Error('comps required (non-empty array)');
    if (!params.outputDir) throw new Error('outputDir required');
    var dir = new Folder(params.outputDir);
    if (!dir.exists) dir.create();
    return withUndo('AE Portal: render_queue_add_batch', function () {
        var results = [];
        for (var i = 0; i < params.comps.length; i++) {
            var ref = params.comps[i];
            var comp = null;
            try { comp = resolveComp(ref); } catch (e) {}
            if (!comp) { results.push({ comp: String(ref), ok: false, error: 'not found' }); continue; }
            var item = app.project.renderQueue.items.add(comp);
            try { if (params.templateName) item.applyTemplate(params.templateName); } catch (e) {}
            var om = item.outputModule(1);
            try { if (params.outputModuleTemplate) om.applyTemplate(params.outputModuleTemplate); } catch (e) {}
            // Build output path AFTER template applied so extension reflects template's format
            var ext = params.extension ? String(params.extension).replace(/^\./, '') : null;
            if (!ext) {
                var currentFile = om.file ? om.file.fsName : '';
                var m = currentFile.match(/\.([A-Za-z0-9]+)$/);
                ext = m ? m[1] : 'mov';
            }
            var suffix = params.filenameSuffix || '';
            var safeName = comp.name.replace(/[\\\/:*?"<>|]/g, '_');
            var outPath = params.outputDir.replace(/[\\\/]+$/, '') + '/' + safeName + suffix + '.' + ext;
            try { om.file = new File(outPath); } catch (e) {}
            results.push({ comp: comp.name, ok: true, queueIndex: app.project.renderQueue.numItems, output: outPath });
        }
        return { count: results.length, items: results };
    });
};

// ===================== project hygiene =====================
handlers.reduce_project = function () {
    return withUndo('AE Portal: reduce_project', function () {
        var unused = [];
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (it instanceof FolderItem) continue;
            var u = safe(function () { return it.usedIn; });
            if (u && u.length === 0) unused.push(it);
        }
        var removed = [];
        // Iterate from top (deletion shifts indices, but we kept refs)
        for (var k = 0; k < unused.length; k++) {
            var name = unused[k].name;
            try { unused[k].remove(); removed.push(name); }
            catch (e) {}
        }
        return { removed: removed, count: removed.length };
    });
};
handlers.consolidate_footage = function () {
    var n = app.project.consolidateFootage();
    return { consolidated: n };
};
handlers.collect_files = function (params) {
    if (!params.targetPath) throw new Error('targetPath required');
    if (!params.path) params.path = params.targetPath;
    var folder = new Folder(params.targetPath);
    if (!folder.exists) folder.create();
    return withUndo('AE Portal: collect_files', function () {
        // AE has no scripting collect-files; fall back to consolidating into project + reporting.
        // We expose the target directory; user can run "Collect Files" via menu.
        // (If you want a true scripted collect, suggest using \`run_jsx\` with custom code.)
        return { note: 'AE has no scripted collect-files API. Use File > Dependencies > Collect Files manually, or call run_jsx with a custom solution.' };
    });
};
handlers.find_missing_footage = function () {
    var missing = [];
    for (var i = 1; i <= app.project.numItems; i++) {
        var it = app.project.item(i);
        if (it instanceof FootageItem && it.footageMissing) {
            missing.push({ id: it.id, name: it.name, file: it.file ? it.file.fsName : null });
        }
    }
    return { count: missing.length, missing: missing };
};

// ===================== undo / redo =====================
handlers.undo = function () { app.executeCommand(16); return { undone: true }; };
handlers.redo = function () { app.executeCommand(17); return { redone: true }; };

// ===================== quick state for live events =====================
handlers.get_quick_state = function () {
    if (!app.project) return { open: false };
    var ac = app.project.activeItem;
    var sel = (ac instanceof CompItem) ? ac.selectedLayers : [];
    var selSig = '';
    var selDetail = [];
    for (var i = 0; i < sel.length; i++) {
        selSig += sel[i].index + ':' + sel[i].name + '|';
        selDetail.push({ index: sel[i].index, name: sel[i].name });
    }
    return {
        open: true,
        projectFile: app.project.file ? app.project.file.fsName : null,
        dirty: app.project.dirty,
        numItems: app.project.numItems,
        activeCompId: (ac instanceof CompItem) ? ac.id : null,
        activeCompName: (ac instanceof CompItem) ? ac.name : null,
        compTime: (ac instanceof CompItem) ? ac.time : null,
        selectionSig: selSig,
        selection: selDetail
    };
};

// ===================== render frame to disk =====================
// Mark: open each comp in the viewer once per AE session. openInViewer switches the
// viewer (and can bring AE to the front), but AE 2026 needs it once before comp.time
// and saveFrameToPng work on a comp that was never viewed. Ids seen here live in
// $.global so a reload_host keeps them; the panel passes forceView on a retry.
function markViewOnce(comp, force) {
    var seen = $.global.__markViewedComps || ($.global.__markViewedComps = {});
    var key = 'c' + comp.id;
    if (!force && seen[key]) return false;
    try { comp.openInViewer(); } catch (_) {}
    seen[key] = true;
    return true;
}
function markViewed(comp) {
    var seen = $.global.__markViewedComps || ($.global.__markViewedComps = {});
    seen['c' + comp.id] = true;
}
handlers.render_frame_to_path = function (params) {
    var comp = resolveComp(params.comp);
    if (!params.path) throw new Error('path required');
    if (typeof comp.saveFrameToPng !== 'function') {
        throw new Error('comp.saveFrameToPng not available (requires AE 22+)');
    }
    // AE 2026: comp must be open in viewer BEFORE reading comp.time AND before saveFrameToPng.
    // Reading comp.time on a never-viewed comp returns NaN. Only the first time (markViewOnce).
    var opened = markViewOnce(comp, params.forceView === true);
    var fps = comp.frameRate;
    var rawTime  = (params.time  != null) ? Number(params.time)  : NaN;
    var rawFrame = (params.frame != null) ? Number(params.frame) : NaN;
    var t;
    if (!isNaN(rawTime))       t = rawTime;
    else if (!isNaN(rawFrame)) t = rawFrame / fps;
    else {
        if (isNaN(comp.time) && !opened) opened = markViewOnce(comp, true);   // viewer was closed since
        t = !isNaN(comp.time) ? comp.time : 0;
    }
    if (isNaN(t) || t < 0)         t = 0;
    if (t > comp.duration)         t = Math.max(0, comp.duration - 1 / fps);
    var f = new File(params.path);
    comp.saveFrameToPng(t, f);
    // saveFrameToPng returns before the PNG is fully flushed; poll until it is.
    // $.sleep blocks AE's single JSX thread, so every ms here is a ms AE is frozen:
    // poll finely at first (returns the instant it's ready, not rounded to 50ms)
    // and cap tighter so a genuinely-stuck render fails fast instead of at 5s.
    // New panel passes waitMs (e.g. 150) so the JSX thread returns fast and the panel
    // finishes the flush/blank/stale check off-thread. Absent waitMs keeps the legacy
    // 2500ms cap so old-server callers are unaffected. Never wait longer than 2500ms.
    var maxWait = (params.waitMs != null) ? Math.min(Number(params.waitMs), 2500) : 2500;
    var waited = 0, step = 5;
    while (waited < maxWait) {
        var probe = new File(params.path);
        if (probe.exists && probe.length > 0) break;
        $.sleep(step);
        waited += step;
        if (step < 40) step += 5;
    }
    var finalProbe = new File(params.path);
    var flushed = finalProbe.exists && finalProbe.length > 0;
    return {
        path: f.fsName, time: t, frame: Math.round(t * comp.frameRate), comp: comp.name,
        bytes: finalProbe.exists ? finalProbe.length : 0,
        waitedMs: waited,
        flushed: flushed,
        openedInViewer: opened,
        compId: comp.id,
        activeCompId: (app.project.activeItem instanceof CompItem) ? app.project.activeItem.id : null
    };
};

// ===================== batch / inspection / timing =====================
function applyPropValue(prop, val, time, comp) {
    if (prop.numKeys > 0) {
        var t = (time != null) ? Number(time) : comp.time;
        prop.setValueAtTime(t, val);
        return { mode: 'keyframe', time: t };
    }
    prop.setValue(val);
    return { mode: 'value' };
}
handlers.set_property_batch = function (params) {
    var targets = params.targets;
    return withUndo('AE Portal: set_property_batch', function () {
        var results = [];
        if (targets && targets.length) {
            for (var i = 0; i < targets.length; i++) {
                var tg = targets[i];
                try {
                    var c = resolveComp(tg.comp);
                    var layer = resolveLayer(c, tg.layer);
                    var prop = resolvePropByPath(layer, tg.prop);
                    var r = applyPropValue(prop, tg.value, tg.time, c);
                    results.push({ ok: true, comp: c.name, layer: layer.name, prop: tg.prop, mode: r.mode });
                } catch (e) {
                    results.push({ ok: false, error: e.toString(), target: tg });
                }
            }
        } else {
            var comp = resolveComp(params.comp);
            var layers = resolveLayers(comp, params.layers || params.layer);
            if (!params.prop) throw new Error('prop required (broadcast form)');
            for (var j = 0; j < layers.length; j++) {
                try {
                    var p = resolvePropByPath(layers[j], params.prop);
                    var rr = applyPropValue(p, params.value, params.time, comp);
                    results.push({ ok: true, comp: comp.name, layer: layers[j].name, prop: params.prop, mode: rr.mode });
                } catch (e2) {
                    results.push({ ok: false, error: e2.toString(), layer: layers[j].name });
                }
            }
        }
        var okCount = 0;
        for (var k = 0; k < results.length; k++) if (results[k].ok) okCount++;
        return { total: results.length, ok: okCount, failed: results.length - okCount, results: results };
    });
};
// 2.2: generic batch — run many JSX-routed portal tools in ONE undo group so the
// whole sequence is a single atomic Cmd+Z. Panel-side tools (render_frame, whisper,
// import_folder, reveal_*, apply_expression_preset, …) aren't in this handlers map,
// so they're rejected per-op; 'batch'/'run_jsx'/'reload_host' are refused to block
// recursion + escape hatches. Transactional semantics WITHOUT app.executeCommand
// (banned — caused data loss): no programmatic auto-undo — the single undo group is
// what makes one Undo revert the whole partial batch. The loop body is fully guarded
// per-op so it never throws, guaranteeing _undoDepth reset + endUndoGroup always run.
handlers.batch = function (params) {
    var operations = params.operations || [];
    if (!(operations instanceof Array)) throw new Error('operations must be an array of {tool, args}');
    var MAX_OPS = 500;
    if (operations.length > MAX_OPS) throw new Error('too many operations: ' + operations.length + ' (max ' + MAX_OPS + ')');
    var stopOnError = params.stopOnError !== false; // default TRUE

    var results = [];
    var appliedCount = 0;
    var failedAt = null;
    var notAttempted = 0;

    // ONE undo group for the whole batch. _undoDepth = 1 makes every inner withUndo
    // pass through (see withUndo) instead of nesting begin/endUndoGroup.
    // Mark: inside the chat's per-answer undo group (_undoDepth already > 0) the batch
    // joins that group instead of opening a nested one.
    var markOuterGroup = _undoDepth > 0;
    var markPrevDepth = _undoDepth;
    if (!markOuterGroup) app.beginUndoGroup('AE Portal: batch (' + operations.length + ' ops)');
    _undoDepth = markPrevDepth + 1;
    for (var i = 0; i < operations.length; i++) {
        var op = operations[i] || {};
        var tool = op.tool;
        var disallowed = (tool === 'batch' || tool === 'run_jsx' || tool === 'reload_host');
        var fn = (tool != null && !disallowed) ? handlers[tool] : null;
        if (!fn) {
            var reason = disallowed ? ('tool not allowed inside batch: ' + tool)
                                    : ('unknown or non-JSX tool: ' + String(tool));
            results.push({ i: i, tool: tool, ok: false, error: reason });
            if (stopOnError) { failedAt = i; break; }
            continue;
        }
        try {
            var r = fn(op.args || {});
            results.push({ i: i, tool: tool, ok: true, result: r });
            appliedCount++;
        } catch (e) {
            results.push({ i: i, tool: tool, ok: false, error: e.toString() });
            if (stopOnError) { failedAt = i; break; }
        }
    }
    // Always restore depth + close the single group (no try...finally; the loop body
    // is fully guarded so nothing above can throw past this point).
    _undoDepth = markPrevDepth;
    if (!markOuterGroup) app.endUndoGroup();

    if (failedAt != null && failedAt >= 0) notAttempted = operations.length - (failedAt + 1);

    var out = {
        count: operations.length,
        appliedCount: appliedCount,
        failedAt: (failedAt != null ? failedAt : -1),
        results: results,
        notAttempted: notAttempted,
        undo: 'single-group'
    };
    if (failedAt != null && failedAt >= 0) {
        out.note = 'batch stopped at op ' + failedAt + '; all applied ops are in ONE undo group — a single Undo (Cmd+Z) reverts the whole partial batch';
    }
    return out;
};
handlers.get_layer_bounds = function (params) {
    var comp = resolveComp(params.comp);
    var layer = resolveLayer(comp, params.layer);
    var t = params.time != null ? Number(params.time) :
            params.frame != null ? Number(params.frame) / comp.frameRate :
            comp.time;
    var r;
    try { r = layer.sourceRectAtTime(t, false); }
    catch (e) { throw new Error('sourceRectAtTime failed for "' + layer.name + '": ' + e.toString()); }
    var tg = layer.property('ADBE Transform Group');
    var out = {
        id: layer.id,
        time: t, frame: Math.round(t * comp.frameRate),
        sourceRect: { left: r.left, top: r.top, width: r.width, height: r.height },
        position: tg.property('ADBE Position').value,
        anchorPoint: tg.property('ADBE Anchor Point').value,
        scale: tg.property('ADBE Scale').value
    };
    try { var c = layerCenter(layer, t); out.compCenter = [c.cx, c.cy]; } catch (_) {}
    if (params.includeExtents && safe(function(){ return typeof layer.sourcePointToComp === 'function'; })) {
        try {
            var corners = [[r.left, r.top], [r.left + r.width, r.top],
                           [r.left + r.width, r.top + r.height], [r.left, r.top + r.height]];
            var pts = [], minx = null, miny = null, maxx = null, maxy = null;
            for (var i = 0; i < corners.length; i++) {
                var cp = layer.sourcePointToComp(corners[i]);
                pts.push(cp);
                if (minx === null || cp[0] < minx) minx = cp[0];
                if (maxx === null || cp[0] > maxx) maxx = cp[0];
                if (miny === null || cp[1] < miny) miny = cp[1];
                if (maxy === null || cp[1] > maxy) maxy = cp[1];
            }
            out.compBounds = { left: minx, top: miny, right: maxx, bottom: maxy, width: maxx - minx, height: maxy - miny };
            out.compCorners = pts;
        } catch (_) {}
    }
    return out;
};
handlers.describe_layer = function (params) {
    var comp = resolveComp(params.comp);
    var layer = resolveLayer(comp, params.layer);
    var fps = comp.frameRate;
    var opts = {
        includeKeyframes: params.includeKeyframes !== false,
        includeEffects: params.includeEffects !== false,
        maxLayers: 500, maxKeyframes: 1000
    };
    var li = baseLayerInfo(layer, null);
    li.stretch = safe(function () { return layer.stretch; });
    li.blendingMode = safe(function () { return String(layer.blendingMode); });
    var tm = trackMatteName(layer.trackMatteType);
    if (tm !== 'NONE') li.trackMatte = tm;
    if (layer.parent) li.parentChain = parentChain(layer);
    if (params.includeTransform !== false) li.transform = captureTransform(layer, fps, opts);
    if (params.includeEffects !== false)   li.effects = captureEffectStack(layer, fps, opts);
    if (params.includeMasks)               li.masks = captureMasks(layer, fps, opts);
    if (params.includeShapeContents)       li.shapeContents = captureShapeContents(layer, fps, opts);
    if (params.includeTextAnimators)       li.textAnimators = captureTextAnimators(layer, fps, opts);
    li.markers = captureMarkers(layer, fps);
    try { var rr = layer.sourceRectAtTime(comp.time, false); li.sourceRect = { left: rr.left, top: rr.top, width: rr.width, height: rr.height }; } catch (_) {}
    return li;
};
handlers.sample_property = function (params) {
    var comp = resolveComp(params.comp);
    var layer = resolveLayer(comp, params.layer);
    var prop = resolvePropByPath(layer, params.prop);
    var fps = comp.frameRate;
    var start = params.startTime != null ? Number(params.startTime) :
                params.startFrame != null ? Number(params.startFrame) / fps : layer.inPoint;
    var end = params.endTime != null ? Number(params.endTime) :
              params.endFrame != null ? Number(params.endFrame) / fps : layer.outPoint;
    if (!(end > start)) { start = 0; end = comp.duration; }
    var step = params.step != null ? Number(params.step) :
               params.frames != null ? (end - start) / Math.max(1, Number(params.frames)) : 1 / fps;
    if (!(step > 0)) step = 1 / fps;
    var MAX = 500;
    var n = Math.floor((end - start) / step) + 1;
    if (n > MAX) { step = (end - start) / (MAX - 1); n = MAX; }
    var series = [];
    for (var i = 0; i < n; i++) {
        var t = start + i * step;
        if (t > end) t = end;
        series.push({ time: t, frame: Math.round(t * fps), value: prop.valueAtTime(t, false) });
    }
    return { prop: params.prop, layer: layer.name, count: series.length, start: start, end: end, step: step, series: series };
};
handlers.markers_to_keyframes = function (params) {
    var comp = resolveComp(params.comp);
    var ms = markerSourceFor(comp, params.markerLayer);
    var times = [];
    for (var k = 1; k <= ms.src.numKeys; k++) times.push(ms.src.keyTime(k));
    if (!times.length) throw new Error('no markers on ' + ms.kind + ' marker source');
    var layers = resolveLayers(comp, params.layers || params.layer);
    var mode = params.mode || 'inout';
    return withUndo('AE Portal: markers_to_keyframes', function () {
        var out = [];
        if (mode === 'inout') {
            for (var li = 0; li < layers.length; li++) {
                if (li >= times.length) break;
                var inT = times[li];
                var outT = (li + 1 < times.length) ? times[li + 1] :
                           (params.lastDuration != null ? inT + Number(params.lastDuration) : comp.duration);
                layers[li].inPoint = inT;
                layers[li].outPoint = outT;
                out.push({ layer: layers[li].name, inPoint: inT, outPoint: outT });
            }
        } else if (mode === 'keyframe') {
            if (!params.prop) throw new Error('mode="keyframe" requires prop');
            for (var lj = 0; lj < layers.length; lj++) {
                var prop = resolvePropByPath(layers[lj], params.prop);
                for (var ti = 0; ti < times.length; ti++) {
                    var v = (params.value !== undefined) ? params.value : prop.valueAtTime(times[ti], false);
                    prop.setValueAtTime(times[ti], v);
                }
                if (params.hold) {
                    for (var ki = 1; ki <= prop.numKeys; ki++) {
                        prop.setInterpolationTypeAtKey(ki, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
                    }
                }
                out.push({ layer: layers[lj].name, prop: params.prop, keysAdded: times.length });
            }
        } else {
            throw new Error('unknown mode: ' + mode + ' (expected inout|keyframe)');
        }
        return { mode: mode, markerCount: times.length, results: out };
    });
};
handlers.audit_fonts = function (params) {
    var comps = [];
    if (params.comp != null) {
        comps.push(resolveComp(params.comp));
    } else {
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (it instanceof CompItem) comps.push(it);
        }
    }
    var usage = {};
    for (var c = 0; c < comps.length; c++) {
        var comp = comps[c];
        for (var L = 1; L <= comp.numLayers; L++) {
            var layer = comp.layer(L);
            if (!(layer instanceof TextLayer)) continue;
            var doc;
            try { doc = layer.property('ADBE Text Properties').property('ADBE Text Document').value; }
            catch (e) { continue; }
            var font = String(doc.font);
            var fo = safe(function () { return doc.fontObject; });
            var postScript = fo ? safe(function () { return fo.postScriptName; }) : null;
            var location = fo ? safe(function () { return String(fo.location); }) : null;
            // Substituted when the resolved PostScript name differs from the requested font.
            var isSub = (postScript && font && postScript !== font) ? true : false;
            if (!usage[font]) usage[font] = { font: font, postScriptName: postScript, location: location, missing: isSub, count: 0, layers: [] };
            usage[font].count++;
            usage[font].layers.push({ comp: comp.name, layer: layer.name });
            if (isSub) usage[font].missing = true;
        }
    }
    var fonts = [], missing = [];
    for (var key in usage) if (usage.hasOwnProperty(key)) { fonts.push(usage[key]); if (usage[key].missing) missing.push(key); }
    return { compCount: comps.length, fontCount: fonts.length, missingFonts: missing, fonts: fonts };
};

// ===================== geometry: mask & shape paths =====================
// THE geometry gap (get_path/set_path/add_mask). A path property's .value is a
// Shape (vertices/inTangents/outTangents arrays + closed). Tangents are RELATIVE
// to their vertex. walkForMatchName / findPropByMatchName / resolvePropByPath are
// in lexical scope (index.jsx). All refs are refetched (never cached across the
// addProperty in add_mask). Loops are bounded by GEOM_MAX_VERTS.
var GEOM_MAX_VERTS = 5000;      // hard cap on any vertex/tangent list
var BEZIER_KAPPA = 0.5522847498; // 4-anchor circle control-handle magnitude factor

// First 'ADBE Vector Shape' under a shape group (depth-first, depth-capped).
function findVectorShapeUnder(group) {
    return walkForMatchName(group, 'ADBE Vector Shape', 0);
}
// Resolve the Path property a get_path/set_path call targets. Returns
// { prop:<shape property>, kind:'mask'|'shape', maskGroup:<mask atom or null> }.
function resolvePathTarget(layer, params) {
    if (params.mask != null) {
        var mp = layer.property('ADBE Mask Parade');
        if (!mp) throw new Error('layer has no masks: ' + layer.name);
        var maskGroup;
        if (typeof params.mask === 'number') {
            if (params.mask < 1 || params.mask > mp.numProperties) throw new Error('mask index out of range: ' + params.mask);
            maskGroup = mp.property(params.mask);
        } else {
            maskGroup = mp.property(String(params.mask));
            if (!maskGroup) throw new Error('mask not found: ' + params.mask);
        }
        var msp = maskGroup.property('ADBE Mask Shape');
        if (!msp) throw new Error('mask has no shape property: ' + params.mask);
        return { prop: msp, kind: 'mask', maskGroup: maskGroup };
    }
    if (params.shapePath != null) {
        var p = resolvePropByPath(layer, String(params.shapePath));
        if (p.matchName !== 'ADBE Vector Shape') {
            var under = findVectorShapeUnder(p);
            if (!under) throw new Error('no path (ADBE Vector Shape) found under shapePath: ' + params.shapePath);
            p = under;
        }
        return { prop: p, kind: 'shape', maskGroup: null };
    }
    if (params.shapeIndex != null) {
        var rv = layer.property('ADBE Root Vectors Group');
        if (!rv) throw new Error('layer has no shape contents (not a shape layer?): ' + layer.name);
        var idx = Number(params.shapeIndex);
        if (idx < 1 || idx > rv.numProperties) throw new Error('shapeIndex out of range: ' + params.shapeIndex);
        var sp = findVectorShapeUnder(rv.property(idx));
        if (!sp) throw new Error('no path (ADBE Vector Shape) under shape group ' + idx);
        return { prop: sp, kind: 'shape', maskGroup: null };
    }
    throw new Error('path target required: pass mask, shapePath, or shapeIndex');
}
function pathTimeFor(comp, params) {
    if (params.time != null)  return Number(params.time);
    if (params.frame != null) return Number(params.frame) / comp.frameRate;
    return null;
}
function zeroTangents(n) {
    var a = [];
    for (var i = 0; i < n; i++) a.push([0, 0]);
    return a;
}
function assertVertList(name, arr, expectLen) {
    if (!(arr instanceof Array)) throw new Error(name + ' must be an array of [x,y] pairs');
    if (arr.length > GEOM_MAX_VERTS) throw new Error(name + ' too long: ' + arr.length + ' (max ' + GEOM_MAX_VERTS + ')');
    if (expectLen != null && arr.length !== expectLen) throw new Error(name + ' length (' + arr.length + ') must match vertices length (' + expectLen + ')');
    for (var i = 0; i < arr.length; i++) {
        var v = arr[i];
        if (!(v instanceof Array) || v.length !== 2) throw new Error(name + '[' + i + '] must be a [x,y] pair');
    }
}
// Build a Shape() from vertices (+ optional tangents/closed). Tangents omitted =>
// zero (straight corners). Validates all lengths BEFORE any AE write.
function buildShape(vertices, inTangents, outTangents, closed) {
    assertVertList('vertices', vertices, null);
    if (vertices.length < 1) throw new Error('vertices must have at least 1 point');
    var inT  = (inTangents  != null) ? inTangents  : zeroTangents(vertices.length);
    var outT = (outTangents != null) ? outTangents : zeroTangents(vertices.length);
    assertVertList('inTangents',  inT,  vertices.length);
    assertVertList('outTangents', outT, vertices.length);
    var shp = new Shape();
    shp.vertices    = vertices;
    shp.inTangents  = inT;
    shp.outTangents = outT;
    shp.closed      = (closed == null) ? true : (closed ? true : false);
    return shp;
}
// Primitive generators. Box is [x, y, w, h] with a top-left origin.
function rectSpec(box) {
    if (!(box instanceof Array) || box.length !== 4) throw new Error('rect must be [x,y,w,h]');
    var x = Number(box[0]), y = Number(box[1]), w = Number(box[2]), h = Number(box[3]);
    return {
        vertices:    [[x, y], [x + w, y], [x + w, y + h], [x, y + h]],
        inTangents:  zeroTangents(4),
        outTangents: zeroTangents(4),
        closed: true
    };
}
function ellipseSpec(box) {
    if (!(box instanceof Array) || box.length !== 4) throw new Error('ellipse must be [x,y,w,h]');
    var x = Number(box[0]), y = Number(box[1]), w = Number(box[2]), h = Number(box[3]);
    var rx = w / 2, ry = h / 2;
    var cx = x + rx, cy = y + ry;
    var kx = rx * BEZIER_KAPPA, ky = ry * BEZIER_KAPPA;
    return {
        // top, right, bottom, left — tangents perpendicular to the radius
        vertices:    [[cx, cy - ry], [cx + rx, cy], [cx, cy + ry], [cx - rx, cy]],
        inTangents:  [[-kx, 0], [0, -ky], [kx, 0], [0, ky]],
        outTangents: [[kx, 0], [0, ky], [-kx, 0], [0, -ky]],
        closed: true
    };
}
function maskModeFor(m) {
    if (m == null) return MaskMode.ADD;
    var s = String(m).toLowerCase();
    if (s === 'add')        return MaskMode.ADD;
    if (s === 'subtract')   return MaskMode.SUBTRACT;
    if (s === 'intersect')  return MaskMode.INTERSECT;
    if (s === 'difference') return MaskMode.DIFFERENCE;
    if (s === 'none')       return MaskMode.NONE;
    throw new Error('unknown mask mode: ' + m + ' (add/subtract/intersect/difference/none)');
}
function maskModeName(mm) {
    if (mm === MaskMode.ADD)        return 'add';
    if (mm === MaskMode.SUBTRACT)   return 'subtract';
    if (mm === MaskMode.INTERSECT)  return 'intersect';
    if (mm === MaskMode.DIFFERENCE) return 'difference';
    if (mm === MaskMode.NONE)       return 'none';
    return String(mm);
}

handlers.get_path = function (params) {
    var comp = resolveComp(params.comp);
    var layer = resolveLayer(comp, params.layer);
    var tgt = resolvePathTarget(layer, params);
    var prop = tgt.prop;
    var t = pathTimeFor(comp, params);
    var shp, sampledAt;
    if (t != null || prop.numKeys > 0) {
        sampledAt = (t != null) ? t : comp.time;
        shp = prop.valueAtTime(sampledAt, false);
    } else {
        sampledAt = null;
        shp = prop.value;
    }
    return {
        kind: tgt.kind,
        vertices:    shp.vertices,
        inTangents:  shp.inTangents,
        outTangents: shp.outTangents,
        closed:      shp.closed,
        numKeys:     prop.numKeys,
        time:  sampledAt,
        frame: (sampledAt != null) ? Math.round(sampledAt * comp.frameRate) : null
    };
};

handlers.set_path = function (params) {
    var comp = resolveComp(params.comp);
    var layer = resolveLayer(comp, params.layer);
    if (params.vertices == null) throw new Error('vertices required');
    var t = pathTimeFor(comp, params);
    return withUndo('AE Portal: set_path', function () {
        var tgt = resolvePathTarget(layer, params);
        var prop = tgt.prop;
        var shape = buildShape(params.vertices, params.inTangents, params.outTangents, params.closed);
        var mode, appliedTime;
        // Respect numKeys per applyPropValue: never setValue on a keyed prop (throws
        // + deletes keys). time/frame given => keyframe there; already keyed => key at
        // current time; otherwise static setValue.
        if (t != null) {
            prop.setValueAtTime(t, shape);
            mode = 'keyframe'; appliedTime = t;
        } else if (prop.numKeys > 0) {
            prop.setValueAtTime(comp.time, shape);
            mode = 'keyframe'; appliedTime = comp.time;
        } else {
            prop.setValue(shape);
            mode = 'value'; appliedTime = null;
        }
        var rb = (mode === 'keyframe') ? prop.valueAtTime(appliedTime, false) : prop.value;
        return {
            kind: tgt.kind,
            mode: mode,
            time: appliedTime,
            frame: (appliedTime != null) ? Math.round(appliedTime * comp.frameRate) : null,
            numKeys: prop.numKeys,
            vertices: rb.vertices,
            closed:   rb.closed
        };
    });
};

handlers.add_mask = function (params) {
    var comp = resolveComp(params.comp);
    var layer = resolveLayer(comp, params.layer);
    return withUndo('AE Portal: add_mask', function () {
        var mp = layer.property('ADBE Mask Parade');
        if (!mp) throw new Error('layer does not support masks: ' + layer.name);
        var mask = mp.addProperty('ADBE Mask Atom');   // new ref — never cache older ones
        if (params.name != null) { try { mask.name = String(params.name); } catch (eN) {} }
        var mm = maskModeFor(params.mode);
        mask.maskMode = mm;
        var spec = null;
        var sh = params.shape;
        if (sh != null) {
            if (sh.vertices != null) {
                spec = { vertices: sh.vertices, inTangents: sh.inTangents, outTangents: sh.outTangents, closed: sh.closed };
            } else if (sh.rect != null) {
                spec = rectSpec(sh.rect);
            } else if (sh.ellipse != null) {
                spec = ellipseSpec(sh.ellipse);
            } else {
                throw new Error('shape must have vertices, rect, or ellipse');
            }
            var shape = buildShape(spec.vertices, spec.inTangents, spec.outTangents, spec.closed);
            mask.property('ADBE Mask Shape').setValue(shape);   // fresh mask => no keys
        }
        if (params.feather != null) {
            var fv = (params.feather instanceof Array) ? params.feather : [Number(params.feather), Number(params.feather)];
            mask.property('ADBE Mask Feather').setValue(fv);
        }
        if (params.expansion != null) mask.property('ADBE Mask Offset').setValue(Number(params.expansion));
        if (params.opacity != null)   mask.property('ADBE Mask Opacity').setValue(Number(params.opacity));
        var closedOut = spec ? ((spec.closed == null) ? true : (spec.closed ? true : false)) : null;
        return { mask: mask.name, index: mask.propertyIndex, mode: maskModeName(mm), closed: closedOut };
    });
};

// ===================== watch mode =====================
// Watch v2 / Stage A — make the diff LOG trustworthy (replay is a later task).
// Runs on view.onSync (fires on EVERY viewer sync), so the whole module lives or
// dies by staying CHEAP. The app.project.revision gate short-circuits every tick
// that did not mutate project data (playback, scrub, selection, solo/shy, view
// changes never bump revision) — so the deep capture below only ever runs ONCE
// per real edit, not per 400ms poll. Every loop is hard-capped anyway to bound
// worst-case per-edit cost on huge comps. Layers are keyed by stable layer.id
// (never index:name), so reorder/rename can't shuffle the diff.
var AEPortalWatch = (function () {
    // -- hard caps (every loop below is bounded by one of these) --
    var MAX_COMP_LAYERS  = 2000;  // id-set scan for add/delete (ids+name only — cheap)
    var MAX_WATCH_LAYERS = 24;    // deep value/meta/path capture per tick
    var MAX_FX           = 30;    // effects scanned per layer
    var MAX_FX_PARAMS    = 80;    // params scanned per effect
    var MAX_KEYS         = 300;   // keyframes captured per property
    var MAX_MASKS        = 48;    // mask paths captured per layer
    var MAX_SHAPE_PATHS  = 48;    // shape-layer paths captured per layer
    var WATCH_MAX_VERTS  = 2000;  // vertices/tangents compared per path
    var SHAPE_WALK_DEPTH = 10;    // shape-tree recursion cap
    var MAX_LOG          = 5000;  // log entries retained (freezes, never shifts — keeps since/total indices stable)
    var PATH_EPS         = 0.001; // path vertex/tangent epsilon
    var VAL_EPS          = 0.0001;// scalar/value epsilon

    // Transform props broadened with Orientation (a real 3D edit); still 8 total.
    var TRANSFORM_MNS = [
        'ADBE Position', 'ADBE Scale', 'ADBE Rotate Z', 'ADBE Opacity',
        'ADBE Anchor Point', 'ADBE Rotate X', 'ADBE Rotate Y', 'ADBE Orientation'
    ];
    var PROP_LABELS = {
        'ADBE Position': 'Position', 'ADBE Scale': 'Scale',
        'ADBE Rotate Z': 'Rotation', 'ADBE Opacity': 'Opacity',
        'ADBE Anchor Point': 'Anchor Point',
        'ADBE Rotate X': 'X Rotation', 'ADBE Rotate Y': 'Y Rotation',
        'ADBE Orientation': 'Orientation'
    };

    var state = { active: false, scope: 'selected', lastRev: -1, lastSnap: null, log: [], full: false };

    function ts() {
        var d = new Date(), h = d.getHours(), m = d.getMinutes(), s = d.getSeconds();
        return (h<10?'0':'')+h+':'+(m<10?'0':'')+m+':'+(s<10?'0':'')+s;
    }
    function clone(v) {
        if (v instanceof Array) { var r=[]; for(var i=0;i<v.length;i++) r.push(v[i]); return r; }
        return v;
    }
    // Flat numeric compare (handles scalars + flat number arrays like Position/Color).
    function eq(a, b) {
        if (a === b) return true;
        if (a instanceof Array && b instanceof Array) {
            if (a.length !== b.length) return false;
            for (var i=0;i<a.length;i++) if (Math.abs(a[i]-b[i]) > VAL_EPS) return false;
            return true;
        }
        return false;
    }
    function numChanged(a, b) {
        if (a == null && b == null) return false;
        if (a == null || b == null) return true;
        return Math.abs(a - b) > 1e-6;
    }
    // KeyframeEase[] -> flat [speed,influence,...] so ease changes diff via eq(). Capped.
    function flatEase(arr) {
        var f = [];
        if (!(arr instanceof Array)) return f;
        var m = arr.length; if (m > 8) m = 8;
        for (var i=0;i<m;i++) { var e = arr[i]; f.push(e ? e.speed : 0); f.push(e ? e.influence : 0); }
        return f;
    }
    // Per-key record carries value + interp (RAW INT: 6612 LINEAR / 6613 BEZIER /
    // 6614 HOLD, never enum ===) + flattened temporal ease, so key_mod (value) and
    // key_ease (interp/ease) are both detectable on a same-count edit.
    function capProp(p) {
        var nk = p.numKeys;
        var out = { n: nk, v: clone(p.value), keys: [] };
        var cap = nk; if (cap > MAX_KEYS) cap = MAX_KEYS;
        for (var k=1;k<=cap;k++) {
            var rec = { t: p.keyTime(k), v: clone(p.keyValue(k)) };
            try { rec.ii = p.keyInInterpolationType(k);  } catch(e1){ rec.ii = 0; }
            try { rec.oi = p.keyOutInterpolationType(k); } catch(e2){ rec.oi = 0; }
            try { rec.ie = flatEase(p.keyInTemporalEase(k));  } catch(e3){ rec.ie = []; }
            try { rec.oe = flatEase(p.keyOutTemporalEase(k)); } catch(e4){ rec.oe = []; }
            out.keys.push(rec);
        }
        return out;
    }
    // Cheap per-layer metadata: parent id / blend / in-out / enabled, plus (text
    // layers only) source text / font / size / animator count. All guarded reads.
    function capMeta(lyr) {
        var m = {};
        m.parent = safe(function(){ return lyr.parent ? lyr.parent.id : 0; }); if (m.parent == null) m.parent = 0;
        m.blend  = safe(function(){ return Number(lyr.blendingMode); });
        m.inPt   = safe(function(){ return lyr.inPoint;  });
        m.outPt  = safe(function(){ return lyr.outPoint; });
        m.en     = safe(function(){ return lyr.enabled ? 1 : 0; });
        m.txt = null; m.font = null; m.size = null; m.anim = 0;
        if (lyr instanceof TextLayer) {
            try {
                var tp  = lyr.property('ADBE Text Properties');
                var doc = tp.property('ADBE Text Document').value;
                m.txt  = String(doc.text);
                m.font = String(doc.font);
                m.size = Number(doc.fontSize);
                var an = tp.property('ADBE Text Animators');
                m.anim = an ? an.numProperties : 0;
            } catch(eT) {}
        }
        return m;
    }
    // Effect stack captured as an ORDERED ARRAY (index-positional) with matchName,
    // so the diff can compare slot-by-slot on (index + matchName) — a rename or
    // reorder no longer misattributes a param change to the wrong effect.
    function capFx(lyr) {
        var arr = [];
        var fxg; try { fxg = lyr.property('ADBE Effect Parade'); } catch(e0){ return arr; }
        if (!fxg) return arr;
        var ec = fxg.numProperties; if (ec > MAX_FX) ec = MAX_FX;
        for (var e=1;e<=ec;e++) {
            var eff; try { eff = fxg.property(e); } catch(e1){ continue; }
            if (!eff) continue;
            var rec = { mn: eff.matchName, name: eff.name, params: {} };
            var pc = eff.numProperties; if (pc > MAX_FX_PARAMS) pc = MAX_FX_PARAMS;
            for (var pp=1;pp<=pc;pp++) {
                try {
                    var prp = eff.property(pp);
                    if (prp.propertyValueType !== PropertyValueType.NO_VALUE &&
                        prp.propertyValueType !== PropertyValueType.CUSTOM_VALUE) {
                        rec.params[prp.name] = clone(prp.value);
                    }
                } catch(ee) {}
            }
            arr.push(rec);
        }
        return arr;
    }
    // Truncate a vertex/tangent list to a comparable, capped copy of [x,y] pairs.
    function capVerts(a) {
        if (!(a instanceof Array)) return [];
        var m = a.length; if (m > WATCH_MAX_VERTS) m = WATCH_MAX_VERTS;
        var out = [];
        for (var i=0;i<m;i++) { var p = a[i]; out.push((p instanceof Array) ? [p[0], p[1]] : p); }
        return out;
    }
    function capShapeVal(prop, target) {
        var shp; try { shp = prop.value; } catch(e){ return null; }
        if (!shp) return null;
        var vc = (shp.vertices instanceof Array) ? shp.vertices.length : 0;
        return { target: target, vc: vc,
                 verts: capVerts(shp.vertices), inT: capVerts(shp.inTangents),
                 outT: capVerts(shp.outTangents), closed: shp.closed ? 1 : 0 };
    }
    // Bounded depth-first collection of every 'ADBE Vector Shape' under a shape group.
    function collectShapePaths(grp, out, depth) {
        if (depth > SHAPE_WALK_DEPTH || out.length >= MAX_SHAPE_PATHS) return;
        var n; try { n = grp.numProperties; } catch(e0){ return; }
        if (n > 400) n = 400;  // breadth cap
        for (var i=1;i<=n;i++) {
            if (out.length >= MAX_SHAPE_PATHS) return;
            var p; try { p = grp.property(i); } catch(e1){ continue; }
            if (!p) continue;
            var mn; try { mn = p.matchName; } catch(e2){ continue; }
            if (mn === 'ADBE Vector Shape') { out.push(p); continue; }
            var np; try { np = p.numProperties; } catch(e3){ np = 0; }
            if (np > 0) collectShapePaths(p, out, depth + 1);
        }
    }
    // Path capture (THE #1 gap): mask paths (ADBE Mask Parade -> ADBE Mask Shape) and
    // shape-layer paths (walk to ADBE Vector Shape). .value samples the current comp
    // time — but the revision gate means we only re-capture on an actual edit, never a
    // scrub, so a point drag registers while a playhead move does not.
    function capPaths(lyr) {
        var out = [];
        try {
            var mp = lyr.property('ADBE Mask Parade');
            if (mp) {
                var mc = mp.numProperties; if (mc > MAX_MASKS) mc = MAX_MASKS;
                for (var i=1;i<=mc;i++) {
                    var mk; try { mk = mp.property(i); } catch(em){ continue; }
                    if (!mk) continue;
                    var msp; try { msp = mk.property('ADBE Mask Shape'); } catch(es){ msp = null; }
                    if (!msp) continue;
                    var rec = capShapeVal(msp, 'mask:' + mk.name);
                    if (rec) out.push(rec);
                }
            }
        } catch(e1){}
        try {
            if (lyr instanceof ShapeLayer) {
                var rv = lyr.property('ADBE Root Vectors Group');
                if (rv) {
                    var paths = [];
                    collectShapePaths(rv, paths, 0);
                    for (var s=0;s<paths.length;s++) {
                        var rec2 = capShapeVal(paths[s], 'shape#' + (s + 1));
                        if (rec2) out.push(rec2);
                    }
                }
            }
        } catch(e2){}
        return out;
    }
    function capLayer(lyr) {
        var out = { name: lyr.name, index: lyr.index, meta: capMeta(lyr), props: {}, fx: [], paths: [] };
        var tg; try { tg = lyr.property('ADBE Transform Group'); } catch(e0){ tg = null; }
        if (tg) {
            for (var i=0;i<TRANSFORM_MNS.length;i++) {
                try { var p = tg.property(TRANSFORM_MNS[i]); if (p) out.props[TRANSFORM_MNS[i]] = capProp(p); } catch(e){}
            }
        }
        out.fx    = capFx(lyr);
        out.paths = capPaths(lyr);
        return out;
    }
    // Snapshot: a CHEAP comp-wide id set (add/delete) plus a DEEP capture scoped to
    // the selected layers (default) or the whole comp when scope==='comp'. Both are
    // hard-capped. Keyed by layer.id throughout; name/index kept only as metadata.
    function capSnap(comp, scope) {
        var snap = { comp: comp.name, compId: comp.id, rev: app.project.revision,
                     ids: {}, idMeta: {}, layers: {} };
        var n = comp.numLayers; if (n > MAX_COMP_LAYERS) n = MAX_COMP_LAYERS;
        for (var i=1;i<=n;i++) {
            var L; try { L = comp.layer(i); } catch(e){ continue; }
            if (!L) continue;
            var id = L.id;
            snap.ids[id] = 1;
            snap.idMeta[id] = { name: L.name, index: L.index };
        }
        if (scope === 'comp') {
            var cap = n; if (cap > MAX_WATCH_LAYERS) cap = MAX_WATCH_LAYERS;
            for (var d=1;d<=cap;d++) {
                var Ld; try { Ld = comp.layer(d); } catch(e){ continue; }
                if (Ld) snap.layers[Ld.id] = capLayer(Ld);
            }
        } else {
            var sel = comp.selectedLayers;
            var sc = sel.length; if (sc > MAX_WATCH_LAYERS) sc = MAX_WATCH_LAYERS;
            for (var s=0;s<sc;s++) snap.layers[sel[s].id] = capLayer(sel[s]);
        }
        return snap;
    }
    function pairsEq(a, b) {
        if (!(a instanceof Array) || !(b instanceof Array)) return a === b;
        if (a.length !== b.length) return false;
        for (var i=0;i<a.length;i++) {
            var pa = a[i], pb = b[i];
            if (pa instanceof Array && pb instanceof Array) {
                if (Math.abs(pa[0]-pb[0]) > PATH_EPS || Math.abs(pa[1]-pb[1]) > PATH_EPS) return false;
            } else if (pa !== pb) return false;
        }
        return true;
    }
    function pathEq(a, b) {
        if (a.vc !== b.vc || a.closed !== b.closed) return false;
        return pairsEq(a.verts, b.verts) && pairsEq(a.inT, b.inT) && pairsEq(a.outT, b.outT);
    }
    function metaDiff(out, t, comp, layerName, oM, nM) {
        if (!oM || !nM) return;
        if (oM.parent !== nM.parent) out.push({ts:t,comp:comp,layer:layerName,prop:'Parent',change:'parent',old:oM.parent,value:nM.parent});
        if (oM.blend  !== nM.blend)  out.push({ts:t,comp:comp,layer:layerName,prop:'Blend Mode',change:'blend',old:oM.blend,value:nM.blend});
        if (numChanged(oM.inPt, nM.inPt))   out.push({ts:t,comp:comp,layer:layerName,prop:'In Point',change:'in_point',old:oM.inPt,value:nM.inPt});
        if (numChanged(oM.outPt, nM.outPt)) out.push({ts:t,comp:comp,layer:layerName,prop:'Out Point',change:'out_point',old:oM.outPt,value:nM.outPt});
        if (oM.en !== nM.en) out.push({ts:t,comp:comp,layer:layerName,prop:'Enabled',change:'enabled',old:oM.en,value:nM.en});
        if (oM.txt !== nM.txt)   out.push({ts:t,comp:comp,layer:layerName,prop:'Source Text',change:'text',old:oM.txt,value:nM.txt});
        if (oM.font !== nM.font) out.push({ts:t,comp:comp,layer:layerName,prop:'Font',change:'font',old:oM.font,value:nM.font});
        if (numChanged(oM.size, nM.size)) out.push({ts:t,comp:comp,layer:layerName,prop:'Font Size',change:'font_size',old:oM.size,value:nM.size});
        if (oM.anim !== nM.anim) out.push({ts:t,comp:comp,layer:layerName,prop:'Text Animators',change:'text_animator',old:oM.anim,value:nM.anim});
    }
    function pathDiff(out, t, comp, layerName, oPaths, nPaths) {
        if (!(nPaths instanceof Array)) return;
        for (var i=0;i<nPaths.length;i++) {
            var np = nPaths[i], op = null;
            if (oPaths instanceof Array) {
                for (var j=0;j<oPaths.length;j++) { if (oPaths[j].target === np.target) { op = oPaths[j]; break; } }
            }
            if (!op) continue;                              // brand-new path target (mask/shape just created)
            if (!pathEq(op, np))
                // Stage-B replay needs the geometry, so thread the captured verts/tangents/closed
                // (plus the resolvable target string) onto the entry. panel-facing prop/change/
                // vertexCount/value are unchanged; verts/inT/outT/closed/target are purely additive.
                out.push({ts:t,comp:comp,layer:layerName,prop:np.target,change:'path_change',
                    target:np.target,vertexCount:np.vc,value:np.vc,
                    verts:np.verts,inT:np.inT,outT:np.outT,closed:np.closed});
        }
    }
    function propDiff(out, t, comp, layerName, oL, nL) {
        for (var mn in nL.props) {
            var nP = nL.props[mn], label = PROP_LABELS[mn] || mn;
            if (!oL.props || !oL.props[mn]) continue;
            var oP = oL.props[mn];
            if (nP.n > oP.n) {
                // key(s) added — report each new time not present before
                for (var ni=0;ni<nP.keys.length;ni++) {
                    var nk = nP.keys[ni], found = false;
                    for (var oi=0;oi<oP.keys.length;oi++) if (Math.abs(oP.keys[oi].t-nk.t)<0.001){found=true;break;}
                    if (!found) out.push({ts:t,comp:comp,layer:layerName,prop:label,mn:mn,change:'key_add',time:nk.t,value:nk.v});
                }
            } else if (nP.n < oP.n) {
                // key(s) deleted — report WHICH times vanished, not just a count
                var removed = [];
                for (var oj=0;oj<oP.keys.length;oj++) {
                    var ok = oP.keys[oj], f2 = false;
                    for (var nj=0;nj<nP.keys.length;nj++) if (Math.abs(nP.keys[nj].t-ok.t)<0.001){f2=true;break;}
                    if (!f2) removed.push(Math.round(ok.t*1000)/1000);
                }
                out.push({ts:t,comp:comp,layer:layerName,prop:label,mn:mn,change:'key_del',count:oP.n-nP.n,times:removed});
            } else if (nP.n === 0 && !eq(nP.v, oP.v)) {
                // static value change
                out.push({ts:t,comp:comp,layer:layerName,prop:label,mn:mn,change:'value',old:oP.v,value:nP.v});
            } else {
                // same count, >=1 key: detect value mods AND ease/interp changes
                for (var ki=0;ki<nP.keys.length;ki++) {
                    var nkv = nP.keys[ki];
                    for (var oki=0;oki<oP.keys.length;oki++) {
                        var okv = oP.keys[oki];
                        if (Math.abs(okv.t-nkv.t)<0.001) {
                            if (!eq(okv.v, nkv.v))
                                out.push({ts:t,comp:comp,layer:layerName,prop:label,mn:mn,change:'key_mod',time:nkv.t,old:okv.v,value:nkv.v});
                            if (okv.ii !== nkv.ii || okv.oi !== nkv.oi || !eq(okv.ie, nkv.ie) || !eq(okv.oe, nkv.oe))
                                out.push({ts:t,comp:comp,layer:layerName,prop:label,mn:mn,change:'key_ease',time:nkv.t,keyIndex:ki+1});
                            break;
                        }
                    }
                }
            }
        }
    }
    function fxDiff(out, t, comp, layerName, oL, nL) {
        if (!(nL.fx instanceof Array) || !(oL.fx instanceof Array)) return;
        for (var fi=0;fi<nL.fx.length;fi++) {
            var nEff = nL.fx[fi], oEff = oL.fx[fi];
            if (!nEff || !oEff) continue;
            if (oEff.mn !== nEff.mn) continue;   // different effect at this slot (rename/reorder) — don't misattribute
            for (var param in nEff.params) {
                if (oEff.params[param] !== undefined && !eq(nEff.params[param], oEff.params[param]))
                    out.push({ts:t,comp:comp,layer:layerName,prop:nEff.name+' › '+param,mn:nEff.mn,
                        change:'value',old:oEff.params[param],value:nEff.params[param]});
            }
        }
    }
    function diff(old, neu) {
        var out = [], t = ts(), comp = neu.comp, compId = neu.compId;
        // 1) comp-wide layer add / delete via cheap id-set diff (ids captured for every
        //    layer; deep capture is scoped, but add/delete is always comp-wide).
        for (var nid in neu.ids) {
            if (!old.ids[nid]) {
                var am = neu.idMeta[nid];
                out.push({ts:t,comp:comp,compId:compId,layer:(am?am.name:('id '+nid)),layerId:Number(nid),prop:'(layer)',
                    change:'layer_add',id:Number(nid),index:(am?am.index:null),value:'added'});
            }
        }
        for (var oid in old.ids) {
            if (!neu.ids[oid]) {
                var dm = old.idMeta[oid];
                out.push({ts:t,comp:comp,compId:compId,layer:(dm?dm.name:('id '+oid)),layerId:Number(oid),prop:'(layer)',
                    change:'layer_del',id:Number(oid),value:'deleted'});
            }
        }
        // 2) deep value / effect / meta / path diff for layers present in BOTH deep sets
        //    (matched by stable id, so reorder/rename never shuffles attribution).
        for (var key in neu.layers) {
            var nL = neu.layers[key], oL = old.layers[key];
            if (!oL) continue;                 // just-selected / just-added — no prior deep snapshot to diff
            var layerName = nL.name;
            var startLen = out.length;
            propDiff(out, t, comp, layerName, oL, nL);
            fxDiff(out,   t, comp, layerName, oL, nL);
            metaDiff(out, t, comp, layerName, oL.meta, nL.meta);
            pathDiff(out, t, comp, layerName, oL.paths, nL.paths);
            // Stage-B replay: stamp stable ids on every entry THIS layer produced, so
            // watch_get_replay can address by {id} (duplicate-name-safe). Existing
            // panel-facing fields are untouched — layerId/compId are purely additive.
            var lid = Number(key);
            for (var si = startLen; si < out.length; si++) {
                out[si].layerId = lid;
                out[si].compId  = compId;
            }
        }
        return out;
    }
    function onSync() {
        if (!state.active) return;
        var rev = app.project.revision;
        if (rev === state.lastRev) return;     // NOISE FILTER: selection/solo/shy/view/scrub never bump revision
        state.lastRev = rev;
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) return;
        var snap = capSnap(comp, state.scope);
        if (state.lastSnap && state.lastSnap.compId === snap.compId) {   // compare by id (comp rename is not an edit)
            var deltas = diff(state.lastSnap, snap);
            for (var i=0;i<deltas.length;i++) {
                if (state.log.length >= MAX_LOG) {
                    if (!state.full) { state.full = true;
                        state.log.push({ts:ts(),comp:snap.comp,layer:'(watch)',prop:'log',change:'log_full',value:MAX_LOG}); }
                    break;
                }
                state.log.push(deltas[i]);
            }
        }
        state.lastSnap = snap;
    }
    function install() {
        try { app.activeViewer.views[0].onSync = onSync; return true; } catch(e){ return false; }
    }
    function uninstall() {
        try { app.activeViewer.views[0].onSync = null; } catch(e){}
    }
    return {
        start: function(p) {
            state.active = true;
            state.scope  = (p && p.scope === 'comp') ? 'comp' : 'selected';
            state.full   = false;
            state.lastRev = app.project.revision;
            var comp = app.project.activeItem;
            state.lastSnap = (comp && comp instanceof CompItem) ? capSnap(comp, state.scope) : null;
            var ok = install();
            return { watching: true, onSync: ok, scope: state.scope };
        },
        stop: function() { state.active = false; uninstall(); return { watching: false }; },
        getLog: function(p) {
            onSync();
            var from = (p && typeof p.since === 'number') ? p.since : 0;
            return { entries: state.log.slice(from), total: state.log.length };
        },
        clear: function() { state.log = []; state.full = false; return { cleared: true }; },
        status: function() { return { active: state.active, entries: state.log.length, rev: state.lastRev, scope: state.scope }; },
        // ---- Stage B: replay ----
        // Convert the current watch log into an ORDERED array of portal tool calls
        // ({tool,args}) that reproduces the recorded edits, ready to feed straight to
        // the `batch` tool. Targets use {id} addressing (duplicate-name-safe) via the
        // layerId/compId stamped on every entry by diff(). Anything that cannot be
        // faithfully reproduced (arbitrary layer creation, key deletes, ease values
        // the log never captured, font/animator changes) goes to `unmapped` with a
        // human note — we never fabricate a call.
        getReplay: function(p) {
            onSync();                                   // flush the latest edits before converting
            var relative = !!(p && p.relative);
            var dedupe   = !(p && p.dedupe === false);  // default TRUE
            var log = state.log;

            // int blendingMode enum -> BlendingMode key NAME (set_layer_blend_mode wants
            // the name, not the enum). Built once per call from the live host enum.
            var blendName = {};
            for (var bk in BlendingMode) {
                try { blendName[String(Number(BlendingMode[bk]))] = bk; } catch (eb) {}
            }
            var FX_SEP = ' › ';                    // 'Effect › Param' separator fxDiff emits

            // dedupe pre-pass: record the LAST log index for each value key (layerId::prop),
            // so a drag's many intermediate value samples collapse to the final value.
            var lastValIdx = {};
            if (dedupe) {
                for (var di = 0; di < log.length; di++) {
                    var de = log[di];
                    if (de && de.change === 'value')
                        lastValIdx[String(de.layerId) + '::' + String(de.prop)] = di;
                }
            }

            var ops = [], unmapped = [], deltas = [];
            function isArr(x) { return x instanceof Array; }
            function compRef(e)  { return (e.compId  != null) ? { id: e.compId }  : e.comp;  }
            function layerRef(e) { return (e.layerId != null) ? { id: e.layerId } : e.layer; }
            function note(e, msg) { unmapped.push({ ts: e.ts, change: e.change, layer: e.layer, prop: e.prop, note: msg }); }

            for (var i = 0; i < log.length; i++) {
                var e = log[i];
                if (!e || !e.change) continue;
                var ch = e.change;

                if (ch === 'log_full') continue;        // control sentinel, nothing to replay

                if (ch === 'value') {
                    if (dedupe && lastValIdx[String(e.layerId) + '::' + String(e.prop)] !== i) continue;
                    var isFx = (typeof e.prop === 'string' && e.prop.indexOf(FX_SEP) !== -1);
                    var propPath;
                    if (isFx) {
                        var sepAt = e.prop.indexOf(FX_SEP);
                        propPath = 'Effects.' + e.prop.substring(0, sepAt) + '.' + e.prop.substring(sepAt + FX_SEP.length);
                    } else {
                        propPath = e.mn || e.prop;      // transform matchName (e.g. 'ADBE Position')
                    }
                    ops.push({ tool: 'set_property', args: { comp: compRef(e), layer: layerRef(e), prop: propPath, value: e.value } });
                    if (relative && !isFx && (e.mn === 'ADBE Position' || e.mn === 'ADBE Anchor Point') &&
                        isArr(e.value) && isArr(e.old) && e.value.length === e.old.length) {
                        var dl = [];
                        for (var dj = 0; dj < e.value.length; dj++) dl.push(e.value[dj] - e.old[dj]);
                        deltas.push({ index: ops.length - 1, layerId: e.layerId, prop: e.prop, old: e.old, value: e.value, delta: dl });
                    }
                    continue;
                }

                if (ch === 'key_add' || ch === 'key_mod') {
                    // key_mod overwrites the value at an existing key time — add_keyframe's
                    // setValueAtTime(time,value) reproduces both faithfully.
                    ops.push({ tool: 'add_keyframe', args: { comp: compRef(e), layer: layerRef(e), prop: (e.mn || e.prop), time: e.time, value: e.value } });
                    continue;
                }

                if (ch === 'key_del') {
                    note(e, 'keyframe(s) deleted at t=' + (isArr(e.times) ? e.times.join(', ') : '?') + ' on ' + e.prop + '; no remove-keyframe portal tool in the replay set — delete these keys manually.');
                    continue;
                }

                if (ch === 'key_ease') {
                    note(e, 'keyframe ease/interp changed at t=' + e.time + ' on ' + e.prop + '; the watch log does not record the ease speed/influence values, so this cannot be reproduced — re-apply easing manually (set_easing).');
                    continue;
                }

                if (ch === 'path_change') {
                    if (!isArr(e.verts)) { note(e, 'path changed on ' + e.prop + ' but no geometry was captured.'); continue; }
                    var tgt = String(e.target != null ? e.target : e.prop);
                    var pArgs = { comp: compRef(e), layer: layerRef(e), vertices: e.verts, inTangents: e.inT, outTangents: e.outT, closed: !!e.closed };
                    if (tgt.substring(0, 5) === 'mask:') {
                        pArgs.mask = tgt.substring(5);
                        ops.push({ tool: 'set_path', args: pArgs });
                    } else if (tgt.substring(0, 6) === 'shape#') {
                        // shape#N is the DFS ordinal of the path among collected shape paths;
                        // for the common single-path shape layer N maps to shapeIndex directly.
                        pArgs.shapeIndex = Number(tgt.substring(6));
                        ops.push({ tool: 'set_path', args: pArgs });
                    } else {
                        note(e, 'path changed on unrecognized target "' + tgt + '".');
                    }
                    continue;
                }

                if (ch === 'layer_del') {
                    ops.push({ tool: 'delete_layer', args: { comp: compRef(e), layer: layerRef(e) } });
                    continue;
                }
                if (ch === 'layer_add') {
                    note(e, 'layer "' + e.layer + '" (id ' + (e.layerId != null ? e.layerId : e.id) + ') was added; layer creation is not reproducible from the watch log — recreate it manually or capture its type.');
                    continue;
                }

                if (ch === 'parent') {
                    ops.push({ tool: 'parent_layers', args: { comp: compRef(e), children: [layerRef(e)], parent: (Number(e.value) ? { id: Number(e.value) } : null) } });
                    continue;
                }
                if (ch === 'blend') {
                    var bn = blendName[String(Number(e.value))];
                    if (bn == null) { note(e, 'blend mode changed to enum ' + e.value + ' but no matching BlendingMode name was found.'); continue; }
                    ops.push({ tool: 'set_layer_blend_mode', args: { comp: compRef(e), layer: layerRef(e), mode: bn } });
                    continue;
                }
                if (ch === 'in_point') {
                    ops.push({ tool: 'set_in_out', args: { comp: compRef(e), layer: layerRef(e), inTime: e.value } });
                    continue;
                }
                if (ch === 'out_point') {
                    ops.push({ tool: 'set_in_out', args: { comp: compRef(e), layer: layerRef(e), outTime: e.value } });
                    continue;
                }
                if (ch === 'enabled') {
                    ops.push({ tool: 'toggle_layer_state', args: { comp: compRef(e), layer: layerRef(e), prop: 'enabled', value: (Number(e.value) ? true : false) } });
                    continue;
                }
                if (ch === 'text') {
                    ops.push({ tool: 'set_text', args: { comp: compRef(e), layer: layerRef(e), text: e.value } });
                    continue;
                }
                if (ch === 'font' || ch === 'font_size' || ch === 'text_animator') {
                    note(e, ch + ' change is outside the replay tool set (set_text covers source text only) — re-apply via set_text_style / add_text_animator manually.');
                    continue;
                }

                note(e, 'no replay mapping for change type "' + ch + '".');
            }

            var out = { operations: ops, count: ops.length, unmapped: unmapped };
            if (relative) out.deltas = deltas;   // operations stay ABSOLUTE; deltas let the caller retarget
            return out;
        }
    };
})();

handlers.watch_start   = function(p) { return AEPortalWatch.start(p); };
handlers.watch_stop    = function()  { return AEPortalWatch.stop(); };
handlers.watch_get_log = function(p) { return AEPortalWatch.getLog(p); };
handlers.watch_clear   = function()  { return AEPortalWatch.clear(); };
handlers.watch_status  = function()  { return AEPortalWatch.status(); };
handlers.watch_get_replay = function(p) { return AEPortalWatch.getReplay(p); };

// ============================================================
// Tier-1B verbs (v0.3.0): add_text_animator, animate_trim_paths, set_shape_style.
// Included inside the MarkHost IIFE, so walkForMatchName / findPropByMatchName /
// applyEasingMode / DEFAULT_INFLUENCE / withUndo / resolveComp / resolveLayer are
// all in lexical scope. Reference-invalidation rule: after ANY addProperty the
// parent's child refs shift, so every add here REFETCHES by matchName before use.
// ============================================================

// --- shared color normalizer (reused across shape tools) ---
// Accepts: hex "#rrggbb" / "rrggbb" / "#rgb", or an array [r,g,b(,a)] that is either
// 0–1 floats or 0–255 ints (auto-detected: any component > 1 ⇒ treat the whole array
// as 0–255). Always returns a 4-element [r,g,b,1] with 0–1 floats (AE Fill/Stroke
// Color streams want [r,g,b,a] 0–1).
function hexToRgba(hex) {
    var h = String(hex);
    if (h.charAt(0) === '#') h = h.substr(1);
    if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    if (h.length !== 6) throw new Error('bad hex color: ' + hex);
    var r = parseInt(h.substr(0, 2), 16);
    var g = parseInt(h.substr(2, 2), 16);
    var b = parseInt(h.substr(4, 2), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) throw new Error('bad hex color: ' + hex);
    return [r / 255, g / 255, b / 255, 1];
}
function normalizeColor(c) {
    if (c == null) return null;
    if (typeof c === 'string') return hexToRgba(c);
    if (c instanceof Array) {
        var over = false, i;
        for (i = 0; i < c.length && i < 4; i++) { if (Number(c[i]) > 1) over = true; }
        var out = [];
        for (i = 0; i < c.length && i < 4; i++) {
            var v = Number(c[i]);
            out.push(over ? v / 255 : v);
        }
        while (out.length < 4) out.push(1);
        return out;
    }
    throw new Error('unsupported color: ' + c);
}
// find an immediate child of a property group by matchName (no add); null if absent.
function findChildByMatch(group, matchName) {
    for (var i = 1; i <= group.numProperties; i++) {
        if (group.property(i).matchName === matchName) return group.property(i);
    }
    return null;
}
// find child by matchName, else add it + REFETCH (refs invalidate after addProperty).
function getOrAddByMatch(group, matchName) {
    var existing = findChildByMatch(group, matchName);
    if (existing) return existing;
    if (group.canAddProperty && !group.canAddProperty(matchName)) return null;
    group.addProperty(matchName);
    return findChildByMatch(group, matchName); // REFETCH — never reuse the pre-add ref
}

// ---------- add_text_animator ----------
// Text Animator + explicit Range Selector in one call. matchName archaeology (from
// project memory): addProperty('ADBE Text Animator') creates an animator with an
// EMPTY selectors collection — scripting does NOT auto-add a Range Selector like the
// UI does, so we add 'ADBE Text Selector' explicitly. Selector ramp is inverted: a
// left-to-right reveal uses a narrow band (Start=0,End=25) and animates Offset from
// -End to 100.
var TEXT_ANIM_PROP_MAP = {
    position: 'ADBE Text Position 3D',
    opacity:  'ADBE Text Opacity',
    scale:    'ADBE Text Scale 3D',
    rotation: 'ADBE Text Rotation',
    tracking: 'ADBE Text Tracking Amount',
    blur:     'ADBE Text Blur'
};
function coerceTextAnimVal(key, val) {
    if (key === 'position') {
        var p = (val instanceof Array) ? val : [val, val];
        return [Number(p[0]), Number(p[1]), p.length > 2 ? Number(p[2]) : 0];
    }
    if (key === 'scale') {
        var s = (val instanceof Array) ? val : [val, val];
        return [Number(s[0]), Number(s[1]), s.length > 2 ? Number(s[2]) : 100];
    }
    if (key === 'blur') {
        var b = (val instanceof Array) ? val : [val, val];
        return [Number(b[0]), Number(b[1])];
    }
    return Number(val); // opacity / rotation / tracking are scalar
}
// basedOn → advanced 'ADBE Text Range Type2' units enum. This advanced sub-prop is
// conditionally HIDDEN by AE (Shape-dependent) → wrapped in try/catch; a hidden prop
// throwing "property or parent property is hidden" is non-fatal (default = characters).
function applyBasedOn(selector, basedOn) {
    var map = { characters: 1, charactersexcludingspaces: 2, words: 3, lines: 4 };
    var enumVal = map[String(basedOn).toLowerCase()];
    if (!enumVal) return false;
    try {
        var adv = selector.property('ADBE Text Range Advanced');
        if (!adv) return false;
        var t2 = adv.property('ADBE Text Range Type2');
        if (!t2) return false;
        t2.setValue(enumVal);
        return true;
    } catch (e) { return false; }
}
handlers.add_text_animator = function (params) {
    var comp = resolveComp(params.comp);
    var layer = resolveLayer(comp, params.layer);
    if (!(layer instanceof TextLayer)) throw new Error('not a text layer: ' + layer.name);
    var props = params.properties || {};
    return withUndo('AE Portal: add_text_animator', function () {
        var textGroup = layer.property('ADBE Text Properties');
        var animators = textGroup.property('ADBE Text Animators');
        // 1) create the animator, then REFETCH it (added last).
        animators.addProperty('ADBE Text Animator');
        var animator = animators.property(animators.numProperties);
        if (params.name) { try { animator.name = String(params.name); } catch (eN) {} }
        // 2) EXPLICIT Range Selector — scripting leaves Selectors empty otherwise.
        var selectors = animator.property('ADBE Text Selectors');
        selectors.addProperty('ADBE Text Selector');
        var selector = selectors.property(selectors.numProperties); // REFETCH
        // 3) range. When a keyframed reveal is requested but no explicit band is given,
        //    default to a narrow band (Start=0, End=25) so the Offset sweep reads.
        var range = params.range || {};
        var revealOn = (params.revealFrom != null && params.revealTo != null);
        var startVal = (range.start != null) ? Number(range.start) : (revealOn ? 0 : null);
        var endVal   = (range.end   != null) ? Number(range.end)   : (revealOn ? 25 : null);
        if (startVal != null) { try { selector.property('ADBE Text Percent Start').setValue(startVal); } catch (e1) {} }
        if (endVal   != null) { try { selector.property('ADBE Text Percent End').setValue(endVal); } catch (e2) {} }
        if (range.offset != null && !revealOn) { try { selector.property('ADBE Text Percent Offset').setValue(Number(range.offset)); } catch (e3) {} }
        // basedOn (units) — advanced/hidden-safe.
        var basedOnApplied = false;
        if (params.basedOn) basedOnApplied = applyBasedOn(selector, params.basedOn);
        // 4) animated properties: iterate the KNOWN map (bounded) not arbitrary input.
        // 'ADBE Text Animator Properties' reports its 103 children as a full addable
        // MENU of NON-settable ghost/template props — find-then-setValue THROWS
        // "Can not 'set value' with this property". The real, animatable instance is
        // the one addProperty(mn) RETURNS (canAddProperty stays true even though
        // numProperties stays 103). So add + setValue on THAT returned ref. This must
        // run AFTER the selector add above (canAddProperty is true then). Verified live
        // on AE 2026. Do NOT use getOrAddByMatch here — its find-first returns the ghost.
        var animProps = animator.property('ADBE Text Animator Properties');
        var added = [];
        for (var key in TEXT_ANIM_PROP_MAP) {
            if (!TEXT_ANIM_PROP_MAP.hasOwnProperty(key)) continue;
            if (props[key] === undefined || props[key] === null) continue;
            var mn = TEXT_ANIM_PROP_MAP[key];
            var ap = null;
            try { if (animProps.canAddProperty(mn)) ap = animProps.addProperty(mn); } catch (eAdd) { ap = null; }
            if (!ap) continue;
            try { ap.setValue(coerceTextAnimVal(key, props[key])); added.push(key); } catch (eP) {}
        }
        // 5) optional keyframed reveal: animate the selector's Offset for a sweep.
        var keyframed = false;
        if (revealOn) {
            var bandEnd = (endVal != null) ? endVal : 25;
            var offsetProp = selector.property('ADBE Text Percent Offset');
            if (offsetProp) {
                offsetProp.setValueAtTime(Number(params.revealFrom), -bandEnd); // inverted ramp start
                offsetProp.setValueAtTime(Number(params.revealTo), 100);
                if (params.ease) { try { applyEasingMode(offsetProp, String(params.ease), DEFAULT_INFLUENCE, 'all'); } catch (eE) {} }
                keyframed = true;
            }
        }
        return {
            animator: animator.name,
            selector: selector.name,
            properties: added,
            keyframed: keyframed,
            basedOn: basedOnApplied ? String(params.basedOn) : null
        };
    });
};

// ---------- animate_trim_paths ----------
// Add + keyframe a Trim Paths modifier on a shape/path layer's Contents.
// 'ADBE Vector Filter - Trim' lives directly under 'ADBE Root Vectors Group'.
handlers.animate_trim_paths = function (params) {
    var comp = resolveComp(params.comp);
    var layer = resolveLayer(comp, params.layer);
    var over = params.over;
    if (!(over instanceof Array) || over.length < 2) throw new Error('over required: [startSec, endSec]');
    var t0 = Number(over[0]), t1 = Number(over[1]);
    var mode = String(params.mode || 'end').toLowerCase();
    var from = (params.from != null) ? Number(params.from) : 0;
    var to   = (params.to   != null) ? Number(params.to)   : 100;
    return withUndo('AE Portal: animate_trim_paths', function () {
        var rv = layer.property('ADBE Root Vectors Group');
        if (!rv) throw new Error('layer has no shape contents (not a shape/path layer?): ' + layer.name);
        var trim = getOrAddByMatch(rv, 'ADBE Vector Filter - Trim'); // find-or-add + REFETCH
        if (!trim) throw new Error('failed to add Trim Paths modifier on ' + layer.name);
        var propMN;
        if (mode === 'start') propMN = 'ADBE Vector Trim Start';
        else if (mode === 'offset') propMN = 'ADBE Vector Trim Offset';
        else propMN = 'ADBE Vector Trim End';
        var tp = trim.property(propMN);
        if (!tp) throw new Error('trim property not found: ' + propMN);
        tp.setValueAtTime(t0, from);
        tp.setValueAtTime(t1, to);
        var eased = false;
        if (params.ease) { try { applyEasingMode(tp, String(params.ease), DEFAULT_INFLUENCE, 'all'); eased = true; } catch (e) {} }
        return { trimProp: tp.name, matchName: propMN, from: from, to: to, over: [t0, t1], eased: eased };
    });
};

// ---------- set_shape_style ----------
// Resolve a shape GROUP ('ADBE Vector Group') under Root Vectors Group, then style
// its Fill/Stroke (found-or-added under the group's 'ADBE Vectors Group' contents).
function resolveShapeGroup(layer, groupParam) {
    var rv = layer.property('ADBE Root Vectors Group');
    if (!rv) throw new Error('layer has no shape contents (not a shape layer?): ' + layer.name);
    var g = null;
    if (groupParam == null || groupParam === '') {
        // first ACTUAL shape group (skip modifiers like Trim Paths at root level).
        for (var i = 1; i <= rv.numProperties; i++) {
            if (rv.property(i).matchName === 'ADBE Vector Group') { g = rv.property(i); break; }
        }
        if (!g) throw new Error('no shape group found in ' + layer.name + ' — add a shape first');
    } else if (typeof groupParam === 'number') {
        if (groupParam < 1 || groupParam > rv.numProperties) throw new Error('group index out of range: ' + groupParam);
        g = rv.property(groupParam);
    } else {
        g = rv.property(String(groupParam));
        if (!g) throw new Error('shape group not found: ' + groupParam);
    }
    var contents = g.property('ADBE Vectors Group');
    if (!contents) throw new Error('shape group has no contents (ADBE Vectors Group): ' + g.name);
    return { group: g, contents: contents };
}
// dash spec: array of numbers [d1,d2,...] or [dash,gap] pairs → {dash,gap} objects.
function normalizeDashPairs(dash) {
    if (!(dash instanceof Array)) dash = [dash];
    var pairs = [];
    for (var i = 0; i < dash.length && i < 20; i++) {
        var d = dash[i];
        if (d instanceof Array) pairs.push({ dash: Number(d[0]), gap: Number(d.length > 1 ? d[1] : d[0]) });
        else pairs.push({ dash: Number(d), gap: Number(d) });
    }
    return pairs;
}
// Apply dashes under the Stroke's 'ADBE Vector Stroke Dashes' group. The per-dash
// child matchNames ('ADBE Vector Stroke Dash 1'/'ADBE Vector Stroke Gap 1', …) are
// not documented by Adobe, so every add goes through getOrAddByMatch
// (canAddProperty-guarded) inside try/catch — an unknown name degrades to
// dashApplied:false instead of throwing. AE supports up to 3 dash/gap pairs.
function applyDashes(stroke, dashSpec) {
    var dashes = stroke.property('ADBE Vector Stroke Dashes');
    if (!dashes) return { dashApplied: false, pairs: 0 };
    var pairs = normalizeDashPairs(dashSpec);
    var applied = 0;
    for (var i = 0; i < pairs.length && i < 3; i++) {
        var n = i + 1;
        try {
            var dp = getOrAddByMatch(dashes, 'ADBE Vector Stroke Dash ' + n);
            if (dp) { dp.setValue(pairs[i].dash); applied++; }
            var gp = getOrAddByMatch(dashes, 'ADBE Vector Stroke Gap ' + n);
            if (gp) gp.setValue(pairs[i].gap);
        } catch (e) {}
    }
    return { dashApplied: applied > 0, pairs: applied };
}
handlers.set_shape_style = function (params) {
    var comp = resolveComp(params.comp);
    var layer = resolveLayer(comp, params.layer);
    return withUndo('AE Portal: set_shape_style', function () {
        var res = resolveShapeGroup(layer, params.group);
        var contents = res.contents;
        var dashInfo = null;
        // FILL
        if (params.fill != null || params.fillOpacity != null) {
            var fill = getOrAddByMatch(contents, 'ADBE Vector Graphic - Fill'); // add + REFETCH
            if (fill) {
                if (params.fill != null) { try { fill.property('ADBE Vector Fill Color').setValue(normalizeColor(params.fill)); } catch (eF) {} }
                if (params.fillOpacity != null) { try { fill.property('ADBE Vector Fill Opacity').setValue(Number(params.fillOpacity)); } catch (eFO) {} }
            }
        }
        // STROKE
        if (params.stroke != null || params.strokeWidth != null || params.strokeOpacity != null || params.dash != null) {
            var stroke = getOrAddByMatch(contents, 'ADBE Vector Graphic - Stroke'); // add + REFETCH
            if (stroke) {
                if (params.stroke != null) { try { stroke.property('ADBE Vector Stroke Color').setValue(normalizeColor(params.stroke)); } catch (eS) {} }
                if (params.strokeWidth != null) { try { stroke.property('ADBE Vector Stroke Width').setValue(Number(params.strokeWidth)); } catch (eSW) {} }
                if (params.strokeOpacity != null) { try { stroke.property('ADBE Vector Stroke Opacity').setValue(Number(params.strokeOpacity)); } catch (eSO) {} }
                if (params.dash != null) dashInfo = applyDashes(stroke, params.dash);
            }
        }
        // read-back (0.7): re-read the resulting fill/stroke so a silent no-op is visible.
        var readFill = null, readStroke = null, readWidth = null;
        var fillP = findChildByMatch(contents, 'ADBE Vector Graphic - Fill');
        if (fillP) { try { readFill = fillP.property('ADBE Vector Fill Color').value; } catch (e) {} }
        var strokeP = findChildByMatch(contents, 'ADBE Vector Graphic - Stroke');
        if (strokeP) {
            try { readStroke = strokeP.property('ADBE Vector Stroke Color').value; } catch (e) {}
            try { readWidth = strokeP.property('ADBE Vector Stroke Width').value; } catch (e) {}
        }
        return { group: res.group.name, fill: readFill, stroke: readStroke, strokeWidth: readWidth, dash: dashInfo };
    });
};

// ============================================================
// Tier-1B verbs (v0.3.0, cont.): fit_box_to_text, add_counter, find_replace_text.
// Still inside the MarkHost IIFE — exprQuote / safe / normalizeColor /
// getOrAddByMatch / findChildByMatch / exprErrorFor / applyEasingMode /
// DEFAULT_INFLUENCE / withUndo / resolveComp / resolveLayer / TextLayer / CompItem
// are all in lexical scope. Reference-invalidation rule still applies: every add
// REFETCHES the child by matchName before use (getOrAddByMatch does this).
// ============================================================

// ---------- fit_box_to_text ----------
// A background rectangle that tracks a text layer's sourceRectAtTime + padding.
// GROUNDED FACT: sourceRectAtTime(t,false) is UNSCALED with non-zero/negative
// left/top (baseline offset). The rect path sits centered on the box layer's origin
// (rect Position [0,0], box anchor [0,0]); the box layer's Transform Position is
// driven to the text's bounds-center in COMP space via the text layer's own
// toComp() — so the box inherits the text's position/anchor/scale/rotation without
// us re-deriving that math. Size = text w/h + padding. Asymmetric padding shifts the
// center by (padR-padL)/2, (padB-padT)/2. 'expression' mode leaves both live; 'bake'
// force-evals the same expressions once, reads the values, then freezes them static.

// number → clean literal for embedding in an expression (avoids 0.30000000004 noise).
function numLit(n) {
    var x = Number(n);
    if (!isFinite(x)) x = 0;
    x = Math.round(x * 10000) / 10000;
    return '' + x;
}
// padding → {l,t,r,b}. Accepts a number (all sides), [x,y], or [l,t,r,b].
function normalizePadding(p) {
    var l = 0, t = 0, r = 0, b = 0;
    if (p == null) return { l: 0, t: 0, r: 0, b: 0 };
    if (typeof p === 'number') { l = Number(p); t = l; r = l; b = l; return { l: l, t: t, r: r, b: b }; }
    if (p instanceof Array) {
        if (p.length === 1) { l = Number(p[0]); t = l; r = l; b = l; }
        else if (p.length === 2) { l = Number(p[0]); r = Number(p[0]); t = Number(p[1]); b = Number(p[1]); }
        else if (p.length === 3) { l = Number(p[0]); t = Number(p[1]); r = Number(p[2]); b = Number(p[1]); }
        else { l = Number(p[0]); t = Number(p[1]); r = Number(p[2]); b = Number(p[3]); }
        return { l: l, t: t, r: r, b: b };
    }
    return { l: 0, t: 0, r: 0, b: 0 };
}
function buildBoxSizeExpr(textName, pad) {
    var L = [];
    L.push('var t = thisComp.layer("' + exprQuote(textName) + '");');
    L.push('var r = t.sourceRectAtTime(time, false);');
    L.push('[r.width + ' + numLit(pad.l + pad.r) + ', r.height + ' + numLit(pad.t + pad.b) + '];');
    return L.join('\n');
}
function buildBoxPosExpr(textName, pad) {
    var L = [];
    L.push('var t = thisComp.layer("' + exprQuote(textName) + '");');
    L.push('var r = t.sourceRectAtTime(time, false);');
    L.push('var cx = r.left + r.width/2 + ' + numLit((pad.r - pad.l) / 2) + ';');
    L.push('var cy = r.top + r.height/2 + ' + numLit((pad.b - pad.t) / 2) + ';');
    L.push('t.toComp([cx, cy]);');
    return L.join('\n');
}
// find (or add) the box's first Vector Group + its contents group. REFETCHES after add.
function ensureBoxContents(shapeLayer) {
    var rv = shapeLayer.property('ADBE Root Vectors Group');
    if (!rv) throw new Error('box layer has no shape contents (not a shape layer?): ' + shapeLayer.name);
    var grp = null;
    for (var i = 1; i <= rv.numProperties; i++) {
        if (rv.property(i).matchName === 'ADBE Vector Group') { grp = rv.property(i); break; }
    }
    if (!grp) {
        rv.addProperty('ADBE Vector Group');
        grp = rv.property(rv.numProperties); // REFETCH — never reuse the pre-add ref
    }
    var contents = grp.property('ADBE Vectors Group');
    if (!contents) throw new Error('shape group missing contents (ADBE Vectors Group)');
    return { group: grp, contents: contents };
}
handlers.fit_box_to_text = function (params) {
    var comp = resolveComp(params.comp);
    var textLayer = resolveLayer(comp, params.textLayer);
    if (!(textLayer instanceof TextLayer)) throw new Error('textLayer is not a text layer: ' + textLayer.name);
    var mode = String(params.mode || 'expression').toLowerCase();
    if (mode !== 'bake') mode = 'expression';
    var pad = normalizePadding(params.padding);
    return withUndo('AE Portal: fit_box_to_text', function () {
        // resolve an existing box to update, else create one placed BEHIND the text.
        var box, created = false;
        if (params.boxLayer != null && params.boxLayer !== '') {
            box = resolveLayer(comp, params.boxLayer);
        } else {
            box = comp.layers.addShape();
            box.name = (params.name != null && String(params.name).length) ? String(params.name) : (textLayer.name + ' BG');
            try { box.moveAfter(textLayer); } catch (eMv) {} // higher index = behind
            // BUG2: moveAfter is a structural change — refetch the layer from the comp
            // root by its (now-updated) index so no pre-move ref is carried forward.
            try { box = comp.layer(box.index); } catch (eRf) {}
            created = true;
        }
        // BUG2 ("Object is invalid"): every addProperty invalidates sibling refs under
        // the same group, so do ALL structural adds FIRST (Vector Group, then rect, then
        // fill), and only AFTER the last add refetch fresh group + leaf refs from the box
        // root. Never read/mutate a leaf ref captured before a later add.
        var seed = ensureBoxContents(box).contents;             // finds-or-adds the Vector Group
        getOrAddByMatch(seed, 'ADBE Vector Shape - Rect');       // structural add
        getOrAddByMatch(seed, 'ADBE Vector Graphic - Fill');     // structural add (invalidates rect)
        var contents = ensureBoxContents(box).contents;          // REFETCH group after the adds
        var rect = findChildByMatch(contents, 'ADBE Vector Shape - Rect');
        if (!rect) throw new Error('failed to add rectangle path on box layer');
        var fill = findChildByMatch(contents, 'ADBE Vector Graphic - Fill'); // may be null
        // no more structural changes past this point — setValue/expression are safe on
        // these fresh refs. box origin = anchor [0,0] so a rect centered at [0,0] lands
        // on Position.
        try { box.property('ADBE Transform Group').property('ADBE Anchor Point').setValue([0, 0]); } catch (eA) {}
        try { rect.property('ADBE Vector Rect Position').setValue([0, 0]); } catch (eRP) {}
        if (params.corner != null) { try { rect.property('ADBE Vector Rect Roundness').setValue(Number(params.corner)); } catch (eRR) {} }
        if (fill) {
            var col = (params.color != null) ? normalizeColor(params.color) : [0, 0, 0, 1];
            try { fill.property('ADBE Vector Fill Color').setValue(col); } catch (eFC) {}
            if (params.opacity != null) { try { fill.property('ADBE Vector Fill Opacity').setValue(Number(params.opacity)); } catch (eFO) {} }
        }
        var sizeProp = rect.property('ADBE Vector Rect Size');
        var posProp  = box.property('ADBE Transform Group').property('ADBE Position');
        var sizeExpr = buildBoxSizeExpr(textLayer.name, pad);
        var posExpr  = buildBoxPosExpr(textLayer.name, pad);
        var expressionError = '';
        if (mode === 'bake') {
            // set the same expressions, force-eval, read the values, then freeze static.
            sizeProp.expression = sizeExpr; sizeProp.expressionEnabled = true;
            posProp.expression  = posExpr;  posProp.expressionEnabled  = true;
            var eP = exprErrorFor(posProp, comp.time);
            var eS = exprErrorFor(sizeProp, comp.time);
            expressionError = eP || eS || '';
            var sizeVal = safe(function () { return sizeProp.valueAtTime(comp.time, false); });
            var posVal  = safe(function () { return posProp.valueAtTime(comp.time, false); });
            sizeProp.expression = ''; sizeProp.expressionEnabled = false;
            posProp.expression  = ''; posProp.expressionEnabled  = false;
            if (sizeVal != null) { try { sizeProp.setValue(sizeVal); } catch (eSz) {} }
            if (posVal  != null) { try { posProp.setValue(posVal); } catch (ePs) {} }
        } else {
            sizeProp.expression = sizeExpr; sizeProp.expressionEnabled = true;
            posProp.expression  = posExpr;  posProp.expressionEnabled  = true;
            var pe = exprErrorFor(posProp, comp.time);
            var se = exprErrorFor(sizeProp, comp.time);
            expressionError = pe || se || '';
        }
        return {
            boxLayer: box.name,
            boxIndex: box.index,
            created: created,
            mode: mode,
            padding: [pad.l, pad.t, pad.r, pad.b],
            sizeExpression: sizeExpr,
            positionExpression: posExpr,
            expressionError: expressionError
        };
    });
};

// ---------- add_counter ----------
// A number counter: a Slider control keyframed from→to, read + formatted by a
// source-text expression. GROUNDED FACT: .toFixed() is banned in the Legacy
// expression engine and there is no toLocaleString, so the expression rounds with
// Math.round(v*10^d) and assembles the integer/fraction/thousands-separator strings
// by hand (see buildCounterExpr). The slider value stream's live display name is read
// off the created effect (falls back to "Slider") so the accessor can't drift.
function buildCounterExpr(effName, valDisplay, from, to, decimals, thousands, sepChar, prefix, suffix) {
    var L = [];
    // BUG1: AE's Slider Control hard-caps values at ±1,000,000, so the slider cannot
    // hold large counter targets. The slider is a 0→100 PROGRESS driver instead, and
    // from/to are baked into the expression: v = from + (to - from) * (p/100).
    L.push('var p = effect("' + exprQuote(effName) + '")("' + exprQuote(valDisplay) + '");');
    L.push('var v = ' + numLit(from) + ' + (' + numLit(to) + ' - ' + numLit(from) + ') * (p/100);');
    L.push('var dec = ' + decimals + ';');
    L.push('var neg = v < 0;');
    L.push('var a = Math.abs(v);');
    L.push('var f = Math.pow(10, dec);');
    L.push('var r = Math.round(a * f);');
    L.push('var ip = Math.floor(r / f);');
    L.push('var fp = Math.round(r - ip * f);');
    L.push('var s = "" + ip;');
    if (thousands) {
        L.push('var out = "";');
        L.push('var cc = 0;');
        L.push('var i;');
        L.push('for (i = s.length - 1; i >= 0; i--) {');
        L.push('  out = s.charAt(i) + out;');
        L.push('  cc = cc + 1;');
        L.push('  if (cc % 3 === 0 && i > 0) { out = "' + exprQuote(sepChar) + '" + out; }');
        L.push('}');
        L.push('s = out;');
    }
    L.push('if (dec > 0) {');
    L.push('  var fs = "" + fp;');
    L.push('  while (fs.length < dec) { fs = "0" + fs; }');
    L.push('  s = s + "." + fs;');
    L.push('}');
    L.push('(neg ? "-" : "") + "' + exprQuote(prefix) + '" + s + "' + exprQuote(suffix) + '";');
    return L.join('\n');
}
handlers.add_counter = function (params) {
    var comp = resolveComp(params.comp);
    var decimals = (params.decimals != null) ? Math.round(Number(params.decimals)) : 0;
    if (decimals < 0) decimals = 0;
    if (decimals > 12) decimals = 12;
    var thousands = (params.thousands === true);
    var sepChar = (params.separator != null) ? String(params.separator) : ',';
    var prefix  = (params.prefix != null) ? String(params.prefix) : '';
    var suffix  = (params.suffix != null) ? String(params.suffix) : '';
    var over = params.over;
    if (!(over instanceof Array) || over.length < 2) throw new Error('over required: [startSec, endSec]');
    var t0 = Number(over[0]), t1 = Number(over[1]);
    var from = (params.from != null) ? Number(params.from) : 0;
    var to   = (params.to   != null) ? Number(params.to)   : 100;
    var sliderName = (params.sliderName != null && String(params.sliderName).length) ? String(params.sliderName) : 'Counter';
    return withUndo('AE Portal: add_counter', function () {
        var layer, created = false;
        if (params.create === true) {
            layer = comp.layers.addText('');
            if (params.name != null && String(params.name).length) { try { layer.name = String(params.name); } catch (eN) {} }
            if (params.fontSize) {
                try {
                    var dp = layer.property('ADBE Text Properties').property('ADBE Text Document');
                    var d = dp.value; d.fontSize = Number(params.fontSize); dp.setValue(d);
                } catch (eFS) {}
            }
            if (params.position) {
                try { layer.property('ADBE Transform Group').property('ADBE Position').setValue(params.position); } catch (ePos) {}
            }
            created = true;
        } else {
            layer = resolveLayer(comp, params.layer);
            if (!(layer instanceof TextLayer)) throw new Error('target layer is not a text layer: ' + layer.name + ' (pass create:true to make one)');
        }
        // Slider control (fresh ref from addProperty — never a cached one).
        var parade = layer.property('ADBE Effect Parade');
        if (!parade) throw new Error('layer has no Effect Parade: ' + layer.name);
        var fx = parade.addProperty('ADBE Slider Control');
        try { fx.name = sliderName; } catch (eSN) {}
        var effName = fx.name;
        var valStream = fx.property('ADBE Slider Control-0001');
        if (!valStream) valStream = safe(function () { return fx.property(1); });
        if (!valStream) throw new Error('could not resolve slider value stream');
        var valDisplay = (valStream.name != null && String(valStream.name).length) ? valStream.name : 'Slider';
        // keyframe the slider as 0→100 PROGRESS (BUG1: the Slider hard-caps at ±1e6, so
        // it can't hold large targets — from/to are baked into the expression instead).
        valStream.setValueAtTime(t0, 0);
        valStream.setValueAtTime(t1, 100);
        var eased = false;
        if (params.ease) { try { applyEasingMode(valStream, String(params.ease), DEFAULT_INFLUENCE, 'all'); eased = true; } catch (eE) {} }
        // source-text formatting expression (from/to baked in as a progress remap).
        var expr = buildCounterExpr(effName, valDisplay, from, to, decimals, thousands, sepChar, prefix, suffix);
        var srcText = layer.property('ADBE Text Properties').property('ADBE Text Document');
        srcText.expression = expr;
        srcText.expressionEnabled = true;
        var exErr = exprErrorFor(srcText, comp.time);
        return {
            layer: layer.name,
            created: created,
            slider: effName,
            sliderProgress: [0, 100],
            from: from,
            to: to,
            over: [t0, t1],
            eased: eased,
            decimals: decimals,
            thousands: thousands,
            expression: expr,
            expressionError: exErr,
            enabled: !exErr
        };
    });
};

// ---------- find_replace_text ----------
// Project- or comp-scoped text find/replace across TextLayers. dryRun defaults TRUE.
// GROUNDED FACT: setValue on a keyframed property THROWS + deletes keys, so keyframed
// source-text layers are reported but skipped. Replacement obtains a COPY of the doc
// via sourceText.value, sets .text on it, then setValue(doc) — preserving other doc
// props (uniform styling; per-run CharacterRange styling can flatten, noted). ES3 has
// no \b, so wholeWord uses a manual word-char boundary test. All loops capped.
function isWordChar(ch) {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch === '_';
}
// return the start indices (in the ORIGINAL hay) of non-overlapping matches.
function scanTextMatches(hay, needle, matchCase, wholeWord) {
    var res = [];
    if (needle.length === 0) return res;
    var H = matchCase ? hay : String(hay).toLowerCase();
    var N = matchCase ? needle : String(needle).toLowerCase();
    var from = 0, guard = 0, CAP = 100000;
    while (guard < CAP) {
        guard++;
        var idx = H.indexOf(N, from);
        if (idx < 0) break;
        var okMatch = true;
        if (wholeWord) {
            var beforeCh = (idx > 0) ? hay.charAt(idx - 1) : '';
            var afterCh  = (idx + N.length < hay.length) ? hay.charAt(idx + N.length) : '';
            if (beforeCh !== '' && isWordChar(beforeCh)) okMatch = false;
            if (afterCh  !== '' && isWordChar(afterCh))  okMatch = false;
        }
        if (okMatch) res.push(idx);
        from = idx + N.length; // non-overlapping
    }
    return res;
}
function replaceTextMatches(hay, idxs, needleLen, replace) {
    if (!idxs.length) return hay;
    var out = [];
    var prev = 0;
    for (var i = 0; i < idxs.length; i++) {
        out.push(hay.substring(prev, idxs[i]));
        out.push(replace);
        prev = idxs[i] + needleLen;
    }
    out.push(hay.substring(prev));
    return out.join('');
}
handlers.find_replace_text = function (params) {
    var find = (params.find != null) ? String(params.find) : '';
    if (find.length === 0) throw new Error('find (non-empty string) required');
    var replace = (params.replace != null) ? String(params.replace) : '';
    var matchCase = (params.matchCase === true);
    var wholeWord = (params.wholeWord === true);
    var dryRun = (params.dryRun === false) ? false : true; // default TRUE
    // gather target comps by ID internally (dup-name hazard), report by name.
    var comps = [];
    if (params.comp != null && params.comp !== '') {
        comps.push(resolveComp(params.comp));
    } else {
        var CAP_ITEMS = 100000;
        var nItems = app.project.numItems;
        if (nItems > CAP_ITEMS) nItems = CAP_ITEMS;
        for (var i = 1; i <= nItems; i++) {
            var it = app.project.item(i);
            if (it instanceof CompItem) comps.push(it);
        }
    }
    function run() {
        var matches = [];
        var replaced = 0;
        var CAP_COMPS = 5000, CAP_LAYERS = 20000;
        var nC = (comps.length < CAP_COMPS) ? comps.length : CAP_COMPS;
        for (var c = 0; c < nC; c++) {
            var comp = comps[c];
            var nL = comp.numLayers;
            if (nL > CAP_LAYERS) nL = CAP_LAYERS;
            for (var L = 1; L <= nL; L++) {
                var layer = comp.layer(L);
                if (!(layer instanceof TextLayer)) continue;
                var st = layer.property('ADBE Text Properties').property('ADBE Text Document');
                if (!st) continue;
                var doc, before;
                try { doc = st.value; before = String(doc.text); } catch (eRead) { continue; }
                var idxs = scanTextMatches(before, find, matchCase, wholeWord);
                if (!idxs.length) continue;
                var after = replaceTextMatches(before, idxs, find.length, replace);
                var rec = { comp: comp.name, layer: layer.name, before: before, after: after, count: idxs.length };
                if (!dryRun) {
                    var keyed = false;
                    try { keyed = st.numKeys > 0; } catch (eK) {}
                    if (keyed) {
                        rec.skipped = 'keyframed sourceText (setValue would delete keys)';
                    } else {
                        try {
                            doc.text = after;      // mutate the COPY obtained via st.value
                            st.setValue(doc);      // other doc props preserved
                            replaced++;
                        } catch (eSet) { rec.error = String(eSet); }
                    }
                }
                matches.push(rec);
            }
        }
        return { scanned: comps.length, matches: matches, replaced: replaced, dryRun: dryRun };
    }
    if (dryRun) return run();
    return withUndo('AE Portal: find_replace_text', run);
};

// ===================== effect stack ops + expression-safe rename (Wave 4) =====================

// Faithful keyframe copy between two arbitrary properties. Mirrors the copy_keyframes
// handler's capture+replay (time/value/raw-int interp/temporal ease sized to the dest's
// real dimension/spatial tangents+auto-bezier) but as a reusable helper so copy_effects
// can rebuild an effect param's animation. Source is never mutated; the dest is captured
// implicitly by re-reading nearestKeyIndex after pass 1 creates the keys. Returns the
// number of keys copied.
function copyKeyframesFaithful(srcProp, destProp) {
    var n = safe(function () { return srcProp.numKeys; }) || 0;
    if (n === 0) return 0;
    var spatial = safe(function () { return srcProp.isSpatial === true; }) === true;
    var data = [];
    for (var k = 1; k <= n; k++) {
        data.push({
            time:  srcProp.keyTime(k),
            value: srcProp.keyValue(k),
            inI:   srcProp.keyInInterpolationType(k),   // RAW INT (6612 LINEAR / 6613 BEZIER / 6614 HOLD)
            outI:  srcProp.keyOutInterpolationType(k),
            inE:   srcProp.keyInTemporalEase(k),
            outE:  srcProp.keyOutTemporalEase(k),
            inTan:  spatial ? safe(function () { return srcProp.keyInSpatialTangent(k);  }) : null,
            outTan: spatial ? safe(function () { return srcProp.keyOutSpatialTangent(k); }) : null,
            sAuto:  spatial ? safe(function () { return srcProp.keySpatialAutoBezier(k); }) : null,
            sCont:  spatial ? safe(function () { return srcProp.keySpatialContinuous(k); }) : null,
            tAuto:  safe(function () { return srcProp.keyTemporalAutoBezier(k); })
        });
    }
    var dDim = dimOf(safe(function () { return destProp.value; }));
    var destSpatial = safe(function () { return destProp.isSpatial === true; }) === true;
    // Pass 1 — create every key at its time with the source value.
    for (var a = 0; a < data.length; a++) {
        try { destProp.setValueAtTime(data[a].time, data[a].value); } catch (eA) {}
    }
    var easeLen = dDim;
    try { easeLen = destProp.keyInTemporalEase(1).length; } catch (eLen) { easeLen = dDim; }
    // Pass 2 — restore interp (raw ints), temporal ease (length-fitted), spatial data.
    for (var j = 0; j < data.length; j++) {
        var d = data[j];
        var idx = destProp.nearestKeyIndex(d.time);
        try { destProp.setInterpolationTypeAtKey(idx, d.inI, d.outI); } catch (e1) {}
        try { destProp.setTemporalEaseAtKey(idx, fitEaseArray(d.inE, easeLen), fitEaseArray(d.outE, easeLen)); } catch (e2) {}
        if (destSpatial && d.inTan && d.outTan) {
            try { destProp.setSpatialTangentsAtKey(idx, d.inTan, d.outTan); } catch (e3) {}
            try { if (d.sAuto != null) destProp.setSpatialAutoBezierAtKey(idx, d.sAuto); } catch (e4) {}
            try { if (d.sCont != null) destProp.setSpatialContinuousAtKey(idx, d.sCont); } catch (e5) {}
        }
        try { if (d.tAuto != null) destProp.setTemporalAutoBezierAtKey(idx, d.tAuto); } catch (e6) {}
    }
    return data.length;
}

// Copy a single leaf effect parameter (value + keyframes + expression) from src to dest.
// CUSTOM_VALUE / TEXT_DOCUMENT / MARKER params carry ARB or non-numeric data that
// ExtendScript cannot read/write (e.g. Curves' curve, a Colorama gradient) — those are
// skipped and recorded in skippedMap keyed by "Effect > Param". NO_VALUE leaves (topic
// headers) have nothing to copy and are silently skipped.
function copyLeafParam(sp, dp, skippedMap, effLabel) {
    var vt = safe(function () { return sp.propertyValueType; });
    if (vt === PropertyValueType.CUSTOM_VALUE ||
        vt === PropertyValueType.TEXT_DOCUMENT ||
        vt === PropertyValueType.MARKER) {
        var nm = safe(function () { return sp.name; }) || '?';
        skippedMap[effLabel + ' > ' + nm] = true;
        return;
    }
    if (vt === PropertyValueType.NO_VALUE || vt == null) return;
    // Keyframes first (they also set the values at those times); else one static value.
    var nk = safe(function () { return sp.numKeys; }) || 0;
    if (nk > 0) {
        copyKeyframesFaithful(sp, dp);
    } else {
        var v = safe(function () { return sp.value; });
        var dNk = safe(function () { return dp.numKeys; }) || 0;
        if (v !== null && dNk === 0) {
            try { dp.setValue(v); } catch (eV) {}
        }
    }
    // A param can carry BOTH keyframes and an expression — copy the expression last.
    var expr = safe(function () { return String(sp.expression || ''); });
    if (expr && expr.length) {
        var canExpr = safe(function () { return dp.canSetExpression; }) === true;
        if (canExpr) {
            try {
                dp.expression = expr;
                dp.expressionEnabled = safe(function () { return sp.expressionEnabled; }) !== false;
            } catch (eX) {}
        }
    }
}

// Walk a source effect group and its freshly-added dest twin in PARALLEL by index. Adding
// the effect by matchName reproduces the identical child structure, so index i on the
// source maps to index i on the dest — no matchName lookups, and nested param groups
// (e.g. compound-effect subgroups) recurse the same way. Depth/breadth capped.
function copyEffectParams(srcGrp, dstGrp, skippedMap, effLabel, depth) {
    if (depth > 16) return;
    var sn = safe(function () { return srcGrp.numProperties; }) || 0;
    var dn = safe(function () { return dstGrp.numProperties; }) || 0;
    var n = (sn < dn) ? sn : dn;
    var CAP = 2000;
    if (n > CAP) n = CAP;
    for (var i = 1; i <= n; i++) {
        var sp = safe(function () { return srcGrp.property(i); });
        var dp = safe(function () { return dstGrp.property(i); });
        if (!sp || !dp) continue;
        var pt = safe(function () { return sp.propertyType; });
        if (pt === PropertyType.PROPERTY) {
            copyLeafParam(sp, dp, skippedMap, effLabel);
        } else {
            copyEffectParams(sp, dp, skippedMap, effLabel, depth + 1);
        }
    }
}

// Resolve an effect reference (name or 1-based index, matchName also accepted) to its
// 1-based index in the Effect Parade, or -1. First match wins for a name.
function findEffectIndex(par, ref) {
    var n = safe(function () { return par.numProperties; }) || 0;
    if (typeof ref === 'number' || /^\d+$/.test(String(ref))) {
        var ix = Number(ref);
        if (ix >= 1 && ix <= n) return ix;
        return -1;
    }
    var want = String(ref).toLowerCase();
    for (var i = 1; i <= n; i++) {
        var e = par.property(i);
        if (e && String(e.name).toLowerCase() === want) return i;
    }
    for (var j = 1; j <= n; j++) {
        var e2 = par.property(j);
        if (e2 && String(e2.matchName).toLowerCase() === want) return j;
    }
    return -1;
}

handlers.copy_effects = function (params) {
    var srcComp = resolveComp(params.comp);
    var src = params.source || {};
    if (src.layer == null) throw new Error('source {layer} required');
    var srcLayer = resolveLayer(srcComp, src.layer);
    if (params.dest == null) throw new Error('dest (layer name/index or array) required');
    var destComp = (params.destComp != null && params.destComp !== '') ? resolveComp(params.destComp) : srcComp;
    var destLayers = resolveLayers(destComp, params.dest);

    var srcPar0 = srcLayer.property('ADBE Effect Parade');
    if (!srcPar0) throw new Error('source layer has no effects: ' + srcLayer.name);
    var srcCount = srcPar0.numProperties;
    if (srcCount === 0) throw new Error('source layer "' + srcLayer.name + '" has no effects to copy');

    // Snapshot the source effect descriptors up front. We hold NO property refs across the
    // dest addProperty calls — the source effect is refetched by its stable index each time
    // (addProperty appends to the end, so existing source indices never shift).
    var srcEffects = [];
    for (var si = 1; si <= srcCount; si++) {
        var ef = srcPar0.property(si);
        srcEffects.push({ index: si, matchName: ef.matchName, name: ef.name });
    }

    // Which source effects to copy (default ALL, in source order).
    var wanted = [];
    var notFound = [];
    if (params.effects == null) {
        wanted = srcEffects;
    } else {
        var reqs = (params.effects instanceof Array) ? params.effects : [params.effects];
        var RCAP = 500;
        var rlim = reqs.length < RCAP ? reqs.length : RCAP;
        for (var r = 0; r < rlim; r++) {
            var req = reqs[r];
            var hit = null;
            if (typeof req === 'number' || /^\d+$/.test(String(req))) {
                var ri = Number(req);
                for (var a1 = 0; a1 < srcEffects.length; a1++) {
                    if (srcEffects[a1].index === ri) { hit = srcEffects[a1]; break; }
                }
            } else {
                var rn = String(req).toLowerCase();
                for (var a2 = 0; a2 < srcEffects.length; a2++) {
                    if (String(srcEffects[a2].name).toLowerCase() === rn ||
                        String(srcEffects[a2].matchName).toLowerCase() === rn) { hit = srcEffects[a2]; break; }
                }
            }
            if (hit) wanted.push(hit);
            else notFound.push(String(req));
        }
    }
    if (wanted.length === 0) throw new Error('no matching source effects to copy' + (notFound.length ? ' (not found: ' + notFound.join(', ') + ')' : ''));

    return withUndo('AE Portal: copy_effects', function () {
        var skippedMap = {};
        var copiedTo = [];
        var effectsCopied = 0;
        var DCAP = 200;
        var dlim = destLayers.length < DCAP ? destLayers.length : DCAP;
        for (var dIx = 0; dIx < dlim; dIx++) {
            var destLayer = destLayers[dIx];
            var selfTarget = (destComp.id === srcComp.id && destLayer.index === srcLayer.index);
            if (params.clearExisting === true) {
                if (selfTarget) throw new Error('clearExisting would delete the source effects (source and dest are the same layer): ' + destLayer.name);
                var dPar0 = destLayer.property('ADBE Effect Parade');
                for (var cRm = dPar0.numProperties; cRm >= 1; cRm--) {   // BOUNDED reverse loop
                    var rmEf = dPar0.property(cRm);
                    if (rmEf) rmEf.remove();
                }
            }
            var addedNames = [];
            var failed = [];
            var wlim = wanted.length < 1000 ? wanted.length : 1000;
            for (var w = 0; w < wlim; w++) {
                var want = wanted[w];
                var dPar = destLayer.property('ADBE Effect Parade');   // REFETCH (prior addProperty invalidated refs)
                var newEf = null;
                try { newEf = dPar.addProperty(want.matchName); } catch (eAdd) {
                    failed.push({ effect: want.name, matchName: want.matchName, error: String(eAdd) });
                    continue;
                }
                if (!newEf) { failed.push({ effect: want.name, matchName: want.matchName, error: 'addProperty returned nothing (unknown/unavailable effect)' }); continue; }
                var srcParNow = srcLayer.property('ADBE Effect Parade');  // REFETCH source group too
                var srcEf = srcParNow.property(want.index);
                var effLabel = srcEf.name;
                try { if (String(srcEf.name) !== String(newEf.name)) newEf.name = srcEf.name; } catch (eN) {}
                try { newEf.enabled = srcEf.enabled; } catch (eE) {}
                copyEffectParams(srcEf, newEf, skippedMap, effLabel, 0);
                addedNames.push(newEf.name);
                effectsCopied++;
            }
            var rec = { layer: destLayer.name, index: destLayer.index, effects: addedNames };
            if (failed.length) rec.failed = failed;
            copiedTo.push(rec);
        }
        var skippedParams = [];
        for (var key in skippedMap) { if (skippedMap.hasOwnProperty(key)) skippedParams.push(key); }
        var out = { copiedTo: copiedTo, effectsCopied: effectsCopied, skippedParams: skippedParams };
        if (notFound.length) out.effectsNotFound = notFound;
        return out;
    });
};

handlers.reorder_effects = function (params) {
    var comp = resolveComp(params.comp);
    var layer = resolveLayer(comp, params.layer);
    var par0 = layer.property('ADBE Effect Parade');
    if (!par0) throw new Error('layer has no effects: ' + layer.name);
    if (par0.numProperties === 0) throw new Error('layer "' + layer.name + '" has no effects');

    return withUndo('AE Portal: reorder_effects', function () {
        // Full reorder by a desired name order — bring each named effect to position t+1.
        // Refetch the parade after every moveTo (moveTo invalidates property refs); moving
        // an effect that currently sits at index >= t+1 never disturbs the placed prefix.
        if (params.order != null) {
            var order = (params.order instanceof Array) ? params.order : [params.order];
            var moves = [];
            var CAP = 500;
            var lim = order.length < CAP ? order.length : CAP;
            for (var t = 0; t < lim; t++) {
                var targetIdx = t + 1;
                var parNow = layer.property('ADBE Effect Parade');
                var curIdx = findEffectIndex(parNow, order[t]);
                if (curIdx < 0) { moves.push({ effect: String(order[t]), error: 'not found' }); continue; }
                var effName = parNow.property(curIdx).name;
                if (curIdx !== targetIdx) parNow.property(curIdx).moveTo(targetIdx);
                moves.push({ effect: effName, fromIndex: curIdx, toIndex: targetIdx });
            }
            return { reordered: moves };
        }
        // Single-effect move.
        if (params.effect == null) throw new Error('effect (name/index) or an order array is required');
        if (params.toIndex == null) throw new Error('toIndex (1-based) required');
        var idx = findEffectIndex(par0, params.effect);
        if (idx < 0) throw new Error('effect not found: ' + params.effect);
        var n = par0.numProperties;
        var toIndex = Number(params.toIndex);
        if (toIndex < 1) toIndex = 1;
        if (toIndex > n) toIndex = n;
        var name = par0.property(idx).name;
        par0.property(idx).moveTo(toIndex);   // read name BEFORE the move (moveTo invalidates the ref)
        return { effect: name, fromIndex: idx, toIndex: toIndex };
    });
};

// Rewrite layer("oldName") / layer('oldName') references to the new name inside an
// expression string. Reuses scanTextMatches/replaceTextMatches (literal, regex-meta-safe,
// non-overlapping) so a name containing regex metacharacters can't corrupt the match. Only
// the layer(...) accessor form is rewritten — an unrelated "oldName" string literal is left
// untouched. thisComp.layer("X") / comp("Y").layer("X") both contain layer("X") as a
// substring, so both are handled.
function replaceLayerRefs(expr, oldName, newName) {
    var out = String(expr);
    var nd1 = 'layer("' + oldName + '")';
    var i1 = scanTextMatches(out, nd1, true, false);
    if (i1.length) out = replaceTextMatches(out, i1, nd1.length, 'layer("' + newName + '")');
    var nd2 = "layer('" + oldName + "')";
    var i2 = scanTextMatches(out, nd2, true, false);
    if (i2.length) out = replaceTextMatches(out, i2, nd2.length, "layer('" + newName + "')");
    return out;
}
// Steps 1-2 of the safe rename: scan every comp (by id internally) for expressions that
// reference the old layer name and would actually change, returning the update records
// (holding a live prop ref — valid across a rename, which never restructures properties).
function collectLayerRefs(oldName, newName) {
    var updates = [];
    var comps = [];
    var CAP_ITEMS = 100000;
    var nItems = app.project.numItems;
    if (nItems > CAP_ITEMS) nItems = CAP_ITEMS;
    for (var i = 1; i <= nItems; i++) {
        var it = app.project.item(i);
        if (it instanceof CompItem) comps.push(it);
    }
    var CAP_COMPS = 5000, CAP_LAYERS = 20000;
    var nC = comps.length < CAP_COMPS ? comps.length : CAP_COMPS;
    for (var c = 0; c < nC; c++) {
        var comp = comps[c];
        var nL = comp.numLayers < CAP_LAYERS ? comp.numLayers : CAP_LAYERS;
        for (var L = 1; L <= nL; L++) {
            var layer = comp.layer(L);
            var ctx = { compObj: comp, compName: comp.name, layerName: layer.name };
            eachExprProp(layer, '', function (p, sub, ex) {
                var ne = replaceLayerRefs(ex, oldName, newName);
                if (ne !== ex) {
                    updates.push({ compObj: ctx.compObj, comp: ctx.compName, layer: ctx.layerName, prop: sub, propRef: p, oldExpr: ex, newExpr: ne });
                }
            }, 0);
        }
    }
    return updates;
}

handlers.safe_rename = function (params) {
    var newName = (params.newName != null) ? String(params.newName) : '';
    if (!newName.length) throw new Error('newName required');
    var dryRun = (params.dryRun === true);

    // ---- comp rename ----
    if (params.renameComp != null && params.renameComp !== '') {
        var theComp = resolveComp(params.renameComp);
        var fromC = theComp.name;
        if (dryRun) {
            return { renamed: false, from: fromC, to: newName, kind: 'comp',
                     expressionsUpdated: [], reEnabled: [], dryRun: true,
                     note: 'comp rename does not auto-update comp("' + fromC + '") references in expressions, nor precomp layer names' };
        }
        return withUndo('AE Portal: safe_rename (comp)', function () {
            theComp.name = newName;
            return { renamed: true, from: fromC, to: theComp.name, kind: 'comp',
                     expressionsUpdated: [], reEnabled: [], dryRun: false,
                     note: 'comp("' + fromC + '") references in expressions are NOT auto-updated' };
        });
    }

    // ---- layer rename (expression-safe 5-step) ----
    var comp = resolveComp(params.comp);
    var layer = resolveLayer(comp, params.layer);
    var fromName = layer.name;
    if (fromName === newName) {
        return { renamed: false, from: fromName, to: newName, kind: 'layer',
                 expressionsUpdated: [], reEnabled: [], dryRun: dryRun, note: 'name unchanged' };
    }

    // Steps 1-2: scan all comps for layer("oldName") references; build the update list.
    var updates = collectLayerRefs(fromName, newName);
    var report = [];
    var RCAP = 100000;
    var rlim = updates.length < RCAP ? updates.length : RCAP;
    for (var u = 0; u < rlim; u++) report.push({ comp: updates[u].comp, layer: updates[u].layer, prop: updates[u].prop });

    if (dryRun) {
        return { renamed: false, from: fromName, to: newName, kind: 'layer',
                 expressionsUpdated: report, reEnabled: [], dryRun: true };
    }

    return withUndo('AE Portal: safe_rename', function () {
        // Step 3: rewrite oldName -> newName in every affected expression FIRST (they now
        // reference newName, which does not exist yet — a transient break resolved by step 4).
        for (var i = 0; i < rlim; i++) {
            try { updates[i].propRef.expression = updates[i].newExpr; } catch (e1) {}
        }
        // Step 4: rename the layer. Property refs survive a rename (no restructuring).
        layer.name = newName;
        // Step 5: force re-enable any expression AE disabled/errored during the transient
        // break — force one eval, and if it still errors or reads disabled, toggle
        // expressionEnabled false->true (the documented cache-clear) and re-eval.
        var reEnabled = [];
        for (var j = 0; j < rlim; j++) {
            var p = updates[j].propRef;
            var tt = 0;
            try { tt = updates[j].compObj.time; } catch (eT) { tt = 0; }
            try { var _v = p.valueAtTime(tt, false); } catch (e2) {}
            var err = ''; try { err = String(p.expressionError || ''); } catch (e3) {}
            var en = true; try { en = p.expressionEnabled; } catch (e4) {}
            if (err.length || en === false) {
                try { p.expressionEnabled = false; } catch (e5) {}
                try { p.expressionEnabled = true; } catch (e6) {}
                try { var _v2 = p.valueAtTime(tt, false); } catch (e7) {}
                var err2 = ''; try { err2 = String(p.expressionError || ''); } catch (e8) {}
                reEnabled.push({ comp: updates[j].comp, layer: updates[j].layer, prop: updates[j].prop, cleared: !err2.length });
            }
        }
        return { renamed: true, from: fromName, to: layer.name, kind: 'layer',
                 expressionsUpdated: report, reEnabled: reEnabled, dryRun: false };
    });
};

// ============================================================
// Tier-1B verbs (v0.3.0, cont.): search_project, swap_color, build_captions.
// Still inside the MarkHost IIFE — eachExprProp / normalizeColor / hexToRgba /
// scanTextMatches / exprQuote / exprErrorFor / safe / withUndo / resolveComp /
// resolveLayer / TextLayer / CompItem / FootageItem / SolidSource / AVLayer /
// PropertyType / PropertyValueType / ParagraphJustification are all in lexical
// scope. Reference-invalidation rule still applies; every loop is capped.
// ============================================================

// Enumerate every CompItem in the project (by id-walking app.project.item), capped.
function allProjectComps() {
    var comps = [];
    var CAP_ITEMS = 100000;
    var nItems = app.project.numItems;
    if (nItems > CAP_ITEMS) nItems = CAP_ITEMS;
    for (var i = 1; i <= nItems; i++) {
        var it = app.project.item(i);
        if (it instanceof CompItem) comps.push(it);
    }
    return comps;
}

// ---------- search_project ----------
// READ-ONLY project-wide search (a delivery-audit tool). NO withUndo, NO mutation.
// Walks comps by id → layers → the surface named by `by`. `query` is a case-insensitive
// substring for every mode except `missing` (where it's optional). Every loop is bounded.
handlers.search_project = function (params) {
    var by = String(params.by != null ? params.by : '').toLowerCase();
    var query = (params.query != null) ? String(params.query) : '';
    var valid = { effect: 1, expression: 1, font: 1, text: 1, footage: 1, missing: 1 };
    if (!valid[by]) throw new Error('by must be one of effect|expression|font|text|footage|missing');
    if (by !== 'missing' && query.length === 0) throw new Error('query required for by="' + by + '"');
    var qLower = query.toLowerCase();
    function hay(s) { return String(s == null ? '' : s).toLowerCase().indexOf(qLower) >= 0; }
    function snippet(s, n) { var t = String(s == null ? '' : s); return (t.length > n) ? (t.substr(0, n) + '…') : t; }

    var hits = [];
    var CAP_HITS = 20000, CAP_COMPS = 5000, CAP_LAYERS = 20000, CAP_FX = 5000, CAP_ITEMS = 100000;

    // footage / missing walk PROJECT ITEMS (not comps); everything else walks comps→layers.
    if (by === 'footage' || by === 'missing') {
        var nItems = app.project.numItems;
        if (nItems > CAP_ITEMS) nItems = CAP_ITEMS;
        for (var i = 1; i <= nItems && hits.length < CAP_HITS; i++) {
            var it = app.project.item(i);
            if (!(it instanceof FootageItem)) continue;
            var fpath = (it.file) ? safe(function () { return it.file.fsName; }) : null;
            if (by === 'missing') {
                if (!it.footageMissing) continue;
            } else {
                if (!(hay(it.name) || (fpath && hay(fpath)))) continue;
            }
            // where used — usedIn comps by name (bounded).
            var used = safe(function () { return it.usedIn; }) || [];
            var usedNames = [];
            for (var u = 0; u < used.length && u < 200; u++) usedNames.push(used[u].name);
            hits.push({ comp: usedNames.length ? usedNames : null, item: it.name,
                        detail: fpath || (it.footageMissing ? '(missing, no path)' : '(no file)') });
        }
        return { by: by, query: query, hits: hits, count: hits.length };
    }

    var comps = allProjectComps();
    var nC = (comps.length < CAP_COMPS) ? comps.length : CAP_COMPS;
    for (var c = 0; c < nC && hits.length < CAP_HITS; c++) {
        var comp = comps[c];
        var nL = (comp.numLayers < CAP_LAYERS) ? comp.numLayers : CAP_LAYERS;
        for (var L = 1; L <= nL && hits.length < CAP_HITS; L++) {
            var layer = comp.layer(L);
            if (by === 'effect') {
                var parade = safe(function () { return layer.property('ADBE Effect Parade'); });
                if (!parade) continue;
                var nFx = parade.numProperties;
                if (nFx > CAP_FX) nFx = CAP_FX;
                for (var e = 1; e <= nFx && hits.length < CAP_HITS; e++) {
                    var eff = parade.property(e);
                    var en = safe(function () { return eff.name; });
                    var emn = safe(function () { return eff.matchName; });
                    if (hay(en) || hay(emn)) {
                        hits.push({ comp: comp.name, layer: layer.name, detail: en + ' (' + emn + ')' });
                    }
                }
            } else if (by === 'expression') {
                var ctx = { comp: comp.name, layer: layer.name };
                eachExprProp(layer, '', function (p, sub, ex) {
                    if (hits.length >= CAP_HITS) return;
                    if (String(ex).toLowerCase().indexOf(qLower) >= 0) {
                        hits.push({ comp: ctx.comp, layer: ctx.layer, detail: sub + ': ' + snippet(ex, 160) });
                    }
                }, 0);
            } else if (by === 'font' || by === 'text') {
                if (!(layer instanceof TextLayer)) continue;
                var doc = safe(function () { return layer.property('ADBE Text Properties').property('ADBE Text Document').value; });
                if (!doc) continue;
                if (by === 'font') {
                    var font = safe(function () { return String(doc.font); });
                    if (font && hay(font)) hits.push({ comp: comp.name, layer: layer.name, detail: font });
                } else {
                    var txt = safe(function () { return String(doc.text); });
                    if (txt != null && hay(txt)) hits.push({ comp: comp.name, layer: layer.name, detail: snippet(txt, 160) });
                }
            }
        }
    }
    return { by: by, query: query, hits: hits, count: hits.length };
};

// ---------- swap_color ----------
// Find/replace a color across the project (client brand-color changes). from/to accept a
// hex string or [r,g,b(,a)] (0-1 or 0-255, auto-normalized by normalizeColor). Match is
// per-channel on RGB only, within `tolerance` (0-1 float, default 0.02). dryRun defaults
// TRUE. `include` selects surfaces (solids|shapeFill|shapeStroke|textFill|effectColor);
// omit for all. GROUNDED: setting a solid's mainSource.color affects EVERY layer sharing
// that footage item — swapped once per footage id and flagged `shared:true`. setValue on a
// KEYFRAMED color throws + deletes keys, so keyed colors are reported (matched) but skipped.
function colorMatchesRGB(c, target, tol) {
    if (!(c instanceof Array) || c.length < 3) return false;
    for (var i = 0; i < 3; i++) {
        var cv = Number(c[i]);
        if (isNaN(cv)) return false;
        if (Math.abs(cv - target[i]) > tol) return false;
    }
    return true;
}
// Depth/breadth-capped walk collecting shape leaves whose matchName === wantMatch.
function eachShapePropByMatch(grp, wantMatch, visit, depth) {
    if (depth > 32) return;
    var n; try { n = grp.numProperties; } catch (e0) { return; }
    var CAP = 20000; if (n > CAP) n = CAP;
    for (var i = 1; i <= n; i++) {
        var p; try { p = grp.property(i); } catch (e1) { continue; }
        if (!p) continue;
        var mn; try { mn = p.matchName; } catch (e2) { mn = ''; }
        if (mn === wantMatch) { visit(p); continue; }
        var pt; try { pt = p.propertyType; } catch (e3) { pt = null; }
        if (pt !== PropertyType.PROPERTY) eachShapePropByMatch(p, wantMatch, visit, depth + 1);
    }
}
handlers.swap_color = function (params) {
    if (params.from == null) throw new Error('from color required');
    if (params.to == null) throw new Error('to color required');
    var fromC = normalizeColor(params.from);   // [r,g,b,a] 0-1
    var toC   = normalizeColor(params.to);
    var tol = (params.tolerance != null) ? Number(params.tolerance) : 0.02;
    if (isNaN(tol) || tol < 0) tol = 0.02;
    var dryRun = (params.dryRun === false) ? false : true; // default TRUE
    // include set — default all surfaces.
    var incAll = !(params.include instanceof Array) || params.include.length === 0;
    var inc = {};
    if (!incAll) { for (var ii = 0; ii < params.include.length; ii++) inc[String(params.include[ii])] = true; }
    function want(surface) { return incAll || inc[surface] === true; }

    // scope: one comp, or the whole project.
    var comps;
    if (params.scope != null && params.scope !== '') comps = [resolveComp(params.scope)];
    else comps = allProjectComps();

    var matches = [];
    var swapped = 0;
    var sharedSwapped = false;
    var doneSolids = {}; // footage id -> true (a shared solid is swapped once)
    var CAP_COMPS = 5000, CAP_LAYERS = 20000;

    function run() {
        var nC = (comps.length < CAP_COMPS) ? comps.length : CAP_COMPS;
        for (var c = 0; c < nC; c++) {
            var comp = comps[c];
            var nL = (comp.numLayers < CAP_LAYERS) ? comp.numLayers : CAP_LAYERS;
            for (var L = 1; L <= nL; L++) {
                var layer = comp.layer(L);

                // --- solids (footage mainSource color; shared across layers) ---
                if (want('solids') && layer instanceof AVLayer && layer.source &&
                    layer.source.mainSource instanceof SolidSource) {
                    var src = layer.source;
                    var sid = safe(function () { return src.id; });
                    var col = safe(function () { return src.mainSource.color; }); // [r,g,b] 0-1
                    if (col && colorMatchesRGB(col, fromC, tol)) {
                        var used = safe(function () { return src.usedIn; }) || [];
                        var isShared = used.length > 1;
                        var rec = { comp: comp.name, layer: layer.name, surface: 'solid', was: col, item: src.name };
                        if (isShared) rec.shared = true;
                        if (!dryRun && !doneSolids[sid]) {
                            try { src.mainSource.color = [toC[0], toC[1], toC[2]]; doneSolids[sid] = true; swapped++; if (isShared) sharedSwapped = true; }
                            catch (eSol) { rec.error = String(eSol); }
                        } else if (!dryRun && doneSolids[sid]) {
                            rec.note = 'already swapped via shared footage item';
                        }
                        matches.push(rec);
                    }
                }

                // --- shape fill / stroke colors ---
                var rootV = safe(function () { return layer.property('ADBE Root Vectors Group'); });
                if (rootV && (want('shapeFill') || want('shapeStroke'))) {
                    var pairs = [];
                    if (want('shapeFill'))   pairs.push({ mn: 'ADBE Vector Fill Color',   surface: 'shapeFill' });
                    if (want('shapeStroke')) pairs.push({ mn: 'ADBE Vector Stroke Color', surface: 'shapeStroke' });
                    for (var pi = 0; pi < pairs.length; pi++) {
                        (function (pair) {
                            eachShapePropByMatch(rootV, pair.mn, function (cp) {
                                var v = safe(function () { return cp.value; });
                                if (!colorMatchesRGB(v, fromC, tol)) return;
                                var rec = { comp: comp.name, layer: layer.name, surface: pair.surface, was: v };
                                var keyed = false; try { keyed = cp.numKeys > 0; } catch (eK) {}
                                if (!dryRun) {
                                    if (keyed) { rec.skipped = 'keyframed color (setValue would delete keys)'; }
                                    else {
                                        var a = (v.length > 3) ? Number(v[3]) : 1;
                                        try { cp.setValue([toC[0], toC[1], toC[2], a]); swapped++; }
                                        catch (eSet) { rec.error = String(eSet); }
                                    }
                                }
                                matches.push(rec);
                            }, 0);
                        })(pairs[pi]);
                    }
                }

                // --- text fill (TextDocument.fillColor) ---
                if (want('textFill') && layer instanceof TextLayer) {
                    var st = safe(function () { return layer.property('ADBE Text Properties').property('ADBE Text Document'); });
                    if (st) {
                        var tdoc = safe(function () { return st.value; });
                        var fc = tdoc ? safe(function () { return tdoc.fillColor; }) : null; // [r,g,b]
                        if (fc && colorMatchesRGB(fc, fromC, tol)) {
                            var rec2 = { comp: comp.name, layer: layer.name, surface: 'textFill', was: fc };
                            var tkeyed = false; try { tkeyed = st.numKeys > 0; } catch (eTK) {}
                            if (!dryRun) {
                                if (tkeyed) { rec2.skipped = 'keyframed sourceText (setValue would delete keys)'; }
                                else {
                                    try { tdoc.applyFill = true; tdoc.fillColor = [toC[0], toC[1], toC[2]]; st.setValue(tdoc); swapped++; }
                                    catch (eTF) { rec2.error = String(eTF); }
                                }
                            }
                            matches.push(rec2);
                        }
                    }
                }

                // --- effect COLOR params ---
                if (want('effectColor')) {
                    var parade = safe(function () { return layer.property('ADBE Effect Parade'); });
                    if (parade) {
                        var nFx = parade.numProperties; if (nFx > 5000) nFx = 5000;
                        for (var e = 1; e <= nFx; e++) {
                            var eff = parade.property(e);
                            var nP = eff.numProperties; if (nP > 20000) nP = 20000;
                            for (var pp = 1; pp <= nP; pp++) {
                                var prp;
                                try { prp = eff.property(pp); } catch (ePr) { continue; }
                                var vt = safe(function () { return prp.propertyValueType; });
                                if (vt !== PropertyValueType.COLOR) continue;
                                var ev = safe(function () { return prp.value; });
                                if (!colorMatchesRGB(ev, fromC, tol)) continue;
                                var rec3 = { comp: comp.name, layer: layer.name, surface: 'effectColor',
                                             detail: eff.name + ' > ' + prp.name, was: ev };
                                var ekeyed = false; try { ekeyed = prp.numKeys > 0; } catch (eEK) {}
                                if (!dryRun) {
                                    if (ekeyed) { rec3.skipped = 'keyframed color (setValue would delete keys)'; }
                                    else {
                                        var ea = (ev.length > 3) ? Number(ev[3]) : 1;
                                        try { prp.setValue([toC[0], toC[1], toC[2], ea]); swapped++; }
                                        catch (eEC) { rec3.error = String(eEC); }
                                    }
                                }
                                matches.push(rec3);
                            }
                        }
                    }
                }
            }
        }
        var out = { from: fromC, to: toC, tolerance: tol, matches: matches, matchCount: matches.length, swapped: swapped, dryRun: dryRun };
        if (sharedSwapped) out.note = 'one or more swapped solids are SHARED footage — the color changed on every layer using that solid';
        return out;
    }
    if (dryRun) return run();
    return withUndo('AE Portal: swap_color', run);
};

// ---------- build_captions ----------
// Transcript/SRT -> timed, wrapped, styled caption text layers (closes the
// whisper->captions loop). segments = [{text,start,end}] (seconds) OR srt = raw SRT.
// mode 'layers' (default) = one text layer per segment timed to [start,end]; mode
// 'single' = one text layer whose source-text expression shows the active segment by
// `time` from an embedded table. Long lines wrap at word boundaries to maxCharsPerLine.
// TextDocument set-all-then-setValue. All loops capped. withUndo.
function parseSrtTime(s) {
    var m = String(s).match(/(\d+):(\d+):(\d+)[,.](\d+)/);
    if (!m) return null;
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
}
function parseSrt(raw) {
    var segs = [];
    var text = String(raw).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    var blocks = text.split(/\n[ \t]*\n+/);
    var CAP = 100000;
    for (var b = 0; b < blocks.length && b < CAP; b++) {
        var lines = blocks[b].split('\n');
        // find the timecode line (contains '-->').
        var tcIdx = -1;
        for (var i = 0; i < lines.length; i++) {
            if (lines[i].indexOf('-->') >= 0) { tcIdx = i; break; }
        }
        if (tcIdx < 0) continue;
        var parts = lines[tcIdx].split('-->');
        if (parts.length < 2) continue;
        var start = parseSrtTime(parts[0]);
        var end   = parseSrtTime(parts[1]);
        if (start == null || end == null) continue;
        var body = [];
        for (var j = tcIdx + 1; j < lines.length; j++) body.push(lines[j]);
        var txt = body.join('\n').replace(/^\s+|\s+$/g, '');
        segs.push({ text: txt, start: start, end: end });
    }
    return segs;
}
// wrap `str` at word boundaries so no line exceeds maxChars; a single over-long word
// stays whole on its own line. Returns lines joined by '\r' (AE hard line break). When
// maxChars <= 0, returns the text unchanged (only converting explicit newlines to \r).
function wrapCaption(str, maxChars) {
    var src = String(str).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    var srcLines = src.split('\n');
    var outLines = [];
    var LCAP = 100000;
    for (var s = 0; s < srcLines.length && s < LCAP; s++) {
        if (!(maxChars > 0)) { outLines.push(srcLines[s]); continue; }
        var words = srcLines[s].split(/\s+/);
        var cur = '';
        for (var w = 0; w < words.length; w++) {
            var word = words[w];
            if (word.length === 0) continue;
            if (cur.length === 0) { cur = word; }
            else if ((cur.length + 1 + word.length) <= maxChars) { cur = cur + ' ' + word; }
            else { outLines.push(cur); cur = word; }
        }
        if (cur.length) outLines.push(cur);
        if (!words.length || srcLines[s].replace(/\s+/g, '').length === 0) { /* blank line */ }
    }
    return outLines.join('\r');
}
// escape a string for embedding as a double-quoted JS string literal inside an AE
// expression (used by 'single' mode's table): backslash, quote, and \r/\n become \\r/\\n.
function exprStrLit(s) {
    return String(s)
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n');
}
// Apply the caption style block to a TextDocument copy, then setValue. `defaultJust` lets
// callers force center for a caption feel unless the style overrides justification.
function applyCaptionStyle(st, wrappedText, style, defaultJust) {
    var doc = st.value;
    doc.text = wrappedText;                                  // set text on the COPY
    if (style.font)     { try { doc.font = String(style.font); } catch (e1) {} }
    if (style.fontSize) { try { doc.fontSize = Number(style.fontSize); } catch (e2) {} }
    if (style.fillColor != null) {
        var fc = normalizeColor(style.fillColor);
        try { doc.applyFill = true; doc.fillColor = [fc[0], fc[1], fc[2]]; } catch (e3) {}
    }
    var just = (style.justification != null) ? String(style.justification) : defaultJust;
    if (just && ParagraphJustification[just] !== undefined) { try { doc.justification = ParagraphJustification[just]; } catch (e4) {} }
    st.setValue(doc);                                        // set-all-then-setValue
}
handlers.build_captions = function (params) {
    var comp = resolveComp(params.comp);
    var mode = String(params.mode || 'layers').toLowerCase();
    if (mode !== 'single') mode = 'layers';
    var style = params.style || {};
    var maxChars = (params.maxCharsPerLine != null) ? Math.round(Number(params.maxCharsPerLine)) : 0;
    var defaultJust = 'CENTER_JUSTIFY';

    // gather segments (explicit or parsed from SRT).
    var segments;
    if (params.srt != null && String(params.srt).length) segments = parseSrt(params.srt);
    else segments = params.segments || [];
    if (!(segments instanceof Array) || segments.length === 0) throw new Error('segments (array) or srt (string) required');
    var SEG_CAP = 100000;
    var nSeg = (segments.length < SEG_CAP) ? segments.length : SEG_CAP;

    // default caption position: centered near the lower third.
    var pos = (style.position instanceof Array) ? style.position : [comp.width / 2, Math.round(comp.height * 0.85)];
    var boxSize = null;
    if (style.box) {
        if (style.box instanceof Array && style.box.length >= 2) boxSize = [Number(style.box[0]), Number(style.box[1])];
        else boxSize = [Math.round(comp.width * 0.8), 200];
    }

    return withUndo('AE Portal: build_captions', function () {
        var out = [];

        if (mode === 'single') {
            var layer = boxSize ? comp.layers.addBoxText(boxSize) : comp.layers.addText('');
            if (params.name != null && String(params.name).length) { try { layer.name = String(params.name); } catch (eN) {} }
            var st = layer.property('ADBE Text Properties').property('ADBE Text Document');
            // seed style (empty text) so font/size/fill/justification are set before the expr.
            applyCaptionStyle(st, '', style, defaultJust);
            // build the source-text table + selector expression.
            var Lx = [];
            Lx.push('var T = [');
            for (var i = 0; i < nSeg; i++) {
                var seg = segments[i];
                var wrapped = wrapCaption(seg.text != null ? seg.text : '', maxChars);
                Lx.push('{t:' + numLit(Number(seg.start)) + ',e:' + numLit(Number(seg.end)) + ',s:"' + exprStrLit(wrapped) + '"},');
            }
            Lx.push('];');
            Lx.push('var out = "";');
            Lx.push('for (var i = 0; i < T.length; i++) { if (time >= T[i].t && time < T[i].e) { out = T[i].s; break; } }');
            Lx.push('out;');
            var expr = Lx.join('\n');
            st.expression = expr;
            st.expressionEnabled = true;
            try { layer.property('ADBE Transform Group').property('ADBE Position').setValue(pos); } catch (ePos) {}
            var exErr = exprErrorFor(st, comp.time);
            return { mode: 'single', created: 1, layers: [{ name: layer.name, index: layer.index, segments: nSeg }],
                     expression: expr, expressionError: exErr, enabled: !exErr };
        }

        // mode 'layers' — one timed text layer per segment.
        for (var s = 0; s < nSeg; s++) {
            var sg = segments[s];
            var start = Number(sg.start), end = Number(sg.end);
            var wrappedTxt = wrapCaption(sg.text != null ? sg.text : '', maxChars);
            var lyr = boxSize ? comp.layers.addBoxText(boxSize) : comp.layers.addText('');
            var stL = lyr.property('ADBE Text Properties').property('ADBE Text Document');
            applyCaptionStyle(stL, wrappedTxt, style, defaultJust);
            // timing: set inPoint then outPoint (default outPoint = comp.duration is large,
            // so no clamp when start < end < duration).
            if (!isNaN(start)) { try { lyr.inPoint = start; } catch (eIn) {} }
            if (!isNaN(end))   { try { lyr.outPoint = end; } catch (eOut) {} }
            try { lyr.property('ADBE Transform Group').property('ADBE Position').setValue(pos); } catch (ePos2) {}
            out.push({ name: lyr.name, index: lyr.index, inPoint: lyr.inPoint, outPoint: lyr.outPoint, text: wrappedTxt });
        }
        return { mode: 'layers', created: out.length, layers: out };
    });
};
