# Layer Type-Specific Methods & Properties

Comprehensive reference for working with different layer types in ExtendScript.

---

## TEXT LAYERS

### Creating Text Layers
```jsx
// Basic text layer
var textLayer = comp.layers.addText("Hello World");

// Box text (constrained width/height)
var boxText = comp.layers.addBoxText([300, 100], "Paragraph text here");

// Empty text layer
var emptyText = comp.layers.addText();
```

### Accessing Text Properties
```jsx
var textLayer = comp.selectedLayers[0];
var sourceText = textLayer.property("Source Text");  // TextProperty
var textDoc = sourceText.value;  // TextDocument object

// IMPORTANT: .value returns TextDocument, not string!
// To get the actual text string:
var textString = textDoc.text;
```

### TextDocument Properties
```jsx
var textDoc = sourceText.value;

// Content
textDoc.text                    // String - the actual text

// Font
textDoc.font                    // "ArialMT", "Helvetica-Bold" etc
textDoc.fontSize                // Size in pixels
textDoc.fauxBold                // Boolean
textDoc.fauxItalic              // Boolean
textDoc.allCaps                 // Boolean
textDoc.smallCaps               // Boolean
textDoc.superscript             // Boolean
textDoc.subscript               // Boolean

// Color & Stroke
textDoc.fillColor               // [r, g, b] 0-1
textDoc.strokeColor             // [r, g, b] 0-1
textDoc.strokeWidth             // Pixels
textDoc.applyFill               // Boolean
textDoc.applyStroke             // Boolean
textDoc.strokeOverFill          // Boolean

// Spacing
textDoc.tracking                // Tracking value
textDoc.leading                 // Line spacing (pixels)
textDoc.autoLeading             // Boolean
textDoc.baselineShift           // Baseline shift (pixels)

// Scale
textDoc.horizontalScale         // Percentage
textDoc.verticalScale           // Percentage

// Alignment
textDoc.justification           // ParagraphJustification enum
textDoc.direction               // ParagraphDirection enum

// Box text specific
textDoc.boxText                 // Boolean - is box text
textDoc.boxTextPos              // [x, y] for box position
textDoc.boxTextSize             // [width, height]
```

### Modifying Text
```jsx
// Get current text document
var textDoc = sourceText.value;

// Modify properties
textDoc.text = "New text content";
textDoc.fontSize = 72;
textDoc.font = "Helvetica-Bold";
textDoc.fillColor = [1, 0.5, 0];  // Orange

// Apply changes (REQUIRED!)
sourceText.setValue(textDoc);
```

### Text Animators
```jsx
var textProp = textLayer.property("ADBE Text Properties");
var animators = textProp.property("ADBE Text Animators");

// Add animator
var animator = animators.addProperty("ADBE Text Animator");
animator.name = "Scale Animator";

// Add selector
var selectors = animator.property("ADBE Text Selectors");
var selector = selectors.addProperty("ADBE Text Selector");

// Animate selector range
selector.property("ADBE Text Percent Start").setValueAtTime(0, 0);
selector.property("ADBE Text Percent Start").setValueAtTime(2, 100);

// Add animator property
var animProps = animator.property("ADBE Text Animator Properties");
var opacity = animProps.addProperty("ADBE Text Opacity");
opacity.setValue(0);  // Animated property value

// Available animator properties:
// "ADBE Text Anchor Point 3D"
// "ADBE Text Position 3D" 
// "ADBE Text Scale 3D"
// "ADBE Text Skew"
// "ADBE Text Skew Axis"
// "ADBE Text Rotation"
// "ADBE Text Rotation X"
// "ADBE Text Rotation Y"
// "ADBE Text Opacity"
// "ADBE Text Fill Opacity"
// "ADBE Text Fill Color"
// "ADBE Text Fill Hue"
// "ADBE Text Fill Saturation"
// "ADBE Text Fill Brightness"
// "ADBE Text Stroke Opacity"
// "ADBE Text Stroke Color"
// "ADBE Text Stroke Hue"
// "ADBE Text Stroke Saturation"
// "ADBE Text Stroke Brightness"
// "ADBE Text Stroke Width"
// "ADBE Text Line Anchor"
// "ADBE Text Line Spacing"
// "ADBE Text Track Type"
// "ADBE Text Tracking Amount"
// "ADBE Text Character Replace"
// "ADBE Text Character Offset"
// "ADBE Text Blur"
```

### Text Path Options
```jsx
var pathOptions = textProp.property("ADBE Text Path Options");
pathOptions.property("ADBE Text Path").setValue(maskIndex);  // Mask index
pathOptions.property("ADBE Text Reverse Path").setValue(false);
pathOptions.property("ADBE Text Perpendicular To Path").setValue(true);
pathOptions.property("ADBE Text Force Align Path").setValue(false);
pathOptions.property("ADBE Text First Margin").setValue(0);
pathOptions.property("ADBE Text Last Margin").setValue(0);
```

---

## SHAPE LAYERS

### Creating Shape Layers
```jsx
var shapeLayer = comp.layers.addShape();
shapeLayer.name = "My Shape";
var contents = shapeLayer.property("Contents");
```

### Adding Groups and Shapes
```jsx
// Add a group
var group = contents.addProperty("ADBE Vector Group");
group.name = "Circle Group";

// Access group contents
var groupContents = group.property("Contents");

// Add ellipse
var ellipse = groupContents.addProperty("ADBE Vector Shape - Ellipse");
ellipse.property("ADBE Vector Ellipse Size").setValue([100, 100]);

// Add rectangle
var rect = groupContents.addProperty("ADBE Vector Shape - Rect");
rect.property("ADBE Vector Rect Size").setValue([200, 150]);
rect.property("ADBE Vector Rect Roundness").setValue(20);

// Add polystar
var star = groupContents.addProperty("ADBE Vector Shape - Star");
star.property("ADBE Vector Star Type").setValue(1);  // 1=Star, 2=Polygon
star.property("ADBE Vector Star Points").setValue(5);
star.property("ADBE Vector Star Position").setValue([0, 0]);
star.property("ADBE Vector Star Outer Radius").setValue(100);
star.property("ADBE Vector Star Inner Radius").setValue(50);
star.property("ADBE Vector Star Outer Roundess").setValue(0);
star.property("ADBE Vector Star Inner Roundess").setValue(0);
star.property("ADBE Vector Star Rotation").setValue(0);
```

### Adding Fill and Stroke
```jsx
// Fill (solid color)
var fill = groupContents.addProperty("ADBE Vector Graphic - Fill");
fill.property("ADBE Vector Fill Color").setValue([1, 0, 0]);  // RGB only!
fill.property("ADBE Vector Fill Opacity").setValue(100);

// Stroke
var stroke = groupContents.addProperty("ADBE Vector Graphic - Stroke");
stroke.property("ADBE Vector Stroke Color").setValue([1, 1, 1]);
stroke.property("ADBE Vector Stroke Width").setValue(5);
stroke.property("ADBE Vector Stroke Opacity").setValue(100);
stroke.property("ADBE Vector Stroke Line Cap").setValue(2);  // 1=Butt, 2=Round, 3=Projecting
stroke.property("ADBE Vector Stroke Line Join").setValue(2); // 1=Miter, 2=Round, 3=Bevel

// Gradient Fill
var gFill = groupContents.addProperty("ADBE Vector Graphic - G-Fill");
gFill.property("ADBE Vector Grad Type").setValue(1);  // 1=Linear, 2=Radial
gFill.property("ADBE Vector Grad Start Pt").setValue([-100, 0]);
gFill.property("ADBE Vector Grad End Pt").setValue([100, 0]);
```

### Shape Operators
```jsx
// Trim Paths (draw-on effect)
var trim = groupContents.addProperty("ADBE Vector Filter - Trim");
trim.property("ADBE Vector Trim Start").setValue(0);
trim.property("ADBE Vector Trim End").setValueAtTime(0, 0);
trim.property("ADBE Vector Trim End").setValueAtTime(1, 100);

// Repeater
var repeater = groupContents.addProperty("ADBE Vector Filter - Repeater");
repeater.property("ADBE Vector Repeater Copies").setValue(5);
repeater.property("ADBE Vector Repeater Offset").setValue(0);
var transform = repeater.property("ADBE Vector Repeater Transform");
transform.property("ADBE Vector Repeater Position").setValue([100, 0]);
transform.property("ADBE Vector Repeater Rotation").setValue(30);
transform.property("ADBE Vector Repeater Scale").setValue([90, 90]);

// Offset Paths
var offset = groupContents.addProperty("ADBE Vector Filter - Offset");
offset.property("ADBE Vector Offset Amount").setValue(10);
offset.property("ADBE Vector Offset Line Join").setValue(1);
offset.property("ADBE Vector Offset Miter Limit").setValue(4);

// Pucker & Bloat
var pb = groupContents.addProperty("ADBE Vector Filter - PB");
pb.property("ADBE Vector PuckerBloat Amount").setValue(50);

// Round Corners
var round = groupContents.addProperty("ADBE Vector Filter - RC");
round.property("ADBE Vector RoundCorner Radius").setValue(10);

// Twist
var twist = groupContents.addProperty("ADBE Vector Filter - Twist");
twist.property("ADBE Vector Twist Angle").setValue(90);
twist.property("ADBE Vector Twist Center").setValue([0, 0]);

// Wiggle Paths
var wiggle = groupContents.addProperty("ADBE Vector Filter - Wiggler");
wiggle.property("ADBE Vector Xform Temporal Freq").setValue(2);
wiggle.property("ADBE Vector Correlation").setValue(50);
wiggle.property("ADBE Vector Temporal Phase").setValue(0);
wiggle.property("ADBE Vector Spatial Phase").setValue(0);
wiggle.property("ADBE Vector Wiggler Points").setValue(2);  // 1=Corner, 2=Smooth
wiggle.property("ADBE Vector Detail").setValue(2);
wiggle.property("ADBE Vector Wiggler Size").setValue(10);

// Zig Zag
var zigzag = groupContents.addProperty("ADBE Vector Filter - Zigzag");
zigzag.property("ADBE Vector Zigzag Size").setValue(10);
zigzag.property("ADBE Vector Zigzag Detail").setValue(5);
zigzag.property("ADBE Vector Zigzag Points").setValue(2);  // 1=Corner, 2=Smooth

// Merge Paths
var merge = groupContents.addProperty("ADBE Vector Filter - Merge");
merge.property("ADBE Vector Merge Type").setValue(1);  // 1-5 for diff modes
```

### Creating Custom Paths
```jsx
var pathGroup = groupContents.addProperty("ADBE Vector Shape - Group");
var path = pathGroup.property("ADBE Vector Shape");

// Create path shape object
var myShape = new Shape();
myShape.vertices = [[0, 0], [100, 0], [100, 100], [0, 100]];
myShape.inTangents = [[0, 0], [0, 0], [0, 0], [0, 0]];
myShape.outTangents = [[0, 0], [0, 0], [0, 0], [0, 0]];
myShape.closed = true;

path.setValue(myShape);
```

---

## MASKS

### Adding Masks
```jsx
var layer = comp.selectedLayers[0];
var masks = layer.property("ADBE Mask Parade");

// Add new mask
var mask = masks.addProperty("ADBE Mask Atom");
mask.name = "My Mask";
```

### Mask Properties
```jsx
mask.property("ADBE Mask Mode").setValue(MaskMode.ADD);
// MaskMode: NONE, ADD, SUBTRACT, INTERSECT, LIGHTEN, DARKEN, DIFFERENCE

mask.property("ADBE Mask Opacity").setValue(100);
mask.property("ADBE Mask Feather").setValue([10, 10]);
mask.property("ADBE Mask Offset").setValue(0);

// Invert
mask.maskInverted = true;

// Lock
mask.locked = true;
```

### Setting Mask Path
```jsx
var maskPath = mask.property("ADBE Mask Shape");

// Create mask shape
var maskShape = new Shape();
maskShape.vertices = [
    [100, 100],
    [300, 100],
    [300, 300],
    [100, 300]
];
maskShape.closed = true;

maskPath.setValue(maskShape);

// Animate mask path
maskPath.setValueAtTime(0, maskShape);

var maskShape2 = new Shape();
maskShape2.vertices = [
    [150, 150],
    [350, 150],
    [350, 350],
    [150, 350]
];
maskShape2.closed = true;
maskPath.setValueAtTime(1, maskShape2);
```

---

## CAMERAS

### Creating Cameras
```jsx
// Create camera (point of interest is centerPoint, not position!)
var camera = comp.layers.addCamera("Camera 1", [comp.width/2, comp.height/2]);

// IMPORTANT: Position camera correctly after creation
var zoom = camera.cameraOption.zoom.value;
camera.transform.position.setValue([comp.width/2, comp.height/2, -zoom]);
camera.transform.pointOfInterest.setValue([comp.width/2, comp.height/2, 0]);
```

### Camera Properties
```jsx
// Camera options
camera.cameraOption.zoom                    // Zoom
camera.cameraOption.depthOfField            // DOF enabled (boolean)
camera.cameraOption.focusDistance           // Focus distance
camera.cameraOption.aperture                // Aperture
camera.cameraOption.blurLevel               // Blur level
camera.cameraOption.irisShape               // Iris shape
camera.cameraOption.irisRotation            // Iris rotation
camera.cameraOption.irisRoundness           // Iris roundness
camera.cameraOption.irisAspectRatio         // Aspect ratio
camera.cameraOption.irisDiffractionFringe   // Diffraction fringe
camera.cameraOption.highlightGain           // Highlight gain
camera.cameraOption.highlightThreshold      // Highlight threshold
camera.cameraOption.highlightSaturation     // Highlight saturation
```

### Two-Node vs One-Node Camera
```jsx
// Two-node (default): Has Point of Interest
camera.autoOrient = AutoOrientType.CAMERA_OR_POINT_OF_INTEREST;

// One-node: No Point of Interest (free rotation)
camera.autoOrient = AutoOrientType.NO_AUTO_ORIENT;
```

---

## LIGHTS

### Creating Lights
```jsx
var light = comp.layers.addLight("Light 1", [comp.width/2, comp.height/2]);
```

### Light Types
```jsx
light.lightType = LightType.PARALLEL;   // Parallel
light.lightType = LightType.SPOT;       // Spot
light.lightType = LightType.POINT;      // Point
light.lightType = LightType.AMBIENT;    // Ambient
```

### Light Properties
```jsx
light.lightOption.intensity              // Intensity %
light.lightOption.color                  // [r, g, b]
light.lightOption.coneAngle              // Spot cone angle
light.lightOption.coneFeather            // Spot feather %
light.lightOption.shadowDarkness         // Shadow darkness
light.lightOption.shadowDiffusion        // Shadow diffusion
light.lightOption.castsShadows           // Boolean
light.lightOption.falloff                // Falloff type
light.lightOption.radius                 // Light radius
light.lightOption.falloffDistance        // Falloff distance
```

---

## 3D LAYERS

### Enabling 3D
```jsx
layer.threeDLayer = true;  // Enable 3D

// Check if layer can be 3D
if (layer.canSetThreeDLayer) {
    layer.threeDLayer = true;
}
```

### 3D Position
```jsx
// IMPORTANT: Never access zPosition directly!
// Always work with full position array

layer.threeDLayer = true;
var pos = layer.transform.position.value;  // Gets [x, y] or [x, y, z]
layer.transform.position.setValue([pos[0], pos[1], 500]);  // Set Z to 500
```

### 3D Transform Properties
```jsx
// Rotation axes
layer.transform.xRotation        // X Rotation
layer.transform.yRotation        // Y Rotation
layer.transform.zRotation        // Z Rotation (same as rotation in 2D)
layer.transform.orientation      // Orientation [x, y, z]

// Material options (3D layers only)
layer.materialOption.lightTransmission
layer.materialOption.castsShadows
layer.materialOption.acceptsShadows
layer.materialOption.acceptsLights
layer.materialOption.ambient
layer.materialOption.diffuse
layer.materialOption.specularIntensity
layer.materialOption.specularShininess
layer.materialOption.metal
layer.materialOption.reflectionIntensity
layer.materialOption.reflectionSharpness
layer.materialOption.reflectionRolloff
layer.materialOption.transparency
layer.materialOption.transparencyRolloff
layer.materialOption.indexOfRefraction
```

---

## PRECOMPOSING (SILENT)

```jsx
// DON'T use: comp.layers.precompose() - opens dialog!
// Use this pattern instead:

(function() {
    var comp = app.project.activeItem;
    var layers = comp.selectedLayers;
    if (layers.length === 0) return;
    
    // Store layer refs before any changes
    var layerRefs = [];
    for (var i = 0; i < layers.length; i++) {
        layerRefs.push(layers[i]);
    }
    
    // Create precomp
    var precomp = app.project.items.addComp(
        "Pre-comp",
        comp.width, comp.height,
        comp.pixelAspect,
        comp.duration,
        comp.frameRate
    );
    
    // Copy layers (reverse order preserves stacking)
    for (var i = layerRefs.length - 1; i >= 0; i--) {
        layerRefs[i].copyToComp(precomp);
    }
    
    // Get insert position before removing
    var insertIndex = layerRefs[0].index;
    
    // Add precomp as layer at original position
    var precompLayer = comp.layers.add(precomp);
    precompLayer.moveAfter(comp.layer(insertIndex));
    
    // Remove originals (reverse order!)
    for (var i = layerRefs.length - 1; i >= 0; i--) {
        layerRefs[i].remove();
    }
    
    return precompLayer;
})();
```
