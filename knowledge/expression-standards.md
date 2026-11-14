# AE Agent Expression Standards

## Purpose
This document defines the standard pattern for generating After Effects expressions.
All expressions should follow this format to appear professional, original, and tailored to each project.

---

## THE STANDARD EXPRESSION PATTERN

Every expression should follow this structure:

```javascript
/**
 * [EXPRESSION_NAME] - [Brief description]
 * Usage: [Which property this applies to]
 */

// ═══════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════

const CONFIG = {
    // Primary settings (user-adjustable)
    [paramName]: [defaultValue],    // [description]
    [paramName]: [defaultValue],    // [description]
};

// ═══════════════════════════════════════════
// CORE LOGIC
// ═══════════════════════════════════════════

[expression logic here]

// Result
[final value or expression result]
```

---

## FORMATTING RULES

### 1. Header Block (Required)
Always start with a JSDoc-style comment:
```javascript
/**
 * Inertial Bounce - Adds elastic overshoot after keyframes
 * Usage: Position, Scale, Rotation
 */
```

### 2. Configuration Section (For Complex Expressions)
Group user-adjustable values in a CONFIG object:
```javascript
const CONFIG = {
    amplitude: 0.05,       // How much overshoot (0.01-0.1)
    frequency: 4.0,        // Oscillations per second
    decay: 8.0,            // How quickly it settles
};
```

### 3. Meaningful Variable Names
Use clear, descriptive names:
```javascript
// ✓ GOOD
const bounceDecay = 8.0;
const oscillationFreq = 4.0;
const nearestKeyIndex = nearestKey(time).index;

// ✗ BAD (looks copied)
const e = 8.0;
const f = 4.0;
const n = nearestKey(time).index;
```

### 4. Inline Comments for Logic
Explain non-obvious logic:
```javascript
// Find the most recent keyframe (not future ones)
if (key(keyIndex).time > time) keyIndex--;

// Calculate time elapsed since last keyframe
const elapsed = time - key(keyIndex).time;
```

### 5. Section Dividers for Readability
Use visual separators:
```javascript
// ═══════════════════════════════════════════
// SECTION NAME
// ═══════════════════════════════════════════
```
Or lighter version:
```javascript
// --- Section Name ---
```

---

## EXPRESSION TEMPLATES

### Simple One-Liner (< 80 chars)
For wiggle, loops, time-based:
```javascript
// Gentle organic drift | AE Agent
wiggle(2, 15)
```

### Medium Expression (2-10 lines)
```javascript
/**
 * Auto-Fade at Edges
 * Usage: Opacity
 */
const fadeDuration = 0.5;  // seconds

// Fade in at start, fade out at end
if (time < inPoint + fadeDuration) {
    linear(time, inPoint, inPoint + fadeDuration, 0, 100);
} else if (time > outPoint - fadeDuration) {
    linear(time, outPoint - fadeDuration, outPoint, 100, 0);
} else {
    100;
}
```

### Complex Expression (10+ lines)
```javascript
/**
 * Elastic Overshoot - Smooth bounce after keyframes
 * Usage: Position, Scale, Rotation, any animatable property
 */

// ═══════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════

const CONFIG = {
    amplitude: 0.05,       // Bounce strength (0.01 = subtle, 0.1 = extreme)
    frequency: 4.0,        // Oscillations per second
    decay: 8.0,            // Settle speed (higher = faster)
};

// ═══════════════════════════════════════════
// KEYFRAME DETECTION
// ═══════════════════════════════════════════

let keyIndex = 0;

if (numKeys > 0) {
    keyIndex = nearestKey(time).index;
    // Ensure we're looking at a past keyframe, not a future one
    if (key(keyIndex).time > time) keyIndex--;
}

// ═══════════════════════════════════════════
// BOUNCE CALCULATION
// ═══════════════════════════════════════════

if (keyIndex > 0) {
    // Time since the last keyframe
    const elapsed = time - key(keyIndex).time;
    
    // Velocity at the moment the keyframe was reached
    const impactVelocity = velocityAtTime(
        key(keyIndex).time - thisComp.frameDuration / 10
    );
    
    // Damped sinusoidal oscillation
    const oscillation = Math.sin(CONFIG.frequency * elapsed * 2 * Math.PI);
    const dampening = Math.exp(-CONFIG.decay * elapsed);
    
    value + impactVelocity * CONFIG.amplitude * oscillation * dampening;
} else {
    value;
}
```

---

## SLIDER CONTROL INTEGRATION

When the user wants adjustable controls, create effects with clear names:

```javascript
/**
 * Controlled Wiggle - Adjustable via sliders
 * Usage: Position
 * Requires: Add Slider Controls named "Wiggle Speed" and "Wiggle Amount"
 */

const speed = effect("Wiggle Speed")("Slider");
const amount = effect("Wiggle Amount")("Slider");

wiggle(speed, amount)
```

The agent should also generate the ExtendScript to add these controls:
```javascript
// Add control sliders to the layer
var fx1 = layer.property("ADBE Effect Parade").addProperty("ADBE Slider Control");
fx1.name = "Wiggle Speed";
fx1.property("Slider").setValue(3);

var fx2 = layer.property("ADBE Effect Parade").addProperty("ADBE Slider Control");
fx2.name = "Wiggle Amount";
fx2.property("Slider").setValue(25);
```

---

## AVOIDED PATTERNS (Don't Look Copied)

### ✗ AVOID: Single-letter variables without context
```javascript
// This looks lifted from a tutorial
n = 0;
if (numKeys > 0){
    n = nearestKey(time).index;
    if (key(n).time > time) n--;
}
```

### ✓ PREFER: Meaningful names with comments
```javascript
// Track the most recent keyframe
let keyIndex = 0;
if (numKeys > 0) {
    keyIndex = nearestKey(time).index;
    if (key(keyIndex).time > time) keyIndex--;
}
```

### ✗ AVOID: Magic numbers without explanation
```javascript
value + v * 0.05 * Math.sin(4 * t * 2 * Math.PI) / Math.exp(8 * t);
```

### ✓ PREFER: Named constants or CONFIG
```javascript
const amplitude = 0.05;   // bounce strength
const frequency = 4.0;    // oscillations/sec
const decay = 8.0;        // settle speed

const oscillation = amplitude * Math.sin(frequency * elapsed * 2 * Math.PI);
value + velocity * oscillation / Math.exp(decay * elapsed);
```

---

## COMPACT MODE (When Brevity Needed)

For expressions embedded in scripts where space matters, use a controlled compact style:

```javascript
// Elastic Bounce | AE Agent
var amp=.05,frq=4,dec=8,k=0;if(numKeys>0){k=nearestKey(time).index;if(key(k).time>time)k--}k>0?value+velocityAtTime(key(k).time-thisComp.frameDuration/10)*amp*Math.sin(frq*(time-key(k).time)*2*Math.PI)/Math.exp(dec*(time-key(k).time)):value
```

Note: Still include a brief header comment even in compact mode.

---

## EXPRESSION NAMING CONVENTIONS

Use consistent names that reflect the purpose:

| Category | Naming Style | Examples |
|----------|-------------|----------|
| Bounce/Physics | "Elastic [Effect]", "Inertial [Effect]" | Elastic Overshoot, Inertial Bounce |
| Time-based | "[Effect] Over Time", "Dynamic [Effect]" | Fade Over Time, Dynamic Rotation |
| Procedural | "Auto-[Effect]", "Procedural [Effect]" | Auto-Scale, Procedural Wiggle |
| Linked | "[Source] Linked [Target]" | Null Linked Position |
| Reactive | "[Trigger] Reactive [Effect]" | Audio Reactive Scale |

---

## ATTRIBUTION

When adapting well-known expressions, acknowledge the technique while making it original:

```javascript
/**
 * Elastic Overshoot - Damped oscillation after keyframes
 * Technique: Inertial bounce principle
 * Customized: AE Agent configuration for this project
 */
```

---

## SUMMARY CHECKLIST

Before outputting any expression:

1. ☐ Header comment with name and usage
2. ☐ CONFIG object for adjustable values (if 2+ settings)
3. ☐ Meaningful variable names (no single letters)
4. ☐ Inline comments for non-obvious logic
5. ☐ Visual section dividers for long expressions
6. ☐ No magic numbers (use named constants)
7. ☐ Consistent formatting and indentation
