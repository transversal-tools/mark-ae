# After Effects Knowledge Library (2024-2026)

Last Updated: December 2024
Sources: Adobe HelpX, Adobe Community Forums, Adobe Beta Program

---

## VERSION 26.0 BETA (AE 2026 - UPCOMING)

⚠️ **BETA FEATURES** - Subject to change before release

### 🎯 Native 3D Parametric Meshes (MAJOR FEATURE)
- **NEW**: Create 3D primitives directly in After Effects!
- Cube, Sphere, Cone, Plane, Torus, Cylinder
- Intuitive controls for size, bevels, side counts
- Works like the 3D equivalent of shape layers
- No more need for external 3D software for basic shapes

**Potential scripting pattern:**
```jsx
// This API is BETA and may change
var mesh = comp.layers.addPrimitive(PrimitiveType.CUBE);
mesh.property("Size").setValue([100, 100, 100]);
mesh.property("Bevel").setValue(5);
```

### 🎨 Substance 3D Material Integration
- **NEW**: Native support for .sbsar files (Substance materials)
- Import dynamic, adjustable textures for 3D models
- Animate material properties with keyframes
- Real-time feedback in native 3D engine
- Adobe provides 1,300+ FREE Substance materials!

### 💡 Enhanced 3D Lighting
- **NEW**: Up to 9 lights per scene (up from previous limit)
- Spot, Area, and Environment lights
- All lights can cast shadows
- Better control over scene illumination

### 📐 Native SVG Import
- **NEW**: Import SVG files directly
- Converts to editable shape layers
- Preserves transparency, gradient strokes, and fills
- Improved Illustrator → Shape Layer pipeline

### 🔤 Variable Font Animation
- **NEW**: Animate font weight, width, style from single font file
- Fluid morphing kinetic typography
- Control via expressions

**Potential scripting pattern:**
```jsx
// Variable font properties (BETA)
textLayer.property("Source Text").property("Font Variation").property("Weight").setValue(700);
textLayer.property("Source Text").property("Font Variation").property("Width").setValue(125);
```

### 🎬 Unmult Effect (GPU-Accelerated)
- **NEW**: Remove solid black or white backgrounds
- Preserves glow and detail
- Perfect for compositing explosions, flares, smoke
- Built-in effect (no plugins needed)

**Usage:**
```jsx
var unmult = layer.Effects.addProperty("ADBE Unmult"); // Name TBD
```

### 🔊 New Audio Effects
- **Gate** - Control when audio passes through
- **Compressor** - Dynamic range control
- **Distortion** - Add grit and character
- Native audio processing in AE!

### 💾 Lossless Compressed Playback
- New cache format saves disk space
- Faster playback for long compositions
- Better RAM + disk hybrid caching

### ✂️ Crop Composition to Layer Bounds
- **NEW**: Automatically resize comp to selected layer(s)
- Useful for exporting tight assets

---

## VERSION 25.6 (November 2025)

### Default Camera Settings
- **NEW**: Use View menu to adjust custom view and Default Camera Settings
- Works whether viewing through camera layer, default active camera, or custom view
- Path: View → Default Camera Settings

### Single 3D Gizmo for Multiple Layers
- **NEW**: Select multiple 3D layers and control them with a single gizmo
- Reduces visual clutter in complex 3D scenes
- Just select multiple 3D layers - gizmo appears at combined center

### Tip of the Day
- Quick tips appear when Composition, Footage, or Layer panels reload or are empty

---

## VERSION 25.4 (August 2025)

### Quick Offset (MAJOR FEATURE)
- **NEW**: Stagger layers or keyframes across multiple layers with keyboard shortcut
- Select layers → Use shortcut to offset timing
- Essential for quick stagger animations

### Paste Text Formatting Only
- **NEW**: Apply only text formatting (no content) to Text layers
- Edit → Paste Text Formatting Only
- Works on entire layer or specific words

### CICP Metadata Support
- Import/export HDR content with CICP metadata
- Ensures color accuracy across devices

### Effect Info Buttons
- Info buttons next to each effect in Effects & Presets panel
- Quick reference while working

---

## VERSION 25.3 (June 2025)

### Smooth Zoom
- Fluid magnification while scrolling, pinch-to-zoom, or using Zoom tool
- Works in Composition, Layer, and Footage panels

### High Performance Preview Playback
- Dramatically longer preview durations
- No RAM size limitation
- Uses improved disk caching

### HDR Preview Support
- Preview and monitor HDR content natively
- Essential for HDR motion design

### 3D Model Animation Controls in Properties Panel
- Modify lighting/shadow effects on 3D model layers
- Select embedded animations through Properties panel

### Animated Environment Lights
- **ADVANCED 3D**: Use composition, video, or image layer as Environment light
- Dynamic lighting for 3D scenes

### New 3D Helper Commands
- Link camera to light (single click)
- Apply 2D effects to 3D objects
- Visualize Environment Light source

### Null Creation Improvements
- Create Null controllers for:
  - Gradient points of Shapes
  - Puppet Pins
  - Effect points
- Simplifies rigging workflows

### Accepts Lights Switch
- Disable 3D layer from accepting lights
- Keep object appearance unaffected by scene lighting

### 3D Model Preview Thumbnails
- Preview 3D models as thumbnails in Project panel
- Faster model identification

---

## ADVANCED 3D RENDERER (AE 2024+)

### When to Use
- 3D text extrusion
- 3D shape extrusion
- Bevels and materials
- Environment lighting
- 3D model integration

### How to Enable
1. Composition Settings (Cmd/Ctrl + K)
2. 3D Renderer tab
3. Change from "Classic 3D" to "Advanced 3D"

### Advantages over Cinema 4D Renderer
- GPU-accelerated
- Better performance
- Native AE integration
- Environment lights support
- Better material options

### Geometry Options (Advanced 3D)
- Extrusion Depth
- Bevel Style
- Bevel Depth
- Hole Bevel Depth
- Material Options (Ambient, Diffuse, Specular, Shininess, Metal)

---

## COMMON SCRIPTING PATTERNS

### Opening Panels/Extensions (Case-Sensitive!)

⚠️ **CRITICAL**: `app.findMenuCommandId()` is CASE-SENSITIVE!

```jsx
// ❌ WRONG - may fail due to case mismatch
app.executeCommand(app.findMenuCommandId("script runner"));  // Returns 0!

// ✅ CORRECT - use smartFindMenuCommand helper
smartFindMenuCommand("script runner");  // Tries multiple variations
```

The `smartFindMenuCommand()` helper automatically tries:
- Original text
- No spaces (ScriptRunner)
- With spaces (Script Runner)
- Title Case
- lowercase
- UPPERCASE

### Change 3D Renderer (Classic ↔ Advanced)

⚠️ **CRITICAL: Internal Names Don't Match UI Names!**

| UI Name | Internal Codename | Notes |
|---------|-------------------|-------|
| Classic 3D | `ADBE Advanced 3d` | CONFUSING! Legacy name |
| **Advanced 3D** | `ADBE Calder` | ✅ THE ONE YOU WANT |
| Cinema 4D | `ADBE Ernst` | C4D renderer |

**CORRECT CODE to switch to Advanced 3D:**
```jsx
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) {
        // Fallback: find first comp in project
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem) {
                comp = item;
                break;
            }
        }
    }
    if (!comp) return;
    
    // CORRECT: Use "ADBE Calder" for Advanced 3D (NOT "ADBE Advanced 3d"!)
    comp.renderer = "ADBE Calder";
})();
```

**To switch BACK to Classic 3D:**
```jsx
comp.renderer = "ADBE Advanced 3d";  // Confusing but correct for Classic
```



### Check AE Version
```jsx
var version = parseFloat(app.version);
if (version >= 25.0) {
    // AE 2024+ features available
}
```

### Modern Effect Recommendations
- Use: Gaussian Blur (not Fast Blur - deprecated)
- Use: Lumetri Color (not old Color Correction)
- Use: Layer Styles Drop Shadow (more options)

### Modern Expressions
```jsx
// Frame-by-frame look
posterizeTime(12);

// Dynamic text boxes
var rect = thisLayer.sourceRectAtTime();
[rect.width, rect.height]

// JSON animation data
thisComp.layer("Data").source.data.value
```

---

## KNOWN ISSUES & FIXES

### ⚠️ LIGHT CREATION - CORRECT PROPERTY PATH

**CRITICAL**: Use `.position.setValue()` directly, NOT `.transform.position.setValue()`!

**CORRECT WAY to add lights:**

```jsx
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;

    // Deselect all layers first
    for (var i = 1; i <= comp.numLayers; i++) {
        comp.layer(i).selected = false;
    }

    // ✅ POINT LIGHT - position works directly on layer
    var keyLight = comp.layers.addLight("Key Light", [comp.width/2, comp.height/2]);
    keyLight.lightType = LightType.POINT;
    keyLight.position.setValue([comp.width/2 + 500, comp.height/2 - 500, -800]);
    keyLight.intensity.setValue(100);
    keyLight.color.setValue([1, 0.95, 0.9]);

    // ✅ SPOT LIGHT with pointOfInterest
    var spotLight = comp.layers.addLight("Rim Light", [comp.width/2, comp.height/2]);
    spotLight.lightType = LightType.SPOT;
    spotLight.position.setValue([comp.width/2 - 900, comp.height/2 - 300, 200]);
    spotLight.pointOfInterest.setValue([comp.width/2, comp.height/2, 0]);
    spotLight.intensity.setValue(150);
    spotLight.color.setValue([0.85, 0.9, 1]);
})();
```

**KEY INSIGHT**: The working script uses:
- `light.position.setValue()` ✅
- `light.pointOfInterest.setValue()` ✅
- `light.intensity.setValue()` ✅
- `light.color.setValue()` ✅

**NOT**: `light.transform.position.setValue()` ⛔

### Display Acceleration Disabled
- GPU not recognized or driver issues
- Fix: Update GPU drivers, check Preferences → Display

### Dynamic Link Issues (AME)
- After Effects and Media Encoder communication broken
- Fix: Clear cache, restart both apps, check firewall

### Common Crashes
- Check Preferences → Memory & Performance
- Disable GPU acceleration temporarily to test
- Clear disk cache

---

## KEYBOARD SHORTCUTS (ESSENTIALS)

### Timeline
- U = Show keyframed properties
- UU = Show modified properties
- E = Show effects
- EE = Show expressions
- S/R/P/A/T = Scale/Rotation/Position/Anchor/Opacity

### 3D
- F10/F11/F12 = Switch 3D views
- C = Camera tool
- W = Rotation tool

### Preview
- Space = Preview
- 0 (numpad) = RAM Preview
- . (period) = Audio only preview

---

## RESOURCES

- Adobe HelpX: https://helpx.adobe.com/after-effects/user-guide.html
- What's New: https://helpx.adobe.com/after-effects/using/whats-new.html
- Community: https://community.adobe.com/t5/after-effects/ct-p/ct-after-effects
- Fixed Issues: https://helpx.adobe.com/after-effects/kb/fixed-issues.html
