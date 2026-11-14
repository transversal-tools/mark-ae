# AE Portal — Tool Reference

> Generated from `mcp-server/tools.js` (135 tools across 32 groups). This file is not hand-maintained — regenerate it whenever tools.js changes (parse the exported `TOOLS` array + the `// ---- section ----` comment markers). Required params marked `*`.

Every tool is called through the standard MCP `tools/call`. Most panel-routed tools also accept an optional `instance` string (target one AE when several are connected — see `list_instances`) and, where they take a `comp`/`layer` target, accept `{id:N}` for duplicate-name-safe addressing.

## core

### `ping`
Health check — confirms the panel is connected and AE is responsive. Returns AE version, build, project file, uptime. Use first when unsure.

### `run_jsx`
Escape hatch — run arbitrary ExtendScript inside AE and return its value. Wrap in (function(){...})(). Prefer dedicated tools when one fits.

Params: `script`* string, `force` boolean

## introspection

### `get_project_map`
Project map. mode="light" (default, <500ms): comp tree, layer counts, fonts, fps, durations, active comp, basic per-layer info (type, parent, track matte, audio presence, text content). mode="deep": adds per-layer transform keyframes + easing, full effect stacks with property values + expressions, parent chains, masks, layer styles, shape contents (recursive groups/paths/fills/strokes/repeaters/trim), text animators (range selectors + animator properties), comp + layer markers. mode="comp": same as deep but for a single comp by name/id (param: comp). Cheaper than full deep for big projects. Toggle off heavy parts with includeShapeContents/includeTextAnimators/includeMasks/includeLayerStyles. Every comp and layer carries a stable numeric `id` — pass it back to any tool as `{ id: N }` (comp or layer param) for duplicate-name-safe addressing. Start with light; only deep-map when you need keyframes/values/structure.

Params: `mode` string(light|deep|comp), `comp` oneOf, `includeKeyframes` boolean, `includeEffects` boolean, `includeMasks` boolean, `includeLayerStyles` boolean, `includeShapeContents` boolean, `includeTextAnimators` boolean, `includeMarkers` boolean, `maxLayers` integer, `maxTreeDepth` integer

### `get_selection`
Returns active comp, currently selected timeline layers, and project panel selection. Cheap — call before mutations to know what user has selected.

### `list_compositions`
Quick list of all comps in the project — id, name, dimensions, fps, duration. Lighter than get_project_map.

### `list_effects`
List of all installed effects (display name, matchName, category). Optional substring filter. Use to find correct matchName before apply_effect.

Params: `filter` string, `refresh` boolean

## easing (never F9/33% unless asked)

### `set_easing`
Apply nice easing on a property's keyframes. Modes: "in" (linear→bezier-in) for animation-in; "out" (bezier-out→linear) for animation-out; "inout" (bezier on both ends) for snap-in-and-out. Default influence 75 (range 70–80 — DO NOT use AE's default 33%/F9 unless the user explicitly asks). range="all" applies to first/last (and middle, for inout); range="selected" uses the keyframes selected in AE's timeline.

Params: `comp` oneOf, `layer`* oneOf, `prop`* string, `mode` string(in|out|inout), `influence` number, `range` oneOf

### `get_easing`
Read keyframes + easing for one property: each key's time/frame/value/inInterp/outInterp/easeIn/easeOut. Use this to preserve easing when changing keyframe values.

Params: `comp` oneOf, `layer`* oneOf, `prop`* string

## effects

### `apply_effect`
Apply an effect to one or more layers. `effect` accepts display name ("Gaussian Blur"), matchName ("ADBE Gaussian Blur 2"), or pseudo-effect path. Set initial property values via `properties` (key = property display name or matchName). If unsure of the name, call lookup_effect(query) FIRST — it's an in-memory lookup of 213 effects, faster than list_effects (which queries AE).

Params: `comp` oneOf, `layers` oneOf, `effect`* string, `properties` object, `force` boolean

## layer creation

### `add_solid`
Add a solid layer. Defaults to comp dimensions and full duration.

Params: `comp` oneOf, `name` string, `color` array, `width` integer, `height` integer, `duration` number

### `add_null`
Add a null object. Useful as a parent rig.

Params: `comp` oneOf, `name` string, `duration` number

### `add_text`
Add a text layer. Optional font/fontSize/fillColor/justification/position.

Params: `comp` oneOf, `text` string, `name` string, `font` string, `fontSize` number, `fillColor` array, `justification` string(LEFT_JUSTIFY|RIGHT_JUSTIFY|CENTER_JUSTIFY|FULL_JUSTIFY_LASTLINE_LEFT|FULL_JUSTIFY_LASTLINE_RIGHT|FULL_JUSTIFY_LASTLINE_CENTER|FULL_JUSTIFY_LASTLINE_FULL), `position` array

### `add_shape`
Add an empty shape layer. Add contents afterwards via run_jsx or set_property.

Params: `comp` oneOf, `name` string

### `add_adjustment`
Add an adjustment layer at comp size and full duration.

Params: `comp` oneOf, `name` string

## layer ops

### `delete_layer`
Delete one or more layers. When names may collide, address by stable id (`{ id: N }`) so the right layer is hit.

Params: `comp` oneOf, `layers` oneOf

### `duplicate_layer`
Duplicate one or more layers.

Params: `comp` oneOf, `layers` oneOf

### `set_property`
Set a property's value. If the property already has keyframes, this sets/creates a keyframe at `time` (or current comp time). Otherwise it sets the constant value. To preserve easing on existing keyframes, call get_easing first, change the value, and easing is kept automatically (we set the value at the same time as the existing key). comp/layer accept `{ id: N }` for duplicate-name-safe stable-id addressing.

Params: `comp` oneOf, `layer`* oneOf, `prop`* string, `value`* oneOf, `time` number

### `add_keyframe`
Add a keyframe to a property at the given time. Defaults the value to the property's value at that time, so easing stays clean. Pair with set_easing afterward.

Params: `comp` oneOf, `layer`* oneOf, `prop`* string, `time` number, `value` oneOf

### `parent_layers`
Set parent of one or more child layers. Pass parent=null to unparent.

Params: `comp` oneOf, `children`* oneOf, `parent` oneOf

### `set_track_matte`
Set track matte type on a layer. Reads from the layer ABOVE it (AE's standard rule). type: NONE | ALPHA | ALPHA_INVERTED | LUMA | LUMA_INVERTED.

Params: `comp` oneOf, `layer`* oneOf, `type`* string(NONE|ALPHA|ALPHA_INVERTED|LUMA|LUMA_INVERTED)

## nav

### `set_active_comp`
Open a comp in the viewer (sets the active comp).

Params: `comp`* oneOf

### `set_selected_layers`
Set the timeline selection. Pass an array of layer indices/names — clears existing selection first.

Params: `comp` oneOf, `layers`* array

### `create_composition`
Create a new composition. Defaults: 1920x1080, 30fps, 10s, pixelAspect 1.

Params: `name` string, `width` integer, `height` integer, `duration` number, `fps` number, `pixelAspect` number, `bgColor` array, `openInViewer` boolean

### `open_project`
Open a .aep project file.

Params: `path`* string, `force` boolean

### `close_project`
Close the current project. save: "save" | "discard" | "prompt" (default).

Params: `save` string(save|discard|prompt), `force` boolean

### `analyze_unused`
Find project items (footage, comps) not used in any composition. Read-only — returns suggestions for cleanup.

## markers

### `list_markers`
List markers on a layer (pass `layer`) or on the comp itself (omit `layer`). Returns time, frame, comment, duration, label.

Params: `comp` oneOf, `layer` oneOf

### `add_marker`
Add a marker on a layer or on the comp. Time can be seconds, or pass `frame`. Optional comment, duration, label (0–16, AE's color labels).

Params: `comp` oneOf, `layer` oneOf, `time` number, `frame` integer, `comment` string, `duration` number, `label` integer, `chapter` string, `url` string, `frameTarget` string, `cuePointName` string

### `add_markers_batch`
Add many markers at once. markers: [{time|frame, comment, duration?, label?}].

Params: `comp` oneOf, `layer` oneOf, `markers`* array

### `delete_marker`
Delete a marker by index (1-based), or by nearest time/frame.

Params: `comp` oneOf, `layer` oneOf, `index` integer, `time` number, `frame` integer

### `set_time`
Move the playhead. Provide either time (seconds) or frame.

Params: `comp` oneOf, `time` number, `frame` integer

## organize

### `suggest_renames`
Inspect a comp and suggest cleaner layer names: text → content, shapes → "line"/"box", AV → source name. Skips already-good names. Read-only.

Params: `comp` oneOf

### `rename_layers`
Apply a rename map. renames is an array of {index, name}.

Params: `comp` oneOf, `renames`* array

### `precompose`
Precompose the given layers into a new comp. moveAllAttributes defaults true.

Params: `comp` oneOf, `layers`* oneOf, `name` string, `moveAllAttributes` boolean

## imports / project

### `import_files`
Import one or more files. Optional intoFolder creates a new project folder. Set sequence=true for image sequences.

Params: `paths`* array, `intoFolder` string, `sequence` boolean

### `import_folder`
Import a folder of media. Walks recursively by default. extensions filter defaults to common AE-friendly types. Files import into a project bin named after the folder.

Params: `path`* string, `recursive` boolean, `extensions` array, `intoFolder` string

### `list_installed_scripts`
List scripts present in installed AE app(s) — Scripts/, ScriptUI Panels/, Startup/, and User Presets. Read-only filesystem scan.

### `list_installed_extensions`
List CEP extensions installed system-wide and per-user. Read-only filesystem scan.

### `list_installed_plugins`
List native plugins installed in the AE app(s) and Adobe Common MediaCore. Read-only filesystem scan.

### `replace_footage`
Replace a footage item's underlying file. Pass either itemId or itemName. Composition usages auto-update.

Params: `itemId` integer, `itemName` string, `path`* string

### `save_project`
Save the project. If path is given, saves a copy at path; otherwise saves in place.

Params: `path` string

### `version_up`
Save the project as the next version (name_v01 → _v02, padding preserved). Suggest after big changes so alts are safe.

## whisper VO timing (panel-side)

### `whisper_transcribe`
Transcribe a VO/audio layer with word-level timestamps, frame-aligned to the comp's frame rate. Pass either a layer (name/index in active comp) or a path to an audio file. Requires the `whisper` CLI on PATH (or set WHISPER_CMD). Returns words: [{word, time, start, end, frame, frameStart, frameEnd}].

Params: `comp` oneOf, `layer` oneOf, `path` string, `model` string, `language` string

## panel-side dev

### `reload_host`
Re-evaluate the panel's host JSX from disk. Use after editing extension/host/*.jsx without restarting AE.

## vision

### `render_frame`
Render the active comp (or specified comp) at a given time, return as a PNG image content block. Pass time (seconds) or frame; defaults to current playhead. THE primary way to "see" what AE looks like — call this after visual mutations to verify results.

Params: `comp` oneOf, `time` number, `frame` integer

### `render_preview_strip`
Render N frames evenly across [start,end] into a single contact-sheet image so motion can be judged, not just one pose. Use this instead of repeated render_frame calls when checking easing, timing, a trim-path draw-on, a counter, or any change that only reads over time. Omit start/end to cover the comp's work area; omit comp for the active comp.

Params: `comp` oneOf, `start` number, `end` number, `frames` integer, `downscale` integer, `columns` integer

## expressions

### `set_expression`
Set an expression on a property. Pass empty string to remove. Auto-enables if non-empty.

Params: `comp` oneOf, `layer`* oneOf, `prop`* string, `expression`* string

### `remove_expression`
Remove the expression from a property and disable expression-mode.

Params: `comp` oneOf, `layer`* oneOf, `prop`* string

### `toggle_expression`
Toggle expressionEnabled on a property without losing the expression text.

Params: `comp` oneOf, `layer`* oneOf, `prop`* string

### `check_expression_errors`
Sweep for BROKEN expressions — every property whose expression failed to evaluate (non-empty expressionError; AE auto-disables these). Pass comp to scan one comp, omit to scan the whole project. Returns { errorCount, errors:[{comp, layer, prop, error, enabled}] }. set_expression already reports an `error` for the property it just set; use this to sweep everything or re-verify after edits.

Params: `comp` oneOf

### `apply_expression_preset`
Apply a preset expression. Library: `wiggle({freq, amp})` — random jitter; `loopOut({type: "cycle"|"pingpong"|"continue"|"offset", numKeyframes})`; `loopIn({...})`; `bounce({amp, freq, decay})` — physics-style bounce after last keyframe; `smooth({width, samples})` — averaging smooth; `time({rate, offset})` — value drives by time; `valueAtTime({offset})` — read this prop at offset time; `posterizeTime({rate})` — sample-and-hold timing; `inertialBounce()` — ease-out bounce; `autoFade({duration})` — opacity fade in/out at layer in/out points; `pingPong()` — short for loopOut pingpong.

Params: `comp` oneOf, `layer`* oneOf, `prop`* string, `preset`* string(wiggle|loopOut|loopIn|bounce|smooth|time|valueAtTime|posterizeTime|inertialBounce|autoFade|pingPong), `params` object

### `add_expression_control`
Add an expression control effect (Slider / Checkbox / Color / Point / 3D Point / Angle / Layer) to a layer — the backbone of a rig. Optionally rename it (name — this also becomes the effect("...") accessor name), set its initial value (value), and AUTO-LINK it: pass linkTo {layer, prop} to point that property's expression at this control. The link is force-evaluated and its expressionError is returned inline (empty string = it evaluated cleanly). The link target must be in the same comp as the control for it to resolve. Returns { effectName, type, valueStream, valueSet, linkedTo, expression, expressionError, linkEnabled }.

Params: `comp` oneOf, `layer`* oneOf, `type`* string(slider|checkbox|color|point|point3d|angle|layer), `name` string, `value`, `linkTo` object

### `link_properties`
One-call expression link: set the DEST property's expression to reference the SOURCE property. The source accessor is auto-derived for the standard transforms (position/scale/rotation/opacity/anchorPoint/orientation/x|yRotation) and for DIRECT effect params (effect("Effect")("Param")). For anything not auto-derivable (masks, nested shape/effect params) pass expressionTemplate explicitly — the handler will error rather than emit a link that silently fails. The result is force-evaluated and its expressionError returned inline. Returns { destLayer, destProp, expression, expressionError, enabled, derived }.

Params: `comp` oneOf, `source`* object, `dest`* object, `destComp` oneOf, `expressionTemplate` string

## keyframe time ops

### `shift_keyframes`
Shift all keyframes on a property by a delta. Positive moves later. Provide deltaSeconds OR deltaFrames OR delta (seconds).

Params: `comp` oneOf, `layer`* oneOf, `prop`* string, `deltaSeconds` number, `deltaFrames` number, `delta` number

### `scale_keyframes`
Stretch/squash keyframes in time around the first keyframe. factor>1 expands (slower), <1 compresses (faster).

Params: `comp` oneOf, `layer`* oneOf, `prop`* string, `factor`* number

### `reverse_keyframes`
Reverse keyframe order in time. Mirrors easing too (in becomes out).

Params: `comp` oneOf, `layer`* oneOf, `prop`* string

### `distribute_keyframes_evenly`
Reposition middle keyframes so they're evenly spaced between the first and last keys. Values unchanged.

Params: `comp` oneOf, `layer`* oneOf, `prop`* string

### `copy_keyframes`
Copy every keyframe from a source property to a destination property with FULL fidelity — time (optionally shifted by timeOffset), value, interpolation type (in/out), temporal ease (correct per-property array length), and spatial tangents + auto-bezier on spatial props (Position/Anchor Point). Dest can be in the same comp or another (destComp). clearExisting removes the dest's existing keyframes first. Source and dest value dimensionality must match (2D→2D, 3D→3D, scalar→scalar) or the call errors. Returns { copied, destLayer, destProp, destComp, spatial, easeArrayLength, timeOffset, clearedExisting }.

Params: `comp` oneOf, `source`* object, `dest`* object, `destComp` oneOf, `timeOffset` number, `clearExisting` boolean

### `sequence_layers`
Stagger layers by setting their startTime to startTime + index*offset. Provide offsetSeconds OR offsetFrames. Optional startTime overrides the first layer's start.

Params: `comp` oneOf, `layers`* array, `offsetSeconds` number, `offsetFrames` number, `startTime` number

### `time_stretch`
Set layer.stretch percentage. 100 = original, 50 = 2x speed, 200 = half speed.

Params: `comp` oneOf, `layer`* oneOf, `percent`* number

### `time_remap_enable`
Enable/disable time remapping on an AVLayer. Required before setting time-remap keyframes.

Params: `comp` oneOf, `layer`* oneOf, `enabled` boolean

### `freeze_frame_at`
Freeze a layer to display a single frame across its duration. Enables time remapping and sets two HOLD keys.

Params: `comp` oneOf, `layer`* oneOf, `time` number, `frame` integer

## geometry

### `center_anchor`
Move anchor point to a named position on the layer. Compensates position (and all keyframes) so the layer doesn't jump. anchor: "center" (default), "top", "bottom", "left", "right", "top-left", "top-right", "bottom-left", "bottom-right". Use "bottom" for squash-and-stretch on bouncing/landing objects.

Params: `comp` oneOf, `layers` oneOf, `anchor` string(center|top|bottom|left|right|top-left|top-right|bottom-left|bottom-right)

### `fit_to_comp`
Scale layers to fit the comp. mode: cover (fills, may crop), contain (fits inside, may letterbox), fill (stretches non-uniformly).

Params: `comp` oneOf, `layers` oneOf, `mode` string(cover|contain|fill)

### `align_layers`
Align layers to an edge. edge: left|right|top|bottom|center-h|center-v. reference: "comp" (default) | "first" | "last" | layer name/index.

Params: `comp` oneOf, `layers` oneOf, `edge`* string(left|right|top|bottom|center-h|center-v), `reference` oneOf

### `distribute_layers`
Evenly distribute layers between first and last on the chosen axis.

Params: `comp` oneOf, `layers` oneOf, `axis` string(x|y)

### `match_size`
Scale `target` so its rendered size matches `source`'s rendered size.

Params: `comp` oneOf, `source`* oneOf, `target`* oneOf

### `match_position`
Set `target`'s position to match `source`'s position.

Params: `comp` oneOf, `source`* oneOf, `target`* oneOf

### `align_to_targets`
Batch paired alignment: center each layer's comp-space visual center onto its target layer's center, plus an optional offset. Unlike align_layers (own-transform only), this walks the FULL parent chain, so labels/numbers parented to scaled or rotated nulls/buttons resolve to true comp coordinates and land correctly. Pair via pairs:[{layer,target}] or parallel layers[]+targets[]. offset [dx,dy] is comp px added to every target center (same offset on all pairs = uniform "normalize"). axis locks an axis (x/y/both). Solves each layer's LOCAL position from the comp-space target, so non-uniform/animated parent scale is handled exactly. Skips layers whose Position has an active expression. 2D layers only (3D/camera not projected). e.g. center "Num N" on "Key N" with offset [0,-23], then "Letters N" on "Key N" with [0,50].

Params: `comp` oneOf, `pairs` array, `layers` oneOf, `targets` oneOf, `offset` array, `axis` string(both|x|y), `time` number, `frame` integer

## text content

### `set_text`
Replace the text content of a text layer (without recreating it).

Params: `comp` oneOf, `layer`* oneOf, `text`* string

### `set_text_style`
Update text styling on an existing text layer. Any subset of font, fontSize, fillColor, strokeColor, strokeWidth, tracking, leading, applyFill, applyStroke, fauxBold, fauxItalic, allCaps, smallCaps, justification.

Params: `comp` oneOf, `layer`* oneOf, `font` string, `fontSize` number, `fillColor` array, `strokeColor` array, `strokeWidth` number, `tracking` number, `leading` number, `applyFill` boolean, `applyStroke` boolean, `fauxBold` boolean, `fauxItalic` boolean, `allCaps` boolean, `smallCaps` boolean, `justification` string(LEFT_JUSTIFY|RIGHT_JUSTIFY|CENTER_JUSTIFY)

### `toggle_layer_state`
Toggle (or set) a boolean-ish layer property in batch. prop: enabled|solo|shy|locked|threeDLayer|motionBlur|adjustmentLayer|guideLayer|collapseTransformation. If `value` provided, sets to that; otherwise toggles.

Params: `comp` oneOf, `layers` oneOf, `prop`* string(enabled|solo|shy|locked|threeDLayer|motionBlur|adjustmentLayer|guideLayer|collapseTransformation), `value` boolean

### `set_color_label`
Set AE color label (0–16). Either pass project itemIds (footage/comps) OR comp+layers (timeline layers).

Params: `label`* integer, `comp` oneOf, `layers` oneOf, `itemIds` array

### `set_in_out`
Set a layer's in/out points. Either time (seconds) or frame for each.

Params: `comp` oneOf, `layer`* oneOf, `inTime` number, `inFrame` integer, `outTime` number, `outFrame` integer

### `set_layer_blend_mode`
Set blending mode. Common modes: NORMAL, MULTIPLY, SCREEN, OVERLAY, ADD, LIGHTEN, DARKEN, COLOR_DODGE, COLOR_BURN, SOFT_LIGHT, HARD_LIGHT, DIFFERENCE, EXCLUSION, HUE, SATURATION, COLOR, LUMINOSITY, ALPHA_ADD.

Params: `comp` oneOf, `layers` oneOf, `mode`* string

### `set_quality`
Set layer quality: BEST | DRAFT | WIREFRAME.

Params: `comp` oneOf, `layers` oneOf, `quality`* string(BEST|DRAFT|WIREFRAME)

## razor / work area

### `split_layer_at_time`
Split (razor) layers at the given time. Each layer is duplicated; original ends at time, duplicate starts at time.

Params: `comp` oneOf, `layers` oneOf, `time` number, `frame` integer

### `set_work_area`
Set comp work area in/out (seconds or frames).

Params: `comp` oneOf, `inTime` number, `inFrame` integer, `outTime` number, `outFrame` integer

### `set_work_area_to_selection`
Set comp work area to span the in/out points of the currently selected layers.

Params: `comp` oneOf

### `trim_to_work_area`
Trim the comp duration to its work area, shifting layers so work-area start becomes time 0.

Params: `comp` oneOf

## cameras / lights

### `add_camera`
Add a camera. oneNode=true makes it free (no point of interest). Default position: comp center, 1777.78 back.

Params: `comp` oneOf, `name` string, `oneNode` boolean, `position` array

### `add_light`
Add a light. type: PARALLEL | SPOT | POINT | AMBIENT.

Params: `comp` oneOf, `name` string, `type` string(PARALLEL|SPOT|POINT|AMBIENT), `position` array, `intensity` number, `color` array

## presets

### `apply_preset_ffx`
Apply a .ffx animation preset to a layer.

Params: `comp` oneOf, `layer`* oneOf, `path`* string

### `apply_mogrt`
Import a .mogrt motion graphics template into the comp at position/time.

Params: `comp` oneOf, `path`* string, `position` array, `time` number

## render queue

### `render_queue_add`
Add a comp to the render queue. Optional outputPath (per first output module), templateName (render settings), outputModuleTemplate.

Params: `comp` oneOf, `outputPath` string, `templateName` string, `outputModuleTemplate` string

### `start_render`
Start rendering the queue. Blocks AE until done — use render_queue_status to poll progress from another conversation.

### `render_queue_status`
Read render queue status: items, status per item, output paths.

### `clear_render_queue`
Remove all items from the render queue.

### `list_om_templates`
List Output Module templates available in AE (names you can pass as outputModuleTemplate). AE 2026 cannot script codec/Format changes — codec must come from a saved OM template.

### `list_rs_templates`
List Render Settings templates available in AE (names you can pass as templateName to render_queue_add).

### `save_om_template`
Save the currently-selected render queue item's OutputModule(1) settings as a new Output Module template. Use after manually configuring an OM in AE (e.g. ProRes 422 + audio off) so future renders can apply it by name via render_queue_add. Optional itemIndex (default: last queued item).

Params: `name`* string, `itemIndex` integer

### `render_queue_add_batch`
Queue multiple comps in one call with the same Render Settings + Output Module template + output directory. Filename derives from comp name + optional suffix + .ext from template. Skips comps not found. Returns per-comp result.

Params: `comps`* array, `outputDir`* string, `templateName` string, `outputModuleTemplate` string, `filenameSuffix` string, `extension` string

## project hygiene actions

### `reduce_project`
Delete all unused project items (footage/comps with empty usedIn). Read analyze_unused first to preview.

### `consolidate_footage`
Merge duplicate footage items in the project. Returns count consolidated.

### `collect_files`
AE has no scripted Collect Files API; this returns guidance. For real collect-files, use AE's File menu.

Params: `targetPath` string

### `find_missing_footage`
List footage items currently flagged as missing (offline media).

## undo / redo

### `undo`
Trigger AE's Undo (Cmd+Z equivalent). Use cautiously — undoes the last AE action regardless of source.

### `redo`
Trigger AE's Redo.

## reveal

### `reveal_in_finder`
Open Finder with the layer's source file selected. Pass either path (filesystem path) or layer (in active comp).

Params: `path` string, `layer` oneOf

### `reveal_project_in_finder`
Open Finder with the AE project file selected.

## knowledge fast lookups (in-memory, zero latency)

### `lookup_effect`
Fast lookup of AE effect matchNames (213 effects). Returns top matches by displayName / matchName / category. Use this BEFORE apply_effect when unsure of the exact name — it's faster than reading the whole knowledge resource.

Params: `query`* string, `limit` integer

### `lookup_property`
Fast lookup of AE property matchNames (108 properties: transforms, masks, layer styles, text, shapes, effects, 3D extrusion). Returns matchName + displayName + access path.

Params: `query`* string, `limit` integer

### `lookup_expression`
Fast lookup of expression snippets (188 entries: wiggle/loop/bounce variants, Dan Ebberts patterns, effect-templates, operation-templates). Returns ready-to-paste expression code.

Params: `query`* string, `limit` integer

### `knowledge_search`
Full-text search across all 18 knowledge files (effect/property matchnames, expressions, layer methods, motion design concepts, scripting API reference, troubleshooting, AE features, keyboard shortcuts, etc.). Returns file + line + snippet. Use when none of the structured lookups fit.

Params: `query`* string, `limit` integer

## live events

### `get_recent_events`
Return events the panel has pushed since `since` (epoch ms; defaults to all buffered, max 100). Events: project_opened, comp_opened, selection_changed, items_changed, dirty_changed.

Params: `since` integer

## batch / inspection / timing

### `set_property_batch`
Set a property across MANY layers (or comps) in ONE undo step. Broadcast form: {comp?, layers, prop, value, time?} applies the same value to every listed layer. Targets form: {targets:[{comp?, layer, prop, value, time?}, ...]} for per-target values. Returns per-target {ok,error}. Use instead of calling set_property N times (stat-card / box-rig work).

Params: `comp` oneOf, `layers` array, `prop` string, `value`, `time` number, `targets` array

### `batch`
Run many portal tools in ONE round-trip and ONE undo group (atomic: a single Undo reverts the whole batch). stopOnError (default true) halts at the first failing op. Only JSX-routed mutation/read tools are allowed — not render_frame, whisper, import_folder, run_jsx, reload_host, or batch itself. Returns per-op results plus appliedCount/failedAt.

Params: `operations`* array, `stopOnError` boolean

### `get_layer_bounds`
Read a layer's rendered bounds at a time: sourceRectAtTime (left/top/width/height in layer space) + Position/Anchor/Scale + the comp-space visual center. includeExtents:true also returns the on-screen bounding box (corners transformed to comp space). The measurement primitive behind responsive-box and counter-centering rigs.

Params: `comp` oneOf, `layer`* oneOf, `time` number, `frame` integer, `includeExtents` boolean

### `describe_layer`
Full snapshot of ONE layer: type, enabled/3D, in/out/startTime/stretch, blend mode, track matte, parent chain, transform (with keyframes), effects, markers, source rect — optionally masks/shapeContents/textAnimators. Cheaper than deep-mapping a whole comp when you only need one layer before a targeted edit.

Params: `comp` oneOf, `layer`* oneOf, `includeTransform` boolean, `includeEffects` boolean, `includeKeyframes` boolean, `includeMasks` boolean, `includeShapeContents` boolean, `includeTextAnimators` boolean

### `sample_property`
Sample a property's VALUE over time (post-expression) as a {time,frame,value} series. Verify expression-driven motion — counters, wiggle, slider-driven box growth — numerically without rendering pixels. Defaults to the layer in→out range at 1-frame steps; pass step (seconds) or frames (sample count). Capped at 500 samples.

Params: `comp` oneOf, `layer`* oneOf, `prop`* string, `startTime` number, `endTime` number, `startFrame` integer, `endFrame` integer, `step` number, `frames` integer

### `markers_to_keyframes`
Turn timed markers into animation — closes the caption pipeline after whisper_transcribe + add_markers_batch. mode="inout" (default): set each target layer's in/out points to consecutive marker times (per-word/per-line reveals). mode="keyframe": drop a key on `prop` at every marker time (value from `value`, or the sampled current value), optionally HOLD-interpolated. Markers read from markerLayer, else comp markers.

Params: `comp` oneOf, `layers`* array, `markerLayer` oneOf, `mode` string(inout|keyframe), `prop` string, `value`, `hold` boolean, `lastDuration` number

### `audit_fonts`
Audit fonts across the project (or one comp): which fonts are used, by which text layers, and which appear SUBSTITUTED/missing (requested PostScript name ≠ resolved font). A pre-render and handoff safety check. Returns missingFonts[] + a per-font usage map.

Params: `comp` oneOf

## geometry: mask & shape paths

### `get_path`
Read a mask or shape path's geometry. Target a mask via `mask` (name or 1-based index) OR a shape-layer path via `shapePath` (a dotted display path like "Contents.Shape 1.Path", or an ADBE matchName resolving to / containing an "ADBE Vector Shape") / `shapeIndex` (1-based group index inside Contents). Pass time/frame to sample a keyframed path; otherwise the static value is read. Tangents are [x,y] RELATIVE to their vertex. Returns {vertices,inTangents,outTangents,closed,numKeys}.

Params: `comp` oneOf, `layer`* oneOf, `mask` oneOf, `shapePath` string, `shapeIndex` integer, `time` number, `frame` integer

### `set_path`
Write a mask or shape path's geometry. Same target selector as get_path (mask / shapePath / shapeIndex). `vertices` is required (array of [x,y] in layer space). inTangents/outTangents are optional (each [x,y] relative to its vertex) and default to zero — straight corners — and must match the vertex count when given. closed defaults true. With time/frame the path is keyframed at that time; otherwise it is set statically (or keyed at the current time if the path is already keyframed). Returns a read-back {kind,mode,vertices,closed,numKeys}.

Params: `comp` oneOf, `layer`* oneOf, `mask` oneOf, `shapePath` string, `shapeIndex` integer, `vertices`* array, `inTangents` array, `outTangents` array, `closed` boolean, `time` number, `frame` integer

### `add_mask`
Create a mask on a layer. mode maps to MaskMode (add/subtract/intersect/difference/none; default add). `shape` is optional: an explicit {vertices,inTangents,outTangents,closed} OR a primitive {rect:[x,y,w,h]} / {ellipse:[x,y,w,h]} with a top-left origin (a 4-point rect or a 4-anchor bezier ellipse is generated). feather ([x,y] or a single number), expansion (px), and opacity (0-100) are optional. Returns {mask,index,mode,closed}.

Params: `comp` oneOf, `layer`* oneOf, `name` string, `mode` string(add|subtract|intersect|difference|none), `shape` object, `feather` oneOf, `expansion` number, `opacity` number

## watch mode

### `watch_start`
Start watch mode (Stage A fidelity). Hooks view.onSync in AE — on every real edit the active comp is snapshotted (keyed by stable layer.id) and diffed. Detects: comp-wide layer add/delete; transform + Orientation value/keyframe changes; keyframe ease/interp changes; which key TIMES were deleted; effect param changes (keyed by index+matchName so rename/reorder is not misattributed); mask + shape-layer PATH point drags; and parenting / blend mode / in-out / enabled / text (font,size,text) / text-animator changes. Selection, solo, shy, view and scrub changes are filtered out. Use watch_get_log to retrieve entries.

Params: `scope` string(selected|comp)

### `watch_stop`
Stop watch mode and remove the onSync hook.

### `watch_get_log`
Get watch log entries since a given index (default 0). Returns { entries, total }. Each entry: { ts, comp, layer, prop, change, value?, old?, time? }. change values: "value" (static or effect-param change) | "key_add" (+ time,value) | "key_del" (+ count, times[] of removed key times) | "key_mod" (+ time, old, value) | "key_ease" (interp/temporal-ease change; + time, keyIndex) | "path_change" (mask/shape path point drag; + vertexCount; prop names the target e.g. "mask:Mask 1" or "shape#1") | "layer_add" (+ id, index) | "layer_del" (+ id) | "parent" | "blend" | "in_point" | "out_point" | "enabled" | "text" | "font" | "font_size" | "text_animator" (each with old/value) | "log_full" (cap reached).

Params: `since` integer

### `watch_clear`
Clear the watch log.

### `watch_status`
Returns { active, entries, rev, scope } — whether watch is running, how many entries are in the log, and the deep-diff scope ("selected" | "comp").

### `watch_get_replay`
Convert the current watch recording into an ordered batch of portal tool calls that reproduces what was done — feed the returned operations straight to the `batch` tool. Layer/comp targets use {id} addressing. Returns { operations:[{tool,args}], count, unmapped:[...] } (plus deltas[] when relative:true). Mapping: value edits → set_property; key_add/key_mod → add_keyframe; path_change → set_path; parent → parent_layers; blend → set_layer_blend_mode; in_point/out_point → set_in_out; enabled → toggle_layer_state; text → set_text; layer_del → delete_layer. Non-reproducible edits (layer_add, key_del, key_ease with no recorded ease values, font/font_size/text_animator) go to unmapped with a human note — never fabricated. dedupe (default true) collapses a drag's many intermediate value samples to the final value per layer+prop.

Params: `relative` boolean, `dedupe` boolean

## multi-instance

### `list_instances`
List the After Effects instances the portal can currently reach (discovered automatically — one per AE that has the AE Portal panel open). Each entry shows its id (the AE year, e.g. "2026"), port, AE version, open project, and whether it is connected. Use this when more than one AE is open so you know what to pass as the `instance` argument.

### `use_instance`
Set the default After Effects instance that subsequent commands target when they don't pass their own `instance`. Accepts an instance id ("2026"/"2025"), an AE major ("26"), or a port. A per-call `instance` argument always overrides this. Useful when two AEs are open and you want to work in one for a while without repeating `instance` on every call.

Params: `instance`* string

### `add_text_animator`
Add a Text Animator (with an explicit Range Selector) to a text layer in one call — the missing text-motion verb for typewriter / cascade / word-reveal builds. `properties` maps any of position [x,y], opacity, scale [x,y], rotation, tracking, blur to their animated values. `basedOn` sets the selector units (characters/word/line). Optional static `range` {start,end,offset} (percent). For a sweep, pass `revealFrom`/`revealTo` (seconds): the selector Offset is keyframed for a left-to-right reveal (inverted ramp; band defaults to Start=0,End=25 if `range` omitted), with optional `ease` (in/out/inout, influence 75).

Params: `comp` oneOf, `layer`* oneOf, `properties` object, `basedOn` string(characters|charactersExcludingSpaces|words|lines), `range` object, `revealFrom` number, `revealTo` number, `ease` string(in|out|inout), `name` string

### `animate_trim_paths`
Add + keyframe a Trim Paths modifier on a shape/path layer — the classic draw-on. Animates the chosen trim prop from `from` to `to` (percent) across the `over` [startSec,endSec] window. `mode` picks which prop: "end" (default, draw-on), "start", or "offset". Optional `ease` (in/out/inout, influence 75).

Params: `comp` oneOf, `layer`* oneOf, `from` number, `to` number, `over`* array, `mode` string(end|start|offset), `ease` string(in|out|inout)

### `set_shape_style`
Style a shape group's fill and/or stroke in one call — Fill/Stroke are found or ADDED as needed. Colors accept a hex string ("#rrggbb"/"#rgb") or an [r,g,b] array (0–1 or 0–255, auto-normalized). `group` targets a shape group by name or 1-based index (default: first group). Optional fillOpacity/strokeOpacity (0–100), strokeWidth, and `dash` (array of numbers or [dash,gap] pairs; up to 3 pairs). Returns the read-back fill/stroke/width.

Params: `comp` oneOf, `layer`* oneOf, `group` oneOf, `fill` oneOf, `fillOpacity` number, `stroke` oneOf, `strokeWidth` number, `strokeOpacity` number, `dash` array

### `fit_box_to_text`
Create (or update) a rounded-rectangle background shape that tracks a text layer's bounds + padding, placed directly BEHIND the text. mode="expression" (default) live-links the box Size + Position to the text's sourceRectAtTime every frame, so the box follows edits and animation; mode="bake" computes once at the current comp time and sets static values. `padding` is a number (all sides), [x,y], or [left,top,right,bottom] px. `corner` = rounded-corner radius. `color` (hex "#rrggbb"/"#rgb" or [r,g,b(,a)], 0–1 or 0–255, auto-normalized) + `opacity` (0–100) style the fill (default black). Pass `boxLayer` to update an existing box instead of creating a new one. Returns { boxLayer, mode, expressionError }.

Params: `comp` oneOf, `textLayer`* oneOf, `padding` oneOf, `corner` number, `color` oneOf, `opacity` number, `mode` string(expression|bake), `boxLayer` oneOf, `name` string

### `add_counter`
Number counter driven A→B by a keyframed Slider control feeding a source-text expression — the responsive-counter primitive. Target an existing text `layer`, or pass create:true (+ optional `position`, `fontSize`, `name`) to make a new one. A slider (named by `sliderName`, default "Counter") is keyframed `from`→`to` across `over` [startSec,endSec], with optional `ease`. The source-text expression (built WITHOUT toFixed) applies `decimals`, optional `thousands` separators (`separator` char, default ","), `prefix`, and `suffix`. Returns { layer, slider, from, to, over, expression, expressionError }.

Params: `comp` oneOf, `layer` oneOf, `create` boolean, `position` array, `fontSize` number, `name` string, `from` number, `to` number, `over`* array, `ease` string(in|out|inout), `decimals` integer, `thousands` boolean, `separator` string, `prefix` string, `suffix` string, `sliderName` string

### `find_replace_text`
Find/replace text across TextLayers, project-wide or scoped to one `comp`. dryRun defaults to TRUE — it reports every match (comp, layer, before, after, count) WITHOUT changing anything; pass dryRun:false to apply. `matchCase` (default false) and `wholeWord` (manual word-boundary test — no regex) refine matching. Replacement preserves the text layer's document properties (uniform styling); keyframed source-text layers are reported but skipped. Returns { scanned, matches, replaced, dryRun }.

Params: `comp` oneOf, `find`* string, `replace` string, `matchCase` boolean, `wholeWord` boolean, `dryRun` boolean

## effect stacks + expression-safe rename

### `copy_effects`
Clone an effect stack from a source layer to one or more dest layers. For each effect it adds the effect by matchName, then copies every settable parameter value, its keyframes (full fidelity — interp/ease/spatial tangents), and any expressions. Copies ALL source effects by default; pass `effects` (names and/or 1-based indices) to copy a subset (in source order). `clearExisting` removes each dest layer's existing effects first (rejected when a dest is the source layer itself). Dest layers may live in another comp via `destComp`. CUSTOM_VALUE / ARB parameters (e.g. Curves curves, Colorama gradients) are NOT script-copyable — they are skipped and listed in `skippedParams` ("Effect > Param"). Returns { copiedTo:[{layer,index,effects,failed?}], effectsCopied, skippedParams, effectsNotFound? }.

Params: `comp` oneOf, `source`* object, `dest`* oneOf, `destComp` oneOf, `effects` oneOf, `clearExisting` boolean

### `reorder_effects`
Reorder effects on a layer within its Effect Parade (1-based indices). Single move: pass `effect` (name or 1-based index) + `toIndex`. Full reorder: pass `order` (the desired list of effect names) and every named effect is moved into that sequence. Returns { effect, fromIndex, toIndex } for a single move, or { reordered:[{effect,fromIndex,toIndex}|{effect,error}] } for a full reorder.

Params: `comp` oneOf, `layer`* oneOf, `effect` oneOf, `toIndex` integer, `order` array

### `safe_rename`
Expression-safe rename of a LAYER (or a comp). A plain rename silently breaks name-based expression references — this runs the 5-step: (1) scan every comp for expressions referencing layer("oldName"), (2) build the update map, (3) rewrite oldName->newName in those expressions FIRST, (4) rename the layer, (5) force re-enable any expression AE disabled during the change. dryRun (default false) reports which expressions WOULD change without touching anything. For a comp rename pass `renameComp` instead of `layer`; the comp is renamed but cross-comp comp("oldName") references are NOT auto-updated (called out in the result note). Returns { renamed, from, to, kind, expressionsUpdated:[{comp,layer,prop}], reEnabled:[...], dryRun, note? }.

Params: `comp` oneOf, `layer` oneOf, `renameComp` oneOf, `newName`* string, `dryRun` boolean

## audit / brand / captions

### `search_project`
READ-ONLY project-wide search — a delivery-audit tool. Walks every comp (by id) → layers → the surface named by `by`, WITHOUT changing anything. `by`: "effect" (layers whose Effect Parade has an effect whose name/matchName contains `query`), "expression" (properties whose expression text contains `query`), "font" (TextLayers whose font contains `query`), "text" (TextLayers whose text contains `query`), "footage" (FootageItems whose name/path contains `query`, with the comps they are used in), or "missing" (FootageItems flagged footageMissing — `query` optional/ignored). Matching is case-insensitive substring. Returns { by, query, hits:[{comp, layer|item, detail}], count }.

Params: `by`* string(effect|expression|font|text|footage|missing), `query` string

### `swap_color`
Find/replace a color across the project — the client brand-color-change primitive. `from`/`to` accept a hex string ("#rrggbb"/"#rgb") or an [r,g,b(,a)] array (0–1 or 0–255, auto-normalized). A color matches when every RGB channel is within `tolerance` (0–1 per-channel, default 0.02) of `from`. dryRun defaults to TRUE — it reports every match WITHOUT changing anything; pass dryRun:false to apply. `scope` limits to one comp (name or id); omit for the whole project. `include` selects which color surfaces to touch (solids, shapeFill, shapeStroke, textFill, effectColor); omit for all. Setting a SOLID recolors every layer sharing that footage item (swapped once, flagged shared:true, called out in `note`). Keyframed colors are matched but SKIPPED (setValue would delete keys). Returns { from, to, tolerance, matches:[{comp, layer, surface, was, ...}], matchCount, swapped, dryRun, note? }.

Params: `from`* oneOf, `to`* oneOf, `tolerance` number, `scope` oneOf, `dryRun` boolean, `include` array

### `build_captions`
Turn a transcript into timed, wrapped, styled caption text layers — closes the whisper→captions loop. Provide `segments` ([{text,start,end}] in seconds) OR `srt` (raw SRT string; "HH:MM:SS,mmm --> HH:MM:SS,mmm" blocks are parsed). mode="layers" (default) creates one text layer per segment timed to [start,end]; mode="single" creates ONE layer with a source-text expression that shows the active segment by `time` from an embedded table. `maxCharsPerLine` word-wraps long lines (0 = no wrap). `style` = { font, fontSize, fillColor (hex or [r,g,b(,a)]), position [x,y], justification, box (true or [w,h] for paragraph/box text) } — captions default to centered near the lower third. Returns { mode, created, layers:[...] } (single mode also returns expression + expressionError).

Params: `comp` oneOf, `segments` array, `srt` string, `mode` string(layers|single), `maxCharsPerLine` integer, `name` string, `style` object

