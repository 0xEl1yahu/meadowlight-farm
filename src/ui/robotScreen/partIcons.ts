/**
 * Small SVG drawings for the robot screen: one icon per robot part (the header's part chips)
 * and the Looks tab's robot preview. Built with createElementNS; nothing is parsed.
 */
import type { RobotPartId } from '../../core/types';
import { PART_PATHS } from '../partShapes';
import { paintHex } from './viewModel';

const SVG_NS = 'http://www.w3.org/2000/svg';
const OUTLINE = '#5a3d2b';

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
  svg.append(svgNode('path', { d: PART_PATHS[part] }));
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
