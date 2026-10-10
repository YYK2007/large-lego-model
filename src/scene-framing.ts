import { Vector3 } from 'three';

/** Perspective fit in the requested camera basis, including narrow viewports. */
export function frameDistance(points: Vector3[], target: Vector3, direction: Vector3, up: Vector3, fov: number, aspect: number, minimum = 0) {
  const backward = direction.clone().normalize();
  const right = up.clone().cross(backward).normalize();
  const vertical = backward.clone().cross(right);
  const verticalTangent = Math.tan(fov * Math.PI / 360);
  const horizontalTangent = verticalTangent * aspect;
  let distance = minimum;
  for (const point of points) {
    const relative = point.clone().sub(target);
    distance = Math.max(distance, relative.dot(backward) + 1.12 * Math.max(
      Math.abs(relative.dot(right)) / horizontalTangent,
      Math.abs(relative.dot(vertical)) / verticalTangent,
    ));
  }
  return distance;
}
