import { buildDynamicCatalog, type LoadedAssetData } from './layout/furnitureCatalog';
import { setFloorSprites } from './floorTiles';
import { setCharacterTemplates } from './sprites/spriteData';
import type { SpriteData } from './types';

// ── PNG → SpriteData ────────────────────────────────────────────
async function pngToSpriteData(url: string): Promise<SpriteData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const { data, width, height } = ctx.getImageData(0, 0, img.naturalWidth, img.naturalHeight);
      const sprite: SpriteData = [];
      for (let y = 0; y < height; y++) {
        const row: string[] = [];
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
          if (a < 2) { row.push(''); }
          else {
            const hex = (n: number) => n.toString(16).padStart(2, '0');
            if (a >= 254) row.push(`#${hex(r)}${hex(g)}${hex(b)}`);
            else row.push(`#${hex(r)}${hex(g)}${hex(b)}${hex(a)}`);
          }
        }
        sprite.push(row);
      }
      resolve(sprite);
    };
    img.onerror = () => reject(new Error(`Failed to load ${url}`));
    img.src = url;
  });
}

// ── Character sprites ───────────────────────────────────────────
// Each char_N.png is 112×96: 7 frames × 16px, 3 rows × 32px
// Rows: 0=down, 1=up, 2=right
// Frames: 0=walk1, 1=walk2, 2=walk3, 3=type1, 4=type2, 5=read1, 6=read2
export async function loadCharacterSprites(): Promise<void> {
  const CHAR_COUNT = 6;
  const FRAME_W = 16, FRAME_H = 32;
  const FRAMES = 7;

  // Slice 2D SpriteData from full character sheet
  function sliceFrame(full: SpriteData, row: number, col: number): SpriteData {
    const startY = row * FRAME_H;
    const startX = col * FRAME_W;
    const result: SpriteData = [];
    for (let y = 0; y < FRAME_H; y++) {
      const srcRow = full[startY + y] ?? [];
      result.push(srcRow.slice(startX, startX + FRAME_W));
    }
    return result;
  }

  const charData = await Promise.all(
    Array.from({ length: CHAR_COUNT }, async (_, i) => {
      const full = await pngToSpriteData(`/assets/characters/char_${i}.png`);
      return {
        down:  Array.from({ length: FRAMES }, (_, f) => sliceFrame(full, 0, f)),
        up:    Array.from({ length: FRAMES }, (_, f) => sliceFrame(full, 1, f)),
        right: Array.from({ length: FRAMES }, (_, f) => sliceFrame(full, 2, f)),
      };
    })
  );
  setCharacterTemplates(charData);
}

// ── Furniture catalog ───────────────────────────────────────────
export async function loadFurnitureCatalog(): Promise<boolean> {
  try {
    const res = await fetch('/api/furniture-catalog');
    if (!res.ok) return false;
    const { catalog } = await res.json() as { catalog: LoadedAssetData['catalog'] & Array<{ url: string }> };

    // Load all PNG sprites in parallel
    const sprites: Record<string, SpriteData> = {};
    await Promise.allSettled(
      catalog.map(async (entry) => {
        try {
          sprites[entry.id] = await pngToSpriteData(entry.url);
        } catch { /* skip broken assets */ }
      })
    );

    return buildDynamicCatalog({ catalog, sprites });
  } catch {
    return false;
  }
}

// ── Floor tiles ────────────────────────────────────────────────
export async function loadFloorTiles(): Promise<void> {
  const FLOOR_COUNT = 9;
  const sprites = await Promise.all(
    Array.from({ length: FLOOR_COUNT }, (_, i) =>
      pngToSpriteData(`/assets/floors/floor_${i}.png`).catch(() => [] as SpriteData)
    )
  );
  setFloorSprites(sprites.filter(s => s.length > 0));
}

// ── Wall tiles ─────────────────────────────────────────────────
export async function loadWallTiles(): Promise<void> {
  // Try to load walls.png (single sheet with 16 bitmask variants)
  // If it exists, setWallSprites will be called
  try {
    const { setWallSprites } = await import('./wallTiles');
    if (typeof setWallSprites !== 'function') return;
    const sprite = await pngToSpriteData('/assets/walls/walls.png').catch(() => null);
    if (!sprite) return;
    // walls.png is 64×128: 4 columns × 4 rows of 16×32 pieces
    // Slice into 16 individual wall sprites (indexed by 4-bit bitmask)
    const PIECE_W = 16, PIECE_H = 32;
    const wallSprites: SpriteData[] = [];
    for (let i = 0; i < 16; i++) {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const piece: SpriteData = [];
      for (let y = 0; y < PIECE_H; y++) {
        const srcRow = sprite[row * PIECE_H + y] ?? [];
        piece.push(srcRow.slice(col * PIECE_W, col * PIECE_W + PIECE_W));
      }
      wallSprites.push(piece);
    }
    setWallSprites([wallSprites]);
  } catch { /* walls not available */ }
}

// ── Load all assets ────────────────────────────────────────────
export async function loadAllAssets(): Promise<void> {
  await Promise.all([
    loadCharacterSprites(),
    loadFurnitureCatalog(),
    loadFloorTiles(),
    loadWallTiles(),
  ]);
}
