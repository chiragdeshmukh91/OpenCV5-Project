import type { Building, Route, Vec2 } from '../types';

/**
 * Map headings use the backend convention: degrees counter-clockwise from east (+x), north = 90.
 * Returns a unit vector in building (x east, y north) coordinates.
 */
export function headingVec(deg: number): Vec2 {
  const r = (deg * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r)];
}

/** Building (x east, y north) -> three.js ground plane (x, z) with north = -z. */
export function toThree([x, y]: Vec2, cx = 0, cy = 0): [number, number] {
  return [x - cx, -(y - cy)];
}

export function centroidOf(polygon: Vec2[]): Vec2 {
  const n = polygon.length || 1;
  return [polygon.reduce((s, p) => s + p[0], 0) / n, polygon.reduce((s, p) => s + p[1], 0) / n];
}

function findDoor(b: Building, a: string, c: string) {
  return b.doors.find((d) => (d.a === a && d.b === c) || (d.a === c && d.b === a));
}

/**
 * Polyline for an evacuation route: start-zone centroid, then for every hop the door between
 * consecutive zones followed by the next zone's centroid (corridors are long, so their centroid is
 * replaced by the door positions on either side), and finally the exit position.
 */
export function routePolyline(route: Pick<Route, 'path'>, b: Building): Vec2[] {
  const zones = new Map(b.zones.map((z) => [z.id, z]));
  const exits = new Map(b.exits.map((e) => [e.id, e]));
  const pts: Vec2[] = [];
  const push = (p: Vec2 | undefined) => {
    if (!p) return;
    const last = pts[pts.length - 1];
    if (last && Math.abs(last[0] - p[0]) < 1e-6 && Math.abs(last[1] - p[1]) < 1e-6) return;
    pts.push([p[0], p[1]]);
  };
  const path = route.path ?? [];
  const entryPoint = (i: number): Vec2 | undefined => {
    // Where the route enters node i from node i-1 (door or exit position).
    if (i <= 0) return undefined;
    const e = exits.get(path[i]);
    if (e) return e.position;
    return findDoor(b, path[i - 1], path[i])?.position;
  };
  path.forEach((node, i) => {
    const zone = zones.get(node);
    const exit = exits.get(node);
    if (i === 0) {
      push(zone?.centroid ?? exit?.position);
      return;
    }
    if (exit) {
      push(exit.position);
      return;
    }
    const enter = entryPoint(i);
    push(enter);
    if (!zone) return;
    const isLast = i === path.length - 1;
    const leave = isLast ? undefined : entryPoint(i + 1);
    if (zone.kind === 'corridor' && enter && leave) {
      // Follow the corridor centreline between the entry and exit doors.
      const xs = zone.polygon.map((p) => p[0]);
      const ys = zone.polygon.map((p) => p[1]);
      const w = Math.max(...xs) - Math.min(...xs);
      const h = Math.max(...ys) - Math.min(...ys);
      const [cx, cy] = zone.centroid;
      if (w >= h) {
        push([enter[0], cy]);
        push([leave[0], cy]);
      } else {
        push([cx, enter[1]]);
        push([cx, leave[1]]);
      }
    } else if (isLast || !leave) {
      push(zone.centroid);
    }
  });
  return pts;
}

export function polylineLength(pts: Vec2[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return s;
}

/** Image-space direction (deg CCW from image right, up = 90, as in the vision pipeline) -> canvas dx, dy. */
export function imageDirToCanvas(deg: number): Vec2 {
  const r = (deg * Math.PI) / 180;
  return [Math.cos(r), -Math.sin(r)];
}
