export function dragTime(initialTime: number, deltaY: number, pixelsPerStep: number, minutesPerStep: number, fine: boolean, start: number, end: number) {
  const gain = fine ? 1 / 6 : 1;
  return Math.min(end, Math.max(start, initialTime - deltaY / pixelsPerStep * minutesPerStep * gain));
}
