# Common Effect Templates

Pre-built code snippets for popular After Effects effects and setups.

---

## Glow Effects

### Basic Glow

```jsx
(function() {
    var comp = app.project.activeItem;
    var layer = comp.selectedLayers[0];
    if (!layer) return;
    
    var glow = layer.Effects.addProperty("ADBE Glo2");
    glow.property("Glow Threshold").setValue(60);
    glow.property("Glow Radius").setValue(100);
    glow.property("Glow Intensity").setValue(1.5);
    glow.property("Glow Colors").setValue(1);  // Original Colors
})();
```

### Neon Glow (Intense)

```jsx
(function() {
    var comp = app.project.activeItem;
    var layer = comp.selectedLayers[0];
    if (!layer) return;
    
    // First glow - tight core
    var glow1 = layer.Effects.addProperty("ADBE Glo2");
    glow1.property("Glow Threshold").setValue(50);
    glow1.property("Glow Radius").setValue(25);
    glow1.property("Glow Intensity").setValue(2);
    
    // Second glow - wide aura
    var glow2 = layer.Effects.addProperty("ADBE Glo2");
    glow2.property("Glow Threshold").setValue(60);
    glow2.property("Glow Radius").setValue(150);
    glow2.property("Glow Intensity").setValue(0.8);
})();
```

---

## Shadow Effects

### Drop Shadow

```jsx
(function() {
    var comp = app.project.activeItem;
    var layer = comp.selectedLayers[0];
    if (!layer) return;
    
    var shadow = layer.Effects.addProperty("ADBE Drop Shadow");
    shadow.property("Opacity").setValue(75);
    shadow.property("Direction").setValue(135);  // Degrees
    shadow.property("Distance").setValue(10);
    shadow.property("Softness").setValue(20);
    shadow.property("Shadow Color").setValue([0, 0, 0]);
})();
```

### Long Shadow (Motion Design Style)

```jsx
(function() {
    var comp = app.project.activeItem;
    var layer = comp.selectedLayers[0];
    if (!layer) return;
    
    // Create multiple drop shadows for long shadow effect
    for (var i = 1; i <= 10; i++) {
        var shadow = layer.Effects.addProperty("ADBE Drop Shadow");
        shadow.property("Opacity").setValue(30 - (i * 2));
        shadow.property("Direction").setValue(135);
        shadow.property("Distance").setValue(i * 5);
        shadow.property("Softness").setValue(0);
        shadow.property("Shadow Color").setValue([0.1, 0.1, 0.15]);
    }
})();
```

---

## Blur Effects

### Gaussian Blur

```jsx
(function() {
    var comp = app.project.activeItem;
    var layer = comp.selectedLayers[0];
    if (!layer) return;
    
    var blur = layer.Effects.addProperty("ADBE Gaussian Blur 2");
    blur.property("Blurriness").setValue(20);
    blur.property("Blur Dimensions").setValue(1);  // Horizontal and Vertical
})();
```

### Animated Focus Pull

```jsx
(function() {
    var comp = app.project.activeItem;
    var layer = comp.selectedLayers[0];
    if (!layer) return;
    
    var blur = layer.Effects.addProperty("ADBE Gaussian Blur 2");
    var blurriness = blur.property("Blurriness");
    
    // Start blurry, focus in
    blurriness.setValueAtTime(0, 50);
    blurriness.setValueAtTime(1, 0);
    
    // Add easing
    blurriness.setInterpolationTypeAtKey(1, KeyframeInterpolationType.BEZIER);
    blurriness.setInterpolationTypeAtKey(2, KeyframeInterpolationType.BEZIER);
})();
```

---

## Color Correction

### Cinematic Look (Teal & Orange)

```jsx
(function() {
    var comp = app.project.activeItem;
    var layer = comp.selectedLayers[0];
    if (!layer) return;
    
    // Add Curves
    var curves = layer.Effects.addProperty("ADBE Curves");
    
    // Add Hue/Saturation
    var hueSat = layer.Effects.addProperty("ADBE HUE SATURATION");
    hueSat.property("Channel Control").setValue(1);  // Master
    hueSat.property("Master Saturation").setValue(15);
    
    // Add a subtle vignette via CC Vignette or adjustment layer
})();
```

### Desaturate (Black & White)

```jsx
(function() {
    var comp = app.project.activeItem;
    var layer = comp.selectedLayers[0];
    if (!layer) return;
    
    var hueSat = layer.Effects.addProperty("ADBE HUE SATURATION");
    hueSat.property("Channel Control").setValue(1);
    hueSat.property("Master Saturation").setValue(-100);
})();
```

### Vintage Film Look

```jsx
(function() {
    var comp = app.project.activeItem;
    var layer = comp.selectedLayers[0];
    if (!layer) return;
    
    // Add Tint for sepia
    var tint = layer.Effects.addProperty("ADBE Tint");
    tint.property("Map Black To").setValue([0.2, 0.1, 0.05]);
    tint.property("Map White To").setValue([1, 0.95, 0.85]);
    tint.property("Amount to Tint").setValue(30);
    
    // Add Levels for contrast
    var levels = layer.Effects.addProperty("ADBE Levels2");
    levels.property("Input Black").setValue(15);
    levels.property("Input White").setValue(240);
    levels.property("Gamma").setValue(0.9);
})();
```

---

## Transitions

### Fade In

```jsx
(function() {
    var comp = app.project.activeItem;
    var layer = comp.selectedLayers[0];
    if (!layer) return;
    
    var opacity = layer.transform.opacity;
    var startTime = layer.inPoint;
    
    opacity.setValueAtTime(startTime, 0);
    opacity.setValueAtTime(startTime + 0.5, 100);
    
    // Easy ease
    opacity.setInterpolationTypeAtKey(1, KeyframeInterpolationType.BEZIER);
    opacity.setInterpolationTypeAtKey(2, KeyframeInterpolationType.BEZIER);
})();
```

### Fade Out

```jsx
(function() {
    var comp = app.project.activeItem;
    var layer = comp.selectedLayers[0];
    if (!layer) return;
    
    var opacity = layer.transform.opacity;
    var endTime = layer.outPoint;
    
    opacity.setValueAtTime(endTime - 0.5, 100);
    opacity.setValueAtTime(endTime, 0);
    
    opacity.setInterpolationTypeAtKey(1, KeyframeInterpolationType.BEZIER);
    opacity.setInterpolationTypeAtKey(2, KeyframeInterpolationType.BEZIER);
})();
```

### Scale Pop In

```jsx
(function() {
    var comp = app.project.activeItem;
    var layer = comp.selectedLayers[0];
    if (!layer) return;
    
    var scale = layer.transform.scale;
    var startTime = layer.inPoint;
    
    // Start small, overshoot, settle
    scale.setValueAtTime(startTime, [0, 0]);
    scale.setValueAtTime(startTime + 0.2, [110, 110]);  // Overshoot
    scale.setValueAtTime(startTime + 0.35, [100, 100]); // Settle
    
    // Easing
    for (var i = 1; i <= scale.numKeys; i++) {
        scale.setInterpolationTypeAtKey(i, KeyframeInterpolationType.BEZIER);
    }
})();
```

### Slide In from Left

```jsx
(function() {
    var comp = app.project.activeItem;
    var layer = comp.selectedLayers[0];
    if (!layer) return;
    
    var pos = layer.transform.position;
    var currentPos = pos.value;
    var startTime = layer.inPoint;
    
    // Start off-screen left
    pos.setValueAtTime(startTime, [-layer.width, currentPos[1]]);
    pos.setValueAtTime(startTime + 0.5, currentPos);
    
    // Easy ease out
    pos.setInterpolationTypeAtKey(1, KeyframeInterpolationType.BEZIER);
    pos.setInterpolationTypeAtKey(2, KeyframeInterpolationType.BEZIER);
})();
```

---

## Text Animations

### Typewriter Effect

```jsx
(function() {
    var comp = app.project.activeItem;
    var layer = comp.selectedLayers[0];
    if (!layer || !(layer instanceof TextLayer)) return;
    
    var textProp = layer.property("Source Text");
    var fullText = textProp.value.text;
    var duration = 2;  // seconds
    var charsPerSecond = fullText.length / duration;
    
    // Expression for typewriter
    layer.property("Source Text").expression = 
        'text.sourceText.substr(0, Math.floor(time * ' + charsPerSecond + '))';
})();
```

### Fade Up Characters (Using Animator)

```jsx
(function() {
    var comp = app.project.activeItem;
    var layer = comp.selectedLayers[0];
    if (!layer || !(layer instanceof TextLayer)) return;
    
    var animators = layer.property("Text").property("Animators");
    var anim = animators.addProperty("ADBE Text Animator");
    anim.name = "Fade Up";
    
    // Add Range Selector
    var range = anim.property("Selectors").addProperty("ADBE Text Selector");
    range.property("Start").setValueAtTime(0, 0);
    range.property("End").setValueAtTime(0, 0);
    range.property("End").setValueAtTime(2, 100);
    
    // Add Properties
    var props = anim.property("Properties");
    props.addProperty("ADBE Text Opacity");
    props.property("Opacity").setValue(0);
    
    props.addProperty("ADBE Text Position");
    props.property("Position").setValue([0, 50]);  // Start 50px down
})();
```

---

## Vignette

### Ellipse Vignette

```jsx
(function() {
    var comp = app.project.activeItem;
    
    // Create adjustment layer
    var adj = comp.layers.addSolid([0,0,0], "Vignette", comp.width, comp.height, 1);
    adj.adjustmentLayer = true;
    
    // Add CC Vignette or create with mask
    var vignette = adj.Effects.addProperty("CC Vignette");
    vignette.property("Amount").setValue(80);
})();
```

---

## Displacement Effects

### Displacement Map (Setup for Logo/Text)

```jsx
(function() {
    var comp = app.project.activeItem;
    var layer = comp.selectedLayers[0];
    if (!layer) return;
    
    // Assume we have a displacement source layer (like Fractal Noise)
    var sourceLayer = comp.layer("Displacement Source"); 
    if (!sourceLayer) {
        alert("Please rename your displacement source layer to 'Displacement Source'");
        return;
    }

    var disp = layer.Effects.addProperty("ADBE Displacement Map");
    disp.property("Displacement Map Layer").setValue(sourceLayer.index);
    
    // CRITICAL: Set source to "Effects & Masks" (dropdown 3 in Newer AE versions)
    // In AE 2023+, the property index for Source is 11
    try {
        disp.property(11).setValue(3); // 1: Source, 2: Masks, 3: Effects & Masks
    } catch(e) {
        // Fallback for older versions if needed, though most modern setups need this
        $.writeln("Note: Displacement source dropdown setting skipped or not supported.");
    }

    disp.property("Max Horizontal Displacement").setValue(50);
    disp.property("Max Vertical Displacement").setValue(50);
})();
```

---

## Noise / Grain

### Film Grain

```jsx
(function() {
    var comp = app.project.activeItem;
    var layer = comp.selectedLayers[0];
    if (!layer) return;
    
    var noise = layer.Effects.addProperty("ADBE Noise");
    noise.property("Amount of Noise").setValue(5);
    noise.property("Noise Type").setValue(2);  // Gaussian
})();
```

---

## Quick Reference: Effect Match Names

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
| Noise | `ADBE Noise` |
| Fractal Noise | `ADBE Fractal Noise` |
| Tritone | `ADBE Tritone` |
| CC Vignette | `CC Vignette` |
| CC Radial Blur | `CC Radial Blur` |
