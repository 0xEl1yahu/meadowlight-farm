/**
 * Robot part drawings, shared by the robot screen's part chips and the inventory's part item
 * icons so the two always match. Plain data in the main chunk: the robot screen imports it
 * from here instead of carrying its own copy.
 */
import type { RobotPartId } from '../core/types';

/**
 * One line drawing per part on a 24 × 24 grid, as a single path's `d` (circles are two arcs),
 * stroked with round caps and joins and no fill.
 */
export const PART_PATHS: Readonly<Record<RobotPartId, string>> = {
  claw: 'M7 3v6a5 5 0 0 0 10 0V3M12 14v7M9 21h6',
  wateringHead: 'M5 9h9v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2zM14 11l5-5M20 12c1 1.4 1.5 2.2 1.5 3a1.5 1.5 0 0 1-3 0c0-.8.5-1.6 1.5-3z',
  tiller: 'M4 5h16M7 5v11M12 5v14M17 5v11',
  seeder: 'M12 3c4 3.5 4 10 0 15c-4-5-4-11.5 0-15zM12 8v13',
  basket: 'M3 10h18l-2.5 9h-13zM8 10a4 4 0 0 1 8 0M9 13v3M15 13v3',
  antenna: 'M12 21V10M10 8a2 2 0 0 0 4 0a2 2 0 0 0-4 0zM7.5 4.5a6 6 0 0 0 0 7M16.5 4.5a6 6 0 0 1 0 7',
  sensorEye: 'M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12zM9 12a3 3 0 0 0 6 0a3 3 0 0 0-6 0z',
  efficientCore: 'M3 12a9 9 0 0 0 18 0a9 9 0 0 0-18 0zM8.5 15.5c0-4.5 2.5-7 7-7c0 4.5-2.5 7-7 7z',
  quickCore: 'M3 12a9 9 0 0 0 18 0a9 9 0 0 0-18 0zM13 6l-4 7h4l-2 5 5-7h-4z',
};
