# Fullscreen Feature for BPMN Diagrams

## Overview

Added fullscreen functionality to all BPMN diagram viewers using the browser's native Fullscreen API.

## Implementation

### Files Modified

1. **DiagramZoomControls.tsx**
   - Added fullscreen button as 4th control
   - Uses `Maximize` icon from Carbon Design System
   - Toggles fullscreen mode on/off
   - Updates icon description based on state

2. **viewer/viewerTypes.ts**
   - Added `getContainerRef()` method to ViewerApi

3. **viewer/useViewerApi.ts**
   - Implemented `getContainerRef()` to return container reference

## Features

### ✅ Fullscreen Button
- **Position:** 4th in the control list (after Fit, Zoom In, Zoom Out)
- **Icon:** `Maximize` from Carbon Design System
- **Tooltip:** "Fullscreen" when not in fullscreen, "Exit fullscreen" when in fullscreen

### ✅ Functionality
- **Click to enter:** Makes the diagram container fullscreen
- **Click to exit:** Returns to normal view
- **ESC key:** Browser default - exits fullscreen
- **State tracking:** Button updates based on fullscreen state

### ✅ No Auto-Fit
- Diagram does NOT automatically fit when entering/exiting fullscreen
- User controls zoom manually using existing zoom controls
- Preserves current zoom level and pan position

## How It Works

### Browser Fullscreen API
```typescript
// Enter fullscreen
container.requestFullscreen()

// Exit fullscreen
document.exitFullscreen()

// Check if in fullscreen
document.fullscreenElement !== null
```

### Event Listener
```typescript
document.addEventListener('fullscreenchange', handleFullscreenChange)
```

Tracks fullscreen state changes to update button tooltip.

### Container Access
The fullscreen button gets the container reference through the ViewerApi:
```typescript
const containerRef = viewerApi.getContainerRef()
const container = containerRef?.current
container.requestFullscreen()
```

## Usage

The fullscreen button is automatically available on all three pages that use the BPMN viewer:

1. **InstanceDetail.tsx** - Process instance diagram
2. **Processes.tsx** - Process definition diagram
3. **MigrationWizard.tsx** - Source and target diagrams (each has its own fullscreen button)

## User Experience

### Entering Fullscreen
1. User clicks the Maximize button (4th button)
2. Diagram container expands to fill entire screen
3. Button tooltip changes to "Exit fullscreen"
4. Zoom level and pan position are preserved
5. User can zoom/pan as normal

### Exiting Fullscreen
1. User clicks the Maximize button again OR presses ESC
2. Diagram returns to normal container size
3. Button tooltip changes back to "Fullscreen"
4. Zoom level and pan position are preserved

## Browser Compatibility

The Fullscreen API is supported in all modern browsers:
- ✅ Chrome/Edge (Chromium)
- ✅ Firefox
- ✅ Safari
- ✅ Opera

## Technical Details

### No Breaking Changes
- Existing functionality unchanged
- All props remain the same
- ViewerApi extended with new method
- Backward compatible

### Error Handling
```typescript
container.requestFullscreen().catch((err: unknown) => {
  console.error('Error attempting to enable fullscreen:', err)
})
```

Gracefully handles cases where fullscreen is not allowed (e.g., iframe restrictions).

### State Management
- Uses React `useState` to track fullscreen state
- Listens to `fullscreenchange` event for updates
- Cleans up event listener on unmount

## Future Enhancements

Potential improvements:
1. **Keyboard shortcut** - F11 or custom key
2. **Double-click to fullscreen** - Alternative trigger
3. **Auto-fit option** - Toggle to auto-fit on fullscreen
4. **Fullscreen on specific element** - Focus on selected task
5. **Picture-in-picture mode** - For multi-diagram comparison

## Testing Checklist

- [ ] Fullscreen button appears on all three pages
- [ ] Button is positioned as 4th control
- [ ] Clicking enters fullscreen mode
- [ ] Clicking again exits fullscreen
- [ ] ESC key exits fullscreen
- [ ] Tooltip updates correctly
- [ ] Zoom level preserved when entering/exiting
- [ ] Pan position preserved when entering/exiting
- [ ] Works in Chrome/Edge
- [ ] Works in Firefox
- [ ] Works in Safari
- [ ] No console errors
