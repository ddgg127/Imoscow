"use client";

import { startTransition, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { createTimeDrumMotion, dragTime } from "@/lib/time-drum-motion";
import { minutesLabel } from "@/lib/vrptw";

const STEP = 30;
const ITEM = 32;
const WHEEL = 0.32;
const FINE = 1 / 6;
export const SIM_SPEEDS = [1, 2, 5, 10, 15, 20, 30, 50, 100] as const;

function minutesWord(count: number) {
  const abs = Math.abs(count) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return "минут";
  if (last === 1) return "минута";
  if (last >= 2 && last <= 4) return "минуты";
  return "минут";
}

type DrumProps = {
  start: number;
  end: number;
  time: number;
  playing: boolean;
  speed: number;
  onTime: (time: number) => void;
  onPlaying: (playing: boolean) => void;
  onSpeed: (speed: number) => void;
  disabled?: boolean;
};

export function TimeDrum({ start, end, time, playing, speed, onTime, onPlaying, onSpeed, disabled }: DrumProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const lensRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLElement>(null);
  const speedRef = useRef<HTMLDivElement>(null);
  const [initialTime] = useState(time);
  const startRef = useRef(start);
  const endRef = useRef(end);
  const onTimeRef = useRef(onTime);
  const onPlayingRef = useRef(onPlaying);
  const onSpeedRef = useRef(onSpeed);
  const disabledRef = useRef(disabled);
  const speedValueRef = useRef(speed);
  const dragRef = useRef<{ y: number; time: number; fine: boolean } | null>(null);
  const motionRef = useRef<ReturnType<typeof createTimeDrumMotion> | null>(null);
  const [speedOpen, setSpeedOpen] = useState(false);
  useLayoutEffect(() => {
    startRef.current = start;
    endRef.current = end;
    onTimeRef.current = onTime;
    onPlayingRef.current = onPlaying;
    onSpeedRef.current = onSpeed;
    disabledRef.current = disabled;
    speedValueRef.current = speed;
  }, [time, start, end, onTime, onPlaying, onSpeed, disabled, speed]);

  const ticks = useMemo(() => {
    const list: number[] = [];
    const first = Math.floor(start / STEP) * STEP;
    for (let value = first; value <= end + 1e-6; value += STEP) list.push(value);
    return list;
  }, [start, end]);

  useLayoutEffect(() => {
    const motion = createTimeDrumMotion({ time: initialTime, start: startRef.current, end: endRef.current,
      requestFrame: callback => requestAnimationFrame(callback), cancelFrame: id => cancelAnimationFrame(id),
      paint: value => {
        const label = minutesLabel(value);
        if (stripRef.current) stripRef.current.style.transform = `translate3d(0, ${-(value - Math.floor(startRef.current / STEP) * STEP) / STEP * ITEM}px, 0)`;
        if (labelRef.current) labelRef.current.textContent = label;
        if (lensRef.current) {
          lensRef.current.setAttribute("aria-valuenow", String(Math.round(value)));
          lensRef.current.setAttribute("aria-valuetext", label);
        }
      },
      publish: (value, final) => {
        if (final) onTimeRef.current(value);
        else startTransition(() => onTimeRef.current(value));
      },
    });
    motionRef.current = motion;
    return () => { motion.dispose(); motionRef.current = null; };
  }, [initialTime]);
  useLayoutEffect(() => {
    motionRef.current?.sync(time, start, end);
    if (disabled && motionRef.current?.isMoving()) { dragRef.current = null; motionRef.current.finish(); }
  }, [time, start, end, disabled]);

  useEffect(() => {
    const el = lensRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (disabledRef.current) return;
      onPlayingRef.current(false);
      const gain = event.shiftKey ? FINE : 1;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? el.clientHeight : 1);
      const motion = motionRef.current;
      if (motion) motion.set(motion.getTarget() + delta * WHEEL * gain, true);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    if (!speedOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (speedRef.current && !speedRef.current.contains(event.target as Node)) setSpeedOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setSpeedOpen(false); };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [speedOpen]);

  useEffect(() => {
    const el = speedRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (disabledRef.current) return;
      const index = SIM_SPEEDS.indexOf(speedValueRef.current as typeof SIM_SPEEDS[number]);
      const current = index < 0 ? 0 : index;
      const next = SIM_SPEEDS[Math.min(SIM_SPEEDS.length - 1, Math.max(0, current + (event.deltaY > 0 ? 1 : -1)))];
      if (next) onSpeedRef.current(next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const offset = ((initialTime - Math.floor(start / STEP) * STEP) / STEP) * ITEM;

  return (
    <div className="time-drum" ref={hostRef} aria-label="Время просмотра">
      <span className="time-drum-caption">Время<br />просмотра</span>
      <button
        className="time-drum-play"
        type="button"
        disabled={disabled}
        aria-label={playing ? "Пауза симуляции" : "Продолжить симуляцию"}
        onClick={() => {
          const motion = motionRef.current;
          if (motion?.isMoving()) motion.finish();
          if (!playing && (motion?.getTime() ?? time) >= end - 1e-6) onTime(start);
          onPlaying(!playing);
        }}
      >
        {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
      </button>
      <div className="time-drum-speed" ref={speedRef}>
        <button
          className="time-drum-speed-btn"
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={speedOpen}
          aria-label={`Скорость симуляции ×${speed}. 1 секунда экрана = ${speed} ${minutesWord(speed)} смены`}
          title={`1 с экрана = ${speed} ${minutesWord(speed)} смены`}
          onClick={() => setSpeedOpen(open => !open)}
        >
          ×{speed}<small>мин/с</small>
        </button>
        {speedOpen && (
          <div className="time-drum-speed-menu" role="listbox" aria-label="Скорость симуляции">
            {SIM_SPEEDS.map(value => (
              <button
                key={value}
                type="button"
                role="option"
                aria-selected={value === speed}
                className={value === speed ? "active" : ""}
                title={`1 с экрана = ${value} ${minutesWord(value)} смены`}
                onClick={() => { onSpeed(value); setSpeedOpen(false); }}
              >
                ×{value}
              </button>
            ))}
          </div>
        )}
      </div>
      <div
        className="time-drum-lens"
        ref={lensRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-valuemin={start}
        aria-valuemax={end}
        aria-valuenow={Math.round(initialTime)}
        aria-valuetext={minutesLabel(initialTime)}
        aria-label="Время просмотра"
        aria-disabled={disabled}
        onPointerDown={event => {
          if (disabled) return;
          event.preventDefault();
          try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* synthetic pointer */ }
          motionRef.current?.begin();
          dragRef.current = { y: event.clientY, time: motionRef.current?.getTime() ?? time, fine: event.shiftKey };
          onPlaying(false);
        }}
        onPointerMove={event => {
          if (!dragRef.current || disabledRef.current) return;
          if (event.shiftKey !== dragRef.current.fine) dragRef.current = { y: event.clientY, time: motionRef.current?.getTime() ?? time, fine: event.shiftKey };
          const dy = event.clientY - dragRef.current.y;
          motionRef.current?.set(dragTime(dragRef.current.time, dy, ITEM, STEP, event.shiftKey, startRef.current, endRef.current));
        }}
        onPointerUp={() => { if (dragRef.current) motionRef.current?.finish(); dragRef.current = null; }}
        onPointerCancel={() => { if (dragRef.current) motionRef.current?.finish(); dragRef.current = null; }}
        onLostPointerCapture={() => { if (dragRef.current) motionRef.current?.finish(); dragRef.current = null; }}
        onKeyDown={event => {
          if (disabled) return;
          if (event.key === "ArrowDown" || event.key === "PageDown") {
            event.preventDefault();
            onPlaying(false);
            const motion = motionRef.current;
            if (motion) motion.set(motion.getTarget() + (event.key === "PageDown" ? 60 : event.shiftKey ? 1 : 15), true);
          }
          if (event.key === "ArrowUp" || event.key === "PageUp") {
            event.preventDefault();
            onPlaying(false);
            const motion = motionRef.current;
            if (motion) motion.set(motion.getTarget() - (event.key === "PageUp" ? 60 : event.shiftKey ? 1 : 15), true);
          }
          if (event.key === "Home") { event.preventDefault(); onPlaying(false); motionRef.current?.set(start); }
          if (event.key === "End") { event.preventDefault(); onPlaying(false); motionRef.current?.set(end); }
          if (event.key === " ") {
            event.preventDefault();
            const motion = motionRef.current;
            if (motion?.isMoving()) motion.finish();
            if (!playing && (motion?.getTime() ?? time) >= end - 1e-6) onTime(start);
            onPlaying(!playing);
          }
        }}
      >
        <div className="time-drum-window" aria-hidden>
          <b ref={labelRef}>{minutesLabel(initialTime)}</b>
        </div>
        <div ref={stripRef} className="time-drum-strip" style={{ transform: `translate3d(0, ${-offset}px, 0)`, willChange: "transform" }}>
          {ticks.map(tick => (
            <div key={tick} className={`time-drum-tick${tick % 60 === 0 ? " hour" : ""}`}>{minutesLabel(tick)}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
