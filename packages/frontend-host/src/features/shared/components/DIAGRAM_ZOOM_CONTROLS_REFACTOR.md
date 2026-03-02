# Diagram Zoom Controls Refactoring

## Summary

Centralized diagram zoom controls across all three pages that use the BPMN Viewer component by creating a reusable `DiagramZoomControls` component.

## Changes Made

### 1. Created Reusable Component

**File:** `src/features/shared/components/DiagramZoomControls.tsx`

- Exports a single `DiagramZoomControls` component
- Uses Carbon Design System buttons with icons:
  - `FitToScreen` - Fit diagram to viewport
  - `Add` - Zoom in
  - `Subtract` - Zoom out
- Supports two positioning modes:
  - `top-right` - Top right corner
  - `center-right` - Vertically centered on right side (default)
- Props:
  - `viewerApi: any` - The viewer API instance
  - `position?: 'top-right' | 'center-right'` - Optional positioning

### 2. Updated All Three Pages

#### InstanceDetail.tsx
- **Before:** Inline zoom control buttons at top-right
- **After:** Uses `<DiagramZoomControls viewerApi={viewerApi} position="center-right" />`
- **Location:** Line 1184
- Removed unused icon imports: `Add`, `Subtract`, `FitToScreen`

#### Processes.tsx
- **Before:** No zoom controls
- **After:** Added `<DiagramZoomControls viewerApi={viewerApi} position="center-right" />`
- **Location:** Line 1019
- Controls only show when diagram is loaded (`currentKey && xmlQ.data`)

#### MigrationWizard.tsx
- **Before:** Custom HTML buttons with text symbols (⤢, +, −)
- **After:** Uses `<DiagramZoomControls>` for both source and target viewers
- **Locations:** 
  - Source viewer: Line 431
  - Target viewer: Line 439
- Each viewer has its own independent set of controls

## Benefits

### Code Reusability
- Single source of truth for zoom control implementation
- No code duplication across three files
- Consistent behavior everywhere

### Maintainability
- Changes to zoom controls only need to be made in one place
- Easy to add new features (e.g., reset zoom, zoom percentage display)
- Consistent styling via Carbon Design System

### User Experience
- Consistent UI across all diagram views
- Professional appearance with Carbon Design icons
- Accessible with proper ARIA labels and icon descriptions

### Positioning
- All controls now use `center-right` positioning
- Vertically centered on the right side of the diagram
- Consistent placement across all pages

## Files Modified

1. ✅ `src/features/shared/components/DiagramZoomControls.tsx` (NEW)
2. ✅ `src/features/mission-control/components/InstanceDetail.tsx`
3. ✅ `src/features/mission-control/components/Processes.tsx`
4. ✅ `src/features/mission-control/components/migration/MigrationWizard.tsx`

## Testing Checklist

- [ ] InstanceDetail page - zoom controls work correctly
- [ ] Processes page - zoom controls appear and function
- [ ] MigrationWizard page - both source and target viewers have working controls
- [ ] All three zoom buttons work (fit, zoom in, zoom out)
- [ ] Controls are positioned correctly (center-right)
- [ ] No console errors
- [ ] Responsive behavior on window resize

## Future Enhancements

Potential improvements that could be added to `DiagramZoomControls`:

1. **Zoom percentage display** - Show current zoom level
2. **Reset button** - Reset to default view
3. **Keyboard shortcuts** - Add hotkeys for zoom operations
4. **Touch gestures** - Pinch to zoom on mobile
5. **Zoom slider** - Alternative UI for precise zoom control
6. **Fullscreen mode** - Expand diagram to fullscreen
