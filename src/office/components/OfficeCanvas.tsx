"use client";

import { useEffect, useRef, useCallback } from "react";
import { startGameLoop } from "../engine/gameLoop";
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
        const w = rect.width;
        const h = rect.height;

        // Background
        ctx.fillStyle = "#1a1a2e";
        ctx.fillRect(0, 0, w, h);

        // Grid floor
        ctx.strokeStyle = "rgba(255,255,255,0.03)";
        const tileSize = 32;
        for (let x = 0; x < w; x += tileSize) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
        for (let y = 0; y < h; y += tileSize) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }

        // Draw characters as pixel sprites
        const chars = Array.from(state.characters.values());
        chars.forEach((char, i) => {
          const cx = 100 + i * 64;
          const cy = h / 2 - 16;

          // Body
          ctx.fillStyle = char.active ? "#4ade80" : "#60a5fa";
          ctx.fillRect(cx, cy, 16, 24);

          // Head
          ctx.fillStyle = "#fbbf24";
          ctx.fillRect(cx + 4, cy - 8, 8, 8);

          // Eyes
          ctx.fillStyle = "#000";
          ctx.fillRect(cx + 6, cy - 5, 2, 2);
          ctx.fillRect(cx + 12, cy - 5, 2, 2);

          // Name label
          ctx.fillStyle = "#fff";
          ctx.font = "8px monospace";
          ctx.textAlign = "center";
          ctx.fillText(char.name, cx + 8, cy + 36);

          // Thinking indicator
          if (char.active) {
            const t = Date.now() / 500;
            ctx.fillStyle = "#fff";
            ctx.font = `${10 + Math.sin(t) * 2}px monospace`;
            ctx.fillText("...", cx + 8, cy - 14);
          }
        });

        // Empty state
        if (chars.length === 0) {
          ctx.fillStyle = "rgba(255,255,255,0.1)";
          ctx.font = "14px monospace";
          ctx.textAlign = "center";
          ctx.fillText("No agents in this office", w / 2, h / 2 - 10);
          ctx.fillText("Click '+ Add Agent' to get started", w / 2, h / 2 + 12);
        }
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
