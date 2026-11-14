# 💡 AE Agent Tips Library

Master AE Agent with these tips and tricks! Type `tip` in the extension for a random tip, or `tips` to see all.

---

## 🚀 Basics

### Instant Commands
Type effect names directly to apply them instantly without AI:
- `blur` → Gaussian Blur
- `glow` → Deep Glow  
- `cc` → Shows CC effects
- `curves` → Curves effect
- `noise` → Fractal Noise

### Quick Actions
These execute immediately without API calls:
- `undo` / `redo`
- `duplicate`
- `precompose`
- `select all` / `deselect`
- `save`

---

## 🎬 Playback

Control playback without leaving the panel:

| Command | Action |
|---------|--------|
| `play` | Start playback |
| `stop` | Stop playback |
| `pause` | Pause playback |
| `ram preview` | Full quality preview |
| `beginning` / `start` | Go to frame 0 |
| `end` | Go to last frame |
| `next frame` / `forward` | Step forward one frame |
| `back` / `previous frame` | Step back one frame |
| `forward 10` | Jump 10 frames forward |
| `back 10` | Jump 10 frames back |
| `next key` | Jump to next keyframe |
| `prev key` | Jump to previous keyframe |

---

## 🔑 Keyframes & Easing

### Keyframe Selection Priority
When you ask to "ease" or adjust easing:
1. **If keyframes are selected** → Only those get modified
2. **If no keyframes selected** → All keyframes on the property are modified

### Easing Values Guide

| Influence | Feel | Use For |
|-----------|------|---------|
| 10-33% | Sharp, snappy | Impact, landing |
| 50-75% | Smooth, natural | General motion |
| 85%+ | Very soft | Gentle settle |

### Pro Tips
- Select specific keyframes before asking to ease
- Use "sharp in, smooth out" for physics (landing)
- Use "smooth in, sharp out" for launches
- The `setEase()` helper handles dimensions automatically

---

## 🤖 AI Models

### Auto Model Selection
AE Agent automatically picks the best model:

| Complexity | Model | Use Case |
|------------|-------|----------|
| Simple (1) | Flash | Quick tasks, panels, effects |
| Medium (2) | Pro | Multi-step, expressions |
| Complex (3+) | Gemini 3 | Complex setups, debugging |

### Deep Think Mode ⚡
Enable Deep Think for:
- Complex multi-step operations
- Debugging difficult errors
- Advanced expression writing
- When normal mode fails

---

## 🔧 Features

### Auto-Fix
If code fails, AE Agent automatically:
1. **Attempt 1**: Tries Flash for quick fix
2. **Attempt 2**: Uses Pro for smarter approach
3. **Attempt 3**: Uses Gemini 3 with Deep Think

### Retry Button ↻
Click retry on any message to try again with fresh context.

### Star Favorites ⭐
Click the star on any message to save it to favorites for quick reuse.

### Console Log
Check the Console tab for detailed logs of:
- User input
- Context gathered
- AI responses
- Code execution
- Errors and fixes

---

## 📝 Best Practices

### Be Specific
Instead of: "make it look better"  
Say: "add 75% ease to all keyframes on position"

### Provide Context
Instead of: "add glow"  
Say: "add subtle glow to the selected text layer"

### Use Layer Types
Specify layer types for better results:
- Shape layer
- Text layer
- Solid
- Null
- Adjustment layer
- Camera
- Light

---

## ⚠️ Troubleshooting

### Common Issues

**"No active composition"**
- Make sure a comp is open and visible
- Click in the comp to focus it

**"No layers selected"**
- Select layers in the timeline before running commands

**Keyframe easing errors**
- The agent now uses `setEase()` helper automatically
- If you see dimension errors, the preprocessor will fix them

**Script keeps failing**
- Try Deep Think mode
- Be more specific in your request
- Check Console for error details

---

## 🎯 Power User Tips

1. **Combine commands**: "add blur at 5 and glow at 50%"
2. **Reference layers**: "copy the position from Ball to Square"
3. **Use expressions**: "add wiggle 2,10 to scale"
4. **Batch operations**: "duplicate this layer 5 times"
5. **Create animations**: Type `bounce` for pre-made physics animation

---

*Type `tip` for a random tip or `tips` to see them all in the extension!*
