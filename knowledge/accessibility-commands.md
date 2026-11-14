# Accessibility & Navigation Commands

These commands help users with disabilities control After Effects via voice or text input.

---

## Playback Controls

### Play / Pause

```jsx
// Toggle play/pause
app.executeCommand(2285);
```

**Voice Commands:** "play", "start", "preview", "pause", "stop", "hold"

---

### Go to Beginning

```jsx
// Jump to start of composition
app.executeCommand(2007);
```

**Voice Commands:** "go to start", "beginning", "rewind", "go back to start"

---

### Go to End

```jsx
// Jump to end of composition
app.executeCommand(2008);
```

**Voice Commands:** "go to end", "end of comp", "jump to end"

---

### Go to Specific Time

```jsx
// Go to 3 seconds
var comp = app.project.activeItem;
comp.time = 3;  // Time in seconds
```

**Voice Commands:** "go to 3 seconds", "jump to 5s", "move to 2 sec"

---

### Go to Specific Frame

```jsx
// Go to frame 90
var comp = app.project.activeItem;
comp.time = 90 / comp.frameRate;  // Convert frames to seconds
```

**Voice Commands:** "go to frame 90", "frame 120", "jump to frame 30"

---

### Step Forward / Backward

```jsx
// Step forward one frame
app.executeCommand(2011);

// Step backward one frame
app.executeCommand(2010);

// Step forward 10 frames
app.executeCommand(2013);

// Step backward 10 frames
app.executeCommand(2012);
```

**Voice Commands:** 
- "next frame", "step forward", "forward one"
- "previous frame", "step back", "back one"
- "10 frames forward", "skip ahead"
- "10 frames back"

---

### RAM Preview

```jsx
// Start RAM preview
app.executeCommand(app.findMenuCommandId("RAM Preview"));
```

**Voice Commands:** "ram preview", "full preview"

---

## Navigate to Keyframes

```jsx
// Go to next keyframe (on selected layers)
app.executeCommand(2016);

// Go to previous keyframe
app.executeCommand(2015);
```

**Voice Commands:** "next keyframe", "previous keyframe", "next key", "last key"

---

## Selection Controls

### Select All / Deselect All

```jsx
// Select all layers
app.executeCommand(2004);

// Deselect all layers
app.executeCommand(2005);
```

**Voice Commands:** 
- "select all", "grab everything"
- "deselect", "deselect all", "clear selection"

---

### Select Layer by Name

```jsx
var comp = app.project.activeItem;
var layer = comp.layer("Background");
if (layer) layer.selected = true;
```

**Voice Commands:** "select the text layer", "select Background", "select the shape"

---

### Select Next / Previous Layer

```jsx
var comp = app.project.activeItem;
var sel = comp.selectedLayers;

// Select next layer (below current)
if (sel.length > 0 && sel[0].index < comp.numLayers) {
    sel[0].selected = false;
    comp.layer(sel[0].index + 1).selected = true;
}

// Select previous layer (above current)
if (sel.length > 0 && sel[0].index > 1) {
    sel[0].selected = false;
    comp.layer(sel[0].index - 1).selected = true;
}
```

**Voice Commands:** "select next layer", "next layer", "layer below", "previous layer", "layer above"

---

## Layer Quick Actions

### Lock / Unlock Layer

```jsx
var sel = app.project.activeItem.selectedLayers;
for (var i = 0; i < sel.length; i++) {
    sel[i].locked = true;   // Lock
    // sel[i].locked = false;  // Unlock
    // sel[i].locked = !sel[i].locked;  // Toggle
}
```

**Voice Commands:** "lock it", "lock layer", "lock this", "unlock", "unlock layer"

---

### Show / Hide Layer

```jsx
var sel = app.project.activeItem.selectedLayers;
for (var i = 0; i < sel.length; i++) {
    sel[i].enabled = false;  // Hide (disable video)
    // sel[i].enabled = true;   // Show (enable video)
}
```

**Voice Commands:** "hide it", "hide layer", "turn off", "show it", "show layer", "turn on"

---

### Solo Layer

```jsx
var sel = app.project.activeItem.selectedLayers;
for (var i = 0; i < sel.length; i++) {
    sel[i].solo = !sel[i].solo;  // Toggle solo
}
```

**Voice Commands:** "solo", "solo this", "unsolo"

---

### Duplicate Layer

```jsx
// Duplicate selected layers
app.executeCommand(2080);
```

**Voice Commands:** "duplicate", "copy layer", "make a copy"

---

### Delete Layer

```jsx
var sel = app.project.activeItem.selectedLayers;
for (var i = sel.length - 1; i >= 0; i--) {
    sel[i].remove();
}
```

**Voice Commands:** "delete", "remove", "delete layer"

---

## View Controls

### Zoom In / Out

```jsx
// Zoom in comp viewer
app.executeCommand(2023);

// Zoom out comp viewer
app.executeCommand(2024);
```

**Voice Commands:** "zoom in", "bigger", "zoom out", "smaller"

---

### Fit / Specific Zoom

```jsx
// Fit to window
app.executeCommand(2026);

// 100%
app.executeCommand(2028);

// 50%
app.executeCommand(2027);
```

**Voice Commands:** "fit", "fit to window", "fit to screen", "100 percent", "50 percent"

---

### Full Screen Preview

```jsx
// Toggle full screen
app.executeCommand(2029);
```

**Voice Commands:** "full screen", "fullscreen", "preview full"

---

## Timeline Controls

### Work Area Navigation

```jsx
var comp = app.project.activeItem;

// Go to work area start
comp.time = comp.workAreaStart;

// Go to work area end  
comp.time = comp.workAreaStart + comp.workAreaDuration;

// Set work area to layer duration
app.executeCommand(2151);
```

**Voice Commands:** "work area start", "work area end", "set work area"

---

## Quick Reference Table

| Action | Command IDs | Voice Example |
|--------|-------------|---------------|
| Play/Pause | 2285 | "play", "stop" |
| Go to Start | 2007 | "beginning", "rewind" |
| Go to End | 2008 | "go to end" |
| Next Frame | 2011 | "next frame" |
| Previous Frame | 2010 | "previous frame" |
| Next 10 Frames | 2013 | "skip ahead" |
| Previous 10 Frames | 2012 | "back 10" |
| Next Keyframe | 2016 | "next key" |
| Previous Keyframe | 2015 | "previous key" |
| Select All | 2004 | "select all" |
| Deselect All | 2005 | "deselect" |
| Duplicate | 2080 | "duplicate" |
| Zoom In | 2023 | "zoom in" |
| Zoom Out | 2024 | "zoom out" |
| Fit | 2026 | "fit" |
| Full Screen | 2029 | "fullscreen" |
