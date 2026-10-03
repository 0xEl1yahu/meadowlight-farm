/**
 * Small SVG drawings for the robot screen: one icon per robot part (the header's part chips)
 * and the Looks tab's robot preview. Built with createElementNS; nothing is parsed.
 */
import type { RobotPartId } from '../../core/types';
import { paintHex } from './viewModel';

const SVG_NS = 'http://www.w3.org/2000/svg';
const OUTLINE = '#5a3d2b';

type Shape = readonly [tag: 'path' | 'circle' | 'rect', attrs: Readonly<Record<string, string>>];

/** Line drawings on a 24 × 24 grid, stroked in currentColor. */
const PART_SHAPES: Readonly<Record<RobotPartId, readonly Shape[]>> = {
  claw: [
    ['path', { d: 'M7 3v6a5 5 0 0 0 10 0V3' }],
    ['path', { d: 'M12 14v7' }],
    ['path', { d: 'M9 21h6' }],
  ],
  wateringHead: [
    ['path', { d: 'M5 9h9v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z' }],
    ['path', { d: 'M14 11l5-5' }],
    ['path', { d: 'M20 12c1 1.4 1.5 2.2 1.5 3a1.5 1.5 0 0 1-3 0c0-.8.5-1.6 1.5-3z' }],
  ],
  tiller: [
    ['path', { d: 'M4 5h16' }],
    ['path', { d: 'M7 5v11' }],
    ['path', { d: 'M12 5v14' }],
    ['path', { d: 'M17 5v11' }],
  ],
  seeder: [
    ['path', { d: 'M12 3c4 3.5 4 10 0 15c-4-5-4-11.5 0-15z' }],
    ['path', { d: 'M12 8v13' }],
  ],
  basket: [
    ['path', { d: 'M3 10h18l-2.5 9h-13z' }],
    ['path', { d: 'M8 10a4 4 0 0 1 8 0' }],
    ['path', { d: 'M9 13v3M15 13v3' }],
  ],
  antenna: [
    ['path', { d: 'M12 21V10' }],
    ['circle', { cx: '12', cy: '8', r: '2' }],
    ['path', { d: 'M7.5 4.5a6 6 0 0 0 0 7' }],
    ['path', { d: 'M16.5 4.5a6 6 0 0 1 0 7' }],
  ],
  sensorEye: [
    ['path', { d: 'M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z' }],
    ['circle', { cx: '12', cy: '12', r: '3' }],
  ],
  efficientCore: [
    ['circle', { cx: '12', cy: '12', r: '9' }],
    ['path', { d: 'M8.5 15.5c0-4.5 2.5-7 7-7c0 4.5-2.5 7-7 7z' }],
  ],
  quickCore: [
    ['circle', { cx: '12', cy: '12', r: '9' }],
    ['path', { d: 'M13 6l-4 7h4l-2 5 5-7h-4z' }],
  ],
};

function svgNode<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Readonly<Record<string, string>>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[K];
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}

/** A part's icon, decorative (the chip around it carries the label). */
export function createPartIcon(part: RobotPartId): SVGSVGElement {
  const svg = svgNode('svg', {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  });
  for (const [tag, attrs] of PART_SHAPES[part]) svg.append(svgNode(tag, attrs));
  return svg;
}

export interface RobotPreview {
  readonly element: SVGSVGElement;
  /** Fills the painted shell (head and body) with a ROBOT_PAINTS colour. */
  paint(color: number): void;
}

/** The Looks tab's little robot: head and body take the paint; trim, eyes and wheels keep theirs. */
export function createRobotPreview(): RobotPreview {
  const svg = svgNode('svg', { viewBox: '0 0 64 64', class: 'rs-robot-preview', role: 'img', 'aria-label': 'Paint preview' });
  const line = { stroke: OUTLINE, 'stroke-width': '2' };
  const head = svgNode('rect', { x: '18', y: '10', width: '28', height: '20', rx: '6', ...line });
  const body = svgNode('rect', { x: '14', y: '32', width: '36', height: '22', rx: '6', ...line });
  svg.append(
    svgNode('path', { d: 'M32 10V5', stroke: OUTLINE, 'stroke-width': '2.5', 'stroke-linecap': 'round' }),
    svgNode('circle', { cx: '32', cy: '4', r: '2.5', fill: '#ffd866', stroke: OUTLINE, 'stroke-width': '1.5' }),
    svgNode('circle', { cx: '21', cy: '56', r: '5', fill: '#5e6670', ...line }),
    svgNode('circle', { cx: '43', cy: '56', r: '5', fill: '#5e6670', ...line }),
    body,
    svgNode('rect', { x: '24', y: '38', width: '16', height: '8', rx: '2', fill: 'rgba(255, 255, 255, 0.45)' }),
    head,
    svgNode('rect', { x: '22', y: '15', width: '20', height: '9', rx: '4', fill: '#3d2f52' }),
    svgNode('circle', { cx: '27', cy: '19.5', r: '2', fill: '#7fd3ff' }),
    svgNode('circle', { cx: '37', cy: '19.5', r: '2', fill: '#7fd3ff' }),
  );
  const paint = (color: number): void => {
    const fill = paintHex(color);
    head.setAttribute('fill', fill);
    body.setAttribute('fill', fill);
  };
  return { element: svg, paint };
}
