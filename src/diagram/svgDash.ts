type Point = [number, number];

/** Visible SVG dash runs as editable geometry. Carry the pattern across
 * corners, including a closing edge; CAD readers need no custom linetype. */
export function dashedRuns(points: Point[], input: number[]): Point[][] {
  const pattern = input.length % 2 ? [...input, ...input] : input;
  if (!pattern.length || pattern.some((v) => !Number.isFinite(v) || v < 0) || !pattern.some((v) => v >= 1e-9)) return [points];
  const runs: Point[][] = [];
  let index = 0, remaining = pattern[0], run: Point[] | undefined;
  const advance = () => {
    index = (index + 1) % pattern.length;
    remaining = pattern[index];
    if (index % 2) run = undefined;
  };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < 1e-9) continue;
    const at = (d: number): Point => [a[0] + (b[0] - a[0]) * d / length, a[1] + (b[1] - a[1]) * d / length];
    let distance = 0;
    while (distance < length - 1e-9) {
      while (remaining < 1e-9) advance();
      const step = Math.min(remaining, length - distance);
      if (index % 2 === 0) {
        if (!run) { run = [at(distance)]; runs.push(run); }
        run.push(at(distance + step));
      }
      distance += step;
      remaining -= step;
      if (remaining < 1e-9) advance();
    }
  }
  return runs;
}
