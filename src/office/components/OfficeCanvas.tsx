"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { startGameLoop } from "../engine/gameLoop";
import { useOfficeStore } from "../engine/officeStore";

const TILE = 16; // Match Pixel Agents: 16px tiles
const CHAR_W = 16;
const CHAR_H = 24;
const DEFAULT_COLS = 20;
const DEFAULT_ROWS = 11;

const CHAR_URLS = Array.from({ length: 6 }, (_, i) => `/assets/characters/char_${i}.png`);
const FLOOR_URLS = Array.from({ length: 9 }, (_, i) => `/assets/floors/floor_${i}.png`);

const FURNITURE_KEYS = ["desk", "chair", "plant", "pc", "coffee"] as const;
const FURNITURE_URLS: Record<string, string> = {
  desk: "/assets/furniture/DESK/DESK_FRONT.png",
  chair: "/assets/furniture/WOODEN_CHAIR/WOODEN_CHAIR_FRONT.png",
  plant: "/assets/furniture/PLANT/PLANT.png",
  pc: "/assets/furniture/PC/PC_FRONT_OFF.png",
  coffee: "/assets/furniture/COFFEE/COFFEE.png",
};

function loadImage(url: string): Promise<HTMLImageElement> { return new Promise(r => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(i); i.src = url; }); }

export function OfficeCanvas({ onAgentClick }: { onAgentClick?: (agentId: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const characters = useOfficeStore((s) => s.characters);
  const update = useOfficeStore((s) => s.update);
  const [sprites, setSprites] = useState<HTMLImageElement[]>([]);
  const [floorTiles, setFloorTiles] = useState<HTMLImageElement[]>([]);
  const [furniture, setFurniture] = useState<Record<string, HTMLImageElement>>({});
  const [loaded, setLoaded] = useState(false);
  const [layout, setLayout] = useState<any>(null);

  useEffect(() => {
    Promise.all([
      Promise.all(CHAR_URLS.map(loadImage)).then(setSprites),
      Promise.all(FLOOR_URLS.map(loadImage)).then(setFloorTiles),
      Promise.all(Object.entries(FURNITURE_URLS).map(async ([k, u]) => [k, await loadImage(u)] as const))
        .then(p => setFurniture(Object.fromEntries(p))),
      fetch("/assets/default-layout.json").then(r => r.json()).then(setLayout).catch(() => {}),
    ]).then(() => setLoaded(true));
  }, []);

  const handleResize = useCallback(() => {
    const c = canvasRef.current;
    const p = containerRef.current;
    if (!c || !p) return;
    const rect = p.getBoundingClientRect();
    c.width = rect.width;
    c.height = rect.height;
    c.style.width = `${rect.width}px`;
    c.style.height = `${rect.height}px`;
  }, []);

  useEffect(() => { handleResize(); window.addEventListener("resize", handleResize); return () => window.removeEventListener("resize", handleResize); }, [handleResize]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Zoom to make office fill viewport (like Pixel Agents: ZOOM_DEFAULT_DPR_FACTOR = 2)
    const dpr = window.devicePixelRatio || 1;
    const zoom = dpr * 2;

    const cols = layout?.cols || DEFAULT_COLS;
    const rows = layout?.rows || DEFAULT_ROWS;
    const officeW = cols * TILE + TILE * 4; // + wall borders
    const officeH = rows * TILE + TILE * 4;

    const stop = startGameLoop(canvas, {
      update,
      render: (ctx) => {
        const state = useOfficeStore.getState();
        const rect = canvas.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;

        ctx.save();
        ctx.scale(zoom, zoom);

        // Center the office
        const offsetX = (w / zoom - officeW) / 2;
        const offsetY = (h / zoom - officeH) / 2;
        const gx = offsetX + TILE * 2;
        const gy = offsetY + TILE * 2;

        // Background
        ctx.fillStyle = "#0d0d1a";
        ctx.fillRect(0, 0, w / zoom, h / zoom);

        // Floor tiles
        const floorImg = floorTiles[0];
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const x = gx + c * TILE;
            const y = gy + r * TILE;
            if (floorImg?.complete && floorImg.naturalWidth > 0) {
              ctx.imageSmoothingEnabled = false;
              ctx.drawImage(floorImg, x, y, TILE, TILE);
            } else {
              ctx.fillStyle = ((r + c) % 2 === 0) ? "#1a1a2e" : "#151528";
              ctx.fillRect(x, y, TILE, TILE);
            }
          }
        }

        // Wall border (2-tile thick)
        const wallColors = ["#2e2e42", "#28283c"];
        const drawWall = (sx: number, sy: number, sw: number, sh: number) => {
          for (let r = 0; r < sh; r++) {
            for (let c = 0; c < sw; c++) {
              ctx.fillStyle = wallColors[(r + c) % 2];
              ctx.fillRect(sx + c * TILE, sy + r * TILE, TILE, TILE);
            }
          }
        };
        // Top
        drawWall(gx - TILE * 2, gy - TILE * 2, cols + 4, 2);
        // Bottom
        drawWall(gx - TILE * 2, gy + rows * TILE, cols + 4, 1);
        // Left
        drawWall(gx - TILE * 2, gy - TILE * 2, 2, rows + 3);
        // Right
        drawWall(gx + cols * TILE, gy - TILE * 2, 2, rows + 3);

        // Wall edge highlight
        ctx.strokeStyle = "rgba(255,255,255,0.06)";
        ctx.lineWidth = 0.5;
        ctx.strokeRect(gx - TILE * 2, gy - TILE * 2, cols * TILE + TILE * 4, rows * TILE + TILE * 3);

        // Agent desk positions (spread across the office)
        const charCount = Math.max(1, state.characters.size);
        const perRow = Math.min(4, Math.ceil(cols / 5));
        const startCol = Math.floor((cols - perRow * 5 + 5) / 2);

        const chars = Array.from(state.characters.values());
        chars.forEach((char, i) => {
          const row = Math.floor(i / perRow) * 3;
          const col = startCol + (i % perRow) * 5;
          if (row >= rows - 2) return;

          const cx = gx + col * TILE + TILE / 2;
          const cy = gy + (row + 1) * TILE + TILE / 2;

          const deskImg = furniture.desk;
          const chairImg = furniture.chair;
          const pcImg = furniture.pc;
          const plantImg = furniture.plant;

          // Desk
          if (deskImg?.complete && deskImg.naturalWidth > 0) {
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(deskImg, cx - TILE, cy + 4, TILE * 2, TILE);
          } else {
            ctx.fillStyle = "#3a3028";
            ctx.fillRect(cx - TILE, cy + 4, TILE * 2, TILE);
          }

          // PC
          if (pcImg?.complete && pcImg.naturalWidth > 0 && i % 2 === 0) {
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(pcImg, cx + 2, cy - 4, 16, 12);
          }

          // Chair
          if (chairImg?.complete && chairImg.naturalWidth > 0) {
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(chairImg, cx - CHAR_W / 2, cy + 12, CHAR_W, 8);
          }

          // Character sprite
          const spriteIdx = i % sprites.length;
          const sprite = sprites[spriteIdx];
          const bob = Math.sin(Date.now() / 800 + i) * 1;
          if (sprite?.complete && sprite.naturalWidth > 0) {
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(sprite, cx - CHAR_W / 2, cy - CHAR_H + bob + 4, CHAR_W, CHAR_H);
          } else {
            ctx.fillStyle = ["#e74c3c", "#3498db", "#2ecc71", "#f39c12", "#9b59b6", "#1abc9c"][i % 6];
            ctx.fillRect(cx - 6, cy - CHAR_H + 4, 12, 20);
          }

          // Name
          ctx.imageSmoothingEnabled = true;
          ctx.fillStyle = "#fff";
          ctx.font = "6px monospace";
          ctx.textAlign = "center";
          ctx.fillText(char.name, cx, cy + 20);
          ctx.imageSmoothingEnabled = false;

          // Active dot
          if (char.active) {
            ctx.fillStyle = "#4ade80";
            ctx.fillRect(cx - 1, cy - CHAR_H, 2, 2);
          }
        });

        // Plants at corners
        const plantImg = furniture.plant;
        if (plantImg?.complete && plantImg.naturalWidth > 0) {
          ctx.imageSmoothingEnabled = false;
          const corners = [
            [gx + TILE, gy + rows * TILE - TILE * 2],
            [gx + cols * TILE - TILE * 2, gy + rows * TILE - TILE * 2],
          ];
          corners.forEach(([px, py]) => ctx.drawImage(plantImg, px, py, TILE, TILE * 1.2));
        }

        // Empty state
        if (chars.length === 0) {
          ctx.imageSmoothingEnabled = true;
          ctx.fillStyle = "rgba(255,255,255,0.12)";
          ctx.font = "7px monospace";
          ctx.textAlign = "center";
          const mx = gx + (cols * TILE) / 2;
          const my = gy + (rows * TILE) / 2;
          ctx.fillText("No agents yet", mx, my - 4);
          ctx.fillText("Click '+ Add Agent'", mx, my + 6);
        }

        ctx.restore();
      },
    });

    return stop;
  }, [update, sprites, floorTiles, furniture, layout, loaded]);

  return (
    <div ref={containerRef} className="w-full h-full relative bg-gray-900">
      <canvas ref={canvasRef} className="absolute inset-0" style={{ imageRendering: "pixelated" }} />
      <div className="absolute bottom-2 left-2 right-2 flex items-center gap-1.5 flex-wrap">
        <span className="text-xs text-gray-500 bg-gray-900/80 px-2 py-1 rounded">{characters.size} agents</span>
        {Array.from(characters.values()).map((char) => (
          <button key={char.id} onClick={(e) => { e.stopPropagation(); onAgentClick?.(char.id); }}
            className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-1 rounded cursor-pointer transition-colors">
            {char.name}
          </button>
        ))}
      </div>
    </div>
  );
}
