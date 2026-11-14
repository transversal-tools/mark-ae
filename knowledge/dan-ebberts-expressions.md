# Dan Ebberts Expressions Collection

Expression templates based on techniques published by Dan Ebberts
(https://www.motionscript.com). Rewritten and reformatted here; see his site for the originals.

---

## INERTIAL BOUNCE

### Standard Elastic Overshoot
```javascript
/**
 * Elastic Overshoot - Classic inertial bounce after keyframes
 * Usage: Position, Scale, Rotation, any animatable property
 * Technique: Dan Ebberts' inertial bounce
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
    // Only use past keyframes, not future ones
    if (key(keyIndex).time > time) keyIndex--;
}

// ═══════════════════════════════════════════
// BOUNCE PHYSICS
// ═══════════════════════════════════════════

if (keyIndex > 0) {
    // Time elapsed since the keyframe
    const elapsed = time - key(keyIndex).time;
    
    // Velocity at the exact moment of the keyframe
    const impactVelocity = velocityAtTime(key(keyIndex).time - thisComp.frameDuration / 10);
    
    // Damped sinusoidal oscillation
    const oscillation = Math.sin(CONFIG.frequency * elapsed * 2 * Math.PI);
    const dampening = Math.exp(-CONFIG.decay * elapsed);
    
    value + impactVelocity * CONFIG.amplitude * oscillation * dampening;
} else {
    value;
}
```

### Slider-Controlled Elastic
```javascript
/**
 * Elastic Overshoot - External slider control version
 * Usage: Position, Scale, Rotation
 * Requires: Slider Controls "Bounce Amp", "Bounce Freq", "Bounce Decay"
 * Technique: Dan Ebberts' inertial bounce
 */

// Read values from slider controls
const amplitude = effect("Bounce Amp")("Slider") / 1000;
const frequency = effect("Bounce Freq")("Slider");
const decay = effect("Bounce Decay")("Slider");

// Find the most recent keyframe
let keyIndex = 0;
if (numKeys > 0) {
    keyIndex = nearestKey(time).index;
    if (key(keyIndex).time > time) keyIndex--;
}

// Apply bounce physics
if (keyIndex > 0) {
    const elapsed = time - key(keyIndex).time;
    const impactVelocity = velocityAtTime(key(keyIndex).time - thisComp.frameDuration / 10);
    
    value + impactVelocity * amplitude * Math.sin(frequency * elapsed * 2 * Math.PI) / Math.exp(decay * elapsed);
} else {
    value;
}
```

### Compact Elastic (For Embedding)
```javascript
/**
 * Elastic Overshoot - Compact version
 * Usage: Any property
 */
var amp=.05,frq=4,dec=8,k=0;if(numKeys>0){k=nearestKey(time).index;if(key(k).time>time)k--}k>0?value+velocityAtTime(key(k).time-thisComp.frameDuration/10)*amp*Math.sin(frq*(time-key(k).time)*2*Math.PI)/Math.exp(dec*(time-key(k).time)):value
```

---

## GRAVITY BOUNCE

### Realistic Drop Bounce
```javascript
/**
 * Gravity Bounce - Realistic physics-based ball drop
 * Usage: Position (apply to Y axis behavior)
 * Technique: Dan Ebberts' gravity simulation
 */
const CONFIG = {
    elasticity: 0.7,     // Energy retained per bounce (0-1)
    gravity: 5000,       // Acceleration in pixels/sec²
    maxBounces: 9        // Maximum bounces to calculate
};

// ═══════════════════════════════════════════
// KEYFRAME DETECTION
// ═══════════════════════════════════════════

let keyIndex = 0;
if (numKeys > 0) {
    keyIndex = nearestKey(time).index;
    if (key(keyIndex).time > time) keyIndex--;
}

// ═══════════════════════════════════════════
// PHYSICS SIMULATION
// ═══════════════════════════════════════════

if (keyIndex > 0) {
    let elapsed = time - key(keyIndex).time;
    // Get initial downward velocity (negative Y = down in AE)
    let velocity = -velocityAtTime(key(keyIndex).time - thisComp.frameDuration / 10)[1];
    
    // Simulate each bounce
    for (let bounce = 0; bounce < CONFIG.maxBounces; bounce++) {
        if (elapsed <= 0) break;
        
        // Time for this bounce arc
        const arcDuration = 2 * velocity / CONFIG.gravity;
        
        if (elapsed < arcDuration) {
            // Still in this arc - calculate position
            const posY = value[1] + velocity * elapsed - CONFIG.gravity * elapsed * elapsed / 2;
            [value[0], posY];
            break;
        }
        
        // Move to next bounce
        elapsed -= arcDuration;
        velocity *= CONFIG.elasticity;
    }
} else {
    value;
}
```

---

## SPEED CONTROL

### Animation Speed Multiplier
```javascript
/**
 * Speed Control - Change animation speed without retiming
 * Usage: Any property with keyframes
 * Requires: Slider Control "Speed"
 * Technique: Dan Ebberts' time manipulation
 */
const speedMultiplier = effect("Speed")("Slider");  // 1 = normal, 2 = 2x speed

if (numKeys > 1) {
    const animationStart = key(1).time;
    const adjustedTime = (time - animationStart) * speedMultiplier;
    valueAtTime(animationStart + adjustedTime);
} else {
    value;
}
```

### Controlled Wiggle Speed
```javascript
/**
 * Speed-Controlled Wiggle - Adjustable frequency and amplitude
 * Usage: Position, Scale
 * Requires: Slider Controls "Wiggle Freq" and "Wiggle Amp"
 */
const frequency = effect("Wiggle Freq")("Slider");
const amplitude = effect("Wiggle Amp")("Slider");

wiggle(frequency, amplitude)
```

---

## AUTO-FADE

### Layer Edge Fade
```javascript
/**
 * Auto-Fade Edges - Fade at layer in/out points
 * Usage: Opacity
 * Technique: Dan Ebberts' autofade
 */
const fadeDuration = 0.5;  // Seconds for fade in and out

if (time < inPoint + fadeDuration) {
    // Fade in
    linear(time, inPoint, inPoint + fadeDuration, 0, 100);
} else if (time > outPoint - fadeDuration) {
    // Fade out
    linear(time, outPoint - fadeDuration, outPoint, 100, 0);
} else {
    100;
}
```

### Composition Time Fade
```javascript
/**
 * Comp Fade - Fade based on composition timeline
 * Usage: Opacity
 */
const CONFIG = {
    fadeInDuration: 0.5,   // Seconds
    fadeOutDuration: 0.5   // Seconds
};

const compEnd = thisComp.duration;

if (time < CONFIG.fadeInDuration) {
    linear(time, 0, CONFIG.fadeInDuration, 0, value);
} else if (time > compEnd - CONFIG.fadeOutDuration) {
    linear(time, compEnd - CONFIG.fadeOutDuration, compEnd, value, 0);
} else {
    value;
}
```

---

## LAYER SEQUENCING

### Index-Based Stagger
```javascript
/**
 * Index Stagger - Delay animation by layer position
 * Usage: Any property with keyframes
 * Technique: Dan Ebberts' layer sequencing
 */
const delayPerLayer = 0.1;  // Seconds between each layer
const layerOffset = (index - 1) * delayPerLayer;

valueAtTime(time - layerOffset)
```

### Sequential Layer Animation
```javascript
/**
 * Sequential Animation - Each layer waits for previous
 * Usage: Any property with keyframes
 */
const animationDuration = 0.5;  // How long each layer's animation takes
const myStartTime = (index - 1) * animationDuration;

if (time < myStartTime) {
    // Not started yet - hold first keyframe value
    key(1).value;
} else if (time > myStartTime + animationDuration) {
    // Finished - hold last keyframe value
    key(numKeys).value;
} else {
    // Animating - offset time to match layer's slot
    valueAtTime(key(1).time + (time - myStartTime));
}
```

---

## FOLLOW THE LEADER

### Trail Effect
```javascript
/**
 * Trail Follow - Each layer follows the one above with delay
 * Usage: Position
 * Technique: Dan Ebberts' follow the leader
 */
const trailDelay = 0.1;  // Seconds behind leader

if (index > 1) {
    const leaderLayer = thisComp.layer(index - 1);
    leaderLayer.transform.position.valueAtTime(time - trailDelay);
} else {
    value;
}
```

### Smooth Trail Follow
```javascript
/**
 * Smooth Trail - Eased following with natural motion
 * Usage: Position
 */
const CONFIG = {
    trailDelay: 0.1,    // Seconds behind
    smoothness: 3       // Easing octaves
};

if (index > 1) {
    const leader = thisComp.layer(index - 1);
    const targetPos = leader.transform.position.valueAtTime(time - CONFIG.trailDelay);
    
    // Smooth interpolation toward target
    ease(time, key(1).time, key(numKeys).time, value, targetPos);
} else {
    value;
}
```

---

## TIME REMAPPING

### Speed Variation
```javascript
/**
 * Speed Variation - Play at different speed
 * Usage: Time Remap
 */
const speedMultiplier = 2;  // 2 = double speed, 0.5 = half speed

posterizeTime(24);  // Optional: reduce frame rate first
time * speedMultiplier
```

### Reverse Animation
```javascript
/**
 * Reverse Play - Play animation backwards
 * Usage: Any property with keyframes
 * Technique: Dan Ebberts' time reversal
 */
if (time < key(1).time) {
    // Before animation - hold last value
    key(numKeys).value;
} else if (time > key(numKeys).time) {
    // After animation - hold first value
    key(1).value;
} else {
    // During animation - reverse time
    const duration = key(numKeys).time - key(1).time;
    const reversedTime = key(numKeys).time - (time - key(1).time);
    valueAtTime(reversedTime);
}
```

### Ping Pong Time
```javascript
/**
 * Ping Pong - Forward then reverse, repeating
 * Usage: Any property with keyframes
 * Technique: Dan Ebberts' time looping
 */
const animStart = key(1).time;
const animEnd = key(numKeys).time;
const duration = animEnd - animStart;

// Calculate position in the ping-pong cycle
let cycleTime = (time - animStart) % (duration * 2);

if (cycleTime > duration) {
    // Going backwards
    cycleTime = duration * 2 - cycleTime;
}

valueAtTime(animStart + cycleTime)
```

---

## PROPERTY LINKING

### Link to Master Layer
```javascript
/**
 * Master Link - Follow master layer with offset
 * Usage: Rotation, Scale, Position
 */
const masterLayer = thisComp.layer("Master Control");
const indexOffset = index * 10;  // Each layer gets more offset

masterLayer.transform.rotation + indexOffset
```

### Mirror Property
```javascript
/**
 * Mirror Value - Invert another property
 * Usage: Rotation, Position
 */
-value
```

### Proportional Scale
```javascript
/**
 * Proportional Link - Scale property by ratio
 * Usage: Scale, Position offset
 */
const scaleFactor = 0.5;  // Half the original value
value * scaleFactor
```

---

## RANDOM WITH CONTROL

### Gaussian Random (Bell Curve)
```javascript
/**
 * Gaussian Random - Natural distribution random
 * Usage: Any property needing realistic variation
 */
// gaussRandom returns values clustered around the center
gaussRandom(50, 100)  // Most values near 75
```

### Seeded Random (Reproducible)
```javascript
/**
 * Seeded Random - Consistent random per layer
 * Usage: Color, Scale, any variation by layer
 */
seedRandom(index, true);  // true = frozen, false = animated
random(100)
```

### Random with Hold Time
```javascript
/**
 * Random Hold - Random value that changes at intervals
 * Usage: Position, Rotation, any property
 * Technique: Dan Ebberts' controlled randomness
 */
const holdDuration = 0.5;  // Seconds between changes

// Create a consistent seed based on time interval
seedRandom(Math.floor(time / holdDuration), true);
random(100)
```

---

## PATH & POSITION

### Circular Orbit
```javascript
/**
 * Circular Orbit - Rotate around center point
 * Usage: Position
 * Technique: Dan Ebberts' orbital motion
 */
const CONFIG = {
    centerLayer: "Center",   // Name of center layer
    radius: 200,             // Orbit radius in pixels
    speed: 1                 // Revolutions per second
};

const center = thisComp.layer(CONFIG.centerLayer).transform.position;
const angle = degreesToRadians(time * CONFIG.speed * 360);

const orbitX = center[0] + Math.cos(angle) * CONFIG.radius;
const orbitY = center[1] + Math.sin(angle) * CONFIG.radius;

[orbitX, orbitY]
```

### Aim at Target
```javascript
/**
 * Aim at Target - Point rotation toward layer
 * Usage: Rotation
 */
const targetLayer = thisComp.layer("Target");
const delta = targetLayer.transform.position - transform.position;

// Calculate angle from this layer to target
radiansToDegrees(Math.atan2(delta[1], delta[0]))
```

### Distance to Layer
```javascript
/**
 * Distance Measurement - Get distance between layers
 * Usage: Use in other expressions or link to slider
 */
const targetLayer = thisComp.layer("Target");
length(transform.position, targetLayer.transform.position)
```

---

## MATH UTILITIES

### Degrees to Radians
```javascript
/**
 * Deg to Rad - Convert angle units
 */
degreesToRadians(degrees)
// Manual: degrees * Math.PI / 180
```

### Radians to Degrees
```javascript
/**
 * Rad to Deg - Convert angle units
 */
radiansToDegrees(radians)
// Manual: radians * 180 / Math.PI
```

### Clamp Value
```javascript
/**
 * Value Clamp - Limit to range
 */
clamp(value, min, max)
```

### Normalize to 0-1
```javascript
/**
 * Normalize - Convert range to 0-1
 */
const inputMin = 0;
const inputMax = 100;

(value - inputMin) / (inputMax - inputMin)
```

### Linear Interpolation
```javascript
/**
 * Linear Lerp - Map value between ranges
 */
// linear(input, inputMin, inputMax, outputMin, outputMax)
linear(time, 0, 5, 0, 100)
```

### Smooth Interpolation
```javascript
/**
 * Ease Lerp - Smooth mapping with easing
 */
// ease(input, inputMin, inputMax, outputMin, outputMax)
ease(time, 0, 5, 0, 100)
```

---

## DAN EBBERTS' EXPRESSION TIPS

1. **valueAtTime()** - Access any property's value at any time
2. **velocityAtTime()** - Get velocity for physics simulations
3. **index** - Use layer index for staggering
4. **numKeys** - Always check if keyframes exist before using them
5. **thisComp.layer()** - Reference other layers dynamically
6. **effect()** - Link expressions to sliders for easy adjustment
7. **seedRandom()** - Create reproducible randomness
8. **posterizeTime()** - Reduce evaluation frequency for performance or style
