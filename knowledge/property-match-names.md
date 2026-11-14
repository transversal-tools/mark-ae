# Property Match Names Reference

This is a comprehensive reference for After Effects internal property names used in ExtendScript.

---

## Transform Properties

All layers share these transform properties under `layer.transform`:

| UI Name | Match Name | Access |
|---------|------------|--------|
| Anchor Point | `ADBE Anchor Point` | `layer.transform.anchorPoint` |
| Position | `ADBE Position` | `layer.transform.position` |
| Position (Separated X) | `ADBE Position_0` | When position is separated |
| Position (Separated Y) | `ADBE Position_1` | When position is separated |
| Position (Separated Z) | `ADBE Position_2` | 3D layers only |
| Scale | `ADBE Scale` | `layer.transform.scale` |
| Rotation | `ADBE Rotate Z` | `layer.transform.rotation` |
| Rotation X | `ADBE Rotate X` | 3D layers: `layer.transform.xRotation` |
| Rotation Y | `ADBE Rotate Y` | 3D layers: `layer.transform.yRotation` |
| Rotation Z | `ADBE Rotate Z` | 3D layers: `layer.transform.zRotation` |
| Orientation | `ADBE Orientation` | 3D layers: `layer.transform.orientation` |
| Opacity | `ADBE Opacity` | `layer.transform.opacity` |

---

## 3D Extrusion Properties (Advanced 3D Renderer)

⚠️ **CRITICAL**: These only work with the Advanced 3D renderer (`comp.renderer = "ADBE Calder"`).

### Geometry Options (Extrusion)

| UI Name | Match Name | Parent Group |
|---------|------------|--------------|
| **Geometry Options Group** | `ADBE Extrsn Options Group` | Layer |
| Extrusion Depth | `ADBE Extrsn Depth` | Geometry Options |
| Hole Bevel Depth | `ADBE Hole Bevel Depth` | Geometry Options |
| Bevel Style | `ADBE Bevel Style` | Geometry Options |
| Bevel Depth | `ADBE Bevel Depth` | Geometry Options |

```jsx
// ✅ CORRECT access pattern
var geo = layer.property("ADBE Extrsn Options Group");
geo.property("ADBE Extrsn Depth").setValue(100);
geo.property("ADBE Bevel Style").setValue(4);  // Convex
geo.property("ADBE Bevel Depth").setValue(5);

// ⛔ WRONG - This doesn't exist!
layer.property("ADBE Geometry Options Group");  // WRONG NAME!
```

### Bevel Style Values

| Value | Style |
|-------|-------|
| 1 | None |
| 2 | Angular |
| 3 | Concave |
| 4 | Convex |

### Material Options

| UI Name | Match Name | Parent Group |
|---------|------------|--------------|
| **Material Options Group** | `ADBE Material Options Group` | Layer |
| Casts Shadows | `ADBE Casts Shadows` | Material Options |
| Accepts Shadows | `ADBE Accepts Shadows` | Material Options |
| Accepts Lights | `ADBE Accepts Lights` | Material Options |
| Ambient | `ADBE Ambient Coefficient` | Material Options |
| Diffuse | `ADBE Diffuse Coefficient` | Material Options |
| Specular Intensity | `ADBE Specular Coefficient` | Material Options |
| Specular Shininess | `ADBE Specular Shininess` | Material Options |
| Metal | `ADBE Metal Coefficient` | Material Options |
| Reflection Intensity | `ADBE Reflection Intensity` | Material Options |
| Reflection Sharpness | `ADBE Reflection Sharpness` | Material Options |
| Reflection Rolloff | `ADBE Reflection Rolloff` | Material Options |
| Transparency | `ADBE Transparency Coefficient` | Material Options |
| Transparency Rolloff | `ADBE Transparency Rolloff` | Material Options |
| Index of Refraction | `ADBE Index of Refraction` | Material Options |

```jsx
var mat = layer.property("ADBE Material Options Group");
mat.property("ADBE Casts Shadows").setValue(1);  // On
mat.property("ADBE Specular Shininess").setValue(50);
mat.property("ADBE Metal Coeff").setValue(80);
mat.property("ADBE Reflection Intensity").setValue(50);
```

---

## Shape Layer Properties

### Shape Contents

| UI Name | Match Name | Notes |
|---------|------------|-------|
| Contents | `ADBE Root Vectors Group` | Top level |
| Group | `ADBE Vector Group` | Container |
| Rectangle Path | `ADBE Vector Shape - Rect` | |
| Ellipse Path | `ADBE Vector Shape - Ellipse` | |
| Polystar Path | `ADBE Vector Shape - Star` | |
| Path | `ADBE Vector Shape - Group` | Bezier path |
| Fill | `ADBE Vector Graphic - Fill` | |
| Stroke | `ADBE Vector Graphic - Stroke` | |
| Gradient Fill | `ADBE Vector Graphic - G-Fill` | |
| Gradient Stroke | `ADBE Vector Graphic - G-Stroke` | |
| Merge Paths | `ADBE Vector Filter - Merge` | |
| Offset Paths | `ADBE Vector Filter - Offset` | |
| Trim Paths | `ADBE Vector Filter - Trim` | |
| Twist | `ADBE Vector Filter - Twist` | |
| Wiggle Paths | `ADBE Vector Filter - Wiggler` | |
| Zig Zag | `ADBE Vector Filter - Zigzag` | |
| Repeater | `ADBE Vector Filter - Repeater` | |
| Round Corners | `ADBE Vector Filter - RC` | |

### Rectangle Properties

| Property | Match Name |
|----------|------------|
| Size | `ADBE Vector Rect Size` |
| Position | `ADBE Vector Rect Position` |
| Roundness | `ADBE Vector Rect Roundness` |

⚠️ **EXPRESSION-CAPABLE**: Only the **leaf properties** (Size, Position, Roundness) can have expressions applied.
The "Rectangle 1" group itself CANNOT have an expression - you must target the specific property inside it!

```jsx
// ✅ CORRECT - Apply expression to Size property
var grp = layer.property("Contents").property("Rectangle 1");
var rect = grp.property("Contents").property("Rectangle Path 1");
rect.property("Size").expression = "[thisComp.width, thisComp.height]";

// ⛔ WRONG - Group cannot have expression
grp.expression = "..."; // ERROR!

// ✅ To match comp size via expression
var sizeExpr = "[thisComp.width, thisComp.height]";
rect.property("Size").expression = sizeExpr;
```

```jsx
// Create shape with rectangle
var shape = comp.layers.addShape();
var grp = shape.property("Contents").addProperty("ADBE Vector Group");
var rect = grp.property("Contents").addProperty("ADBE Vector Shape - Rect");
rect.property("Size").setValue([400, 300]);
rect.property("Roundness").setValue(20);

var fill = grp.property("Contents").addProperty("ADBE Vector Graphic - Fill");
fill.property("Color").setValue([1, 0, 0]);  // Red (RGB, 3 values!)
```

### Fill Properties

| Property | Match Name |
|----------|------------|
| Color | `ADBE Vector Fill Color` |
| Opacity | `ADBE Vector Fill Opacity` |
| Fill Rule | `ADBE Vector Fill Rule` |

### Stroke Properties

| Property | Match Name |
|----------|------------|
| Color | `ADBE Vector Stroke Color` |
| Opacity | `ADBE Vector Stroke Opacity` |
| Stroke Width | `ADBE Vector Stroke Width` |
| Line Cap | `ADBE Vector Stroke Line Cap` |
| Line Join | `ADBE Vector Stroke Line Join` |

---

## Camera Properties

| UI Name | Match Name | Access |
|---------|------------|--------|
| Point of Interest | `ADBE Anchor Point` | `camera.pointOfInterest` |
| Zoom | `ADBE Camera Zoom` | `camera.cameraOption.zoom` |
| Depth of Field | `ADBE Camera Depth of Field` | |
| Focus Distance | `ADBE Camera Focus Distance` | |
| Aperture | `ADBE Camera Aperture` | |
| Blur Level | `ADBE Camera Blur Level` | |

```jsx
var cam = comp.layers.addCamera("Camera 1", [960, 540]);
cam.position.setValue([960, 540, -1500]);
cam.property("Camera Options").property("Zoom").setValue(1200);
```

---

## Light Properties

⚠️ **CRITICAL**: Use direct properties, NOT `.transform.position`!

| UI Name | Match Name | Access |
|---------|------------|--------|
| Position | - | `light.position` ✅ (NOT `light.transform.position`) |
| Point of Interest | - | `light.pointOfInterest` |
| Intensity | `ADBE Light Intensity` | `light.intensity` |
| Color | `ADBE Light Color` | `light.color` |
| Cone Angle | `ADBE Light Cone Angle` | Spot lights |
| Cone Feather | `ADBE Light Cone Feather` | Spot lights |
| Falloff | `ADBE Light Falloff Type` | |
| Radius | `ADBE Light Falloff Start` | |
| Falloff Distance | `ADBE Light Falloff Distance` | |
| Casts Shadows | `ADBE Light Casts Shadows` | |
| Shadow Darkness | `ADBE Light Shadow Darkness` | |
| Shadow Diffusion | `ADBE Light Shadow Diffusion` | |

```jsx
// ✅ CORRECT way to set light properties
var light = comp.layers.addLight("Key Light", [960, 540]);
light.lightType = LightType.POINT;
light.position.setValue([960, 540, -500]);  // Direct!
light.intensity.setValue(100);
light.color.setValue([1, 0.95, 0.9]);

// ⛔ WRONG - causes "property hidden" errors
light.transform.position.setValue([x, y, z]);
```

### Light Types

| LightType | Value |
|-----------|-------|
| PARALLEL | `LightType.PARALLEL` |
| SPOT | `LightType.SPOT` |
| POINT | `LightType.POINT` |
| AMBIENT | `LightType.AMBIENT` |

---

## Text Layer Properties

| UI Name | Match Name | Access |
|---------|------------|--------|
| Source Text | `ADBE Text Properties` | `textLayer.property("Source Text")` |
| Path Options | `ADBE Text Path Options` | |
| More Options | `ADBE Text More Options` | |
| Animators | `ADBE Text Animators` | |

```jsx
var textLayer = comp.layers.addText("Hello");
var textProp = textLayer.property("Source Text");
var textDoc = textProp.value;
textDoc.fontSize = 72;
textDoc.fillColor = [1, 1, 1];
textDoc.font = "Arial-BoldMT";
textProp.setValue(textDoc);
```

---

## Audio Properties

| UI Name | Match Name |
|---------|------------|
| Audio Levels | `ADBE Audio Levels` |

---

## 3D Renderer Names

| UI Name | Internal Codename |
|---------|-------------------|
| Classic 3D | `ADBE Advanced 3d` | 
| **Advanced 3D** | `ADBE Calder` |
| Cinema 4D | `ADBE Ernst` |

```jsx
// Switch to Advanced 3D
comp.renderer = "ADBE Calder";

// Switch to Classic 3D
comp.renderer = "ADBE Advanced 3d";
```

---

## Effects

Effects are accessed via `layer.Effects` or `layer.property("ADBE Effect Parade")`.

### Common Effects

| Effect | Match Name |
|--------|------------|
| Gaussian Blur | `ADBE Gaussian Blur 2` |
| Drop Shadow | `ADBE Drop Shadow` |
| Glow | `ADBE Glo2` |
| Fill | `ADBE Fill` |
| Tint | `ADBE Tint` |
| Levels | `ADBE Levels2` |
| Curves | `ADBE Curves` |
| Hue/Saturation | `ADBE HUE SATURATION` |
| Tritone | `ADBE Tritone` |
| CC Radial Blur | `CC Radial Blur` |
| Fractal Noise | `ADBE Fractal Noise` |

```jsx
var blur = layer.Effects.addProperty("ADBE Gaussian Blur 2");
blur.property("Blurriness").setValue(20);

var glow = layer.Effects.addProperty("ADBE Glo2");
glow.property("Glow Radius").setValue(100);
glow.property("Glow Intensity").setValue(2);
```
