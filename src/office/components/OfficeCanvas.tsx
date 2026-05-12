"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CAMERA_FOLLOW_LERP, CAMERA_FOLLOW_SNAP_THRESHOLD, PAN_MARGIN_FRACTION, TILE_SIZE, ZOOM_DEFAULT_DPR_FACTOR } from "../constants";
import { startGameLoop } from "../engine/gameLoop";
import { OfficeState } from "../engine/officeState";
import { renderFrame } from "../engine/renderer";
import { useOfficeStore } from "../engine/officeStore";
import { loadAllAssets } from "../assetLoader";
import { migrateLayoutColors } from "../layout/layoutSerializer";

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 8;
const ZOOM_FACTOR_IN = 1.14;
const ZOOM_FACTOR_OUT = 0.88;
const DRAG_THRESHOLD_PX = 4;

export function OfficeCanvas({ onAgentClick }: { onAgentClick?: (agentId: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const officeStateRef = useRef<OfficeState | null>(null);
  const panRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(2);
  const offsetRef = useRef({ x: 0, y: 0 });
  // Pointer tracking (works for both left and middle mouse)
  const isPointerDownRef = useRef(false);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ mouseX: 0, mouseY: 0, panX: 0, panY: 0 });
  // String agentId → numeric ID for OfficeState
  const agentIdMapRef = useRef<Map<string, number>>(new Map());
  const nextNumIdRef = useRef(1);
  const [assetsLoaded, setAssetsLoaded] = useState(false);
  const [zoomDisplay, setZoomDisplay] = useState<number | null>(null);
  const zoomFadeRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const characters = useOfficeStore(s => s.characters);

  useEffect(() => {
    loadAllAssets().then(() => setAssetsLoaded(true));
  }, []);

  useEffect(() => {
    if (!assetsLoaded) return;
    fetch('/assets/default-layout.json')
      .then(r => r.json())
      .then(raw => {
        const layout = migrateLayoutColors(raw);
        officeStateRef.current = new OfficeState(layout);
        for (const [stringId, char] of characters) {
          const numId = nextNumIdRef.current++;
          agentIdMapRef.current.set(stringId, numId);
          officeStateRef.current.addAgent(numId);
          officeStateRef.current.setAgentActive(numId, char.active);
        }
        zoomRef.current = Math.round(ZOOM_DEFAULT_DPR_FACTOR * (window.devicePixelRatio || 1));
      })
      .catch(() => {
        officeStateRef.current = new OfficeState();
        zoomRef.current = Math.round(ZOOM_DEFAULT_DPR_FACTOR * (window.devicePixelRatio || 1));
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetsLoaded]);

  useEffect(() => {
    const state = officeStateRef.current;
    if (!state || !assetsLoaded) return;
    const currentIds = new Set(agentIdMapRef.current.keys());
    const newIds = new Set(characters.keys());
    for (const [stringId, char] of characters) {
      if (!agentIdMapRef.current.has(stringId)) {
        const numId = nextNumIdRef.current++;
        agentIdMapRef.current.set(stringId, numId);
        state.addAgent(numId);
      }
      const numId = agentIdMapRef.current.get(stringId)!;
      state.setAgentActive(numId, char.active);
      if (char.showPermissionBubble) state.showPermissionBubble(numId);
      else state.clearPermissionBubble(numId);
    }
    for (const stringId of currentIds) {
      if (!newIds.has(stringId)) {
        const numId = agentIdMapRef.current.get(stringId)!;
        state.removeAgent(numId);
        agentIdMapRef.current.delete(stringId);
      }
    }
  }, [characters, assetsLoaded]);

  const clampPan = useCallback((px: number, py: number) => {
    const canvas = canvasRef.current;
    const state = officeStateRef.current;
    if (!canvas || !state) return { x: px, y: py };
    const layout = state.getLayout();
    const zoom = zoomRef.current;
    const mapW = layout.cols * TILE_SIZE * zoom;
    const mapH = layout.rows * TILE_SIZE * zoom;
    const marginX = canvas.width * PAN_MARGIN_FRACTION;
    const marginY = canvas.height * PAN_MARGIN_FRACTION;
    const maxPanX = mapW / 2 + canvas.width / 2 - marginX;
    const maxPanY = mapH / 2 + canvas.height / 2 - marginY;
    return {
      x: Math.max(-maxPanX, Math.min(maxPanX, px)),
      y: Math.max(-maxPanY, Math.min(maxPanY, py)),
    };
  }, []);

  const showZoom = useCallback(() => {
    setZoomDisplay(Math.round(zoomRef.current * 100));
    if (zoomFadeRef.current) clearTimeout(zoomFadeRef.current);
    zoomFadeRef.current = setTimeout(() => setZoomDisplay(null), 1500);
  }, []);

  const applyZoom = useCallback((newZoom: number, screenX: number, screenY: number) => {
    const canvas = canvasRef.current;
    const state = officeStateRef.current;
    if (!canvas || !state) return;
    const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newZoom));
    const oldZoom = zoomRef.current;
    // World point under cursor (using current offset)
    const worldX = (screenX - offsetRef.current.x) / oldZoom;
    const worldY = (screenY - offsetRef.current.y) / oldZoom;
    // Keep that world point at same screen position after zoom
    const layout = state.getLayout();
    const mapHalfW = layout.cols * TILE_SIZE / 2;
    const mapHalfH = layout.rows * TILE_SIZE / 2;
    const zoomDelta = clamped - oldZoom;
    zoomRef.current = clamped;
    panRef.current = clampPan(
      panRef.current.x - (worldX - mapHalfW) * zoomDelta,
      panRef.current.y - (worldY - mapHalfH) * zoomDelta,
    );
    showZoom();
  }, [clampPan, showZoom]);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
  }, []);

  const screenToWorld = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const deviceX = (clientX - rect.left) * dpr;
    const deviceY = (clientY - rect.top) * dpr;
    return {
      x: (deviceX - offsetRef.current.x) / zoomRef.current,
      y: (deviceY - offsetRef.current.y) / zoomRef.current,
    };
  }, []);

  const canvasScreenCenter = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    return { x: canvas.width / 2, y: canvas.height / 2 };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    resizeCanvas();
    const observer = new ResizeObserver(resizeCanvas);
    if (containerRef.current) observer.observe(containerRef.current);

    const stop = startGameLoop(canvas, {
      update: (dt) => { officeStateRef.current?.update(dt); },
      render: (ctx) => {
        const state = officeStateRef.current;
        const w = canvas.width;
        const h = canvas.height;
        const zoom = zoomRef.current;

        if (!state) {
          ctx.fillStyle = '#0d0d1a';
          ctx.fillRect(0, 0, w, h);
          return;
        }

        if (state.cameraFollowId !== null) {
          const ch = state.characters.get(state.cameraFollowId);
          if (ch) {
            const layout = state.getLayout();
            const mapW = layout.cols * TILE_SIZE * zoom;
            const mapH = layout.rows * TILE_SIZE * zoom;
            const targetX = mapW / 2 - ch.x * zoom;
            const targetY = mapH / 2 - ch.y * zoom;
            const dx = targetX - panRef.current.x;
            const dy = targetY - panRef.current.y;
            if (Math.abs(dx) < CAMERA_FOLLOW_SNAP_THRESHOLD && Math.abs(dy) < CAMERA_FOLLOW_SNAP_THRESHOLD) {
              panRef.current = { x: targetX, y: targetY };
            } else {
              panRef.current = {
                x: panRef.current.x + dx * CAMERA_FOLLOW_LERP,
                y: panRef.current.y + dy * CAMERA_FOLLOW_LERP,
              };
            }
          }
        }

        const { offsetX, offsetY } = renderFrame(
          ctx, w, h,
          state.tileMap,
          state.furniture,
          state.getCharacters(),
          zoom,
          panRef.current.x,
          panRef.current.y,
          {
            selectedAgentId: state.selectedAgentId,
            hoveredAgentId: state.hoveredAgentId,
            hoveredTile: state.hoveredTile,
            seats: state.seats,
            characters: state.characters,
          },
          undefined,
          state.getLayout().tileColors,
          state.getLayout().cols,
          state.getLayout().rows,
        );
        offsetRef.current = { x: offsetX, y: offsetY };
      },
    });

    return () => { stop(); observer.disconnect(); };
  }, [resizeCanvas]);

  // Smooth zoom toward cursor
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const screenX = (e.clientX - rect.left) * dpr;
    const screenY = (e.clientY - rect.top) * dpr;
    const factor = e.deltaY > 0 ? ZOOM_FACTOR_OUT : ZOOM_FACTOR_IN;
    applyZoom(zoomRef.current * factor, screenX, screenY);
  }, [applyZoom]);

  // Left or middle mouse starts pan
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0 || e.button === 1) {
      e.preventDefault();
      isPointerDownRef.current = true;
      isPanningRef.current = false;
      panStartRef.current = { mouseX: e.clientX, mouseY: e.clientY, panX: panRef.current.x, panY: panRef.current.y };
      if (canvasRef.current) canvasRef.current.style.cursor = 'grab';
    }
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPointerDownRef.current) {
      const dx = e.clientX - panStartRef.current.mouseX;
      const dy = e.clientY - panStartRef.current.mouseY;
      if (!isPanningRef.current && Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD_PX) {
        isPanningRef.current = true;
      }
      if (isPanningRef.current) {
        const dpr = window.devicePixelRatio || 1;
        panRef.current = clampPan(panStartRef.current.panX + dx * dpr, panStartRef.current.panY + dy * dpr);
        if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
      }
    }

    const state = officeStateRef.current;
    if (!state) return;
    const world = screenToWorld(e.clientX, e.clientY);
    if (world) {
      const col = Math.floor(world.x / TILE_SIZE);
      const row = Math.floor(world.y / TILE_SIZE);
      state.hoveredTile = { col, row };
      const hovId = state.getCharacterAt(world.x, world.y);
      state.hoveredAgentId = hovId;
      if (!isPanningRef.current && !isPointerDownRef.current) {
        if (canvasRef.current) canvasRef.current.style.cursor = hovId !== null ? 'pointer' : 'grab';
      }
    }
  }, [clampPan, screenToWorld]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    const wasPanning = isPanningRef.current;
    isPointerDownRef.current = false;
    isPanningRef.current = false;

    const state = officeStateRef.current;
    // Reset cursor
    if (canvasRef.current) {
      canvasRef.current.style.cursor = state?.hoveredAgentId !== null ? 'pointer' : 'grab';
    }

    // If was not a drag → treat as click
    if (!wasPanning && e.button === 0 && state) {
      const world = screenToWorld(e.clientX, e.clientY);
      if (!world) return;
      const numId = state.getCharacterAt(world.x, world.y);
      if (numId !== null) {
        state.selectedAgentId = numId;
        state.cameraFollowId = numId;
        for (const [stringId, n] of agentIdMapRef.current) {
          if (n === numId) { onAgentClick?.(stringId); break; }
        }
      } else {
        state.selectedAgentId = null;
        state.cameraFollowId = null;
      }
    }
  }, [screenToWorld, onAgentClick]);

  const handleMouseLeave = useCallback(() => {
    isPointerDownRef.current = false;
    isPanningRef.current = false;
    if (canvasRef.current) canvasRef.current.style.cursor = 'grab';
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => e.preventDefault(), []);

  const handleZoomBtn = useCallback((dir: 1 | -1) => {
    const center = canvasScreenCenter();
    applyZoom(zoomRef.current * (dir > 0 ? ZOOM_FACTOR_IN : ZOOM_FACTOR_OUT), center.x, center.y);
  }, [applyZoom, canvasScreenCenter]);

  const handleZoomReset = useCallback(() => {
    const center = canvasScreenCenter();
    applyZoom(2 * (window.devicePixelRatio || 1), center.x, center.y);
  }, [applyZoom, canvasScreenCenter]);

  const storeChars = useOfficeStore(s => s.characters);

  return (
    <div ref={containerRef} className="w-full h-full relative bg-[#0d0d1a]"
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onContextMenu={handleContextMenu}
    >
      <canvas ref={canvasRef} className="absolute inset-0" style={{ imageRendering: 'pixelated', cursor: 'grab' }} />
      {!assetsLoaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-gray-500 text-sm">Loading office...</span>
        </div>
      )}

      {/* Zoom controls */}
      <div className="absolute top-2 right-2 flex flex-col gap-1 select-none">
        <button onClick={() => handleZoomBtn(1)}
          className="w-7 h-7 bg-gray-900/90 text-gray-300 text-base rounded hover:bg-gray-700 flex items-center justify-center border border-gray-700"
          title="Zoom in">+</button>
        {zoomDisplay !== null && (
          <div className="bg-gray-900/90 text-gray-400 text-[10px] rounded px-1 py-0.5 text-center border border-gray-700">
            {zoomDisplay}%
          </div>
        )}
        <button onClick={() => handleZoomBtn(-1)}
          className="w-7 h-7 bg-gray-900/90 text-gray-300 text-base rounded hover:bg-gray-700 flex items-center justify-center border border-gray-700"
          title="Zoom out">−</button>
        <button onClick={handleZoomReset}
          className="w-7 h-7 bg-gray-900/90 text-gray-400 text-[9px] rounded hover:bg-gray-700 flex items-center justify-center border border-gray-700"
          title="Reset zoom">⌂</button>
      </div>

      {/* Agent list at bottom */}
      <div className="absolute bottom-2 left-2 right-10 flex items-center gap-1.5 flex-wrap">
        <span className="text-xs text-gray-500 bg-gray-900/80 px-2 py-1 rounded">{storeChars.size} agents</span>
        {Array.from(storeChars.values()).map(char => (
          <button key={char.id} onClick={e => { e.stopPropagation(); onAgentClick?.(char.id); }}
            className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-1 rounded cursor-pointer transition-colors">
            {char.name}
          </button>
        ))}
      </div>
    </div>
  );
}
