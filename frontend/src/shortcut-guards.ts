/** Radix keeps closed overlays mounted while their exit animation finishes. */
export function hasOpenOverlay(){
 return !!document.querySelector('[role="dialog"]:not([data-state="closed"]), [role="menu"]:not([data-state="closed"]), [role="listbox"]:not([data-state="closed"])');
}
