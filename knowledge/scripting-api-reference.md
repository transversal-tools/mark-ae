# After Effects ExtendScript API Reference

Complete reference for generating accurate ExtendScript code.
Based on official Adobe After Effects Scripting Guide.

---

## OBJECT MODEL HIERARCHY

```
Application (app)
├── Project (app.project)
│   ├── Items collection (project.items / project.item(index))
│   │   ├── CompItem (compositions)
│   │   │   ├── Layers collection (comp.layers / comp.layer(index))
│   │   │   │   ├── AVLayer (footage, solids, adjustments)
│   │   │   │   ├── TextLayer
│   │   │   │   ├── ShapeLayer
│   │   │   │   ├── CameraLayer
│   │   │   │   └── LightLayer
│   │   │   └── MarkerCollection
│   │   ├── FolderItem
│   │   ├── FootageItem
│   │   └── SolidSource
│   ├── RenderQueue
│   │   └── RenderQueueItems → RenderQueueItem → OutputModules
│   └── ImportOptions
└── Settings (app.settings)
```

---

## APPLICATION OBJECT (app)

### Properties
```jsx
app.project                    // Project object
app.version                    // String "25.0" etc
app.buildName                  // Build identifier
app.buildNumber                // Build number
app.isRenderEngine             // Boolean if render-only mode
app.isoLanguage                // "en_US" etc
app.settings                   // Preferences access
app.memoryInUse                // Bytes used
app.activeViewer               // Current viewer panel
```

### Methods
```jsx
app.newProject()                           // Create new project
app.open(file)                             // Open project file
app.quit()                                 // Quit AE
app.beginSuppressDialogs()                 // Suppress dialogs
app.endSuppressDialogs(alert)              // End suppress (bool: show alerts)
app.setMemoryUsageLimits(imageCachePercent, maxMemPercent)
app.setSavePreferencesOnQuit(doSave)
app.saveProjectOnCrash(file)
app.pauseWatchFolder(pause)

// IMPORTANT: Menu commands
app.findMenuCommandId(commandName)         // Get command ID
app.executeCommand(commandId)              // Execute command

// ⚠️ NEVER USE IN SCRIPTS:
// app.beginUndoGroup() / app.endUndoGroup() - Host handles this!
```

### Menu Command Examples
```jsx
// Get command ID, then execute
var cmdId = app.findMenuCommandId("Import File...");
app.executeCommand(cmdId);

// Common commands
app.executeCommand(app.findMenuCommandId("New Composition..."));
app.executeCommand(app.findMenuCommandId("RAM Preview"));
app.executeCommand(app.findMenuCommandId("Save"));
app.executeCommand(app.findMenuCommandId("Effects & Presets"));
```

---

## PROJECT OBJECT (app.project)

### Properties
```jsx
project.file                   // File object (null if unsaved)
project.rootFolder             // FolderItem for root
project.items                  // ItemCollection
project.numItems               // Number of items
project.activeItem             // Currently active CompItem or null
project.selection              // Array of selected items
project.renderQueue            // RenderQueue object
project.bitsPerChannel         // 8, 16, or 32
project.linearBlending         // Boolean
project.gpuAccelType           // GPU acceleration type
project.xmpPacket              // XMP metadata string
project.workingSpace           // Color working space
project.workingGamma           // Gamma value
project.displayStartFrame      // Display frame numbering start
project.framesUseFeetFrames    // Boolean
project.feetFramesFilmType     // Film type for feet+frames
project.framesCountType        // Frame count type
project.timeDisplayType        // Time display format
project.footageTimecodeDisplayStartType
project.expressionEngine       // "javascript-1.0" or "extendscript"
```

### Methods
```jsx
project.save()                              // Save project
project.saveWithDialog()                    // Save As dialog
project.close(closeOption)                  // Close (CloseOptions enum)
project.importFile(importOptions)           // Import file
project.importPlaceholder(name, w, h, fps, dur)
project.importFileWithDialog()              // Import with dialog
project.showWindow(show)                    // Show/hide panels
project.autoFixExpressions(oldText, newText) // Fix expressions
project.consolidateFootage()                // Remove unused
project.removeUnusedFootage()               // Remove unused footage
project.reduceProject(items)                // Remove all except items
project.setDefaultImportFolder(folder)
project.team_projects_showSyncDialog()
project.team_projects_sync()
```

### Item Creation
```jsx
// Create composition
project.items.addComp(name, width, height, pixelAspect, duration, frameRate)

// Create folder
project.items.addFolder(name)

// The root folder
project.rootFolder.items.addFolder(name)  // Add to root

// Import footage
var io = new ImportOptions(new File(path));
project.importFile(io);
```

---

## COMPOSITION (CompItem)

### Properties
```jsx
comp.name                      // Composition name
comp.width                     // Width in pixels
comp.height                    // Height in pixels
comp.pixelAspect               // Pixel aspect ratio
comp.frameRate                 // Frames per second
comp.frameDuration             // Duration of single frame
comp.duration                  // Duration in seconds
comp.time                      // Current time in seconds
comp.workAreaStart             // Work area start time
comp.workAreaDuration          // Work area duration
comp.numLayers                 // Number of layers
comp.layers                    // LayerCollection
comp.selectedLayers            // Array of selected layers
comp.selectedProperties        // Array of selected properties
comp.activeCamera              // Current camera layer or null
comp.bgColor                   // Background color [r,g,b]
comp.resolutionFactor          // [h, v] resolution factor
comp.shutterAngle              // Motion blur shutter
comp.shutterPhase              // Motion blur phase
comp.motionBlur                // Motion blur enabled
comp.draft3d                   // Draft 3D mode
comp.frameBlending             // Frame blending enabled
comp.preserveNestedFrameRate
comp.preserveNestedResolution
comp.renderer                  // "ADBE Advanced 3d" etc
comp.markerProperty            // Marker property group
comp.displayStartTime          // Display start offset
comp.hideShyLayers             // Hide shy layers
```

### Methods
```jsx
comp.layer(index)              // Get layer by index (1-based)
comp.layer(name)               // Get layer by name
comp.layer(otherLayer, index)  // Get relative layer

// Save frame as image
comp.saveFrameToPng(time, file)
comp.saveFrameToPng(time, file, options)

// Open in viewer
comp.openInViewer()

// RAM preview
comp.ramPreviewTest(unknown, playFrom, playTo)

// Duplicate
comp.duplicate()
```

### Layer Creation Methods
```jsx
// Add layers
comp.layers.addNull()                       // Null object
comp.layers.addNull(duration)               // With duration
comp.layers.addSolid(color, name, w, h, pixelAspect)
comp.layers.addSolid(color, name, w, h, pixelAspect, duration)
comp.layers.addText(sourceText)             // Text layer
comp.layers.addText()                       // Empty text layer
comp.layers.addBoxText([width, height], sourceText)
comp.layers.addShape()                      // Shape layer
comp.layers.addCamera(name, centerPoint)    // Camera layer
comp.layers.addLight(name, centerPoint)     // Light layer
comp.layers.add(item)                       // Add footage/comp as layer
comp.layers.add(item, duration)             // With duration

// Precomping (DO NOT USE - opens dialog!)
// Use manual precomp instead (see below)
```

### Manual Precompose (Silent)
```jsx
// ⚠️ comp.layers.precompose() opens a dialog - DON'T USE!
// Instead, manually create precomp:

(function() {
    var comp = app.project.activeItem;
    var layers = comp.selectedLayers;
    if (layers.length === 0) return;
    
    // 1. Create new comp
    var precomp = app.project.items.addComp(
        "Pre-comp",
        comp.width,
        comp.height,
        comp.pixelAspect,
        comp.duration,
        comp.frameRate
    );
    
    // 2. Store layer data before modifying
    var layerData = [];
    for (var i = 0; i < layers.length; i++) {
        layerData.push({
            layer: layers[i],
            index: layers[i].index
        });
    }
    
    // 3. Copy each layer to precomp (reverse order to maintain stacking)
    for (var i = layerData.length - 1; i >= 0; i--) {
        layerData[i].layer.copyToComp(precomp);
    }
    
    // 4. Add precomp as layer
    var precompLayer = comp.layers.add(precomp);
    
    // 5. Remove original layers (reverse order!)
    for (var i = layerData.length - 1; i >= 0; i--) {
        layerData[i].layer.remove();
    }
})();
```

---

## LAYERS (Layer, AVLayer, TextLayer, ShapeLayer, etc.)

### Common Layer Properties (All Layer Types)
```jsx
layer.name                     // Layer name
layer.index                    // Stack order (1 = top)
layer.parent                   // Parent layer or null
layer.source                   // Source item (footage/comp)
layer.containingComp           // Parent composition
layer.time                     // Current time
layer.startTime                // Layer start time
layer.inPoint                  // In point
layer.outPoint                 // Out point
layer.enabled                  // Visibility (eyeball)
layer.solo                     // Solo state
layer.shy                      // Shy state
layer.locked                   // Lock state
layer.comment                  // Layer comment
layer.label                    // Label color (0-16)
layer.autoOrient               // AutoOrientType enum
layer.marker                   // Marker property
layer.selected                 // Selection state
layer.hasVideo                 // Has video content
layer.active                   // Active at current time
layer.nullLayer                // Is null layer (AVLayer only)
layer.selectedProperties       // Selected properties array
```

### AVLayer Specific Properties
```jsx
layer.source                   // FootageItem or CompItem
layer.isNameFromSource         // Name from source
layer.height                   // Source height
layer.width                    // Source width
layer.audioEnabled             // Audio enabled
layer.audioActive              // Audio active at time
layer.effectsActive            // Effects enabled
layer.motionBlur               // Motion blur enabled
layer.threeDLayer              // 3D layer enabled
layer.threeDPerChar            // 3D per character (text)
layer.environmentLayer         // Is environment layer
layer.guideLayer               // Is guide layer
layer.adjustmentLayer          // Is adjustment layer
layer.timeRemapEnabled         // Time remap enabled
layer.hasTrackMatte            // Has track matte
layer.trackMatteType           // TrackMatteType enum
layer.trackMatteLayer          // Track matte layer
layer.preserveTransparency     // Preserve transparency
layer.isNameSet                // Name manually set
layer.blendingMode             // BlendingMode enum
layer.canSetCollapseTransformation
layer.collapseTransformation   // Collapse/continuous raster
layer.frameBlending            // Frame blend enabled
layer.frameBlendingType        // FrameBlendingType enum
layer.canSetTimeRemapEnabled   // Can enable time remap
layer.samplingQuality          // LayerSamplingQuality enum
```

### AVLayer Methods
```jsx
layer.duplicate()              // Duplicate layer
layer.remove()                 // Delete layer
layer.moveToBeginning()        // Move to top
layer.moveToEnd()              // Move to bottom
layer.moveAfter(otherLayer)    // Move after layer
layer.moveBefore(otherLayer)   // Move before layer
layer.setParentWithJump(parent) // Parent without moving
layer.copyToComp(comp)         // Copy to another comp
layer.replaceSource(newSource, fixExpr) // Replace source
layer.sourceRectAtTime(time, extents) // Get bounds
layer.openInViewer()           // Open in Layer panel
layer.activeAtTime(time)       // Active at specific time
layer.calculateTransformFromPoints(p0,p1,p2,target0,target1,target2)
layer.applyPreset(file)        // Apply animation preset
```

### TextLayer Specific
```jsx
// Access text content
var textProp = layer.property("Source Text");
var textDoc = textProp.value;  // TextDocument object

// TextDocument properties
textDoc.text                   // String content
textDoc.font                   // Font name
textDoc.fontSize               // Size in pixels
textDoc.fillColor              // [r,g,b] 0-1
textDoc.strokeColor            // [r,g,b] 0-1
textDoc.strokeWidth            // Stroke width
textDoc.applyFill              // Fill enabled
textDoc.applyStroke            // Stroke enabled
textDoc.strokeOverFill         // Stroke over fill
textDoc.justification          // ParagraphJustification enum
textDoc.tracking               // Tracking value
textDoc.baselineLocs           // Baseline info (read-only)
textDoc.allCaps                // All caps
textDoc.smallCaps              // Small caps
textDoc.superscript            // Superscript
textDoc.subscript              // Subscript
textDoc.verticalScale          // Vertical scale %
textDoc.horizontalScale        // Horizontal scale %
textDoc.baselineShift          // Baseline shift
textDoc.tsume                  // Tsume value (CJK)
textDoc.leading                // Line spacing
textDoc.autoLeading            // Auto leading
textDoc.fauxBold               // Faux bold
textDoc.fauxItalic             // Faux italic

// Set text
textDoc.text = "New text";
textProp.setValue(textDoc);
```

### ShapeLayer Specific
```jsx
// Access shape contents
var contents = layer.property("Contents");  // PropertyGroup

// Shape path groups (created via addProperty)
contents.addProperty("ADBE Vector Group");           // Group
contents.addProperty("ADBE Vector Shape - Ellipse"); // Ellipse
contents.addProperty("ADBE Vector Shape - Rect");    // Rectangle
contents.addProperty("ADBE Vector Shape - Star");    // Polystar
contents.addProperty("ADBE Vector Shape - Group");   // Path
contents.addProperty("ADBE Vector Graphic - Fill");  // Fill
contents.addProperty("ADBE Vector Graphic - Stroke");// Stroke
contents.addProperty("ADBE Vector Graphic - G-Fill");// Gradient fill
contents.addProperty("ADBE Vector Graphic - G-Stroke");// Gradient stroke
contents.addProperty("ADBE Vector Filter - Merge");  // Merge paths
contents.addProperty("ADBE Vector Filter - Offset"); // Offset paths
contents.addProperty("ADBE Vector Filter - PB");     // Pucker & Bloat
contents.addProperty("ADBE Vector Filter - Repeater");// Repeater
contents.addProperty("ADBE Vector Filter - RC");     // Round corners
contents.addProperty("ADBE Vector Filter - Trim");   // Trim paths
contents.addProperty("ADBE Vector Filter - Twist");  // Twist
contents.addProperty("ADBE Vector Filter - Wiggler");// Wiggle paths
contents.addProperty("ADBE Vector Filter - Zigzag"); // Zig zag
```

### CameraLayer Specific
```jsx
layer.cameraOption             // Camera options property group
layer.cameraOption.zoom        // Zoom property
layer.cameraOption.depthOfField // DOF enabled
layer.cameraOption.focusDistance // Focus distance
layer.cameraOption.aperture    // Aperture
layer.cameraOption.blurLevel   // Blur level
layer.cameraOption.irisShape   // Iris shape
layer.cameraOption.irisRotation // Iris rotation
layer.cameraOption.irisRoundness // Iris roundness
layer.cameraOption.irisAspectRatio // Iris aspect
layer.cameraOption.irisDiffractionFringe // Diffraction
layer.cameraOption.highlightGain // Highlight gain (DOF)
layer.cameraOption.highlightThreshold // Highlight threshold
layer.cameraOption.highlightSaturation // Highlight sat
```

### LightLayer Specific
```jsx
layer.lightType               // LightType enum
layer.lightOption             // Light options property group
layer.lightOption.intensity   // Intensity
layer.lightOption.color       // Light color
layer.lightOption.coneAngle   // Spot cone angle
layer.lightOption.coneFeather // Spot feather
layer.lightOption.shadowDarkness // Shadow darkness
layer.lightOption.shadowDiffusion // Shadow diffusion
layer.lightOption.falloff     // Falloff type
layer.lightOption.radius      // Light radius
layer.lightOption.falloffDistance // Falloff distance
layer.lightOption.castsShadows // Casts shadows
```

---

## PROPERTIES

### Accessing Properties
```jsx
// By name (display name)
layer.property("Position")
layer.property("Transform").property("Position")

// By match name (more reliable)
layer.property("ADBE Transform Group").property("ADBE Position")

// Common shortcuts
layer.transform                // Transform group
layer.transform.position       // Position property
layer.transform.scale          // Scale property
layer.transform.rotation       // Rotation (2D)
layer.transform.xRotation      // X Rotation (3D)
layer.transform.yRotation      // Y Rotation (3D)
layer.transform.zRotation      // Z Rotation (3D)
layer.transform.opacity        // Opacity
layer.transform.anchorPoint    // Anchor point
layer.transform.pointOfInterest // Camera/Light POI

// Effects
layer.property("Effects")
layer.property("ADBE Effect Parade")

// Masks
layer.property("Masks")
layer.property("ADBE Mask Parade")
```

### Property Object Properties
```jsx
prop.name                      // Display name
prop.matchName                 // Internal name
prop.propertyIndex             // Index in parent
prop.propertyDepth             // Nesting depth
prop.propertyType              // PropertyType enum
prop.value                     // Current value
prop.hasMax                    // Has maximum
prop.hasMin                    // Has minimum
prop.maxValue                  // Maximum value
prop.minValue                  // Minimum value
prop.isSpatial                 // Is spatial (2D/3D)
prop.canVaryOverTime           // Can have keyframes
prop.canSetExpression          // Can have expression
prop.expression                // Expression string
prop.expressionEnabled         // Expression active
prop.expressionError           // Expression error string
prop.selectedKeys              // Array of selected key indices
prop.numKeys                   // Number of keyframes
prop.selected                  // Property selected
prop.isModified                // Has been modified
prop.propertyGroup             // Parent property group
prop.parentProperty            // Parent property
```

### Property Methods
```jsx
// Value
prop.setValue(value)           // Set static value
prop.valueAtTime(time, preExpr) // Get value at time

// Keyframes
prop.setValueAtTime(time, value) // Set keyframe
prop.addKey(time)              // Add keyframe, return index
prop.removeKey(keyIndex)       // Remove keyframe
prop.keyTime(keyIndex)         // Get key time
prop.keyValue(keyIndex)        // Get key value
prop.setValueAtKey(keyIndex, value) // Change key value
prop.nearestKeyIndex(time)     // Find nearest key
prop.isInterpolationTypeValid(type) // Check if type valid

// Keyframe interpolation
prop.keyInInterpolationType(keyIndex)
prop.keyOutInterpolationType(keyIndex)
prop.setInterpolationTypeAtKey(keyIndex, inType, outType)
// Types: KeyframeInterpolationType.LINEAR, BEZIER, HOLD

// Temporal ease
prop.keyInTemporalEase(keyIndex)  // Array of KeyframeEase
prop.keyOutTemporalEase(keyIndex)
prop.setTemporalEaseAtKey(keyIndex, inEase, outEase)
// inEase/outEase = array of KeyframeEase per dimension

// Spatial tangents (position, anchor)
prop.keyInSpatialTangent(keyIndex)
prop.keyOutSpatialTangent(keyIndex)
prop.setSpatialTangentsAtKey(keyIndex, inTang, outTang)
prop.keyRoving(keyIndex)
prop.setRovingAtKey(keyIndex, roving)
prop.keySpatialAutoBezier(keyIndex)
prop.setSpatialAutoBezierAtKey(keyIndex, autoBez)
prop.keySpatialContinuous(keyIndex)
prop.setSpatialContinuousAtKey(keyIndex, continuous)

// Expression
prop.setExpression(expression)  // Deprecated, use .expression =
```

### KeyframeEase Object
```jsx
// Create easing
var ease = new KeyframeEase(speed, influence);
// speed: velocity (usually 0 for smooth)
// influence: 0-100, how much curve bends

// For easy ease (default smoothness)
var easyEase = new KeyframeEase(0, 33.33);

// For very smooth
var smooth = new KeyframeEase(0, 75);

// For snappy
var snappy = new KeyframeEase(0, 10);

// Application (array per dimension!)
// 1D property (rotation, opacity):
prop.setTemporalEaseAtKey(1, [ease], [ease]);

// 2D property (position, scale):
prop.setTemporalEaseAtKey(1, [ease, ease], [ease, ease]);

// 3D property (3D position):
prop.setTemporalEaseAtKey(1, [ease, ease, ease], [ease, ease, ease]);
```

---

## TRANSFORM PROPERTY MATCH NAMES

### 2D Layer
```jsx
"ADBE Transform Group"         // Transform group
"ADBE Anchor Point"            // Anchor Point
"ADBE Position"                // Position
"ADBE Scale"                   // Scale
"ADBE Rotate Z"                // Rotation (also "ADBE Rotation")
"ADBE Opacity"                 // Opacity
```

### 3D Layer
```jsx
"ADBE Transform Group"         // Transform group
"ADBE Anchor Point"            // Anchor Point
"ADBE Position"                // Position (becomes 3D)
"ADBE Scale"                   // Scale
"ADBE Rotate X"                // X Rotation
"ADBE Rotate Y"                // Y Rotation
"ADBE Rotate Z"                // Z Rotation
"ADBE Orientation"             // Orientation
"ADBE Opacity"                 // Opacity
```

### Camera/Light
```jsx
"ADBE Transform Group"
"ADBE Anchor Point"
"ADBE Position"
"ADBE Rotate X"
"ADBE Rotate Y"
"ADBE Rotate Z"
"ADBE Orientation"
"ADBE Camera Options Group"    // Camera options
"ADBE Camera Zoom"             // Zoom
"ADBE Camera Focus Distance"   // Focus distance
"ADBE Camera Aperture"         // Aperture
"ADBE Camera Blur Level"       // Blur level
```

---

## ENUMERATIONS

### BlendingMode
```jsx
BlendingMode.ADD
BlendingMode.ALPHA_ADD
BlendingMode.CLASSIC_COLOR_BURN
BlendingMode.CLASSIC_COLOR_DODGE
BlendingMode.CLASSIC_DIFFERENCE
BlendingMode.COLOR
BlendingMode.COLOR_BURN
BlendingMode.COLOR_DODGE
BlendingMode.DANCING_DISSOLVE
BlendingMode.DARKEN
BlendingMode.DARKER_COLOR
BlendingMode.DIFFERENCE
BlendingMode.DISSOLVE
BlendingMode.DIVIDE
BlendingMode.EXCLUSION
BlendingMode.HARD_LIGHT
BlendingMode.HARD_MIX
BlendingMode.HUE
BlendingMode.LIGHTEN
BlendingMode.LIGHTER_COLOR
BlendingMode.LINEAR_BURN
BlendingMode.LINEAR_DODGE
BlendingMode.LINEAR_LIGHT
BlendingMode.LUMINESCENT_PREMUL
BlendingMode.LUMINOSITY
BlendingMode.MULTIPLY
BlendingMode.NORMAL
BlendingMode.OVERLAY
BlendingMode.PIN_LIGHT
BlendingMode.SATURATION
BlendingMode.SCREEN
BlendingMode.SILHOUETTE_ALPHA
BlendingMode.SILHOUETTE_LUMA
BlendingMode.SOFT_LIGHT
BlendingMode.STENCIL_ALPHA
BlendingMode.STENCIL_LUMA
BlendingMode.SUBTRACT
BlendingMode.VIVID_LIGHT
```

### TrackMatteType
```jsx
TrackMatteType.ALPHA
TrackMatteType.ALPHA_INVERTED
TrackMatteType.LUMA
TrackMatteType.LUMA_INVERTED
TrackMatteType.NO_TRACK_MATTE
```

### LightType
```jsx
LightType.AMBIENT
LightType.PARALLEL
LightType.POINT
LightType.SPOT
```

### AutoOrientType
```jsx
AutoOrientType.ALONG_PATH
AutoOrientType.CAMERA_OR_POINT_OF_INTEREST
AutoOrientType.CHARACTERS_TOWARD_CAMERA
AutoOrientType.NO_AUTO_ORIENT
```

### KeyframeInterpolationType
```jsx
KeyframeInterpolationType.BEZIER
KeyframeInterpolationType.HOLD
KeyframeInterpolationType.LINEAR
```

### ParagraphJustification
```jsx
ParagraphJustification.CENTER_JUSTIFY
ParagraphJustification.FULL_JUSTIFY_LASTLINE_CENTER
ParagraphJustification.FULL_JUSTIFY_LASTLINE_FULL
ParagraphJustification.FULL_JUSTIFY_LASTLINE_LEFT
ParagraphJustification.FULL_JUSTIFY_LASTLINE_RIGHT
ParagraphJustification.LEFT_JUSTIFY
ParagraphJustification.RIGHT_JUSTIFY
```

---

## FILE AND FOLDER OBJECTS

### File Object
```jsx
var file = new File(path);     // Create file reference
var file = File.openDialog("Title"); // Open dialog

file.exists                    // Boolean
file.name                      // Filename with extension
file.displayName               // Display name
file.path                      // Directory path
file.fsName                    // Full filesystem path
file.absoluteURI               // Full URI
file.parent                    // Parent folder

file.open("r")                 // Open for reading
file.open("w")                 // Open for writing
file.open("a")                 // Open for appending
file.read()                    // Read all content
file.readln()                  // Read line
file.write(text)               // Write text
file.writeln(text)             // Write line
file.close()                   // Close file
file.remove()                  // Delete file
file.copy(target)              // Copy to target
file.rename(newName)           // Rename
```

### Folder Object
```jsx
var folder = new Folder(path);
var folder = Folder.selectDialog("Title");

Folder.temp                    // Temp folder
Folder.desktop                 // Desktop folder
Folder.userData                // User app data

folder.exists                  // Boolean
folder.name                    // Folder name
folder.parent                  // Parent folder
folder.fsName                  // Filesystem path

folder.getFiles()              // Array of files/folders
folder.getFiles("*.jsx")       // Filter by pattern
folder.create()                // Create folder
folder.remove()                // Remove folder
```

---

## IMPORT OPTIONS

```jsx
var io = new ImportOptions(file);
io.file                        // File to import
io.sequence                    // Import as sequence
io.forceAlphabetical           // Force alphabetical order
io.importAs                    // ImportAsType enum

// ImportAsType
ImportAsType.COMP
ImportAsType.COMP_CROPPED_LAYERS
ImportAsType.FOOTAGE
ImportAsType.PROJECT

// Import
var item = project.importFile(io);
```

---

## RENDER QUEUE

```jsx
var rq = app.project.renderQueue;
rq.numItems                    // Number of items
rq.items                       // RQItemCollection
rq.rendering                   // Currently rendering

rq.item(index)                 // Get RQ item
rq.items.add(comp)             // Add comp to queue
rq.render()                    // Start render
rq.pauseRendering(pause)       // Pause/resume
rq.stopRendering()             // Stop render
rq.showWindow(show)            // Show RQ window

// RenderQueueItem
var rqi = rq.item(1);
rqi.comp                       // Source comp
rqi.status                     // RQItemStatus enum
rqi.render                     // Boolean
rqi.startTime                  // Render start time
rqi.elapsedSeconds             // Time spent rendering
rqi.logType                    // LogType enum
rqi.outputModules              // Output modules
rqi.numOutputModules

rqi.remove()                   // Remove from queue
rqi.duplicate()                // Duplicate item

// OutputModule
var om = rqi.outputModule(1);
om.name                        // Preset name
om.file                        // Output file
om.postRenderAction            // PostRenderAction enum
om.templates                   // Available templates
om.applyTemplate(name)
om.remove()
om.saveAsTemplate(name)
```

---

## MARKERS

### Accessing Markers
```jsx
// Composition markers
comp.markerProperty            // PropertyGroup

// Layer markers
layer.marker                   // MarkerProperty

// Get marker count
layer.marker.numKeys

// Get marker at time
layer.marker.keyValue(layer.marker.nearestKeyIndex(time))
```

### Creating Markers
```jsx
var marker = new MarkerValue("Comment text");
marker.comment                 // Comment text
marker.chapter                 // Chapter name
marker.url                     // URL
marker.frameTarget             // Frame target
marker.cuePointName            // Cue point name
marker.eventCuePoint           // Is event cue point
marker.duration                // Duration
marker.protectedRegion         // Protected region
marker.label                   // Color label (0-16)

// Set marker
layer.marker.setValueAtTime(time, marker);

// Remove marker
layer.marker.removeKey(keyIndex);
```

---

## DEBUGGING

### Output Methods
```jsx
// NEVER use alert() - blocks execution!
// Use $.writeln() instead

$.writeln("Debug message");    // Write to ExtendScript console
$.write("No newline");         // Write without newline

// Access in CEP via:
// http://localhost:8088 (Chrome DevTools)
```

### Error Handling
```jsx
try {
    // risky code
} catch (e) {
    $.writeln("Error: " + e.toString());
    $.writeln("Line: " + e.line);
}
```
