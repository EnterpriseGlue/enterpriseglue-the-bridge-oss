export function resolveEditorModeTabIndex(selectedIndex: number, implementUnavailableReason?: string | null): number {
  return selectedIndex === 1 && implementUnavailableReason ? 0 : selectedIndex;
}
