import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

interface ManifestAsset {
  type: 'asset';
  id: string;
  file: string;
  width: number;
  height: number;
  footprintW: number;
  footprintH: number;
  orientation?: string;
  state?: string;
  frame?: number;
  mirrorSide?: boolean;
}

interface ManifestGroup {
  type: 'group';
  groupType: string;
  orientation?: string;
  state?: string;
  members: ManifestNode[];
}

type ManifestNode = ManifestAsset | ManifestGroup;

interface ManifestRoot {
  id: string;
  name: string;
  category: string;
  type: 'group' | 'asset';
  groupType?: string;
  rotationScheme?: string;
  canPlaceOnWalls?: boolean;
  canPlaceOnSurfaces?: boolean;
  backgroundTiles?: number;
  // group manifests
  members?: ManifestNode[];
  // root-asset manifests (no members, no file — PNG is {id}.png)
  width?: number;
  height?: number;
  footprintW?: number;
  footprintH?: number;
  orientation?: string;
}

interface FlatCatalogEntry {
  id: string;
  label: string;
  category: string;
  width: number;
  height: number;
  footprintW: number;
  footprintH: number;
  isDesk: boolean;
  url: string;
  groupId?: string;
  orientation?: string;
  state?: string;
  canPlaceOnSurfaces?: boolean;
  backgroundTiles?: number;
  canPlaceOnWalls?: boolean;
  mirrorSide?: boolean;
  rotationScheme?: string;
  animationGroup?: string;
  frame?: number;
}

function flattenManifest(
  root: ManifestRoot,
  baseUrl: string,
): FlatCatalogEntry[] {
  const results: FlatCatalogEntry[] = [];

  function walk(
    node: ManifestNode,
    inheritedOrientation?: string,
    inheritedState?: string,
    inheritedAnimGroup?: string,
  ): void {
    if (node.type === 'asset') {
      const orientation = node.orientation ?? inheritedOrientation;
      const state = node.state ?? inheritedState;
      const animationGroup = inheritedAnimGroup;

      results.push({
        id: node.id,
        label: root.name,
        category: root.category,
        width: node.width,
        height: node.height,
        footprintW: node.footprintW,
        footprintH: node.footprintH,
        isDesk: root.category === 'desks',
        url: `${baseUrl}/${node.file}`,
        groupId: root.id,
        ...(orientation !== undefined ? { orientation } : {}),
        ...(state !== undefined ? { state } : {}),
        ...(root.canPlaceOnSurfaces ? { canPlaceOnSurfaces: true } : {}),
        ...(root.backgroundTiles ? { backgroundTiles: root.backgroundTiles } : {}),
        ...(root.canPlaceOnWalls ? { canPlaceOnWalls: true } : {}),
        ...(node.mirrorSide ? { mirrorSide: true } : {}),
        ...(root.rotationScheme ? { rotationScheme: root.rotationScheme } : {}),
        ...(animationGroup !== undefined ? { animationGroup } : {}),
        ...(node.frame !== undefined ? { frame: node.frame } : {}),
      });
    } else {
      // group node
      const groupOrientation = node.orientation ?? inheritedOrientation;
      const groupState = node.state ?? inheritedState;

      // When entering an animation group, compute the animationGroup key
      let animGroup = inheritedAnimGroup;
      if (node.groupType === 'animation' && groupState !== undefined) {
        const orientPart = groupOrientation ?? 'unknown';
        const statePart = groupState;
        animGroup = `${root.id}_${orientPart}_${statePart}`;
      }

      for (const member of node.members) {
        walk(member, groupOrientation, groupState, animGroup);
      }
    }
  }

  // Root-level asset (no members array) — PNG is {id}.png in the same folder
  if (root.type === 'asset' || !root.members) {
    results.push({
      id: root.id,
      label: root.name,
      category: root.category,
      width: root.width ?? 16,
      height: root.height ?? 16,
      footprintW: root.footprintW ?? 1,
      footprintH: root.footprintH ?? 1,
      isDesk: root.category === 'desks',
      url: `${baseUrl}/${root.id}.png`,
      ...(root.orientation !== undefined ? { orientation: root.orientation } : {}),
      ...(root.canPlaceOnSurfaces ? { canPlaceOnSurfaces: true } : {}),
      ...(root.backgroundTiles ? { backgroundTiles: root.backgroundTiles } : {}),
      ...(root.canPlaceOnWalls ? { canPlaceOnWalls: true } : {}),
    });
    return results;
  }

  for (const member of root.members) {
    walk(member, undefined, undefined, undefined);
  }

  return results;
}

export async function GET(): Promise<NextResponse> {
  try {
    const furnitureDir = path.join(process.cwd(), 'public', 'assets', 'furniture');

    if (!fs.existsSync(furnitureDir)) {
      return NextResponse.json({ catalog: [] });
    }

    const groupDirs = fs.readdirSync(furnitureDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    const catalog: FlatCatalogEntry[] = [];

    for (const groupName of groupDirs) {
      const manifestPath = path.join(furnitureDir, groupName, 'manifest.json');
      if (!fs.existsSync(manifestPath)) continue;

      try {
        const raw = fs.readFileSync(manifestPath, 'utf-8');
        const manifest = JSON.parse(raw) as ManifestRoot;
        const baseUrl = `/assets/furniture/${groupName}`;
        const entries = flattenManifest(manifest, baseUrl);
        catalog.push(...entries);
      } catch {
        // Skip malformed manifests
        console.warn(`Failed to parse manifest for ${groupName}`);
      }
    }

    return NextResponse.json({ catalog });
  } catch (err) {
    console.error('furniture-catalog route error:', err);
    return NextResponse.json({ catalog: [] }, { status: 500 });
  }
}
