/**
 * Small DOM helpers shared by the HUD widgets, the slot views and the inventory screen. Text is
 * always written with textContent; nothing here ever parses markup.
 */

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== '') node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function hudButton(className: string, text?: string): HTMLButtonElement {
  const button = h('button', className, text);
  button.type = 'button';
  return button;
}

export function kbd(label: string): HTMLElement {
  return h('kbd', 'hud-kbd', label);
}

export function iconHost(className: string, icon: SVGSVGElement): HTMLElement {
  const host = h('span', className);
  host.setAttribute('aria-hidden', 'true');
  host.append(icon);
  return host;
}

export function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

export function setHidden(node: HTMLElement, hidden: boolean): void {
  if (node.hidden !== hidden) node.hidden = hidden;
}

export function setTitle(node: HTMLElement, title: string): void {
  if (node.title !== title) node.title = title;
}

export function setAttr(node: Element, name: string, value: string): void {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

/**
 * Focus release for buttons inside the frozen modals (shop, pause, inventory). A mouse click
 * blurs the button so Space and Enter return to the game once the modal closes; a keyboard
 * activation (click.detail === 0) keeps focus so Tab navigation through the modal is not thrown
 * away. A modal that closes hides its buttons, which drops their focus anyway.
 */
export function releasePointerFocus(button: HTMLElement, event: MouseEvent): void {
  if (event.detail !== 0) button.blur();
}

/** The element matching `selector` that contains the event target, if it lies inside root. */
export function closestWithin(event: Event, root: HTMLElement, selector: string): HTMLElement | null {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const match = target.closest(selector);
  return match instanceof HTMLElement && root.contains(match) ? match : null;
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
