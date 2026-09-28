export function dragTime(initialTime: number, deltaY: number, pixelsPerStep: number, minutesPerStep: number, fine: boolean, start: number, end: number) {
  const gain = fine ? 1 / 6 : 1;
  return Math.min(end, Math.max(start, initialTime - deltaY / pixelsPerStep * minutesPerStep * gain));
}

type MotionOptions = {
  time: number; start: number; end: number;
  requestFrame: (callback: (timestamp: number) => void) => number;
  cancelFrame: (id: number) => void;
  paint: (time: number) => void;
  publish: (time: number, final: boolean) => void;
};

/** Paint every frame; share time with the expensive plan at most 20 times/s. */
export function createTimeDrumMotion(options: MotionOptions) {
  let start = options.start;
  let end = options.end;
  const clamp = (value: number) => Math.min(end, Math.max(start, value));
  let displayed = clamp(options.time);
  let target = displayed;
  let dragging = false;
  let animated = false;
  let disposed = false;
  let frame: number | null = null;
  let lastFrame: number | null = null;
  let lastPublish = -Infinity;
  let lastPublished = displayed;
  const schedule = () => {
    if (frame === null && !disposed) frame = options.requestFrame(tick);
  };
  const tick = (timestamp: number) => {
    frame = null;
    const elapsed = lastFrame === null ? 16 : Math.max(0, timestamp - lastFrame);
    lastFrame = timestamp;
    if (animated) {
      displayed += (target - displayed) * (1 - Math.exp(-elapsed / 65));
      if (Math.abs(target - displayed) < 0.01) { displayed = target; animated = false; }
    } else displayed = target;
    options.paint(displayed);
    if ((animated || dragging) && timestamp - lastPublish >= 50 && displayed !== lastPublished) {
      lastPublish = timestamp; lastPublished = displayed;
      options.publish(displayed, false);
    }
    if (animated) schedule();
    else if (!dragging) { lastFrame = null; lastPublished = displayed; options.publish(displayed, true); }
  };
  return {
    getTime: () => displayed,
    getTarget: () => target,
    isMoving: () => dragging || frame !== null,
    begin() { dragging = true; animated = false; target = displayed; lastFrame = null; },
    set(value: number, smooth = false) { if (disposed) return; target = clamp(value); animated = smooth; schedule(); },
    finish() {
      if (disposed) return;
      if (frame !== null) options.cancelFrame(frame);
      frame = null; dragging = false; animated = false; lastFrame = null;
      displayed = target; lastPublished = displayed;
      options.paint(displayed); options.publish(displayed, true);
    },
    sync(value: number, from: number, to: number) {
      start = from; end = to;
      displayed = clamp(displayed); target = clamp(target);
      // A delayed parent render must not pull the pointer back to an older time.
      if (!dragging && frame === null) { displayed = clamp(value); target = displayed; lastPublished = displayed; }
      options.paint(displayed);
    },
    dispose() { disposed = true; if (frame !== null) options.cancelFrame(frame); frame = null; },
  };
}
