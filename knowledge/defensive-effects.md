# Defensive Effect Handling 

## Critical Rules for Adding Effects

### Rule #1: ALWAYS Use Try-Catch

**Every single effect MUST be wrapped in try-catch!**

Effects can fail for many reasons:
- Plugin not installed
- Wrong match name
- User doesn't have that version of AE
- Effect deprecated or moved

```jsx
// ✅ CORRECT - Always wrap effects
try {
    var blur = layer.Effects.addProperty("ADBE Gaussian Blur 2");
    if (blur) {
        blur.property("Blurriness").setValue(20);
        $.writeln("Blur added successfully");
    } else {
        $.writeln("Blur effect not available");
    }
} catch(e) {
    $.writeln("Failed to add blur: " + e.message);
}
```

```jsx
// ❌ WRONG - Will crash if effect fails
var blur = layer.Effects.addProperty("ADBE Gaussian Blur 2");
blur.property("Blurriness").setValue(20);  // CRASHES!
```

---

## Effects That Commonly Fail

### Curves

**DO NOT USE:**
- `"ADBE Curves"` - Often missing
- `"ADBE CurvesF"` - Non-standard

**USE INSTEAD:**
- `"ADBE CurvesCustom"` - More reliable
- `"ADBE Pro Levels2"` - Levels instead
- `"ADBE Brightness & Contrast 2"` - Simple alternative

### Lumetri Color

**Problem:** Lumetri has complex nested property groups that vary by version.

**DO NOT USE** `"ADBE Lumetri"` for:
- Basic Correction
- Creative
- Curves
- Color Wheels

**USE INSTEAD - Simple, reliable effects:**

```jsx
// ✅ SAFE cinematic grading without Lumetri
try {
    // Tint for color tone (Teal & Orange look)
    var tint = layer.Effects.addProperty("ADBE Tint");
    if (tint) {
        tint.property("Map Black To").setValue([0.15, 0.2, 0.25]); // Teal shadows
        tint.property("Map White To").setValue([1, 0.95, 0.9]); // Warm highlights
        tint.property("Amount to Tint").setValue(35);
    }
    
    // Brightness & Contrast
    var bc = layer.Effects.addProperty("ADBE Brightness & Contrast 2");
    if (bc) {
        bc.property("Contrast").setValue(20);
    }
    
    // Exposure for highlights
    var exp = layer.Effects.addProperty("ADBE Exposure2");
    if (exp) {
        exp.property("Exposure").setValue(0.3);
    }
    
    // Saturation
    var hue = layer.Effects.addProperty("ADBE HUE SATURATION");
    if (hue) {
        hue.property("Colorize").setValue(0);
        hue.property("Master Saturation").setValue(10);
    }
    
    $.writeln("Cinematic color grading applied");
} catch(e) {
    $.writeln("Color grading error: " + e.message);
}
```

---

## Cinematic Effects - Safe Patterns

### Film Grain

```jsx
// ✅ Add grain safely
try {
    var grain = layer.Effects.addProperty("ADBE Add Grain");
    if (grain) {
        grain.property("Intensity").setValue(0.15);
        grain.property("Size").setValue(1.5);
        $.writeln("Film grain added");
    } else {
        // Fallback: use Fractal Noise
        var noise = layer.Effects.addProperty("ADBE Fractal Noise");
        if (noise) {
            noise.property("Contrast").setValue(250);
            noise.property("Brightness").setValue(-50);
            noise.property("Blending Mode").setValue(3); // Overlay
            noise.property("Opacity").setValue(15);
            $.writeln("Added noise as grain fallback");
        }
    }
} catch(e) {
    $.writeln("Grain error: " + e.message);
}
```

### Vignette

```jsx
// ✅ Safe vignette
try {
    var vig = layer.Effects.addProperty("CC Vignette");
    if (vig) {
        vig.property("Amount").setValue(100);
        $.writeln("Vignette added");
    } else {
        $.writeln("CC Vignette not available - manual mask recommended");
    }
} catch(e) {
    $.writeln("Vignette error: " + e.message);
}
```

### Glow (Cinematic)

```jsx
// ✅ Soft cinematic glow
try {
    var glow = layer.Effects.addProperty("ADBE Glo2");
    if (glow) {
        glow.property("Glow Threshold").setValue(75);
        glow.property("Glow Radius").setValue(30);
        glow.property("Glow Intensity").setValue(0.8);
        $.writeln("Soft glow added");
    }
} catch(e) {
    $.writeln("Glow error: " + e.message);
}
```

---

## Multiple Effects Pattern

**When adding several effects, isolate failures:**

```jsx
var effectsAdded = [];
var effectsFailed = [];

// Effect 1
try {
    var e1 = layer.Effects.addProperty("ADBE Tint");
    if (e1) {
        e1.property("Amount to Tint").setValue(30);
        effectsAdded.push("Tint");
    }
} catch(err) {
    effectsFailed.push("Tint: " + err.message);
}

// Effect 2
try {
    var e2 = layer.Effects.addProperty("ADBE Gaussian Blur 2");
    if (e2) {
        e2.property("Blurriness").setValue(5);
        effectsAdded.push("Blur");
    }
} catch(err) {
    effectsFailed.push("Blur: " + err.message);
}

// Effect 3
try {
    var e3 = layer.Effects.addProperty("CC Vignette");
    if (e3) {
        e3.property("Amount").setValue(100);
        effectsAdded.push("Vignette");
    }
} catch(err) {
    effectsFailed.push("Vignette: " + err.message);
}

// Report results
$.writeln("✅ Added: " + (effectsAdded.length ? effectsAdded.join(", ") : "none"));
if (effectsFailed.length > 0) {
    $.writeln("❌ Failed: " + effectsFailed.join(", "));
}
```

---

## Property Path Checking

**Never assume nested properties exist:**

```jsx
// ❌ WRONG - Will crash
var lumetri = layer.Effects.addProperty("ADBE Lumetri");
var basic = lumetri.property("Basic Correction");
basic.property("Exposure").setValue(0.5);  // CRASH!

// ✅ CORRECT - Check each level
try {
    var lumetri = layer.Effects.addProperty("ADBE Lumetri");
    if (!lumetri) {
        $.writeln("Lumetri not available");
        return;
    }
    
    var basic = lumetri.property("Basic Correction");
    if (!basic) {
        $.writeln("'Basic Correction' group not found");
        return;
    }
    
    var exposure = basic.property("Exposure");
    if (exposure) {
        exposure.setValue(0.5);
        $.writeln("Exposure set");
    } else {
        $.writeln("Exposure property not found");
    }
} catch(e) {
    $.writeln("Lumetri error: " + e.message);
}
```

---

## The Defensive Mindset

**Every effect operation should answer:**
1. What if this effect doesn't exist?
2. What if the property name is wrong?
3. What if the property is nested deeper?
4. What should happen if it fails?

**Always provide graceful fallbacks:**

```jsx
// Try preferred effect first
var success = false;
try {
    var sharp = layer.Effects.addProperty("ADBE Unsharp Mask2");
    if (sharp) {
        sharp.property("Amount").setValue(80);
        success = true;
        $.writeln("Applied Unsharp Mask");
    }
} catch(e) {}

// Fallback to basic sharpen
if (!success) {
    try {
        var sharp2 = layer.Effects.addProperty("ADBE Sharpen");
        if (sharp2) {
            sharp2.property("Sharpen Amount").setValue(40);
            $.writeln("Applied basic Sharpen (fallback)");
        }
    } catch(e) {
        $.writeln("No sharpen effects available");
    }
}
```

---

## Summary: The Safe Effect Recipe

```jsx
// The pattern to use EVERY TIME you add an effect:
try {
    var effect = layer.Effects.addProperty("Effect Match Name");
    if (effect) {
        // Only access properties if effect was added
        var prop = effect.property("Property Name");
        if (prop) {
            prop.setValue(value);
            $.writeln("Effect applied successfully");
        } else {
            $.writeln("Property not found: Property Name");
        }
    } else {
        $.writeln("Effect not available: Effect Match Name");
    }
} catch(e) {
    $.writeln("Error adding effect: " + e.message);
}
```

**Remember:** One defensive check saves hours of debugging cascading errors!
