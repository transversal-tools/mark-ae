# 3D Rig Templates - PROVEN WORKING PATTERNS

These templates are **known-working** scripts that should be used as reference for creating 3D rigs, extruded shapes, and complex multi-layer setups.

---

## CRITICAL LEARNINGS

### 1. Light Position - WHAT WORKS

```jsx
// ✅ CORRECT - Use .position.setValue() directly (NOT .transform.position)
keyLight.position.setValue([compWidth/2 + 500, compHeight/2 - 500, -800]);
keyLight.intensity.setValue(100);

// ✅ Also works for Spot lights
rimLight.position.setValue([compWidth/2 - 900, compHeight/2 - 300, 200]); 
rimLight.pointOfInterest.setValue([compWidth/2, compHeight/2, 0]);
rimLight.intensity.setValue(150);
rimLight.color.setValue([0.85, 0.9, 1]); 

// ⛔ WRONG - This causes "property hidden" errors
light.transform.position.setValue([x, y, z]);  // DON'T USE .transform
```

### 2. Extrusion Properties - CORRECT PROPERTY NAMES

```jsx
// ✅ CORRECT property group names for extrusion
var geoGroup = layer.property("ADBE Extrsn Options Group");
geoGroup.property("ADBE Extrsn Depth").setValue(45);
geoGroup.property("ADBE Bevel Style").setValue(4);  // Convex bevel
geoGroup.property("ADBE Bevel Depth").setValue(3);

var matGroup = layer.property("ADBE Material Options Group");
matGroup.property("ADBE Casts Shadows").setValue(1);
matGroup.property("ADBE Specular Shininess").setValue(20);
matGroup.property("ADBE Metal Coeff").setValue(90);
matGroup.property("ADBE Reflection Intensity").setValue(70);

// ⛔ WRONG (this name doesn't exist)
layer.property("ADBE Geometry Options Group");  // DON'T USE
```

### 3. Always Use Undo Groups

```jsx
app.beginUndoGroup("Create Phone Rig");
try {
    // ... all your code ...
} catch(err) {
    alert("Error: " + err.toString());
} finally {
    app.endUndoGroup();
}
```

### 4. Renderer Switch with Fallback

```jsx
try {
    mainComp.renderer = "ADBE Calder";
} catch(e) {
    try { mainComp.renderer = "Advanced 3D"; } catch(e2) {}
}
```

---

## TEMPLATE: 3D Phone Rig (Proven Working)

Use this template for ANY 3D device rig (phone, tablet, laptop, TV, etc.)

```jsx
(function() {
    var mainComp = app.project.activeItem;
    if (!mainComp || !(mainComp instanceof CompItem)) {
        alert("Please open a Composition first!");
        return;
    }

    app.beginUndoGroup("Create 3D Device Rig");

    try {
        // === CONFIGURABLE DIMENSIONS ===
        var bezelSize = 15;
        var bodyRadius = 65;
        var frameThickness = 45;
        var bodyW = 600;
        var sourceW = 1080;
        var sourceH = 2340;  // Adjust for device aspect ratio
        
        // Calculated values
        var screenTargetW = bodyW - (bezelSize * 2);
        var aspectRatio = sourceH / sourceW;
        var screenTargetH = screenTargetW * aspectRatio;
        var bodyH = screenTargetH + (bezelSize * 2);
        var scaleFactor = (screenTargetW / sourceW) * 100;
        var screenTargetRadius = bodyRadius - bezelSize;
        var sourceRadius = screenTargetRadius / (scaleFactor / 100);
        var uniqueID = Math.floor(Math.random() * 10000);

        // === STEP 1: CREATE PRE-COMPS FIRST ===
        
        // A. Content comp (what displays on screen)
        var contentCompName = "UI_" + uniqueID;
        var contentComp = app.project.items.addComp(contentCompName, sourceW, sourceH, 1.0, mainComp.duration, mainComp.frameRate);
        contentComp.layers.addSolid([0.05, 0.05, 0.05], "BG", sourceW, sourceH, 1.0).moveToEnd();
        var txt = contentComp.layers.addText("CONTENT");
        var txtProp = txt.property("Source Text");
        var txtDoc = txtProp.value;
        txtDoc.fontSize = 180;
        txtDoc.fillColor = [1, 1, 1];
        txtDoc.font = "Arial-BoldMT";
        txtDoc.justification = ParagraphJustification.CENTER_JUSTIFY;
        txtProp.setValue(txtDoc);
        txt.position.setValue([sourceW/2, sourceH/2]);

        // B. Matte comp (rounded screen texture)
        var matteCompName = "Screen_Texture_" + uniqueID;
        var matteComp = app.project.items.addComp(matteCompName, sourceW, sourceH, 1.0, mainComp.duration, mainComp.frameRate);
        var contentLayer = matteComp.layers.add(contentComp);
        var maskShape = matteComp.layers.addShape();
        maskShape.name = "Rounded Mask";
        var maskGroup = maskShape.property("Contents").addProperty("ADBE Vector Group");
        var maskRect = maskGroup.property("Contents").addProperty("ADBE Vector Shape - Rect");
        maskRect.property("Size").setValue([sourceW, sourceH]);
        maskRect.property("Roundness").setValue(sourceRadius);
        var maskFill = maskGroup.property("Contents").addProperty("ADBE Vector Graphic - Fill");
        maskFill.property("Color").setValue([1, 1, 1]);

        try {
            contentLayer.setTrackMatte(maskShape, TrackMatteType.ALPHA);
        } catch(e) {
            maskShape.moveBefore(contentLayer);
            contentLayer.trackMatteType = TrackMatteType.ALPHA;
        }

        // === STEP 2: SET ADVANCED 3D RENDERER ===
        try {
            mainComp.renderer = "ADBE Calder";
        } catch(e) {
            try { mainComp.renderer = "Advanced 3D"; } catch(e2) {}
        }

        // === STEP 3: BUILD 3D SCENE ===
        var compWidth = mainComp.width;
        var compHeight = mainComp.height;

        // Controller Null
        var controller = mainComp.layers.addNull();
        controller.name = "Device_CTRL";
        controller.threeDLayer = true;
        controller.position.setValue([compWidth/2, compHeight/2, 0]);

        // Frame (main body)
        var frameLayer = mainComp.layers.addShape();
        frameLayer.name = "Frame";
        frameLayer.threeDLayer = true;
        var frameGroup = frameLayer.property("Contents").addProperty("ADBE Vector Group");
        var frameRect = frameGroup.property("Contents").addProperty("ADBE Vector Shape - Rect");
        frameRect.property("Size").setValue([bodyW, bodyH]);
        frameRect.property("Roundness").setValue(bodyRadius);
        var frameFill = frameGroup.property("Contents").addProperty("ADBE Vector Graphic - Fill");
        frameFill.property("Color").setValue([0.65, 0.65, 0.7]);

        // Back panel
        var backLayer = mainComp.layers.addShape();
        backLayer.name = "Back";
        backLayer.threeDLayer = true;
        var backGroup = backLayer.property("Contents").addProperty("ADBE Vector Group");
        var backRect = backGroup.property("Contents").addProperty("ADBE Vector Shape - Rect");
        backRect.property("Size").setValue([bodyW - 2, bodyH - 2]);
        backRect.property("Roundness").setValue(bodyRadius);
        var backFill = backGroup.property("Contents").addProperty("ADBE Vector Graphic - Fill");
        backFill.property("Color").setValue([0.1, 0.1, 0.1]);
        backLayer.position.setValue([compWidth/2, compHeight/2, frameThickness + 0.1]);

        // Screen
        var screenLayer = mainComp.layers.add(matteComp);
        screenLayer.name = "Screen";
        screenLayer.threeDLayer = true;
        screenLayer.scale.setValue([scaleFactor, scaleFactor, 100]);
        screenLayer.position.setValue([compWidth/2, compHeight/2, -1]);

        // Parenting
        frameLayer.parent = controller;
        backLayer.parent = controller;
        screenLayer.parent = controller;

        // === STEP 4: APPLY EXTRUSION ===
        try {
            // Frame extrusion
            var fGeo = frameLayer.property("ADBE Extrsn Options Group");
            fGeo.property("ADBE Extrsn Depth").setValue(frameThickness);
            fGeo.property("ADBE Bevel Style").setValue(4);
            fGeo.property("ADBE Bevel Depth").setValue(3);

            var fMat = frameLayer.property("ADBE Material Options Group");
            fMat.property("ADBE Casts Shadows").setValue(1);
            fMat.property("ADBE Specular Shininess").setValue(20);
            fMat.property("ADBE Metal Coeff").setValue(90);

            // Back extrusion
            backLayer.property("ADBE Extrsn Options Group").property("ADBE Extrsn Depth").setValue(2);
            var bMat = backLayer.property("ADBE Material Options Group");
            bMat.property("ADBE Specular Shininess").setValue(100);
            bMat.property("ADBE Metal Coeff").setValue(0);
            bMat.property("ADBE Reflection Intensity").setValue(70);
        } catch(e) {
            $.writeln("Extrusion not applied - Advanced 3D may not be active");
        }

        // === STEP 5: CAMERA ===
        var cameraLayer = null;
        for (var c = 1; c <= mainComp.numLayers; c++) {
            if (mainComp.layer(c) instanceof CameraLayer) {
                cameraLayer = mainComp.layer(c);
                break;
            }
        }
        if (!cameraLayer) {
            cameraLayer = mainComp.layers.addCamera("Camera 1", [compWidth/2, compHeight/2]);
        }
        var targetHeight = bodyH * 1.3;
        var zoom = cameraLayer.property("Camera Options").property("Zoom").value;
        var newZDist = (targetHeight * zoom) / compHeight;
        cameraLayer.position.setValue([compWidth/2, compHeight/2, -newZDist]);

        // === STEP 6: LIGHTS ===
        var hasLight = false;
        for (var x = 1; x <= mainComp.numLayers; x++) {
            if (mainComp.layer(x) instanceof LightLayer) hasLight = true;
        }

        if (!hasLight) {
            // Key Light (main)
            var keyLight = mainComp.layers.addLight("Key Light", [compWidth/2, compHeight/2]);
            keyLight.lightType = LightType.POINT;
            keyLight.position.setValue([compWidth/2 + 500, compHeight/2 - 500, -800]);
            keyLight.intensity.setValue(100);

            // Rim Light
            var rimLight = mainComp.layers.addLight("Rim Light", [compWidth/2, compHeight/2]);
            rimLight.lightType = LightType.SPOT;
            rimLight.position.setValue([compWidth/2 - 900, compHeight/2 - 300, 200]);
            rimLight.pointOfInterest.setValue([compWidth/2, compHeight/2, 0]);
            rimLight.intensity.setValue(150);
            rimLight.color.setValue([0.85, 0.9, 1]);

            // Fill Light
            var warmLight = mainComp.layers.addLight("Fill Light", [compWidth/2, compHeight/2]);
            warmLight.lightType = LightType.POINT;
            warmLight.position.setValue([compWidth/2 + 800, compHeight/2 + 500, -200]);
            warmLight.intensity.setValue(50);
            warmLight.color.setValue([1, 0.9, 0.8]);
        }

        // Optional: Add rotation animation
        controller.rotationY.setValuesAtTimes([mainComp.time, mainComp.time + 5], [0, 360]);
        controller.rotationX.setValue(-10);

    } catch(err) {
        alert("Error: " + err.toString());
    } finally {
        app.endUndoGroup();
    }
})();
```

---

## KEY DIFFERENCES FROM FAILED ATTEMPTS

| What Failed | Why | Correct Pattern |
|-------------|-----|-----------------|
| `light.transform.position.setValue()` | Wrong property path | `light.position.setValue()` |
| `layer.property("ADBE Geometry Options Group")` | Wrong property name | `layer.property("ADBE Extrsn Options Group")` |
| Creating 3D scene first, then pre-comps | Order matters | Create pre-comps FIRST, then 3D scene |
| Single step with everything | Too complex, hard to debug | Modular steps with try/catch |
| No undo group | Messy undo behavior | `app.beginUndoGroup()` / `app.endUndoGroup()` |

---

## DEVICE VARIATIONS

### Tablet (iPad-like)
```jsx
var bodyW = 900;
var sourceW = 1668;
var sourceH = 2388;
var bodyRadius = 80;
```

### Laptop Screen
```jsx
var bodyW = 1200;
var sourceW = 2560;
var sourceH = 1600;
var bodyRadius = 20;
var bezelSize = 25;
```

### TV/Monitor
```jsx
var bodyW = 1600;
var sourceW = 3840;
var sourceH = 2160;
var bodyRadius = 10;
var bezelSize = 30;
var frameThickness = 25;
```
