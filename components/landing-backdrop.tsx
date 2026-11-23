"use client";

import { useEffect, useRef } from "react";

type Vec = [number, number, number];

const D = Math.PI / 180;
const PAD = 100;
const TILT = 24 * D;
const CT = Math.cos(TILT);
const ST = Math.sin(TILT);
// Brightness steps for the dots, so each step is one fill instead of thousands.
const LEVELS = 20;

function vec(lat: number, lon: number): Vec {
  const f = lat * D;
  const l = lon * D;
  return [Math.cos(f) * Math.cos(l), Math.sin(f), Math.cos(f) * Math.sin(l)];
}

/**
 * Draws the dotted globe once. It is deliberately a still image: it is only
 * redrawn when the canvas is resized or the theme changes, so it costs nothing
 * while the page scrolls.
 */
function startGlobe(cv: HTMLCanvasElement) {
  const ctx = cv.getContext("2d");
  if (!ctx) return () => {};

  const dots: Vec[] = [];
  for (let lat = -84; lat <= 84; lat += 3) {
    const n = Math.max(1, Math.round(120 * Math.cos(lat * D)));
    for (let i = 0; i < n; i++) dots.push(vec(lat, (i / n) * 360 + (lat % 2 ? 1.5 : 0)));
  }
  const buckets: number[][] = Array.from({ length: LEVELS }, () => []);
  let raf = 0;

  function draw() {
    raf = 0;
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    cv.width = Math.max(1, Math.round(W * dpr));
    cv.height = Math.max(1, Math.round(H * dpr));
    const R = Math.max(2.2 * (window.innerWidth || W), 2400) / 2;
    const cx = W / 2;
    const cy = PAD + R;
    const dark = document.documentElement.classList.contains("dark");

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = dark ? "#c8d4ff" : "#4c5a94";
    for (const bucket of buckets) bucket.length = 0;
    for (const p of dots) {
      const y3 = p[1] * CT - p[2] * ST;
      const z = p[1] * ST + p[2] * CT;
      const x = cx + R * p[0];
      const y = cy - R * y3;
      if (z <= 0 || y < 0 || y > H || x < -4 || x > W + 4) continue;
      const fade = Math.max(0, Math.min(1, (H - y) / (H * 0.5)));
      const level = Math.round(Math.min(1, z * 2.5) * fade * LEVELS);
      if (level > 0) buckets[level - 1].push(x, y);
    }
    for (let level = 0; level < LEVELS; level++) {
      const bucket = buckets[level];
      if (!bucket.length) continue;
      ctx.globalAlpha = ((dark ? 0.3 : 0.26) * (level + 1)) / LEVELS;
      ctx.beginPath();
      for (let i = 0; i < bucket.length; i += 2) ctx.rect(bucket[i] - 0.8, bucket[i + 1] - 0.8, 1.6, 1.6);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function schedule() {
    if (!raf) raf = requestAnimationFrame(draw);
  }

  const resize = new ResizeObserver(schedule);
  resize.observe(cv);
  const theme = new MutationObserver(schedule);
  theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  schedule();

  return () => {
    if (raf) cancelAnimationFrame(raf);
    resize.disconnect();
    theme.disconnect();
  };
}

export function LandingBackdrop() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvas.current) return;
    return startGlobe(canvas.current);
  }, []);

  return (
    <div className="backdrop" aria-hidden>
      <div className="planet" />
      <canvas ref={canvas} className="globe" />
    </div>
  );
}
