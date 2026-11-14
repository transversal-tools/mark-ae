# Motion Design Concepts & Strategies

This file teaches the AI how to think like a professional Motion Designer. Use these strategies when the user gives high-level or abstract requests.

---

## 🎨 Aesthetics & Styles

### "Make it Pop" / "Juicy" / "Reveal" (CHOOSE ONE VARIATION)
Do NOT always use the same one! Check context or pick randomly.

**Variant A: The Bouncer (Classic Elastic)**
*   **Best for:** Logos, UI Elements, Text.
*   **Technique:** Scale from 0% → 110% → 100%. Anchor point centered.
*   **Expression:** Apply `inertialBounce` to Scale (see Expressions Library).
*   **Feel:** Friendly, energetic.

**Variant B: The Liquid Snap (Organic)**
*   **Best for:** Shapes, transitions.
*   **Technique:** Turbulent Displace (Size: 80, Amount: 100 → 0) + Fast Box Blur (Radius: 20 → 0) + Simple Choker (Choke: 10).
*   **Feel:** Morphing, gooey, modern.

**Variant C: The Slide & Slice (Sleek)**
*   **Best for:** Corporate, Titles.
*   **Technique:** Mask reveal (Linear Wipe at 45°) + Position slide (50px offset → 0).
*   **Easing:** Very sharp ease in (85% influence).
*   **Effect:** Light Sweep scanning across as it reveals.

**Variant D: The Glitch Snap (Digital)**
*   **Best for:** Tech, loud brands.
*   **Technique:** RGB Split (Shift Channels) animating distance 10 → 0.
*   **Action:** 2 frames of "Invert" effect toggling on/off at start.


### "Cinematic" / "Film Look"
*   **Framing:** Add 2.35:1 Letterbox (black solids at top/bottom).
*   **Color:** Teal & Orange Grading. High contrast Curves.
*   **Texture:** Film Grain (4-5% intensity, Mono).
*   **Optical:** Subtle Chromatic Aberration (Shift Channels or VR Chromatic Aberrations). Vignette (dark corners).
*   **FPS:** Ensure comp is 24fps.

### "Glitch" / "Cyberpunk"
*   **Displacement:** Fractal Noise (Blocky) driving a Displacement Map.
*   **RGB Split:** Separate RGB channels (Shift Channels effect) and offset position slightly.
*   **Strobe:** Random opacity modification.
*   **Pixel Sort:** (Native) CC Scale Wipe at 90 degrees with high stretch.

### "Organic" / "Hand Drawn"
*   **Framerate:** Posterize Time to 12fps (on adjustment layer).
*   **Edges:** Roughen Edges effect (Type: Rusty/Spiky, Scale: 5-10).
*   **Movement:** Turbulent Displace (Size: 50, Amount: 5) animated slowly.

---

## 🏃 Animation Principles (Code Implementation)

### 1. Anticipation
Before a move, go slightly in the opposite direction.
*   *Code:* Add a keyframe before the move starts that moves backwards.

### 2. Follow Through (Overshoot)
Don't just stop. Go past the target, then come back.
*   *Code:* `amp = .05; freq = 2.0; decay = 2.0; ...` (Standard Overshoot Expression)

### 3. Squash and Stretch
Maintains volume. If X scales to 120%, Y should scale to 83% (1/1.2).
*   *Code:* Link Scale X and Y inversely.

### 4. Staging (Focus)
Darken unrelated areas.
*   *Code:* Add Vignette or blur background layers.

---

## 🛠️ Composition Strategies

### "Clean Up" / "Organize"
*   **Color Coding:** 
    *   Nulls = None/Grey
    *   Controllers = Red
    *   Matte/Adjustment = Purple
    *   Solids = Orange
*   **Naming:** Rename layers based on effect (e.g., "Adjustment Layer 1" -> "FX_Glow").
*   **Shy:** Enable 'Separate Dimensions' on Position for better graph editor control.

### "Parallax" (2.5D)
When asked for depth:
1.  Turn layers to 3D.
2.  Push background layers back in Z space (e.g., Z = 2000).
3.  Scale them up to fill the frame (use `fitToComp` helper).
4.  Add a Camera.

---

## 🧠 "Standard" Defaults (The 'Pro' Settings)

When the user gives a generic command, assume these **Pro Defaults** instead of AE's factory defaults:

| Effect | Factory Default | **Pro Default** | Why? |
| :--- | :--- | :--- | :--- |
| **Drop Shadow** | Black, 50% opacity, hard edge | **Color: Dark Blue/Purple (multiply), Softness: 20-50, Dist: 15** | "Real" shadows are rarely pure black or sharp. |
| **Glow** | Threshold 60%, Radius 10, Intensity 1 | **Threshold 40%, Radius 100, Intensity 0.6** | Default AE glow looks cheap/thin. Wide radius looks "expensive". |
| **Motion Blur** | Off | **On (Shutter Angle 180)** | Always enable motion blur for moving layers. |
| **Fractal Noise** | Basic, Soft Linear | **Spline, High Contrast** | Soft Linear looks like 90s clouds. |
| **Vignette** | None | **CC Vignette (Amount 50, Angle 45)** | Focuses the eye. |

---

## ⛔ "Junior" Mistakes (Avoid these!)

*   **Linear Keyframes:** Never leave keyframes linear unless requested. Apply `easyEaseAll(prop, 66)` by default.
*   **Black Shadows:** See above. Use dark blue/brown depending on scene.
*   **100% Pure Red/Green/Blue:** Use hex codes like `#FF4444` (Soft Red) instead of `#FF0000` (Painful Red).
*   **Static Cameras:** If adding a camera, usually add a "Drift" (Null parent rotating slowly).
