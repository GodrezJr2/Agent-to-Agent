"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { startGameLoop } from "../engine/gameLoop";
import { useOfficeStore } from "../engine/officeStore";

const TILE = 32;
const CHAR_W = 16;
const CHAR_H = 24;
const SPRITE_URLS = [
  "/assets/characters/char_0.png",
  "/assets/characters/char_1.png",
  "/assets/characters/char_2.png",
  "/assets/characters/char_3.png",
  "/assets/characters/char_4.png",
  "/assets/characters/char_5.png",
];

interface AgentHitArea { id: string; x: number; y: number; w: number; h: number; }

export function OfficeCanvas({ onAgentClick }: { onAgentClick?: (agentId: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const characters = useOfficeStore((s) => s.characters);
  const update = useOfficeStore((s) => s.update);
  const [sprites, setSprites] = useState<HTMLImageElement[]>([]);
  const [loaded, setLoaded] = useState(false);
  const hitAreasRef = useRef<AgentHitArea[]>([]);
  const [hoveredAgent, setHoveredAgent] = useState<string | null>(null);

  // Load character sprites
  useEffect(() => {
    const imgs = SPRITE_URLS.map((url) => {
      const img = new Image();
      img.src = url;
      return img;
    });
    Promise.all(imgs.map((img) => new Promise<void>((resolve) => { img.onload = () => resolve(); img.onerror = () => resolve(); })))
      .then(() => { setSprites(imgs); setLoaded(true); });
  }, []);

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

        // Dark background
        ctx.fillStyle = "#0f0f1a";
        ctx.fillRect(0, 0, w, h);

        // Wall border
        const ox = 80;
        const oy = 40;
        const cols = 10;
        const rows = 6;
        const gridW = cols * TILE;
        const gridH = rows * TILE;
        const gx = ox;
        const gy = oy;

        // Floor
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const bright = ((r + c) % 2 === 0) ? "#1a1a2e" : "#16162a";
            ctx.fillStyle = bright;
            ctx.fillRect(gx + c * TILE, gy + r * TILE, TILE, TILE);
          }
        }

        // Grid lines
        ctx.strokeStyle = "rgba(255,255,255,0.04)";
        ctx.lineWidth = 0.5;
        for (let r = 0; r <= rows; r++) {
          ctx.beginPath();
          ctx.moveTo(gx, gy + r * TILE);
          ctx.lineTo(gx + gridW, gy + r * TILE);
          ctx.stroke();
        }
        for (let c = 0; c <= cols; c++) {
          ctx.beginPath();
          ctx.moveTo(gx + c * TILE, gy);
          ctx.lineTo(gx + c * TILE, gy + gridH);
          ctx.stroke();
        }

        // Walls (top and side borders, 2-tile thick)
        ctx.fillStyle = "#2a2a3e";
        // Top wall
        ctx.fillRect(gx - TILE, gy - TILE * 2, gridW + TILE * 2, TILE * 2);
        // Bottom wall
        ctx.fillRect(gx - TILE, gy + gridH, gridW + TILE * 2, TILE);
        // Left wall
        ctx.fillRect(gx - TILE * 2, gy - TILE, TILE * 2, gridH + TILE);
        // Right wall
        ctx.fillRect(gx + gridW, gy - TILE, TILE * 2, gridH + TILE);

        // Wall detail lines
        ctx.strokeStyle = "rgba(255,255,255,0.06)";
        ctx.lineWidth = 0.5;
        ctx.strokeRect(gx - TILE * 2, gy - TILE * 2, gridW + TILE * 4, gridH + TILE * 3);

        // Desk positions
        const deskPositions = [
          { x: gx + TILE * 2, y: gy + TILE },
          { x: gx + TILE * 5, y: gy + TILE },
          { x: gx + TILE * 8, y: gy + TILE },
          { x: gx + TILE * 2, y: gy + TILE * 3 },
          { x: gx + TILE * 5, y: gy + TILE * 3 },
          { x: gx + TILE * 8, y: gy + TILE * 3 },
        ];

        // Draw characters at desk positions
        const chars = Array.from(state.characters.values());
        const areas: AgentHitArea[] = [];
        chars.forEach((char, i) => {
          const pos = deskPositions[i % deskPositions.length];
          if (!pos) return;
          const cx = pos.x + 8;
          const cy = pos.y - 2;

          // Track hit area (character + name label)
          areas.push({ id: char.id, x: cx - 10, y: cy - 12, w: 20, h: CHAR_H + 30 });

          // Highlight on hover
          const isHovered = hoveredAgent === char.id;
          if (isHovered) {
            ctx.strokeStyle = "rgba(74,222,128,0.6)";
            ctx.lineWidth = 1;
            ctx.strokeRect(cx - 12, cy - 14, 24, CHAR_H + 32);
          }

          // Desk
          ctx.fillStyle = "#3a3028";
          ctx.fillRect(pos.x - 4, pos.y + CHAR_H, TILE + 8, 4);
          ctx.fillStyle = "#4a4038";
          ctx.fillRect(pos.x - 2, pos.y + CHAR_H - 2, TILE + 4, 2);

          // Legs
          ctx.fillStyle = "#2a2018";
          ctx.fillRect(pos.x, pos.y + CHAR_H + 4, 2, 6);
          ctx.fillRect(pos.x + TILE, pos.y + CHAR_H + 4, 2, 6);

          // Chair
          ctx.fillStyle = "#5a5048";
          ctx.fillRect(cx - 6, cy + CHAR_H + 4, 12, 3);

          // Draw character sprite or fallback
          const spriteIdx = i % sprites.length;
          const sprite = sprites[spriteIdx];

          if (sprite && sprite.complete && sprite.naturalWidth > 0) {
            // Draw sprite pixelated
            ctx.imageSmoothingEnabled = false;
            // Idle animation: slight bob
            const bob = Math.sin(Date.now() / 800 + i) * 1;
            ctx.drawImage(sprite, cx - 8, cy + bob, CHAR_W, CHAR_H);
            ctx.imageSmoothingEnabled = true;
          } else {
            // Fallback: colored character shape
            const colors = ["#e74c3c", "#3498db", "#2ecc71", "#f39c12", "#9b59b6", "#1abc9c"];
            ctx.fillStyle = colors[i % colors.length];
            ctx.fillRect(cx - 6, cy, 12, 20);
            ctx.fillStyle = "#fff";
            ctx.fillRect(cx - 3, cy + 4, 3, 3);
            ctx.fillRect(cx + 1, cy + 4, 3, 3);
          }

          // Name label
          ctx.fillStyle = "#fff";
          ctx.font = "7px monospace";
          ctx.textAlign = "center";
          ctx.fillText(char.name, cx, cy + CHAR_H + 14);

          // Active indicator
          if (char.active) {
            const t = Date.now() / 300;
            ctx.fillStyle = `rgba(74, 222, 128, ${0.5 + Math.sin(t) * 0.3})`;
            ctx.font = "8px monospace";
            ctx.fillText("●", cx, cy - 6);
          }
        });

        hitAreasRef.current = areas;
        if (chars.length === 0) {
          ctx.fillStyle = "rgba(255,255,255,0.15)";
          ctx.font = "13px monospace";
          ctx.textAlign = "center";
          const midX = gx + gridW / 2;
          const midY = gy + gridH / 2;
          ctx.fillText("No agents in this office", midX, midY - 8);
          ctx.font = "10px monospace";
          ctx.fillStyle = "rgba(255,255,255,0.08)";
          ctx.fillText("Click '+ Add Agent' to get started", midX, midY + 10);
        }
      },
    });

    return stop;
  }, [update, sprites, loaded, hoveredAgent]);

  // Hover detection for highlight
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      let found: string | null = null;
      for (const area of hitAreasRef.current) {
        if (x >= area.x && x <= area.x + area.w && y >= area.y && y <= area.y + area.h) {
          found = area.id; break;
        }
      }
      setHoveredAgent(found);
      canvas.style.cursor = found ? "pointer" : "default";
    };

    canvas.addEventListener("mousemove", handleMove);
    return () => {
      canvas.removeEventListener("mousemove", handleMove);
    };
  }, [onAgentClick]);

  return (
    <div ref={containerRef} className="w-full h-full relative bg-gray-900">
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        style={{ imageRendering: "pixelated" }}
      />
      <div className="absolute bottom-2 left-2 right-2 flex items-center gap-1.5 flex-wrap">
        <span className="text-xs text-gray-500 bg-gray-900/80 px-2 py-1 rounded">{characters.size} agents</span>
        {Array.from(characters.values()).map((char) => (
          <button
            key={char.id}
            onClick={(e) => { e.stopPropagation(); onAgentClick?.(char.id); }}
            className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-1 rounded cursor-pointer transition-colors"
          >
            {char.name}
          </button>
        ))}
      </div>
    </div>
  );
}
