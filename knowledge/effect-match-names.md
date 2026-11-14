# After Effects Effect Match Names

Complete reference for applying effects via ExtendScript.
Use these EXACT match names with `layer.property("Effects").addProperty(matchName)`.

---

## BLUR & SHARPEN

```jsx
"ADBE Gaussian Blur 2"        // Gaussian Blur (use this, not Fast Blur)
"ADBE Box Blur2"              // Fast Box Blur
"ADBE Motion Blur"            // Directional Blur
"ADBE Radial Blur"            // Radial Blur
"ADBE Sharpen"                // Sharpen
"ADBE Unsharp Mask2"          // Unsharp Mask
"ADBE Camera Lens Blur"       // Camera Lens Blur
"ADBE Compound Blur"          // Compound Blur
"CC Radial Blur"              // CC Radial Blur
"CC Vector Blur"              // CC Vector Blur
"CC Radial Fast Blur"         // CC Radial Fast Blur
```

## COLOR CORRECTION

```jsx
"ADBE Brightness & Contrast 2" // Brightness & Contrast
"ADBE CurvesCustom"           // Curves
"ADBE Pro Levels2"            // Levels
"ADBE HUE SATURATION"         // Hue/Saturation
"ADBE Color Balance 2"        // Color Balance
"ADBE Vibrance"               // Vibrance
"ADBE Exposure2"              // Exposure
"ADBE Tint"                   // Tint
"ADBE Tritone"                // Tritone
"ADBE Change Color"           // Change Color
"ADBE Change To Color"        // Change to Color
"ADBE Color Balance (HLS)"    // Color Balance (HLS)
"ADBE Equalize"               // Equalize
"ADBE Invert"                 // Invert
"ADBE Lumetri"                // Lumetri Color
"ADBE Photo Filter"           // Photo Filter
"ADBE SelectiveColor"         // Selective Color
"ADBE ShadowHighlight"        // Shadow/Highlight
"CC Color Neutralizer"        // CC Color Neutralizer
"CC Color Offset"             // CC Color Offset
"CC Kernel"                   // CC Kernel
"CC Toner"                    // CC Toner
```

## STYLIZE

```jsx
"ADBE Glo2"                   // Glow
"ADBE Drop Shadow"            // Drop Shadow
"ADBE Bevel Alpha"            // Bevel Alpha
"ADBE Brush Strokes"          // Brush Strokes
"ADBE Cartoonify"             // Cartoon
"ADBE Color Emboss"           // Color Emboss
"ADBE Emboss"                 // Emboss
"ADBE Find Edges"             // Find Edges
"ADBE Mosaic"                 // Mosaic
"ADBE Posterize"              // Posterize
"ADBE Roughen Edges"          // Roughen Edges
"ADBE Scatter"                // Scatter
"ADBE Strobe"                 // Strobe Light
"ADBE Texturize"              // Texturize
"ADBE Threshold2"             // Threshold
"CC Glass"                    // CC Glass
"CC Kaleida"                  // CC Kaleida
"CC Mr. Mercury"              // CC Mr. Mercury
"CC Plastic"                  // CC Plastic
"CC RepeTile"                 // CC RepeTile
"CC Threshold"                // CC Threshold
"CC Threshold RGB"            // CC Threshold RGB
"CC Vignette"                 // CC Vignette
"CC Color Halftone"           // CC Color Halftone
```

## DISTORT

```jsx
"ADBE Bulge"                  // Bulge
"ADBE Corner Pin"             // Corner Pin
"ADBE Displacement Map"       // Displacement Map
"ADBE LIQUIFY"                // Liquify
"ADBE Magnify"                // Magnify
"ADBE Mesh Warp"              // Mesh Warp
"ADBE Mirror"                 // Mirror
"ADBE Offset"                 // Offset
"ADBE Optics Compensation"    // Optics Compensation
"ADBE Polar Coordinates"      // Polar Coordinates
"ADBE Reshape"                // Reshape
"ADBE Ripple"                 // Ripple
"ADBE Rolling Shutter"        // Rolling Shutter Repair
"ADBE Smear"                  // Smear
"ADBE Spherize"               // Spherize
"ADBE Geometry2"              // Transform
"ADBE Turbulent Displace"     // Turbulent Displace
"ADBE Twirl"                  // Twirl
"ADBE WRPMESH"                // Warp
"ADBE Wave Warp"              // Wave Warp
"ADBE Wave World"             // Wave World
"CC Bend It"                  // CC Bend It
"CC Bender"                   // CC Bender
"CC Blobbylize"               // CC Blobbylize
"CC Flo Motion"               // CC Flo Motion
"CC Griddler"                 // CC Griddler
"CC Lens"                     // CC Lens
"CC Page Turn"                // CC Page Turn
"CC Power Pin"                // CC Power Pin
"CC Ripple Pulse"             // CC Ripple Pulse
"CC Slant"                    // CC Slant
"CC Smear"                    // CC Smear
"CC Split"                    // CC Split
"CC Split 2"                  // CC Split 2
"CC Tiler"                    // CC Tiler
```

## GENERATE

```jsx
"ADBE Fill"                   // Fill
"ADBE Ramp"                   // Gradient Ramp
"ADBE Fractal Noise"          // Fractal Noise
"ADBE Cell Pattern"           // Cell Pattern
"ADBE Checkerboard"           // Checkerboard
"ADBE Circle"                 // Circle
"ADBE Ellipse"                // Ellipse
"ADBE Eyedropper Fill"        // Eyedropper Fill
"ADBE Grid"                   // Grid
"ADBE Lens Flare"             // Lens Flare
"ADBE Lightning 2"            // Advanced Lightning
"ADBE Paint Bucket"           // Paint Bucket
"ADBE Scribble Fill"          // Scribble
"ADBE Stroke"                 // Stroke
"ADBE Vegas"                  // Vegas
"ADBE Write-on"               // Write-on
"ADBE 4ColorGradient"         // 4-Color Gradient
"ADBE AudSpect"               // Audio Spectrum
"ADBE AudWave"                // Audio Waveform
"ADBE Laser"                  // Beam
"CC Glue Gun"                 // CC Glue Gun
"CC Light Burst 2.5"          // CC Light Burst 2.5
"CC Light Rays"               // CC Light Rays
"CC Light Sweep"              // CC Light Sweep
"CC Threads"                  // CC Threads
```

## KEYING

```jsx
"ADBE Spill2"                 // Advanced Spill Suppressor
"ADBE Color Difference Key"   // Color Difference Key
"ADBE Color Range"            // Color Range
"ADBE Difference Matte2"      // Difference Matte
"ADBE Extract"                // Extract
"ADBE ATG Extract"            // Inner/Outer Key
"Keylight 906"                // Keylight (1.2)
"ADBE Linear Color Key2"      // Linear Color Key
```

## MATTE

```jsx
"ADBE Matte Choker"           // Matte Choker
"ADBE MC Refine"              // Refine Hard Matte
"ADBE MC Refine Soft"         // Refine Soft Matte
"ADBE Simple Choker"          // Simple Choker
```

## NOISE & GRAIN

```jsx
"ADBE Add Grain"              // Add Grain
"ADBE Dust & Scratches"       // Dust & Scratches
"ADBE Fractal Noise"          // Fractal Noise
"ADBE Match Grain2"           // Match Grain
"ADBE Median"                 // Median
"ADBE Noise"                  // Noise
"ADBE Noise Alpha2"           // Noise Alpha
"ADBE Noise HLS2"             // Noise HLS
"ADBE Noise HLS Auto2"        // Noise HLS Auto
"ADBE Remove Grain2"          // Remove Grain
"ADBE AIF Perlin Noise 3D"    // Turbulent Noise
```

## PERSPECTIVE

```jsx
"ADBE 3D Glasses2"            // 3D Glasses
"ADBE Bevel Alpha"            // Bevel Alpha
"ADBE Drop Shadow"            // Drop Shadow
"ADBE Radial Shadow"          // Radial Shadow
"CC Cylinder"                 // CC Cylinder
"CC Environment"              // CC Environment
"CC Sphere"                   // CC Sphere
"CC Spotlight"                // CC Spotlight
```

## SIMULATION

```jsx
"ADBE Card Dance"             // Card Dance
"ADBE Caustics"               // Caustics
"ADBE Foam"                   // Foam
"ADBE Particle Playground"    // Particle Playground
"ADBE Shatter"                // Shatter
"ADBE Wave World"             // Wave World
"CC Ball Action"              // CC Ball Action
"CC Bubbles"                  // CC Bubbles
"CC Drizzle"                  // CC Drizzle
"CC Hair"                     // CC Hair
"CC Mr. Mercury"              // CC Mr. Mercury
"CC Particle Systems II"      // CC Particle Systems II
"CC Particle World"           // CC Particle World
"CC Pixel Polly"              // CC Pixel Polly
"CC Rain"                     // CC Rain
"CC Scatterize"               // CC Scatterize
"CC Snow"                     // CC Snow
"CC Star Burst"               // CC Star Burst
```

## TIME

```jsx
"ADBE Echo"                   // Echo
"ADBE Posterize Time"         // Posterize Time
"ADBE Timewarp"               // Timewarp
"CC Force Motion Blur"        // CC Force Motion Blur
"CC Wide Time"                // CC Wide Time
```

## TRANSITION

```jsx
"ADBE Block Dissolve"         // Block Dissolve
"ADBE Gradient Wipe"          // Gradient Wipe
"ADBE IRIS_WIPE"              // Iris Wipe
"ADBE Linear Wipe"            // Linear Wipe
"ADBE Radial Wipe"            // Radial Wipe
"ADBE Venetian Blinds"        // Venetian Blinds
"CC Glass Wipe"               // CC Glass Wipe
"CC Grid Wipe"                // CC Grid Wipe
"CC Image Wipe"               // CC Image Wipe
"CC Jaws"                     // CC Jaws
"CC Light Wipe"               // CC Light Wipe
"CC Radial ScaleWipe"         // CC Radial Scale Wipe
"CC Scale Wipe"               // CC Scale Wipe
"CC Twister"                  // CC Twister
"CC WarpoMatic"               // CC WarpoMatic
```

## CHANNEL

```jsx
"ADBE Arithmetic"             // Arithmetic
"ADBE Blend"                  // Blend
"ADBE Calculations"           // Calculations
"ADBE Channel Combiner"       // Channel Combiner
"ADBE Compound Arithmetic"    // Compound Arithmetic
"ADBE Invert"                 // Invert
"ADBE Minimax"                // Minimax
"ADBE Remove Color Matting"   // Remove Color Matting
"ADBE Set Channels"           // Set Channels
"ADBE Set Matte3"             // Set Matte
"ADBE Shift Channels"         // Shift Channels
"ADBE Solid Composite"        // Solid Composite
"CC Composite"                // CC Composite
```

## UTILITY

```jsx
"ADBE Apply Color LUT2"       // Apply Color LUT
"ADBE Cineon Converter2"      // Cineon Converter
"ADBE ProfileToProfile"       // Color Profile Converter
"ADBE Grow Bounds"            // Grow Bounds
"ADBE Compander"              // HDR Compander
"ADBE Highlight Compression"  // HDR Highlight Compression
```

## EXPRESSION CONTROLS

```jsx
"ADBE Slider Control"         // Slider Control
"ADBE Point Control"          // Point Control
"ADBE Point3D Control"        // 3D Point Control
"ADBE Checkbox Control"       // Checkbox Control
"ADBE Color Control"          // Color Control
"ADBE Dropdown Control"       // Dropdown Menu Control
"ADBE Angle Control"          // Angle Control
"ADBE Layer Control"          // Layer Control
```

---

## USAGE EXAMPLES

### Adding an Effect
```jsx
var layer = comp.selectedLayers[0];
var glow = layer.property("Effects").addProperty("ADBE Glo2");
glow.property("Glow Threshold").setValue(60);
glow.property("Glow Radius").setValue(25);
glow.property("Glow Intensity").setValue(1);
```

### Adding Slider Controls
```jsx
var slider = layer.property("Effects").addProperty("ADBE Slider Control");
slider.name = "My Slider";
slider.property("Slider").setValue(50);
```

### Adding Fractal Noise
```jsx
var noise = layer.property("Effects").addProperty("ADBE Fractal Noise");
noise.property("Fractal Type").setValue(3); // Turbulent Basic
noise.property("Contrast").setValue(150);
noise.property("Brightness").setValue(-20);
```

### CC Particle World
```jsx
var particles = layer.property("Effects").addProperty("CC Particle World");
particles.property("Birth Rate").setValue(2);
particles.property("Longevity (sec)").setValue(3);
particles.property("Particle").property("Particle Type").setValue(6); // Faded Sphere
```
