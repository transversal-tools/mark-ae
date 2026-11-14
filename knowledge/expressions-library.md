# After Effects Expressions Library

Professional expression templates ready for use.
All expressions follow AE Agent formatting standards.

---

## POSITION & TRANSFORM

### 2D to 3D Null Link
```javascript
/**
 * 2D to 3D Null Link - Attach 2D position to 3D layer
 * Usage: Position (2D layer tracking 3D)
 */
thisComp.layer("3D Layer Name").toComp([0, 0, 0])
```

### Shape Layer Position Control
```javascript
/**
 * Shape Position Control - Link shape position to external Null
 * Usage: Shape Layer > Path Position
 */
const controlLayer = thisComp.layer("Control NULL");
const worldPos = controlLayer.toComp(controlLayer.transform.anchorPoint);
fromComp(worldPos)
```

### Auto-Center Anchor Point
```javascript
/**
 * Auto-Center Anchor - Dynamically center anchor on text/shape
 * Usage: Anchor Point
 */
const bounds = sourceRectAtTime(time, true);
const centerX = bounds.left + bounds.width / 2;
const centerY = bounds.top + bounds.height / 2;
[centerX, centerY]
```

### Vertical Center Anchor
```javascript
/**
 * Vertical Center Anchor - Center anchor vertically only
 * Usage: Anchor Point
 */
const bounds = sourceRectAtTime(time);
const centerY = value[1] - bounds.height / 2;
[0, centerY]
```

### Composition Center
```javascript
/**
 * Comp Center - Get exact center of composition
 * Usage: Position
 */
[thisComp.width * 0.5, thisComp.height * 0.5]
```

### Orbital Motion
```javascript
/**
 * Orbital Motion - Rotate around a center point
 * Usage: Position
 */
const CONFIG = {
    radius: 200,           // Distance from center (pixels)
    speed: 1,              // Revolutions per second
    centerLayer: "Center"  // Name of center layer
};

const center = thisComp.layer(CONFIG.centerLayer).transform.position;
const angle = degreesToRadians(time * CONFIG.speed * 360);

const orbitX = center[0] + Math.cos(angle) * CONFIG.radius;
const orbitY = center[1] + Math.sin(angle) * CONFIG.radius;

[orbitX, orbitY]
```

### Follow with Delay
```javascript
/**
 * Follow with Delay - Track another layer with time offset
 * Usage: Position
 */
const CONFIG = {
    targetLayer: "Leader",  // Layer to follow
    delay: 0.2              // Seconds behind
};

const target = thisComp.layer(CONFIG.targetLayer);
target.transform.position.valueAtTime(time - CONFIG.delay)
```

---

## PARENT/CHILD RELATIONSHIPS

### Ignore Parent Rotation
```javascript
/**
 * Ignore Parent Rotation - Maintain world rotation despite parent
 * Usage: Rotation
 */
value - parent.transform.rotation
```

### Ignore Parent Scale
```javascript
/**
 * Ignore Parent Scale - Maintain size despite parent scaling
 * Usage: Scale
 */
const parentScale = parent.transform.scale.value;
const compensatedScale = [];

for (let i = 0; i < parentScale.length; i++) {
    compensatedScale[i] = (parentScale[i] === 0) ? 0 : value[i] * 100 / parentScale[i];
}

compensatedScale
```

### Ignore Nested Parent Scale
```javascript
/**
 * Ignore Nested Parent Scale - Compensate for all parent layers
 * Usage: Scale
 */
let currentLayer = thisLayer;
let compensatedScale = transform.scale.value;

while (currentLayer.hasParent) {
    currentLayer = currentLayer.parent;
    const parentScale = currentLayer.transform.scale.value;
    
    for (let i = 0; i < compensatedScale.length; i++) {
        compensatedScale[i] *= 100 / parentScale[i];
    }
}

compensatedScale
```

### Inherit Parent Opacity
```javascript
/**
 * Inherit Parent Opacity - Multiply opacity with parent
 * Usage: Opacity
 */
hasParent ? (parent.opacity / 100) * value : value
```

### Inherit Nested Opacity
```javascript
/**
 * Inherit Nested Opacity - Multiply opacity through all parents
 * Usage: Opacity
 */
let combinedOpacity = value;
let currentLayer = thisLayer;

while (currentLayer.hasParent) {
    currentLayer = currentLayer.parent;
    combinedOpacity *= currentLayer.opacity / 100;
}

combinedOpacity
```

---

## BOUNCE & INERTIA

### Elastic Overshoot
```javascript
/**
 * Elastic Overshoot - Smooth bounce after keyframes
 * Usage: Position, Scale, Rotation, any animatable property
 */
const CONFIG = {
    amplitude: 0.05,   // Bounce strength (0.01 = subtle, 0.1 = extreme)
    frequency: 4.0,    // Oscillations per second
    decay: 8.0         // Settle speed (higher = faster)
};

// ═══════════════════════════════════════════
// KEYFRAME DETECTION
// ═══════════════════════════════════════════

let keyIndex = 0;

if (numKeys > 0) {
    keyIndex = nearestKey(time).index;
    // Ensure we're looking at a past keyframe
    if (key(keyIndex).time > time) keyIndex--;
}

// ═══════════════════════════════════════════
// BOUNCE CALCULATION
// ═══════════════════════════════════════════

if (keyIndex > 0) {
    const elapsed = time - key(keyIndex).time;
    const impactVelocity = velocityAtTime(key(keyIndex).time - thisComp.frameDuration / 10);
    
    const oscillation = Math.sin(CONFIG.frequency * elapsed * 2 * Math.PI);
    const dampening = Math.exp(-CONFIG.decay * elapsed);
    
    value + impactVelocity * CONFIG.amplitude * oscillation * dampening;
} else {
    value;
}
```

### Elastic Overshoot (Slider Controlled)
```javascript
/**
 * Elastic Overshoot - Slider controlled version
 * Usage: Position, Scale, Rotation
 * Requires: Slider Controls "Amplitude", "Frequency", "Decay"
 */
const amplitude = effect("Amplitude")("Slider") / 1000;
const frequency = effect("Frequency")("Slider");
const decay = effect("Decay")("Slider");

let keyIndex = 0;

if (numKeys > 0) {
    keyIndex = nearestKey(time).index;
    if (key(keyIndex).time > time) keyIndex--;
}

if (keyIndex > 0) {
    const elapsed = time - key(keyIndex).time;
    const impactVelocity = velocityAtTime(key(keyIndex).time - thisComp.frameDuration / 10);
    
    value + impactVelocity * amplitude * Math.sin(frequency * elapsed * 2 * Math.PI) / Math.exp(decay * elapsed);
} else {
    value;
}
```

### Gravity Bounce
```javascript
/**
 * Gravity Bounce - Realistic ball drop with physics
 * Usage: Position (Y axis)
 */
const CONFIG = {
    elasticity: 0.7,     // Energy retention per bounce (0-1)
    gravity: 5000,       // Pixels per second squared
    maxBounces: 9        // Maximum bounces to calculate
};

let keyIndex = 0;

if (numKeys > 0) {
    keyIndex = nearestKey(time).index;
    if (key(keyIndex).time > time) keyIndex--;
}

if (keyIndex > 0) {
    let elapsed = time - key(keyIndex).time;
    let velocity = -velocityAtTime(key(keyIndex).time - thisComp.frameDuration / 10)[1];
    
    for (let bounce = 0; bounce < CONFIG.maxBounces; bounce++) {
        if (elapsed <= 0) break;
        
        const bounceDuration = 2 * velocity / CONFIG.gravity;
        
        if (elapsed < bounceDuration) {
            [value[0], value[1] + velocity * elapsed - CONFIG.gravity * elapsed * elapsed / 2];
            break;
        }
        
        elapsed -= bounceDuration;
        velocity *= CONFIG.elasticity;
    }
} else {
    value;
}
```

---

## OPACITY & VISIBILITY

### Auto Fade Edges
```javascript
/**
 * Auto Fade Edges - Fade in at start, fade out at end
 * Usage: Opacity
 */
const fadeDuration = 0.5;  // Seconds for each fade

if (time < inPoint + fadeDuration) {
    // Fading in
    linear(time, inPoint, inPoint + fadeDuration, 0, 100);
} else if (time > outPoint - fadeDuration) {
    // Fading out
    linear(time, outPoint - fadeDuration, outPoint, 100, 0);
} else {
    100;
}
```

### Auto Fade (Adjustable)
```javascript
/**
 * Auto Fade - Slider controlled fades
 * Usage: Opacity
 * Requires: Slider Controls "Fade In" and "Fade Out"
 */
const fadeIn = effect("Fade In")("Slider");
const fadeOut = effect("Fade Out")("Slider");

if (time < inPoint + fadeIn) {
    linear(time, inPoint, inPoint + fadeIn, 0, value);
} else if (time > outPoint - fadeOut) {
    linear(time, outPoint - fadeOut, outPoint, value, 0);
} else {
    value;
}
```

### Flicker Effect
```javascript
/**
 * Flicker Effect - Random opacity flicker
 * Usage: Opacity
 */
const CONFIG = {
    minOpacity: 50,    // Minimum opacity
    maxOpacity: 100,   // Maximum opacity
    holdFrames: 2      // Frames between changes
};

posterizeTime(thisComp.frameRate / CONFIG.holdFrames);
random(CONFIG.minOpacity, CONFIG.maxOpacity)
```

---

## DELAY & STAGGER

### Index-Based Stagger
```javascript
/**
 * Index Stagger - Delay animation by layer index
 * Usage: Any property with keyframes
 */
const delayPerLayer = 0.1;  // Seconds between each layer
const offset = (index - 1) * delayPerLayer;

valueAtTime(time - offset)
```

### Stagger with Control
```javascript
/**
 * Controlled Stagger - Adjustable delay via slider
 * Usage: Any property with keyframes
 * Requires: Slider Control "Stagger Delay" on master layer
 */
const masterLayer = thisComp.layer("Master Control");
const delayPerLayer = masterLayer.effect("Stagger Delay")("Slider") / 1000;
const offset = (index - 1) * delayPerLayer;

valueAtTime(time - offset)
```

### Sequential Animation
```javascript
/**
 * Sequential Animation - Each layer waits for previous
 * Usage: Any property with keyframes
 */
const layerDuration = 0.5;  // Animation duration per layer
const startTime = (index - 1) * layerDuration;

if (time < startTime) {
    key(1).value;
} else if (time > startTime + layerDuration) {
    key(numKeys).value;
} else {
    valueAtTime(key(1).time + (time - startTime));
}
```

---

## LOOPING

### Loop Out Cycle
```javascript
/**
 * Loop Cycle - Repeat keyframes infinitely
 * Usage: Any property with keyframes
 */
loopOut("cycle")
```

### Loop Ping Pong
```javascript
/**
 * Loop Ping Pong - Forward then reverse repeat
 * Usage: Any property with keyframes
 */
loopOut("pingpong")
```

### Loop Both Directions
```javascript
/**
 * Loop Both - Extend loop in both directions
 * Usage: Any property with keyframes
 */
loopIn() + loopOut() - value
```

### Loop with Offset
```javascript
/**
 * Loop with Offset - Loop while continuing to progress
 * Usage: Position, Rotation
 */
loopOut("offset")
```

---

## WIGGLE VARIATIONS

### Standard Wiggle
```javascript
/**
 * Standard Wiggle - Organic random movement
 * Usage: Position, Scale, Rotation
 */
// wiggle(frequency, amplitude)
wiggle(3, 25)  // 3 times/sec, 25 pixels
```

### Wiggle X Only
```javascript
/**
 * Wiggle X Only - Horizontal wiggle only
 * Usage: Position
 */
const wiggleResult = wiggle(3, 50);
[wiggleResult[0], value[1]]
```

### Wiggle Y Only
```javascript
/**
 * Wiggle Y Only - Vertical wiggle only
 * Usage: Position
 */
const wiggleResult = wiggle(3, 50);
[value[0], wiggleResult[1]]
```

### Smooth Wiggle
```javascript
/**
 * Smooth Wiggle - Low frequency organic motion
 * Usage: Position, Scale
 */
const CONFIG = {
    frequency: 0.5,    // Very slow oscillation
    amplitude: 30,     // Movement range
    octaves: 2         // Smoothness (1-4)
};

wiggle(CONFIG.frequency, CONFIG.amplitude, CONFIG.octaves)
```

### Controlled Wiggle
```javascript
/**
 * Controlled Wiggle - Slider adjustable
 * Usage: Position, Scale
 * Requires: Slider Controls "Wiggle Speed" and "Wiggle Amount"
 */
const speed = effect("Wiggle Speed")("Slider");
const amount = effect("Wiggle Amount")("Slider");

wiggle(speed, amount)
```

### Posterized Wiggle
```javascript
/**
 * Posterized Wiggle - Step-based random (stop motion feel)
 * Usage: Position, Rotation
 */
const CONFIG = {
    fps: 12,           // Frame rate for steps
    frequency: 3,      // Wiggle speed
    amplitude: 25      // Wiggle amount
};

posterizeTime(CONFIG.fps);
wiggle(CONFIG.frequency, CONFIG.amplitude)
```

---

## TIME-BASED

### Continuous Rotation
```javascript
/**
 * Continuous Rotation - Constant spin
 * Usage: Rotation
 */
const degreesPerSecond = 90;  // Speed of rotation
time * degreesPerSecond
```

### Sine Wave Motion
```javascript
/**
 * Sine Wave Motion - Smooth back and forth
 * Usage: Position, Scale, any value
 */
const CONFIG = {
    frequency: 2,       // Cycles per second
    amplitude: 50,      // Movement range
    offset: 0           // Phase offset (degrees)
};

const phase = degreesToRadians(CONFIG.offset);
const wave = Math.sin(time * CONFIG.frequency * 2 * Math.PI + phase);

value + wave * CONFIG.amplitude
```

### Pulsing Scale
```javascript
/**
 * Pulsing Scale - Rhythmic size change
 * Usage: Scale
 */
const CONFIG = {
    frequency: 2,      // Pulses per second
    amplitude: 10      // Size variation (percentage)
};

const pulse = Math.sin(time * CONFIG.frequency * 2 * Math.PI) * CONFIG.amplitude;
[100 + pulse, 100 + pulse]
```

### Frame-by-Frame Hold
```javascript
/**
 * Frame Hold - Reduce animation to specific FPS
 * Usage: Any property
 */
const targetFPS = 12;  // Desired frame rate look
posterizeTime(targetFPS);
value
```

---

## AUDIO REACTIVE

### Audio Amplitude Scale
```javascript
/**
 * Audio Reactive Scale - Size responds to audio
 * Usage: Scale
 * Requires: Audio layer with "Both Channels" keyframed
 */
const CONFIG = {
    audioLayer: "Audio",     // Name of audio layer
    minScale: 100,           // Base scale
    sensitivity: 50          // How much it responds
};

const audio = thisComp.layer(CONFIG.audioLayer);
const audioLevel = audio.effect("Both Channels")("Slider");

const reactiveScale = CONFIG.minScale + (audioLevel * CONFIG.sensitivity / 100);
[reactiveScale, reactiveScale]
```

---

## PROXIMITY & DISTANCE

### Distance Between Layers
```javascript
/**
 * Distance Measurement - Get distance to another layer
 * Usage: Slider, or use in other expressions
 */
const targetLayer = thisComp.layer("Target");
length(transform.position, targetLayer.transform.position)
```

### Aim at Layer
```javascript
/**
 * Aim at Target - Point rotation toward layer
 * Usage: Rotation
 */
const target = thisComp.layer("Target");
const delta = target.transform.position - transform.position;

radiansToDegrees(Math.atan2(delta[1], delta[0]))
```

### Proximity Opacity
```javascript
/**
 * Proximity Fade - Opacity based on distance to target
 * Usage: Opacity
 */
const CONFIG = {
    targetLayer: "Cursor",   // Layer to measure from
    fadeStart: 300,          // Distance where fade starts
    fadeEnd: 50              // Distance where fully visible
};

const target = thisComp.layer(CONFIG.targetLayer);
const distance = length(transform.position, target.transform.position);

linear(distance, CONFIG.fadeEnd, CONFIG.fadeStart, 100, 0)
```

---

## TEXT EXPRESSIONS

### Dynamic Text Box
```javascript
/**
 * Dynamic Text Box - Size adapts to text content
 * Usage: Rectangle Path Size (shape layer behind text)
 */
const CONFIG = {
    textLayer: "Text Layer",
    paddingH: 40,            // Horizontal padding
    paddingV: 20             // Vertical padding
};

const textBounds = thisComp.layer(CONFIG.textLayer).sourceRectAtTime(time, true);

[textBounds.width + CONFIG.paddingH, textBounds.height + CONFIG.paddingV]
```

### Text Layer Center Position
```javascript
/**
 * Text Center Position - Center box behind text
 * Usage: Position (shape layer)
 */
const textLayer = thisComp.layer("Text Layer");
const bounds = textLayer.sourceRectAtTime(time, true);

const centerX = bounds.left + bounds.width / 2;
const centerY = bounds.top + bounds.height / 2;

textLayer.toComp([centerX, centerY])
```

### Typewriter Counter
```javascript
/**
 * Typewriter Counter - Reveal text character by character
 * Usage: Source Text > Expression Selector > Amount
 */
const CONFIG = {
    revealDuration: 2,    // Total seconds to reveal all
    startDelay: 0.5       // Seconds before starting
};

const elapsed = Math.max(0, time - inPoint - CONFIG.startDelay);
const progress = elapsed / CONFIG.revealDuration;

Math.min(progress * 100, 100)
```

---

## COLOR EXPRESSIONS

### Random Color per Layer
```javascript
/**
 * Random Color - Unique color based on layer index
 * Usage: Fill Color, Stroke Color
 */
seedRandom(index, true);

const hue = random(360);
const saturation = random(0.6, 1);
const brightness = random(0.7, 1);

hslToRgb([hue / 360, saturation, brightness])
```

### Color Cycle
```javascript
/**
 * Color Cycle - Animated color shift over time
 * Usage: Fill Color
 */
const cycleSpeed = 0.1;  // Color cycles per second

const hue = (time * cycleSpeed) % 1;
hslToRgb([hue, 0.8, 0.6])
```

---

## STROKE EXPRESSIONS

### Constant Stroke Width
```javascript
/**
 * Constant Stroke - Maintain stroke width regardless of scale
 * Usage: Stroke Width
 */
const desiredWidth = 5;  // Pixels

// Compensate for layer scale
const scaleCompensation = length(toComp([0, 0]), toComp([0.7071, 0.7071]));
desiredWidth / scaleCompensation || 0.001
```

---

## RANDOM EXPRESSIONS

### Seeded Random (Reproducible)
```javascript
/**
 * Seeded Random - Same random value every time
 * Usage: Any property
 */
seedRandom(index, true);  // true = static, false = animated
random(100)
```

### Random with Hold
```javascript
/**
 * Random Hold - Random value that changes at intervals
 * Usage: Any property
 */
const holdDuration = 0.5;  // Seconds between changes

seedRandom(Math.floor(time / holdDuration), true);
random(100)
```

### Gaussian Random
```javascript
/**
 * Gaussian Random - Bell curve distribution
 * Usage: Any property needing natural variation
 */
gaussRandom(50, 100)  // (min, max) with center bias
```

---

## INTERPOLATION & MATH

### Linear Remap
```javascript
/**
 * Linear Remap - Map one range to another
 * Usage: Any property
 */
// linear(inputValue, inputMin, inputMax, outputMin, outputMax)
linear(time, 0, 5, 0, 100)  // 0-5 seconds → 0-100
```

### Ease Remap
```javascript
/**
 * Ease Remap - Smooth interpolation with easing
 * Usage: Any property
 */
// ease(inputValue, inputMin, inputMax, outputMin, outputMax)
ease(time, 0, 5, 0, 100)  // Smooth acceleration/deceleration
```

### Clamp Value
```javascript
/**
 * Value Clamp - Limit value to range
 * Usage: Any property
 */
clamp(value, 0, 100)  // Keep between 0 and 100
```

### Normalize to 0-1
```javascript
/**
 * Normalize - Convert any range to 0-1
 * Usage: Any property
 */
const inputMin = 0;
const inputMax = 100;

(value - inputMin) / (inputMax - inputMin)
```

---

## MARKERS

### Marker-Triggered Animation
```javascript
/**
 * Marker Trigger - Animate when marker is reached
 * Usage: Scale, Opacity, etc.
 */
let keyIndex = 0;

if (marker.numKeys > 0) {
    keyIndex = marker.nearestKey(time).index;
    if (marker.key(keyIndex).time > time) keyIndex--;
}

if (keyIndex > 0) {
    // Time since marker
    const elapsed = time - marker.key(keyIndex).time;
    // Do animation based on elapsed time
    linear(elapsed, 0, 0.5, 0, 100);
} else {
    0;
}
```

---

## QUICK REFERENCE

| Effect | Expression |
|--------|------------|
| Wiggle | `wiggle(3, 25)` |
| Loop | `loopOut("cycle")` |
| Spin | `time * 90` |
| Follow | `thisComp.layer("X").position` |
| Stagger | `valueAtTime(time - index * 0.1)` |
| Auto-fade | `linear(time, inPoint, inPoint + 0.5, 0, value)` |
| Random | `seedRandom(index, true); random(100)` |
| Distance | `length(position, thisComp.layer("X").position)` |

---

## TIME REMAP & SPEED

### Hold Frame at Time
```javascript
/**
 * Hold Frame - Freeze at specific time
 * Usage: Time Remap
 */
const holdTime = 2;  // Freeze at 2 seconds
Math.min(time, holdTime)
```

### Slow Motion Ramp
```javascript
/**
 * Slow Motion Ramp - Gradual speed change
 * Usage: Time Remap
 */
const CONFIG = {
    slowStart: 2,        // When to start slowing
    slowEnd: 4,          // When to resume normal
    slowFactor: 0.25     // Speed during slow (0.25 = 25% speed)
};

if (time < CONFIG.slowStart) {
    time;
} else if (time < CONFIG.slowEnd) {
    CONFIG.slowStart + (time - CONFIG.slowStart) * CONFIG.slowFactor;
} else {
    CONFIG.slowStart + (CONFIG.slowEnd - CONFIG.slowStart) * CONFIG.slowFactor + (time - CONFIG.slowEnd);
}
```

### Reverse Playback
```javascript
/**
 * Reverse - Play footage backwards
 * Usage: Time Remap
 */
const duration = thisLayer.source.duration;
duration - time
```

### Ping Pong Time
```javascript
/**
 * Ping Pong - Forward then backward loop
 * Usage: Time Remap
 */
const duration = thisLayer.source.duration;
const cycle = time % (duration * 2);

if (cycle < duration) {
    cycle;
} else {
    duration * 2 - cycle;
}
```

### Speed Ramping with Keyframes
```javascript
/**
 * Speed Ramp - Smooth speed transitions
 * Usage: Time Remap (add keyframes to control)
 */
// This works with keyframed time remap
// Add keyframes, then apply this to smooth them:
if (numKeys < 2) {
    time;
} else {
    let keyIndex = nearestKey(time).index;
    if (key(keyIndex).time > time && keyIndex > 1) keyIndex--;
    
    if (keyIndex < numKeys) {
        const t1 = key(keyIndex).time;
        const t2 = key(keyIndex + 1).time;
        const v1 = key(keyIndex).value;
        const v2 = key(keyIndex + 1).value;
        ease(time, t1, t2, v1, v2);
    } else {
        value;
    }
}
```

---

## RESPONSIVE DESIGN

### Scale to Fit Width
```javascript
/**
 * Scale to Width - Resize layer to match comp width
 * Usage: Scale
 */
const targetWidth = thisComp.width;
const currentWidth = width;
const scaleFactor = (targetWidth / currentWidth) * 100;
[scaleFactor, scaleFactor]
```

### Scale to Fit Height
```javascript
/**
 * Scale to Height - Resize layer to match comp height
 * Usage: Scale
 */
const targetHeight = thisComp.height;
const currentHeight = height;
const scaleFactor = (targetHeight / currentHeight) * 100;
[scaleFactor, scaleFactor]
```

### Scale to Cover (Maintain Aspect)
```javascript
/**
 * Scale to Cover - Fill comp while maintaining aspect ratio
 * Usage: Scale
 */
const scaleW = thisComp.width / width;
const scaleH = thisComp.height / height;
const scaleFactor = Math.max(scaleW, scaleH) * 100;
[scaleFactor, scaleFactor]
```

### Scale to Contain (Fit Inside)
```javascript
/**
 * Scale to Contain - Fit inside comp maintaining aspect
 * Usage: Scale
 */
const scaleW = thisComp.width / width;
const scaleH = thisComp.height / height;
const scaleFactor = Math.min(scaleW, scaleH) * 100;
[scaleFactor, scaleFactor]
```

### Responsive Position (Percentage)
```javascript
/**
 * Responsive Position - Position as percentage of comp
 * Usage: Position
 */
const CONFIG = {
    xPercent: 50,  // 50% = center
    yPercent: 50   // 50% = center
};

const x = thisComp.width * (CONFIG.xPercent / 100);
const y = thisComp.height * (CONFIG.yPercent / 100);
[x, y]
```

### Safe Zone Position
```javascript
/**
 * Safe Zone - Keep layer within title safe area
 * Usage: Position
 */
const safeMargin = 0.1;  // 10% margin

const minX = thisComp.width * safeMargin;
const maxX = thisComp.width * (1 - safeMargin);
const minY = thisComp.height * safeMargin;
const maxY = thisComp.height * (1 - safeMargin);

[clamp(value[0], minX, maxX), clamp(value[1], minY, maxY)]
```

---

## CAMERA & 3D

### Parallax Scale Compensation (CRITICAL)
```javascript
/**
 * Parallax Scale - Maintain apparent size in Z-space
 * Usage: Scale (3D layers with camera)
 * CAUTION: Use dist/refDist NOT refDist/dist!
 */
const cam = thisComp.activeCamera;
const camPos = cam.toWorld([0, 0, 0]);
const layerPos = toWorld(anchorPoint);
const dist = length(camPos, layerPos);
const refDist = cam.cameraOption.zoom;
const factor = dist / refDist;
value * factor
```

### Billboard (Face Camera)
```javascript
/**
 * Billboard - Always face the camera
 * Usage: Orientation (3D layer)
 */
const cam = thisComp.activeCamera;
lookAt(toWorld(anchorPoint), cam.toWorld([0, 0, 0]))
```

### Z-Depth Opacity
```javascript
/**
 * Z-Depth Opacity - Fade based on distance from camera
 * Usage: Opacity (3D layer)
 */
const CONFIG = {
    nearDist: 500,     // Full opacity distance
    farDist: 2000,     // Zero opacity distance
    nearOpacity: 100,
    farOpacity: 0
};

const cam = thisComp.activeCamera;
const dist = length(toWorld(anchorPoint), cam.toWorld([0, 0, 0]));

linear(dist, CONFIG.nearDist, CONFIG.farDist, CONFIG.nearOpacity, CONFIG.farOpacity)
```

### Camera Shake Expression
```javascript
/**
 * Camera Shake - Organic camera movement
 * Usage: Position (Camera layer)
 */
const CONFIG = {
    frequency: 2,
    amplitude: 15,
    decay: 0          // Set > 0 to fade out shake
};

const shakeX = wiggle(CONFIG.frequency, CONFIG.amplitude)[0] - value[0];
const shakeY = wiggle(CONFIG.frequency, CONFIG.amplitude)[1] - value[1];
const decayFactor = CONFIG.decay > 0 ? Math.exp(-CONFIG.decay * time) : 1;

value + [shakeX * decayFactor, shakeY * decayFactor, 0]
```

---

## PATH ANIMATION

### Orient Along Path
```javascript
/**
 * Auto-Orient - Rotate to face direction of travel
 * Usage: Rotation
 */
const velocity = position.velocityAtTime(time);
radiansToDegrees(Math.atan2(velocity[1], velocity[0]))
```

### Path Progress Percentage
```javascript
/**
 * Path Progress - Get percentage along animation path
 * Usage: Slider or other expressions
 */
// Requires keyframes on position
if (numKeys < 2) {
    0;
} else {
    const startTime = key(1).time;
    const endTime = key(numKeys).time;
    linear(time, startTime, endTime, 0, 100);
}
```

### Smooth Path Corners
```javascript
/**
 * Smooth Corners - Round off path corners
 * Usage: Position (with spatial keyframes)
 */
const smoothing = thisComp.frameDuration * 3;

if (numKeys < 2) {
    value;
} else {
    const t = time;
    const t1 = Math.max(t - smoothing, key(1).time);
    const t2 = Math.min(t + smoothing, key(numKeys).time);
    
    const p1 = position.valueAtTime(t1);
    const p2 = position.valueAtTime(t2);
    (p1 + p2) / 2;
}
```

---

## SHAPE LAYER EXPRESSIONS

### Trim Path Draw On
```javascript
/**
 * Trim Draw On - Animate path drawing
 * Usage: Trim Paths > End
 */
const duration = 1;  // Seconds to draw
linear(time, inPoint, inPoint + duration, 0, 100)
```

### Trim Path with Easing
```javascript
/**
 * Trim Eased - Smooth draw on effect
 * Usage: Trim Paths > End
 */
const duration = 1;
ease(time, inPoint, inPoint + duration, 0, 100)
```

### Repeater Scale Decay
```javascript
/**
 * Repeater Decay - Each copy smaller than last
 * Usage: Repeater > Transform > Scale
 */
const decayPercent = 90;  // Each copy is 90% of previous
[decayPercent, decayPercent]
```

### Repeater Opacity Fade
```javascript
/**
 * Repeater Fade - Each copy more transparent
 * Usage: Repeater > Transform > Opacity
 */
const decayPercent = 80;  // Each copy is 80% opacity of previous
decayPercent
```

### Dynamic Stroke Width
```javascript
/**
 * Dynamic Stroke - Width based on speed
 * Usage: Stroke Width
 */
const CONFIG = {
    baseWidth: 5,
    speedMultiplier: 0.1,
    maxWidth: 20
};

const speed = length(position.velocity);
Math.min(CONFIG.baseWidth + speed * CONFIG.speedMultiplier, CONFIG.maxWidth)
```

---

## SLIDER CONTROL PATTERNS

### Checkbox Toggle
```javascript
/**
 * Checkbox Toggle - On/off control
 * Usage: Any property
 * Requires: Checkbox Control "Enable"
 */
const enabled = effect("Enable")("Checkbox");
enabled ? 100 : 0  // Full opacity when checked, 0 when not
```

### Dropdown Selection
```javascript
/**
 * Dropdown Switch - Multiple options
 * Usage: Any property
 * Requires: Dropdown Control "Mode" with options
 */
const mode = effect("Mode")("Menu").value;

// Returns: 1 for first option, 2 for second, etc.
if (mode === 1) {
    [100, 100];  // Option 1: normal scale
} else if (mode === 2) {
    [150, 150];  // Option 2: big
} else {
    [50, 50];    // Option 3: small
}
```

### Color Control Link
```javascript
/**
 * Color Link - Use color picker value
 * Usage: Fill Color, Stroke Color
 * Requires: Color Control "Main Color"
 */
effect("Main Color")("Color")
```

### Point Control Position
```javascript
/**
 * Point Position - Link to point control
 * Usage: Position, Effect positions
 * Requires: Point Control "Target Position"
 */
effect("Target Position")("Point")
```

### Angle Control Rotation
```javascript
/**
 * Angle Link - Use angle control for rotation
 * Usage: Rotation
 * Requires: Angle Control "Angle"
 */
effect("Angle")("Angle")
```

---

## COUNTDOWN & TIMERS

### Countdown Timer
```javascript
/**
 * Countdown - Display countdown from number
 * Usage: Source Text
 */
const startNumber = 10;
const duration = 10;  // Seconds

const remaining = Math.max(0, startNumber - Math.floor((time - inPoint) / (duration / startNumber)));
remaining.toString()
```

### Stopwatch Timer
```javascript
/**
 * Stopwatch - Count up from zero
 * Usage: Source Text
 */
const elapsed = time - inPoint;
const minutes = Math.floor(elapsed / 60);
const seconds = Math.floor(elapsed % 60);
const frames = Math.floor((elapsed % 1) * thisComp.frameRate);

// Format: MM:SS:FF
(minutes < 10 ? "0" : "") + minutes + ":" + 
(seconds < 10 ? "0" : "") + seconds + ":" + 
(frames < 10 ? "0" : "") + frames
```

### Percentage Counter
```javascript
/**
 * Percentage Counter - Animate percentage display
 * Usage: Source Text
 */
const duration = 2;  // Seconds to count
const endValue = 100;

const progress = Math.min((time - inPoint) / duration, 1);
const currentValue = Math.floor(ease(progress, 0, 1, 0, endValue));

currentValue + "%"
```

### Number Counter with Comma
```javascript
/**
 * Number Counter - Large numbers with formatting
 * Usage: Source Text
 */
const duration = 3;
const endValue = 1000000;

const progress = Math.min((time - inPoint) / duration, 1);
const currentValue = Math.floor(ease(progress, 0, 1, 0, endValue));

// Add commas
currentValue.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")
```

---

## COMPARISON & LOGIC

### Conditional Show/Hide
```javascript
/**
 * Conditional Visibility - Show based on condition
 * Usage: Opacity
 */
const controller = thisComp.layer("Controller");
const triggerValue = controller.effect("Trigger")("Slider");

triggerValue > 50 ? 100 : 0
```

### Time Window
```javascript
/**
 * Time Window - Only visible during time range
 * Usage: Opacity
 */
const showStart = 2;  // Start showing at 2 seconds
const showEnd = 5;    // Stop showing at 5 seconds

(time >= showStart && time <= showEnd) ? 100 : 0
```

### Marker Active Check
```javascript
/**
 * Marker Active - Is a marker currently active?
 * Usage: Opacity or any property
 */
let isActive = false;

if (marker.numKeys > 0) {
    const nearestIdx = marker.nearestKey(time).index;
    const markerTime = marker.key(nearestIdx).time;
    const markerDuration = marker.key(nearestIdx).duration || 0;
    
    isActive = (time >= markerTime && time <= markerTime + markerDuration);
}

isActive ? 100 : 0
```

### Layer Index Condition
```javascript
/**
 * Index Filter - Apply only to specific layer indices
 * Usage: Any property
 */
const targetIndices = [1, 3, 5];  // Only these layers

if (targetIndices.indexOf(index) !== -1) {
    wiggle(3, 25);  // Apply effect
} else {
    value;  // No effect
}
```

---

## ADVANCED MATH

### Smooth Step (Better than ease)
```javascript
/**
 * Smooth Step - Ultra-smooth interpolation
 * Usage: Any property
 */
function smoothStep(edge0, edge1, x) {
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
}

const progress = smoothStep(0, 2, time);  // 0-2 seconds
linear(progress, 0, 1, 0, 100)
```

### Exponential Ease Out
```javascript
/**
 * Exponential Ease - Fast start, slow end
 * Usage: Any property
 */
const duration = 1;
const progress = Math.min((time - inPoint) / duration, 1);
const eased = 1 - Math.pow(1 - progress, 3);

linear(eased, 0, 1, 0, 100)
```

### Spring Physics
```javascript
/**
 * Spring Physics - Realistic spring motion
 * Usage: Position, Scale
 */
const CONFIG = {
    stiffness: 100,    // Spring tightness
    damping: 10,       // Friction
    mass: 1            // Object mass
};

let keyIndex = 0;
if (numKeys > 0) {
    keyIndex = nearestKey(time).index;
    if (key(keyIndex).time > time) keyIndex--;
}

if (keyIndex > 0) {
    const startVal = key(keyIndex).value;
    const endVal = key(keyIndex === numKeys ? keyIndex : keyIndex + 1).value;
    const elapsed = time - key(keyIndex).time;
    
    const omega = Math.sqrt(CONFIG.stiffness / CONFIG.mass);
    const zeta = CONFIG.damping / (2 * Math.sqrt(CONFIG.stiffness * CONFIG.mass));
    
    const decay = Math.exp(-zeta * omega * elapsed);
    const oscillation = Math.cos(omega * Math.sqrt(1 - zeta * zeta) * elapsed);
    
    endVal + (startVal - endVal) * decay * oscillation;
} else {
    value;
}
```

### Noise Function
```javascript
/**
 * Perlin-like Noise - Smooth organic variation
 * Usage: Any property
 */
const CONFIG = {
    speed: 1,
    amplitude: 50,
    seed: index
};

seedRandom(CONFIG.seed, false);
const noiseValue = noise(time * CONFIG.speed);

value + noiseValue * CONFIG.amplitude
```

### Modulo Cycle
```javascript
/**
 * Modulo Cycle - Value that cycles within range
 * Usage: Rotation, Hue, etc.
 */
const cycleLength = 360;  // Full cycle value
const speed = 90;         // Units per second

((time * speed) % cycleLength)
```

### Bezier Interpolation
```javascript
/**
 * Custom Bezier - Define your own easing curve
 * Usage: Any property
 */
function cubicBezier(t, p1x, p1y, p2x, p2y) {
    // Simple approximation of cubic bezier
    const cx = 3 * p1x;
    const bx = 3 * (p2x - p1x) - cx;
    const ax = 1 - cx - bx;
    
    const cy = 3 * p1y;
    const by = 3 * (p2y - p1y) - cy;
    const ay = 1 - cy - by;
    
    return ((ay * t + by) * t + cy) * t;
}

const duration = 1;
const t = clamp((time - inPoint) / duration, 0, 1);

// Custom curve (ease-out-back style)
const eased = cubicBezier(t, 0.175, 0.885, 0.32, 1.275);

linear(eased, 0, 1, 0, 100)
```

