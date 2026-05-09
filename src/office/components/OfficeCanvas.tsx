"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { startGameLoop } from "../engine/gameLoop";
import { useOfficeStore } from "../engine/officeStore";

const TILE = 32;
const CHAR_W = 16;
const CHAR_H = 24;

const CHAR_URLS = Array.from({ length: 6 }, (_, i) => `/assets/characters/char_${i}.png`);
const FLOOR_URLS = Array.from({ length: 9 }, (_, i) => `/assets/floors/floor_${i}.png`);
const FURNITURE_URLS: Record<string, string> = {
  desk: "/assets/furniture/DESK/DESK_FRONT.png",
  chair: "/assets/furniture/WOODEN_CHAIR/WOODEN_CHAIR_FRONT.png",
  plant: "/assets/furniture/PLANT/PLANT.png",
  pc: "/assets/furniture/PC/PC_FRONT_OFF.png",
  coffee: "/assets/furniture/COFFEE/COFFEE.png",
  clock: "/assets/furniture/CLOCK/CLOCK.png",
  bookshelf: "/assets/furniture/BOOKSHELF/BOOKSHELF.png",
};

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(img);
    img.src = url;
  });
}

export function OfficeCanvas({ onAgentClick }: { onAgentClick?: (agentId: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const characters = useOfficeStore((s) => s.characters);
  const update = useOfficeStore((s) => s.update);
  const [sprites, setSprites] = useState<HTMLImageElement[]>([]);
  const [floorTiles, setFloorTiles] = useState<HTMLImageElement[]>([]);
  const [furniture, setFurniture] = useState<Record<string, HTMLImageElement>>({});
  const [loaded, setLoaded] = useState(false);

  // Load all assets
  useEffect(() => {
    Promise.all([
      Promise.all(CHAR_URLS.map(loadImage)).then(setSprites),
      Promise.all(FLOOR_URLS.map(loadImage)).then(setFloorTiles),
      Promise.all(
        Object.entries(FURNITURE_URLS).map(async ([key, url]) => {
          const img = await loadImage(url);
          return [key, img] as const;
        })
      ).then((pairs) => setFurniture(Object.fromEntries(pairs))),
    ]).then(() => setLoaded(true));
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

  useEffect(() => { handleResize(); window.addEventListener("resize", handleResize); return () => window.removeEventListener("resize", handleResize); }, [handleResize]);

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

        ctx.imageSmoothingEnabled = false;

        // Background
        ctx.fillStyle = "#0d0d1a";
        ctx.fillRect(0, 0, w, h);

        const cols = 12;
        const rows = 8;
        const gx = 48;
        const gy = 32;
        const floor = floorTiles[0];

        // Floor tiles
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const x = gx + c * TILE;
            const y = gy + r * TILE;
            if (floor && floor.complete && floor.naturalWidth > 0) {
              ctx.drawImage(floor, x, y, TILE, TILE);
            } else {
              const shade = ((r + c) % 2 === 0) ? "#1a1a2e" : "#151528";
              ctx.fillStyle = shade;
              ctx.fillRect(x, y, TILE, TILE);
            }
          }
        }

        // Draw walls (2-tile thick border)
        const wallColor = "#2e2e42";
        // Top wall
        for (let c = -2; c < cols + 2; c++) {
          for (let r = -2; r < 0; r++) {
            const x = gx + c * TILE;
            const y = gy + r * TILE;
            // Wall checker pattern
            const shade = ((c + r) % 2 === 0) ? wallColor : "#28283c";
            ctx.fillStyle = shade;
            ctx.fillRect(x, y, TILE, TILE);
            // Brick lines
            ctx.fillStyle = "rgba(0,0,0,0.2)";
            ctx.fillRect(x, y + TILE - 1, TILE, 1);
          }
        }
        // Side walls
        for (let r = -2; r < rows + 1; r++) {
          for (let side = 0; side < 2; side++) {
            const sc = side === 0 ? -2 : cols;
            for (let wc = 0; wc < 2; wc++) {
              const x = gx + (sc + wc) * TILE;
              const y = gy + r * TILE;
              if (r < 0 || r >= rows) continue;
              const shade = ((sc + wc + r) % 2 === 0) ? wallColor : "#28283c";
              ctx.fillStyle = shade;
              ctx.fillRect(x, y, TILE, TILE);
              ctx.fillStyle = "rgba(0,0,0,0.2)";
              ctx.fillRect(x + TILE - 1, y, 1, TILE);
            }
          }
        }
        // Bottom wall
        for (let c = -2; c < cols + 2; c++) {
          for (let r = rows; r < rows + 1; r++) {
            const x = gx + c * TILE;
            const y = gy + r * TILE;
            const shade = ((c + r) % 2 === 0) ? wallColor : "#28283c";
            ctx.fillStyle = shade;
            ctx.fillRect(x, y, TILE, TILE);
          }
        }

        // Wall top/side highlight
        ctx.strokeStyle = "rgba(255,255,255,0.06)";
        ctx.lineWidth = 1;
        ctx.strokeRect(gx - TILE * 2, gy - TILE * 2, cols * TILE + TILE * 4, rows * TILE + TILE * 3);

        // Desk positions
        const deskPositions = [
          { x: gx + TILE * 3, y: gy + TILE * 1 },
          { x: gx + TILE * 7, y: gy + TILE * 1 },
          { x: gx + TILE * 3, y: gy + TILE * 4 },
          { x: gx + TILE * 7, y: gy + TILE * 4 },
        ];

        const deskImg = furniture.desk;
        const chairImg = furniture.chair;
        const plantImg = furniture.plant;
        const pcImg = furniture.pc;

        const chars = Array.from(state.characters.values());

        // Draw furniture at each desk position
        deskPositions.forEach((pos, di) => {
          const dx = pos.x;
          const dy = pos.y;

          // Desk sprite
          if (deskImg && deskImg.complete && deskImg.naturalWidth > 0) {
            ctx.drawImage(deskImg, dx - 4, dy + 8, TILE + 8, TILE);
          } else {
            ctx.fillStyle = "#3a3028";
            ctx.fillRect(dx - 4, dy + 8, TILE + 8, TILE);
            ctx.fillStyle = "#4a4038";
            ctx.fillRect(dx - 2, dy + 6, TILE + 4, 2);
            // Legs
            ctx.fillStyle = "#2a2018";
            ctx.fillRect(dx, dy + 8 + TILE, 2, 6);
            ctx.fillRect(dx + TILE, dy + 8 + TILE, 2, 6);
          }

          // PC on desk
          if (pcImg && pcImg.complete && pcImg.naturalWidth > 0 && di % 2 === 0) {
            ctx.drawImage(pcImg, dx + TILE / 2 - 8, dy + 2, 16, 16);
          }

          // Agent at this desk
          const char = chars[di];
          if (char) {
            const cx = dx + TILE / 2;
            const cy = dy - 4;
            const spriteIdx = di % sprites.length;
            const sprite = sprites[spriteIdx];

            // Chair behind character
            if (chairImg && chairImg.complete && chairImg.naturalWidth > 0) {
              ctx.drawImage(chairImg, cx - 8, cy + CHAR_H + 2, CHAR_W, 8);
            } else {
              ctx.fillStyle = "#5a5048";
              ctx.fillRect(cx - 6, cy + CHAR_H + 2, 12, 4);
            }

            // Character sprite
            if (sprite && sprite.complete && sprite.naturalWidth > 0) {
              const bob = Math.sin(Date.now() / 800 + di) * 1;
              ctx.drawImage(sprite, cx - 8, cy + bob, CHAR_W, CHAR_H);
            } else {
              const colors = ["#e74c3c", "#3498db", "#2ecc71", "#f39c12", "#9b59b6", "#1abc9c"];
              ctx.fillStyle = colors[di % colors.length];
              ctx.fillRect(cx - 6, cy, 12, 20);
              ctx.fillStyle = "#fff";
              ctx.fillRect(cx - 3, cy + 4, 3, 3);
              ctx.fillRect(cx + 1, cy + 4, 3, 3);
            }

            // Name
            ctx.fillStyle = "#fff";
            ctx.font = "7px monospace";
            ctx.textAlign = "center";
            ctx.fillText(char.name, cx, cy + CHAR_H + 14);

            // Active dot
            if (char.active) {
              const t = Date.now() / 300;
              ctx.fillStyle = `rgba(74, 222, 128, ${0.5 + Math.sin(t) * 0.3})`;
              ctx.font = "8px monospace";
              ctx.fillText("●", cx, cy - 6);
            }
          }
        });

        // Plants at corners
        if (plantImg && plantImg.complete && plantImg.naturalWidth > 0) {
          [
            [gx + TILE, gy + TILE * 6],
            [gx + TILE * 10, gy + TILE * 6],
          ].forEach(([px, py]) => {
            ctx.drawImage(plantImg, px - 4, py - 4, 20, 24);
          });
        }

        // Empty state
        if (chars.length === 0) {
          ctx.fillStyle = "rgba(255,255,255,0.12)";
          ctx.font = "13px monospace";
          ctx.textAlign = "center";
          const mx = gx + (cols * TILE) / 2;
          const my = gy + (rows * TILE) / 2;
          ctx.fillText("No agents in this office", mx, my - 8);
          ctx.font = "10px monospace";
          ctx.fillStyle = "rgba(255,255,255,0.07)";
          ctx.fillText("Click '+ Add Agent' to get started", mx, my + 10);
        }

        ctx.imageSmoothingEnabled = true;
      },
    });

    return stop;
  }, [update, sprites, floorTiles, furniture, loaded]);

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
