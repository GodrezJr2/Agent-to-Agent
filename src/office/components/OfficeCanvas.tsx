"use client";

import { useEffect, useRef, useCallback } from "react";
import { startGameLoop } from "../engine/gameLoop";
import { renderFrame } from "../engine/renderer";
import { useOfficeStore } from "../engine/officeStore";

export function OfficeCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const characters = useOfficeStore((s) => s.characters);
  const layout = useOfficeStore((s) => s.layout);
  const update = useOfficeStore((s) => s.update);

  const handleResize = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    const ctx = canvas.getContext("2d");
    if (ctx) ctx.scale(dpr, dpr);
  }, []);

  useEffect(() => {
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [handleResize]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const stop = startGameLoop(canvas, {
      update,
      render: (ctx) => {
        const state = useOfficeStore.getState();
        const rect = canvas.getBoundingClientRect();
        renderFrame(ctx, rect.width, rect.height, state);
      },
    });

    return stop;
  }, [update]);

  return (
    <div ref={containerRef} className="w-full h-full relative bg-gray-900">
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        style={{ imageRendering: "pixelated" }}
      />
      {/* Agent count overlay */}
      <div className="absolute bottom-2 left-2 text-xs text-gray-500 bg-gray-900/80 px-2 py-1 rounded">
        {characters.size} agents
      </div>
    </div>
  );
}
