# Troubleshooting Guide

Common After Effects scripting errors and how to fix them.

---

## "null is not an object"

### Cause
Trying to access a property or method on something that doesn't exist.

### Common Scenarios

**1. No active composition:**
```jsx
// ⛔ WRONG
var comp = app.project.activeItem;
comp.layers.addShape();  // Error if comp is null!

// ✅ CORRECT
var comp = app.project.activeItem;
if (!comp || !(comp instanceof CompItem)) {
    alert("Please select a composition first.");
    return;
}
comp.layers.addShape();
```

**2. Layer not found:**
```jsx
// ⛔ WRONG
var layer = comp.layer("MyLayer");
layer.transform.scale.setValue([50, 50]);  // Error if layer doesn't exist!

// ✅ CORRECT
var layer = comp.layer("MyLayer");
if (!layer) {
    $.writeln("Layer 'MyLayer' not found");
    return;
}
layer.transform.scale.setValue([50, 50]);
```

**3. Property path doesn't exist:**
```jsx
// ⛔ WRONG - "ADBE Geometry Options Group" doesn't exist!
var geo = layer.property("ADBE Geometry Options Group");
geo.property("Depth").setValue(100);  // Error!

// ✅ CORRECT - Use "ADBE Extrsn Options Group"
var geo = layer.property("ADBE Extrsn Options Group");
if (geo) {
    geo.property("ADBE Extrsn Depth").setValue(100);
}
```

**4. Shape layer content access:**
```jsx
// ⛔ WRONG - Adding directly to Contents
var rect = shape.property("Contents").addProperty("ADBE Vector Shape - Rect");
rect.property("Size").setValue([400, 400]);  // May fail!

// ✅ CORRECT - Add to a group first
var grp = shape.property("Contents").addProperty("ADBE Vector Group");
var rect = grp.property("Contents").addProperty("ADBE Vector Shape - Rect");
rect.property("Size").setValue([400, 400]);
```

---

## "Can not set value - property is hidden"

### Cause
Trying to set a property that is locked, hidden, or not available in the current context.

### Common Scenarios

**1. Light position via .transform:**
```jsx
// ⛔ WRONG - Light transform.position is hidden!
var light = comp.layers.addLight("Key", [960, 540]);
light.transform.position.setValue([960, 540, -500]);  // Error!

// ✅ CORRECT - Use direct .position property
var light = comp.layers.addLight("Key", [960, 540]);
light.position.setValue([960, 540, -500]);
light.intensity.setValue(100);
```

**2. Locked layer:**
```jsx
// ⛔ WRONG - Can't modify locked layer
var layer = comp.layer("Background");
layer.locked = true;
layer.moveToEnd();  // Error - layer is locked!

// ✅ CORRECT - Unlock first, then modify
var layer = comp.layer("Background");
layer.locked = false;
layer.moveToEnd();
layer.locked = true;  // Re-lock if needed
```

**3. 3D properties on 2D layer:**
```jsx
// ⛔ WRONG - zPosition hidden on 2D layers
layer.transform.zPosition.setValue(100);  // Error!

// ✅ CORRECT - Enable 3D first
layer.threeDLayer = true;
var pos = layer.transform.position.value;
layer.transform.position.setValue([pos[0], pos[1], 100]);
```

**4. Separated position dimensions:**
```jsx
// When position is separated, you can't set position.setValue([x,y,z])
// BEST: Use the global helpers that handle this automatically:
setPositionSafe(layer, [960, 540]);       // Sets position safely
var pos = getPositionSafe(layer);          // Gets position safely

// Or manually handle separated dimensions:
if (layer.transform.position.dimensionsSeparated) {
    layer.transform.xPosition.setValue(960);
    layer.transform.yPosition.setValue(540);
    if (layer.threeDLayer) {
        layer.transform.zPosition.setValue(-500);
    }
} else {
    layer.transform.position.setValue([960, 540]);
}
```

---

## "Parameter 2 does not have 2 elements"

### Cause
Passing wrong array format to a method.

```jsx
// ⛔ WRONG - addCamera second param must be [x, y] array
var cam = comp.layers.addCamera("Camera 1", comp.width/2);  // Error!

// ✅ CORRECT
var cam = comp.layers.addCamera("Camera 1", [comp.width/2, comp.height/2]);
```

---

## "Value array does not have N elements" (setTemporalEaseAtKey)

### Cause
`prop.setTemporalEaseAtKey(key, inArray, outArray)` requires the ease arrays to match the
property's **temporal-ease dimension count**, which is NOT always `prop.value.length`:

- **Spatial** props (Position, Anchor Point): **1** KeyframeEase, regardless of 2D/3D.
- **Non-spatial multi-dim**: one per dimension. **Scale is 3D ([x,y,z]) even on a 2D shape
  layer in a 2D comp** → 3. Color → 4.
- **1D** (Rotation, Opacity): 1.

Sizing with `prop.value.length` gives 2 for a 2D Position (wants 1) → throws. Get the real
count from `prop.keyInTemporalEase(1).length`.

```jsx
// ⛔ WRONG — value.length is 2 for Position, but it wants 1 ease element
prop.setTemporalEaseAtKey(k, [e,e], [e,e]);   // "Value array does not have 1 elements"

// ✅ CORRECT — use the dimension count from the property itself
var dim = prop.keyInTemporalEase(1).length;   // 1 for spatial, 3 for Scale, etc.
var inA = [], outA = [];
for (var d = 0; d < dim; d++){ inA.push(new KeyframeEase(0,75)); outA.push(new KeyframeEase(0,75)); }
prop.setInterpolationTypeAtKey(k, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
prop.setTemporalEaseAtKey(k, inA, outA);

// ✅ BEST in run_jsx — use the Portal's built-in global helper (host/actions.jsx):
setTemporalEaseSafe(prop, k, 0, 75, 0, 75);   // inSpeed, inInfl, outSpeed, outInfl
```

The dedicated `set_easing` tool already does this correctly (via `easesArrFor`) — this only
bites hand-written `run_jsx`.

---

## "No keyframes to modify"

### Cause
Trying to modify keyframe interpolation when no keyframes exist.

```jsx
// ⛔ WRONG
prop.setInterpolationTypeAtKey(1, KeyframeInterpolationType.BEZIER);  // Error if no keys!

// ✅ CORRECT
if (prop.numKeys >= 1) {
    prop.setInterpolationTypeAtKey(1, KeyframeInterpolationType.BEZIER);
}
```

---

## Template Literals Don't Work

### Cause
ExtendScript doesn't support ES6 features like template literals.

```jsx
// ⛔ WRONG - Backticks don't work in ExtendScript!
var expr = `time * ${speed}`;  // Syntax Error!

// ✅ CORRECT - Use string concatenation
var expr = "time * " + speed;
```

---

## padStart/padEnd Don't Exist

### Cause
ExtendScript doesn't have modern JavaScript methods.

```jsx
// ⛔ WRONG
var str = String(num).padStart(2, '0');  // Error!

// ✅ CORRECT
var str = (num < 10 ? "0" : "") + num;

// Or create a helper function
function pad(num, length) {
    var s = String(num);
    while (s.length < length) s = "0" + s;
    return s;
}
```

---

## Color Values: 3 vs 4 Values

### Cause
Different properties expect different color formats.

```jsx
// Shape layer fill - 3 values (RGB)
fill.property("Color").setValue([1, 0, 0]);  // ✅ Correct

// Text fill color - Also 3 values
textDoc.fillColor = [1, 1, 1];  // ✅ Correct

// Some effects may use 4 values (RGBA)
// Check the specific effect documentation

// ⛔ WRONG for most color properties
fill.property("Color").setValue([1, 0, 0, 1]);  // Error!
```

---

## Renderer Not Changing

### Cause
Using wrong internal name for renderer.

```jsx
// ⛔ WRONG - These names are swapped!
comp.renderer = "Advanced 3D";  // Might not work
comp.renderer = "ADBE Advanced 3d";  // This is actually CLASSIC 3D!

// ✅ CORRECT - Use internal codenames
comp.renderer = "ADBE Calder";      // Advanced 3D (the new one!)
comp.renderer = "ADBE Advanced 3d";  // Classic 3D (the old one!)
comp.renderer = "ADBE Ernst";        // Cinema 4D

// Always wrap in try/catch
try {
    comp.renderer = "ADBE Calder";
} catch(e) {
    $.writeln("Could not set renderer: " + e);
}
```

---

## Effect Not Found

### Cause
Using wrong effect name or effect not installed.

```jsx
// ⛔ WRONG - Effect names are specific
layer.Effects.addProperty("Gaussian Blur");  // Might fail!

// ✅ CORRECT - Use match names
layer.Effects.addProperty("ADBE Gaussian Blur 2");  // Correct match name

// Always wrap in try/catch for effects
try {
    var blur = layer.Effects.addProperty("ADBE Gaussian Blur 2");
} catch(e) {
    alert("Effect not found: " + e);
}
```

---

## Undo Group Mismatch

### Cause
Mismatched beginUndoGroup/endUndoGroup calls, especially with errors.

```jsx
// ⛔ RISKY - If error occurs, endUndoGroup never called
app.beginUndoGroup("My Action");
// ... code that might fail ...
app.endUndoGroup();

// ✅ CORRECT - Use try/finally
app.beginUndoGroup("My Action");
try {
    // ... code that might fail ...
} catch(e) {
    alert(e);
} finally {
    app.endUndoGroup();  // Always runs
}
```

---

## Layer Index Out of Range

### Cause
Layer indices are 1-based, not 0-based.

```jsx
// ⛔ WRONG
var layer = comp.layer(0);  // Error! Indices start at 1

// ✅ CORRECT
var layer = comp.layer(1);  // First layer

// Loop correctly
for (var i = 1; i <= comp.numLayers; i++) {
    var layer = comp.layer(i);
    // ...
}
```

---

## Debugging Tips

### Use $.writeln for logging

```jsx
$.writeln("Debug: comp = " + comp);
$.writeln("Debug: layer count = " + comp.numLayers);
$.writeln("Debug: property = " + prop);
```

### Check ESTK Console

Open ExtendScript Toolkit and check the console for output.

### Check property existence before access

```jsx
var prop = layer.property("Something");
$.writeln("Property exists: " + (prop !== null));
$.writeln("Property value: " + (prop ? prop.value : "N/A"));
```

### Wrap everything in try/catch

```jsx
(function() {
    try {
        // Your code here
    } catch(e) {
        alert("Error at line " + e.line + ": " + e.message);
        $.writeln(e.stack);
    }
})();
```

---

## HANG / CRASH: never use `while (numKeys>0) removeKey(1)` (fork–malloc deadlock)

On macOS 26 (new "xzone" allocator) a removal loop like:

```jsx
// ⛔ WRONG — wedged AE 2025's main thread at 100% CPU; required force-quit (2026-06-01)
while (prop.numKeys > 0) prop.removeKey(1);
while (rq.numItems > 0) rq.item(1).remove();
```

can deadlock **inside `removeKey` → `operator new` → malloc** on `_xzm_fork_lock_wait`:
malloc blocks waiting on the fork lock held by another AE thread that is mid-`fork()`
(background render / MediaCore). The main thread never returns. Crash stack showed
`jsOpWhile → removeKey → AEGPD_DeleteKeyframe → _xzm_xzone_malloc → _xzm_fork_lock_wait`.

```jsx
// ✅ CORRECT — bounded reverse loop, terminates regardless of removeKey behavior
for (var i = prop.numKeys; i >= 1; i--) prop.removeKey(i);
for (var j = rq.numItems; j >= 1; j--) rq.item(j).remove();
```

Rules:
- Removing keyframes / collection items: ALWAYS iterate downward with a `for` loop. Never `while(count>0) removeFirst()`.
- Cap every JSX loop; never assume a mutating call decrements the count.
- The portal itself does NOT fork inside AE (render_frame uses `comp.saveFrameToPng`); the
  fork was AE-internal — but a bounded loop removes the exposure. Fixed in
  `actions.jsx` `freeze_frame_at` and `clear_render_queue`.
