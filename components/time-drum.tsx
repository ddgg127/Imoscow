"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
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
  const speedRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef(time);
  const startRef = useRef(start);
  const endRef = useRef(end);
  const onTimeRef = useRef(onTime);
  const onPlayingRef = useRef(onPlaying);
  const onSpeedRef = useRef(onSpeed);
  const disabledRef = useRef(disabled);
  const speedValueRef = useRef(speed);
  const dragRef = useRef<{ y: number } | null>(null);
  const [speedOpen, setSpeedOpen] = useState(false);
  useEffect(() => {
    timeRef.current = time;
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

  const clamp = (value: number) => Math.min(endRef.current, Math.max(startRef.current, value));

  useEffect(() => {
    const el = lensRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (disabledRef.current) return;
      onPlayingRef.current(false);
      const gain = event.shiftKey ? FINE : 1;
      onTimeRef.current(clamp(timeRef.current + event.deltaY * WHEEL * gain));
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

  const offset = ((time - start) / STEP) * ITEM;

  return (
    <div className="time-drum" ref={hostRef} aria-label="Барабан времени смены">
      <button
        className="time-drum-play"
        type="button"
        disabled={disabled}
        aria-label={playing ? "Пауза симуляции" : "Продолжить симуляцию"}
        onClick={() => {
          if (!playing && time >= end - 1e-6) onTime(start);
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
        aria-valuenow={Math.round(time)}
        aria-valuetext={minutesLabel(time)}
        aria-label="Время смены"
        onPointerDown={event => {
          if (disabled) return;
          event.preventDefault();
          try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* synthetic pointer */ }
          dragRef.current = { y: event.clientY };
          onPlaying(false);
        }}
        onPointerMove={event => {
          if (!dragRef.current || disabledRef.current) return;
          const dy = event.clientY - dragRef.current.y;
          dragRef.current.y = event.clientY;
          const gain = event.shiftKey ? FINE : 1;
          onTimeRef.current(clamp(timeRef.current + dy / ITEM * STEP * gain));
        }}
        onPointerUp={() => { dragRef.current = null; }}
        onPointerCancel={() => { dragRef.current = null; }}
        onKeyDown={event => {
          if (disabled) return;
          if (event.key === "ArrowDown" || event.key === "PageDown") {
            event.preventDefault();
            onTime(clamp(time + (event.key === "PageDown" ? 60 : event.shiftKey ? 1 : 15)));
          }
          if (event.key === "ArrowUp" || event.key === "PageUp") {
            event.preventDefault();
            onTime(clamp(time - (event.key === "PageUp" ? 60 : event.shiftKey ? 1 : 15)));
          }
          if (event.key === "Home") { event.preventDefault(); onTime(start); }
          if (event.key === "End") { event.preventDefault(); onTime(end); }
          if (event.key === " ") {
            event.preventDefault();
            if (!playing && time >= end - 1e-6) onTime(start);
            onPlaying(!playing);
          }
        }}
      >
        <div className="time-drum-window" aria-hidden>
          <b>{minutesLabel(time)}</b>
        </div>
        <div className="time-drum-strip" style={{ transform: `translateY(${-offset}px)` }}>
          {ticks.map(tick => (
            <div key={tick} className={`time-drum-tick${tick % 60 === 0 ? " hour" : ""}`}>{minutesLabel(tick)}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
