# Common Operation Templates

Ready-to-use ExtendScript templates for common After Effects operations.
These can be directly used or adapted by the AI agent.

---

## COMPOSITION SETTINGS

### Helper: Get Active Comp (even when panel has focus)
```jsx
// IMPORTANT: app.project.activeItem may be null when agent panel is focused
// This helper finds the comp even if it's not "active"
function getActiveOrLastComp() {
    var comp = app.project.activeItem;
    if (comp && comp instanceof CompItem) return comp;
    
    // Fallback: find the first open comp in the project
    for (var i = 1; i <= app.project.numItems; i++) {
        var item = app.project.item(i);
        if (item instanceof CompItem) {
            return item;  // Return first comp found
        }
    }
    return null;
}
```

### Change to Advanced 3D Renderer
⚠️ **CRITICAL: Internal names DON'T match UI names!**
- `ADBE Calder` = Advanced 3D (the NEW one you want!)
- `ADBE Advanced 3d` = Classic 3D (confusing legacy name)
- `ADBE Ernst` = Cinema 4D

```jsx
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) {
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem) {
                comp = item;
                break;
            }
        }
    }
    if (!comp) {
        $.writeln("Error: No composition found");
        return;
    }
    
    // Set to ADVANCED 3D (new renderer)
    comp.renderer = "ADBE Calder";
    $.writeln("Changed to Advanced 3D");
})();
```

### Change to Classic 3D Renderer
```jsx
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) {
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem) {
                comp = item;
                break;
            }
        }
    }
    if (!comp) return;
    
    // Set to CLASSIC 3D (confusingly named "ADBE Advanced 3d")
    comp.renderer = "ADBE Advanced 3d";
    $.writeln("Changed to Classic 3D");
})();
```

### Change Comp Frame Rate
```jsx
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    
    comp.frameRate = 60;  // Change to desired FPS
})();
```

### Change Comp Duration
```jsx
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    
    comp.duration = 30;  // Duration in seconds
})();
```

### Change Comp Resolution
```jsx
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    
    comp.width = 3840;
    comp.height = 2160;
})();
```

### Change Comp Background Color
```jsx
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    
    // RGB values from 0-1
    comp.bgColor = [0.1, 0.1, 0.1];  // Dark gray
})();
```

---

## MASK OPERATIONS

### Create Rectangular Mask
```jsx
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    var layer = comp.selectedLayers[0];
    if (!layer) return;
    
    var masks = layer.property("ADBE Mask Parade");
    var mask = masks.addProperty("ADBE Mask Atom");
    mask.name = "Rectangle Mask";
    
    // Create rectangle centered on layer
    var w = layer.width * 0.8;
    var h = layer.height * 0.8;
    var cx = layer.width / 2;
    var cy = layer.height / 2;
    
    var maskShape = new Shape();
    maskShape.vertices = [
        [cx - w/2, cy - h/2],
        [cx + w/2, cy - h/2],
        [cx + w/2, cy + h/2],
        [cx - w/2, cy + h/2]
    ];
    maskShape.closed = true;
    
    mask.property("ADBE Mask Shape").setValue(maskShape);
    mask.property("ADBE Mask Feather").setValue([0, 0]);
    mask.property("ADBE Mask Opacity").setValue(100);
})();
```

### Create Elliptical Mask
```jsx
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    var layer = comp.selectedLayers[0];
    if (!layer) return;
    
    var masks = layer.property("ADBE Mask Parade");
    var mask = masks.addProperty("ADBE Mask Atom");
    mask.name = "Ellipse Mask";
    
    // Create ellipse using bezier approximation
    var rx = layer.width * 0.4;   // radius X
    var ry = layer.height * 0.4;  // radius Y
    var cx = layer.width / 2;
    var cy = layer.height / 2;
    
    // Bezier control point offset for circle approximation
    var k = 0.5522847498;
    
    var maskShape = new Shape();
    maskShape.vertices = [
        [cx, cy - ry],      // top
        [cx + rx, cy],      // right
        [cx, cy + ry],      // bottom
        [cx - rx, cy]       // left
    ];
    maskShape.inTangents = [
        [-rx * k, 0],
        [0, -ry * k],
        [rx * k, 0],
        [0, ry * k]
    ];
    maskShape.outTangents = [
        [rx * k, 0],
        [0, ry * k],
        [-rx * k, 0],
        [0, -ry * k]
    ];
    maskShape.closed = true;
    
    mask.property("ADBE Mask Shape").setValue(maskShape);
    mask.property("ADBE Mask Feather").setValue([20, 20]);
})();
```

### Animate Mask Reveal (Left to Right)
```jsx
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    var layer = comp.selectedLayers[0];
    if (!layer) return;
    
    var masks = layer.property("ADBE Mask Parade");
    var mask = masks.addProperty("ADBE Mask Atom");
    mask.name = "Reveal Mask";
    
    var w = layer.width;
    var h = layer.height;
    var duration = 1; // seconds
    
    // Start: mask covers nothing (off to the left)
    var startShape = new Shape();
    startShape.vertices = [
        [-w, 0], [0, 0], [0, h], [-w, h]
    ];
    startShape.closed = true;
    
    // End: mask covers full layer
    var endShape = new Shape();
    endShape.vertices = [
        [0, 0], [w, 0], [w, h], [0, h]
    ];
    endShape.closed = true;
    
    var maskPath = mask.property("ADBE Mask Shape");
    maskPath.setValueAtTime(0, startShape);
    maskPath.setValueAtTime(duration, endShape);
    
    // Add easing
    var ease = new KeyframeEase(0, 75);
    maskPath.setTemporalEaseAtKey(1, [ease], [ease]);
    maskPath.setTemporalEaseAtKey(2, [ease], [ease]);
})();
```

### Animate Mask Reveal (Circle Expand)
```jsx
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    var layer = comp.selectedLayers[0];
    if (!layer) return;
    
    var masks = layer.property("ADBE Mask Parade");
    var mask = masks.addProperty("ADBE Mask Atom");
    mask.name = "Circle Reveal";
    
    var cx = layer.width / 2;
    var cy = layer.height / 2;
    var maxRadius = Math.max(layer.width, layer.height);
    var duration = 1;
    var k = 0.5522847498;
    
    function createCircleShape(r) {
        var shape = new Shape();
        if (r < 1) r = 1; // Minimum radius
        shape.vertices = [
            [cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]
        ];
        shape.inTangents = [
            [-r * k, 0], [0, -r * k], [r * k, 0], [0, r * k]
        ];
        shape.outTangents = [
            [r * k, 0], [0, r * k], [-r * k, 0], [0, -r * k]
        ];
        shape.closed = true;
        return shape;
    }
    
    var maskPath = mask.property("ADBE Mask Shape");
    maskPath.setValueAtTime(0, createCircleShape(1));
    maskPath.setValueAtTime(duration, createCircleShape(maxRadius));
    
    var ease = new KeyframeEase(0, 80);
    maskPath.setTemporalEaseAtKey(1, [ease], [ease]);
    maskPath.setTemporalEaseAtKey(2, [ease], [ease]);
})();
```

### Feather Mask Over Time
```jsx
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    var layer = comp.selectedLayers[0];
    if (!layer) return;
    
    var masks = layer.property("ADBE Mask Parade");
    if (masks.numProperties === 0) return;
    
    var mask = masks.property(1);  // First mask
    var feather = mask.property("ADBE Mask Feather");
    
    feather.setValueAtTime(0, [0, 0]);
    feather.setValueAtTime(1, [50, 50]);
})();
```

### Invert All Masks
```jsx
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    var layer = comp.selectedLayers[0];
    if (!layer) return;
    
    var masks = layer.property("ADBE Mask Parade");
    for (var i = 1; i <= masks.numProperties; i++) {
        var mask = masks.property(i);
        mask.inverted = !mask.inverted;
    }
})();
```

### Set Mask Mode
```jsx
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    var layer = comp.selectedLayers[0];
    if (!layer) return;
    
    var masks = layer.property("ADBE Mask Parade");
    if (masks.numProperties === 0) return;
    
    var mask = masks.property(1);
    // MaskMode: NONE, ADD, SUBTRACT, INTERSECT, LIGHTEN, DARKEN, DIFFERENCE
    mask.property("ADBE Mask Mode").setValue(MaskMode.SUBTRACT);
})();
```

---

## TRACK MATTE OPERATIONS

### Set Alpha Matte
```jsx
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    
    var layers = comp.selectedLayers;
    if (layers.length < 1) return;
    
    var layer = layers[0];
    
    // The layer ABOVE becomes the matte
    // TrackMatteType: ALPHA, ALPHA_INVERTED, LUMA, LUMA_INVERTED, NO_TRACK_MATTE
    layer.trackMatteType = TrackMatteType.ALPHA;
})();
```

### Set Luma Matte
```jsx
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    
    var layer = comp.selectedLayers[0];
    if (!layer) return;
    
    layer.trackMatteType = TrackMatteType.LUMA;
})();
```

### Create Text Reveal with Matte
```jsx
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    
    // Get selected text layer
    var textLayer = comp.selectedLayers[0];
    if (!textLayer || !(textLayer instanceof TextLayer)) {
        $.writeln("Select a text layer first");
        return;
    }
    
    var bounds = textLayer.sourceRectAtTime(0, false);
    var padding = 20;
    
    // Create matte shape layer ABOVE text
    var matte = comp.layers.addShape();
    matte.name = textLayer.name + " Matte";
    matte.moveBefore(textLayer);
    
    // Add rectangle
    var contents = matte.property("Contents");
    var group = contents.addProperty("ADBE Vector Group");
    var rect = group.property("Contents").addProperty("ADBE Vector Shape - Rect");
    rect.property("Size").setValue([bounds.width + padding * 2, bounds.height + padding * 2]);
    
    var fill = group.property("Contents").addProperty("ADBE Vector Graphic - Fill");
    fill.property("Color").setValue([1, 1, 1]);
    
    // Position matte at text center
    var textPos = textLayer.transform.position.value;
    matte.transform.position.setValue([
        textPos[0] + bounds.left + bounds.width/2,
        textPos[1] + bounds.top + bounds.height/2
    ]);
    
    // Animate matte scale for reveal
    matte.transform.scale.setValueAtTime(0, [0, 100]);
    matte.transform.scale.setValueAtTime(0.5, [100, 100]);
    
    var ease = new KeyframeEase(0, 80);
    matte.transform.scale.setTemporalEaseAtKey(1, [ease, ease], [ease, ease]);
    matte.transform.scale.setTemporalEaseAtKey(2, [ease, ease], [ease, ease]);
    
    // Set text to use alpha matte
    textLayer.trackMatteType = TrackMatteType.ALPHA;
})();
```

### Create Gradient Wipe Matte
```jsx
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    
    var layer = comp.selectedLayers[0];
    if (!layer) return;
    
    // Create gradient solid for matte
    var matte = comp.layers.addSolid([1, 1, 1], "Gradient Matte", comp.width, comp.height, 1);
    matte.moveBefore(layer);
    
    // Add gradient ramp
    var ramp = matte.property("Effects").addProperty("ADBE Ramp");
    ramp.property("Start of Ramp").setValue([0, comp.height/2]);
    ramp.property("End of Ramp").setValue([comp.width, comp.height/2]);
    ramp.property("Start Color").setValue([0, 0, 0, 1]);
    ramp.property("End Color").setValue([1, 1, 1, 1]);
    
    // Animate start point for wipe effect
    ramp.property("Start of Ramp").setValueAtTime(0, [-comp.width, comp.height/2]);
    ramp.property("Start of Ramp").setValueAtTime(1, [comp.width, comp.height/2]);
    
    ramp.property("End of Ramp").setValueAtTime(0, [0, comp.height/2]);
    ramp.property("End of Ramp").setValueAtTime(1, [comp.width * 2, comp.height/2]);
    
    // Set luma matte
    layer.trackMatteType = TrackMatteType.LUMA;
})();
```

### Remove Track Matte
```jsx
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    
    var layers = comp.selectedLayers;
    for (var i = 0; i < layers.length; i++) {
        layers[i].trackMatteType = TrackMatteType.NO_TRACK_MATTE;
    }
})();
```

---

## PARENTING OPERATIONS

### Parent Selected to New Null
```jsx
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    
    var layers = comp.selectedLayers;
    if (layers.length === 0) return;
    
    // Create null
    var nullLayer = comp.layers.addNull();
    nullLayer.name = "Controller";
    nullLayer.moveTo(1);
    
    // Center null at average position of selected layers
    var avgX = 0, avgY = 0;
    for (var i = 0; i < layers.length; i++) {
        avgX += layers[i].transform.position.value[0];
        avgY += layers[i].transform.position.value[1];
    }
    nullLayer.transform.position.setValue([avgX / layers.length, avgY / layers.length]);
    
    // Parent layers (preserving visual position)
    for (var i = 0; i < layers.length; i++) {
        layers[i].setParentWithJump(nullLayer);
    }
})();
```

### Unparent All Selected (Keep Position)
```jsx
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    
    var layers = comp.selectedLayers;
    for (var i = 0; i < layers.length; i++) {
        if (layers[i].parent) {
            // Get world position before unparenting
            var worldPos = layers[i].toComp([0, 0], 0);
            layers[i].parent = null;
            // Restore position
            layers[i].transform.position.setValue(worldPos);
        }
    }
})();
```

### Chain Parent Selected Layers
```jsx
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    
    var layers = comp.selectedLayers;
    if (layers.length < 2) return;
    
    // Sort by index
    layers.sort(function(a, b) { return a.index - b.index; });
    
    // Chain: each layer parents to the one above
    for (var i = 1; i < layers.length; i++) {
        layers[i].setParentWithJump(layers[i - 1]);
    }
})();
```

---

## TRIM & TIMING OPERATIONS

### Trim Layers to Work Area
```jsx
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    
    var layers = comp.selectedLayers;
    if (layers.length === 0) {
        // Apply to all layers
        for (var i = 1; i <= comp.numLayers; i++) {
            var layer = comp.layer(i);
            layer.inPoint = comp.workAreaStart;
            layer.outPoint = comp.workAreaStart + comp.workAreaDuration;
        }
    } else {
        for (var i = 0; i < layers.length; i++) {
            layers[i].inPoint = comp.workAreaStart;
            layers[i].outPoint = comp.workAreaStart + comp.workAreaDuration;
        }
    }
})();
```

### Trim Layer to Playhead
```jsx
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    
    var layers = comp.selectedLayers;
    for (var i = 0; i < layers.length; i++) {
        layers[i].outPoint = comp.time;
    }
})();
```

### Set In Point to Playhead
```jsx
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    
    var layers = comp.selectedLayers;
    for (var i = 0; i < layers.length; i++) {
        layers[i].inPoint = comp.time;
    }
})();
```

### Sequence Layers
```jsx
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    
    var layers = comp.selectedLayers;
    if (layers.length < 2) return;
    
    // Sort by index (top to bottom)
    layers.sort(function(a, b) { return a.index - b.index; });
    
    var currentTime = layers[0].inPoint;
    
    for (var i = 0; i < layers.length; i++) {
        var layer = layers[i];
        var duration = layer.outPoint - layer.inPoint;
        
        layer.startTime = currentTime - layer.inPoint;
        layer.inPoint = currentTime;
        layer.outPoint = currentTime + duration;
        
        currentTime = layer.outPoint;
    }
})();
```

### Sequence Layers with Overlap
```jsx
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    
    var layers = comp.selectedLayers;
    if (layers.length < 2) return;
    
    var overlapFrames = 5;  // Frames of overlap
    var overlapTime = overlapFrames / comp.frameRate;
    
    layers.sort(function(a, b) { return a.index - b.index; });
    
    var currentTime = layers[0].inPoint;
    
    for (var i = 0; i < layers.length; i++) {
        var layer = layers[i];
        var duration = layer.outPoint - layer.inPoint;
        
        layer.startTime = currentTime - layer.inPoint;
        layer.inPoint = currentTime;
        layer.outPoint = currentTime + duration;
        
        currentTime = layer.outPoint - overlapTime;
    }
})();
```

---

## ALIGNMENT OPERATIONS

### Center Layer in Comp
```jsx
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    
    var layers = comp.selectedLayers;
    for (var i = 0; i < layers.length; i++) {
        var layer = layers[i];
        var pos = layer.transform.position.value;
        var z = pos.length > 2 ? pos[2] : 0;
        layer.transform.position.setValue([comp.width/2, comp.height/2, z]);
    }
})();
```

### Align Layers Horizontally (by top layer)
```jsx
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    
    var layers = comp.selectedLayers;
    if (layers.length < 2) return;
    
    layers.sort(function(a, b) { return a.index - b.index; });
    var targetY = layers[0].transform.position.value[1];
    
    for (var i = 1; i < layers.length; i++) {
        var pos = layers[i].transform.position.value;
        layers[i].transform.position.setValue([pos[0], targetY, pos[2] || 0]);
    }
})();
```

### Align Layers Vertically (by top layer)
```jsx
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    
    var layers = comp.selectedLayers;
    if (layers.length < 2) return;
    
    layers.sort(function(a, b) { return a.index - b.index; });
    var targetX = layers[0].transform.position.value[0];
    
    for (var i = 1; i < layers.length; i++) {
        var pos = layers[i].transform.position.value;
        layers[i].transform.position.setValue([targetX, pos[1], pos[2] || 0]);
    }
})();
```

### Distribute Layers Horizontally
⚠️ **USE setPositionSafe and getPositionSafe** to handle separated dimensions!

```jsx
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    
    var layers = comp.selectedLayers;
    if (layers.length < 2) {
        $.writeln("Select at least 2 layers to distribute");
        return;
    }
    
    // Get positions safely (handles separated dimensions)
    var layerData = [];
    for (var i = 0; i < layers.length; i++) {
        var pos = getPositionSafe(layers[i]);
        layerData.push({ layer: layers[i], x: pos[0], y: pos[1], z: pos[2] || 0 });
    }
    
    // Sort by current X position
    layerData.sort(function(a, b) { return a.x - b.x; });
    
    // Calculate even spacing between first and last
    var startX = layerData[0].x;
    var endX = layerData[layerData.length - 1].x;
    var spacing = (endX - startX) / (layerData.length - 1);
    
    // Apply new positions
    for (var i = 0; i < layerData.length; i++) {
        var newX = startX + (spacing * i);
        setPositionSafe(layerData[i].layer, [newX, layerData[i].y, layerData[i].z]);
    }
    
    $.writeln("Distributed " + layers.length + " layers horizontally");
})();
```

### Distribute Layers Vertically
⚠️ **USE setPositionSafe and getPositionSafe** to handle separated dimensions!

```jsx
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    
    var layers = comp.selectedLayers;
    if (layers.length < 2) {
        $.writeln("Select at least 2 layers to distribute");
        return;
    }
    
    // Get positions safely (handles separated dimensions)
    var layerData = [];
    for (var i = 0; i < layers.length; i++) {
        var pos = getPositionSafe(layers[i]);
        layerData.push({ layer: layers[i], x: pos[0], y: pos[1], z: pos[2] || 0 });
    }
    
    // Sort by current Y position
    layerData.sort(function(a, b) { return a.y - b.y; });
    
    // Calculate even spacing between first and last
    var startY = layerData[0].y;
    var endY = layerData[layerData.length - 1].y;
    var spacing = (endY - startY) / (layerData.length - 1);
    
    // Apply new positions
    for (var i = 0; i < layerData.length; i++) {
        var newY = startY + (spacing * i);
        setPositionSafe(layerData[i].layer, [layerData[i].x, newY, layerData[i].z]);
    }
    
    $.writeln("Distributed " + layers.length + " layers vertically");
})();
```

---

## ANCHOR POINT OPERATIONS

### Center Anchor Point
```jsx
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    
    var layers = comp.selectedLayers;
    for (var i = 0; i < layers.length; i++) {
        var layer = layers[i];
        var bounds = layer.sourceRectAtTime(layer.inPoint, false);
        
        var newAnchor = [
            bounds.left + bounds.width / 2,
            bounds.top + bounds.height / 2
        ];
        
        var delta = [
            newAnchor[0] - layer.transform.anchorPoint.value[0],
            newAnchor[1] - layer.transform.anchorPoint.value[1]
        ];
        
        layer.transform.anchorPoint.setValue(newAnchor);
        
        var pos = layer.transform.position.value;
        layer.transform.position.setValue([
            pos[0] + delta[0],
            pos[1] + delta[1],
            pos[2] || 0
        ]);
    }
})();
```

### Anchor to Bottom Center
```jsx
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    
    var layers = comp.selectedLayers;
    for (var i = 0; i < layers.length; i++) {
        var layer = layers[i];
        var bounds = layer.sourceRectAtTime(layer.inPoint, false);
        
        var newAnchor = [
            bounds.left + bounds.width / 2,
            bounds.top + bounds.height
        ];
        
        var delta = [
            newAnchor[0] - layer.transform.anchorPoint.value[0],
            newAnchor[1] - layer.transform.anchorPoint.value[1]
        ];
        
        layer.transform.anchorPoint.setValue(newAnchor);
        
        var pos = layer.transform.position.value;
        layer.transform.position.setValue([
            pos[0] + delta[0],
            pos[1] + delta[1],
            pos[2] || 0
        ]);
    }
})();
```

### Anchor to Top Center
```jsx
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    
    var layers = comp.selectedLayers;
    for (var i = 0; i < layers.length; i++) {
        var layer = layers[i];
        var bounds = layer.sourceRectAtTime(layer.inPoint, false);
        
        var newAnchor = [
            bounds.left + bounds.width / 2,
            bounds.top
        ];
        
        var delta = [
            newAnchor[0] - layer.transform.anchorPoint.value[0],
            newAnchor[1] - layer.transform.anchorPoint.value[1]
        ];
        
        layer.transform.anchorPoint.setValue(newAnchor);
        
        var pos = layer.transform.position.value;
        layer.transform.position.setValue([
            pos[0] + delta[0],
            pos[1] + delta[1],
            pos[2] || 0
        ]);
    }
})();
```

---

## DUPLICATION & CLONING

### Duplicate and Offset
```jsx
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    
    var layer = comp.selectedLayers[0];
    if (!layer) return;
    
    var count = 5;      // Number of copies
    var offsetX = 100;  // Horizontal offset
    var offsetY = 0;    // Vertical offset
    
    for (var i = 1; i < count; i++) {
        var dupe = layer.duplicate();
        var pos = layer.transform.position.value;
        dupe.transform.position.setValue([
            pos[0] + offsetX * i,
            pos[1] + offsetY * i,
            pos[2] || 0
        ]);
    }
})();
```

### Radial Clone
```jsx
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    
    var layer = comp.selectedLayers[0];
    if (!layer) return;
    
    var count = 8;
    var radius = 200;
    var centerX = comp.width / 2;
    var centerY = comp.height / 2;
    
    for (var i = 0; i < count; i++) {
        var angle = (i / count) * Math.PI * 2;
        var target = (i === 0) ? layer : layer.duplicate();
        
        target.transform.position.setValue([
            centerX + Math.cos(angle) * radius,
            centerY + Math.sin(angle) * radius
        ]);
        
        target.transform.rotation.setValue((angle * 180 / Math.PI) + 90);
    }
})();
```

### Grid Clone
```jsx
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    
    var layer = comp.selectedLayers[0];
    if (!layer) return;
    
    var cols = 4;
    var rows = 3;
    var spacingX = 150;
    var spacingY = 150;
    var startX = 200;
    var startY = 200;
    
    var count = 0;
    for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
            var target = (count === 0) ? layer : layer.duplicate();
            target.transform.position.setValue([
                startX + c * spacingX,
                startY + r * spacingY
            ]);
            count++;
        }
    }
})();
```

---

## EFFECTS BATCH OPERATIONS

### Apply Effect to All Selected
```jsx
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    
    var layers = comp.selectedLayers;
    var effectMatchName = "ADBE Glo2";  // Glow
    
    for (var i = 0; i < layers.length; i++) {
        var fx = layers[i].property("Effects").addProperty(effectMatchName);
        fx.property("Glow Threshold").setValue(60);
        fx.property("Glow Radius").setValue(25);
    }
})();
```

### Remove All Effects from Selected
```jsx
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    
    var layers = comp.selectedLayers;
    
    for (var i = 0; i < layers.length; i++) {
        var effects = layers[i].property("Effects");
        // IMPORTANT: Remove from END to START to avoid index shifting
        for (var e = effects.numProperties; e >= 1; e--) {
            effects.property(e).remove();
        }
    }
})();
```

### Remove Specific Effect by Display Name
```jsx
// RECOMMENDED approach for removing effects by their visible name
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    
    var layers = comp.selectedLayers;
    if (layers.length === 0) return;
    
    // Effect name as shown in the Effect Controls panel
    var effectNameToRemove = "Lumetri Color";  // Case-insensitive search
    var effectNameLower = effectNameToRemove.toLowerCase();
    
    for (var i = 0; i < layers.length; i++) {
        var effects = layers[i].property("Effects");
        
        // Iterate backwards to safely remove while iterating
        for (var e = effects.numProperties; e >= 1; e--) {
            var fx = effects.property(e);
            if (fx.name.toLowerCase().indexOf(effectNameLower) !== -1) {
                fx.remove();
            }
        }
    }
})();
```

### Remove Effect by Match Name (Most Reliable)
```jsx
// Use this when you know the exact internal match name
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    
    var layers = comp.selectedLayers;
    if (layers.length === 0) return;
    
    // Use EXACT match name from effect-match-names.md
    var matchNameToRemove = "ADBE Lumetri";  // Lumetri Color
    
    for (var i = 0; i < layers.length; i++) {
        var effects = layers[i].property("Effects");
        
        for (var e = effects.numProperties; e >= 1; e--) {
            var fx = effects.property(e);
            if (fx.matchName === matchNameToRemove) {
                fx.remove();
            }
        }
    }
})();
```

### Common Effect Match Names for Removal
```jsx
// Quick reference for effect removal - use these EXACT strings:
// 
// BLUR:
//   "ADBE Gaussian Blur 2"    - Gaussian Blur
//   "ADBE Motion Blur"        - Motion Blur
//   "ADBE Radial Blur"        - Radial Blur
//   "ADBE Camera Lens Blur"   - Camera Lens Blur
//
// COLOR:
//   "ADBE Lumetri"            - Lumetri Color
//   "ADBE CurvesCustom"       - Curves
//   "ADBE Levels2"            - Levels
//   "ADBE HUE SATURATION"     - Hue/Saturation
//   "ADBE Tint"               - Tint
//   "ADBE Fill"               - Fill
//
// STYLIZE:
//   "ADBE Glo2"               - Glow
//   "ADBE Drop Shadow"        - Drop Shadow
//   "ADBE BEZMESH"            - Bezier Warp
//
// GENERATE:
//   "ADBE Ramp"               - Gradient Ramp
//   "ADBE Solid Composite"    - Solid Composite
//   "ADBE Checkerboard"       - Checkerboard
//
// EXPRESSION CONTROLS:
//   "ADBE Slider Control"     - Slider
//   "ADBE Color Control"      - Color
//   "ADBE Point Control"      - Point
//   "ADBE Checkbox Control"   - Checkbox
//   "ADBE Angle Control"      - Angle
//   "ADBE Layer Control"      - Layer
```

### Remove Effect by Partial Name (Fuzzy Search)
```jsx
// Use when you're not sure of the exact name
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    
    var layers = comp.selectedLayers;
    if (layers.length === 0) return;
    
    // Partial name to search for (case-insensitive)
    var searchTerm = "blur";  // Will match "Gaussian Blur", "Motion Blur", etc.
    var searchLower = searchTerm.toLowerCase();
    var removedCount = 0;
    
    for (var i = 0; i < layers.length; i++) {
        var effects = layers[i].property("Effects");
        
        for (var e = effects.numProperties; e >= 1; e--) {
            var fx = effects.property(e);
            // Check both display name and match name
            if (fx.name.toLowerCase().indexOf(searchLower) !== -1 ||
                fx.matchName.toLowerCase().indexOf(searchLower) !== -1) {
                fx.remove();
                removedCount++;
            }
        }
    }
})();
```

### Copy Effects Between Layers
```jsx
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    
    var layers = comp.selectedLayers;
    if (layers.length < 2) {
        $.writeln("Select source layer first, then target layers");
        return;
    }
    
    // First selected is source
    var source = layers[0];
    var sourceEffects = source.property("Effects");
    
    // Apply each effect to other layers
    for (var i = 1; i < layers.length; i++) {
        var target = layers[i];
        for (var e = 1; e <= sourceEffects.numProperties; e++) {
            var fx = sourceEffects.property(e);
            var newFx = target.property("Effects").addProperty(fx.matchName);
            newFx.name = fx.name;
            
            // Copy property values (simplified - works for most effects)
            for (var p = 1; p <= fx.numProperties; p++) {
                try {
                    var prop = fx.property(p);
                    var newProp = newFx.property(p);
                    if (prop.canSetValue) {
                        newProp.setValue(prop.value);
                    }
                } catch (e) {}
            }
        }
    }
})();
```
