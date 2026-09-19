// The live pixel office: pixel-agents' engine, canvas and layout editor, driven
// through its own webview message protocol (agentCreated, agentToolStart, ...)
// so the vendored code stays unmodified. Layout and seats persist per office.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./pixel.css";
import type { Activity, Agent, LayoutTemplate } from "./api";
import { api } from "./api";
import { Icon } from "./icons";
import { initBrowserMock, getMockPayload } from "./vendor/pixel-agents/webview-ui/src/browserMock";
import { onHostMessage } from "./vendor/pixel-agents/webview-ui/src/vscodeApi";
import { useEditorActions } from "./vendor/pixel-agents/webview-ui/src/hooks/useEditorActions";
import { useEditorKeyboard } from "./vendor/pixel-agents/webview-ui/src/hooks/useEditorKeyboard";
import { useExtensionMessages } from "./vendor/pixel-agents/webview-ui/src/hooks/useExtensionMessages";
import { OfficeCanvas } from "./vendor/pixel-agents/webview-ui/src/office/components/OfficeCanvas";
import { ToolOverlay } from "./vendor/pixel-agents/webview-ui/src/office/components/ToolOverlay";
import { EditorState } from "./vendor/pixel-agents/webview-ui/src/office/editor/editorState";
import { EditorToolbar } from "./vendor/pixel-agents/webview-ui/src/office/editor/EditorToolbar";
import { OfficeState } from "./vendor/pixel-agents/webview-ui/src/office/engine/officeState";
import { isRotatable } from "./vendor/pixel-agents/webview-ui/src/office/layout/furnitureCatalog";
import { EditTool } from "./vendor/pixel-agents/webview-ui/src/office/types";
import { EditActionBar } from "./vendor/pixel-agents/webview-ui/src/components/EditActionBar";
import { ZoomControls } from "./vendor/pixel-agents/webview-ui/src/components/ZoomControls";

// Assets decode once per page load and are shared by every office view.
let assetsReady: Promise<void> | null = null;
const loadAssets = () => (assetsReady ??= initBrowserMock());

const dispatch = (data: unknown) => window.dispatchEvent(new MessageEvent("message", { data }));

// The engine keys characters by number; agents are uuids.
const numericIds = new Map<string, number>();
const numericId = (uuid: string) => {
  if (!numericIds.has(uuid)) numericIds.set(uuid, numericIds.size + 1);
  return numericIds.get(uuid)!;
};

/** Map an office activity to the engine's tool vocabulary (drives typing vs reading). */
function engineTool(a: Activity): string {
  if (a.state === "thinking") return "Read";
  if (a.state === "delegating") return "SendMessage";
  const d = a.detail || "";
  if (/^(read_file|grep|list_dir)/.test(d)) return "Read";
  if (/^(web_search|fetch_url)/.test(d)) return "WebFetch";
  if (/^(write_file|edit_file|delete_file)/.test(d)) return "Write";
  if (/^bash/.test(d)) return "Bash";
  return "Edit";
}

type Seats = Record<string, { palette?: number; hueShift?: number; seatId?: string }>;

const TILE = 16;
const VOID = 255;

/** Largest integer zoom that fits the used part of the layout, plus the pan that centers it. */
function fitView(layout: { cols: number; rows: number; tiles: number[] }, width: number, height: number) {
  let minC = layout.cols, minR = layout.rows, maxC = -1, maxR = -1;
  layout.tiles.forEach((t, i) => {
    if (t === VOID) return;
    const c = i % layout.cols, r = Math.floor(i / layout.cols);
    minC = Math.min(minC, c); maxC = Math.max(maxC, c); minR = Math.min(minR, r); maxR = Math.max(maxR, r);
  });
  if (maxC < 0) { minC = 0; minR = 0; maxC = layout.cols - 1; maxR = layout.rows - 1; }
  const dpr = window.devicePixelRatio || 1;
  const bw = (maxC - minC + 1) * TILE, bh = (maxR - minR + 1) * TILE;
  // Integer zoom keeps pixel art crisp; a small margin keeps walls off the edges.
  const zoom = Math.max(1, Math.floor(Math.min((width - 24) * dpr / bw, (height - 16) * dpr / bh)));
  const pan = {
    x: (layout.cols / 2 - (minC + maxC + 1) / 2) * TILE * zoom,
    y: (layout.rows / 2 - (minR + maxR + 1) / 2) * TILE * zoom,
  };
  return { zoom, pan };
}

export function PixelOffice({
  officeId, agents, activity, onAgentClick,
}: {
  officeId: string;
  agents: Agent[];
  activity: Record<string, Activity>;
  onAgentClick?: (agentId: string) => void;
}) {
  // One engine + editor per mounted office.
  const officeStateRef = useRef<OfficeState | null>(null);
  const getOfficeState = useCallback(() => (officeStateRef.current ??= new OfficeState()), []);
  const editorState = useMemo(() => new EditorState(), []);
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templates, setTemplates] = useState<LayoutTemplate[]>([]);
  const [showLabels, setShowLabels] = useState(false);

  const editor = useEditorActions(getOfficeState, editorState);
  const isEditDirty = useCallback(() => editor.isEditMode && editor.isDirty, [editor.isEditMode, editor.isDirty]);
  const { agents: engineAgents, agentTools, subagentCharacters, layoutReady, loadedAssets } =
    useExtensionMessages(getOfficeState, editor.setLastSavedLayout, isEditDirty);

  const byNumeric = useMemo(() => new Map(agents.map((a) => [numericId(a.id), a])), [agents]);
  const known = useRef(new Set<string>());

  // Persist what the editor and engine ask the host to save.
  useEffect(() => onHostMessage((msg) => {
    if (msg?.type === "saveLayout") {
      api.saveLayout(officeId, { layout: msg.layout }).catch((e) => setError(`Layout not saved: ${e.message}`));
    } else if (msg?.type === "saveAgentSeats") {
      const seats: Seats = {};
      for (const [num, seat] of Object.entries(msg.seats as Record<string, any>)) {
        const agent = byNumeric.get(Number(num));
        if (agent) seats[agent.id] = seat;
      }
      api.saveLayout(officeId, { seats }).catch(() => {});
    }
  }), [officeId, byNumeric]);

  // Boot: decode assets, then replay the extension's load sequence with this office's layout.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadAssets();
        const saved = await api.layout(officeId);
        if (cancelled) return;
        const payload = getMockPayload();
        if (!payload) throw new Error("Office assets failed to load");
        dispatch({ type: "settingsLoaded", soundEnabled: false, extensionVersion: "a2a", lastSeenVersion: "a2a", alwaysShowLabels: true, hooksInfoShown: true });
        dispatch({ type: "characterSpritesLoaded", characters: payload.characters });
        dispatch({ type: "floorTilesLoaded", sprites: payload.floorSprites });
        dispatch({ type: "wallTilesLoaded", sets: payload.wallSets });
        dispatch({ type: "furnitureAssetsLoaded", catalog: payload.furnitureCatalog, sprites: payload.furnitureSprites });
        const seats = saved.seats || {};
        dispatch({
          type: "existingAgents",
          agents: agents.map((a) => numericId(a.id)),
          agentMeta: Object.fromEntries(agents.map((a) => [numericId(a.id), seats[a.id] || {}])),
          folderNames: Object.fromEntries(agents.map((a) => [numericId(a.id), a.role || ""])),
        });
        known.current = new Set(agents.map((a) => a.id));
        dispatch({ type: "layoutLoaded", layout: saved.layout || payload.layout });
      } catch (e: any) {
        if (!cancelled) setError(e.message || String(e));
      }
    })();
    return () => { cancelled = true; };
    // Boot once per office; later agent changes are handled incrementally below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [officeId]);

  // Agents hired or removed after boot.
  useEffect(() => {
    if (!layoutReady) return;
    const ids = new Set(agents.map((a) => a.id));
    for (const a of agents) {
      if (!known.current.has(a.id)) dispatch({ type: "agentCreated", id: numericId(a.id), folderName: a.role || "" });
    }
    for (const id of known.current) {
      if (!ids.has(id)) dispatch({ type: "agentClosed", id: numericId(id) });
    }
    known.current = ids;
    // Names on the character labels.
    const os = getOfficeState();
    for (const a of agents) {
      const ch = os.characters.get(numericId(a.id));
      if (ch) { ch.agentName = a.name; ch.folderName = a.role || undefined; }
    }
  }, [agents, layoutReady, getOfficeState]);

  // Live activity → typing/reading animations, status labels, and a "done" bubble.
  const lastActivity = useRef<Record<string, string>>({});
  useEffect(() => {
    if (!layoutReady) return;
    for (const a of agents) {
      const act = activity[a.id];
      const id = numericId(a.id);
      const key = act ? `${act.state}:${act.detail}` : "idle";
      if (lastActivity.current[a.id] === key) continue;
      const was = lastActivity.current[a.id];
      lastActivity.current[a.id] = key;
      if (act) {
        dispatch({ type: "agentToolsClear", id });
        dispatch({ type: "agentStatus", id, status: "active" });
        dispatch({ type: "agentToolStart", id, toolId: `${a.id}:${Date.now()}`, status: act.detail || (act.state === "thinking" ? "Thinking" : act.state), toolName: engineTool(act) });
      } else if (was && was !== "idle") {
        dispatch({ type: "agentToolsClear", id });
        dispatch({ type: "agentStatus", id, status: "waiting" });
      }
    }
  }, [activity, agents, layoutReady]);

  // Fit the room to the stage when it first appears and when a template is applied.
  const fit = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { zoom, pan } = fitView(getOfficeState().getLayout(), el.clientWidth, el.clientHeight);
    editor.handleZoomChange(zoom);
    editor.panRef.current = pan;
  }, [editor, getOfficeState]);
  const fitted = useRef(false);
  useEffect(() => {
    if (!layoutReady || fitted.current) return;
    fitted.current = true;
    requestAnimationFrame(fit);
  }, [layoutReady, fit]);

  const [tick, setTick] = useState(0);
  useEditorKeyboard(
    editor.isEditMode, editorState, editor.handleDeleteSelected, editor.handleRotateSelected,
    editor.handleToggleState, editor.handleUndo, editor.handleRedo,
    useCallback(() => setTick((n) => n + 1), []), editor.handleToggleEditMode,
  );
  void tick;

  async function openTemplates() {
    setTemplatesOpen((v) => !v);
    if (!templates.length) setTemplates(await api.layoutTemplates().catch(() => []));
  }

  async function applyTemplate(t: LayoutTemplate) {
    setTemplatesOpen(false);
    if (editor.isDirty && !window.confirm(`Replace your unsaved layout changes with "${t.name}"?`)) return;
    try {
      const layout = await api.layoutTemplate(t.file);
      await api.saveLayout(officeId, { layout });
      getOfficeState().rebuildFromLayout(layout);
      editor.setLastSavedLayout(layout);
      requestAnimationFrame(fit);
      setTick((n) => n + 1);
    } catch (e: any) {
      setError(`Could not apply template: ${e.message}`);
    }
  }

  const os = getOfficeState();
  const selUid = editorState.selectedFurnitureUid;
  const showRotateHint = editor.isEditMode && (
    (selUid && isRotatable(os.getLayout().furniture.find((f) => f.uid === selUid)?.type || "")) ||
    (editorState.activeTool === EditTool.FURNITURE_PLACE && isRotatable(editorState.selectedFurnitureType))
  );

  return (
    <div ref={containerRef} className="pixel-ui" style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      {!layoutReady && <div className="stage-loading">{error || "Loading office…"}</div>}
      {layoutReady && (
        <>
          <OfficeCanvas
            officeState={os}
            onClick={(num: number) => { const a = byNumeric.get(num); if (a) onAgentClick?.(a.id); }}
            isEditMode={editor.isEditMode}
            editorState={editorState}
            onEditorTileAction={editor.handleEditorTileAction}
            onEditorEraseAction={editor.handleEditorEraseAction}
            onEditorSelectionChange={editor.handleEditorSelectionChange}
            onDeleteSelected={editor.handleDeleteSelected}
            onRotateSelected={editor.handleRotateSelected}
            onDragMove={editor.handleDragMove}
            editorTick={editor.editorTick}
            zoom={editor.zoom}
            onZoomChange={editor.handleZoomChange}
            panRef={editor.panRef}
          />
          <ZoomControls zoom={editor.zoom} onZoomChange={editor.handleZoomChange} />
          {editor.isEditMode && editor.isDirty && <EditActionBar editor={editor} editorState={editorState} />}
          {showRotateHint && <div className="rotate-hint">Press R to rotate</div>}
          {editor.isEditMode && (
            <EditorToolbar
              activeTool={editorState.activeTool}
              selectedTileType={editorState.selectedTileType}
              selectedFurnitureType={editorState.selectedFurnitureType}
              selectedFurnitureUid={selUid}
              selectedFurnitureColor={selUid ? (os.getLayout().furniture.find((f) => f.uid === selUid)?.color ?? null) : null}
              floorColor={editorState.floorColor}
              wallColor={editorState.wallColor}
              selectedWallSet={editorState.selectedWallSet}
              onToolChange={editor.handleToolChange}
              onTileTypeChange={editor.handleTileTypeChange}
              onFloorColorChange={editor.handleFloorColorChange}
              onWallColorChange={editor.handleWallColorChange}
              onWallSetChange={editor.handleWallSetChange}
              onSelectedFurnitureColorChange={editor.handleSelectedFurnitureColorChange}
              onFurnitureTypeChange={editor.handleFurnitureTypeChange}
              loadedAssets={loadedAssets}
            />
          )}
          <ToolOverlay
            officeState={os}
            agents={engineAgents}
            agentTools={agentTools}
            subagentCharacters={subagentCharacters}
            containerRef={containerRef}
            zoom={editor.zoom}
            panRef={editor.panRef}
            onCloseAgent={() => {}}
            alwaysShowOverlay={showLabels}
          />
          <div className="stage-bar">
            <button className={`btn sm${editor.isEditMode ? " primary" : ""}`} onClick={editor.handleToggleEditMode} aria-pressed={editor.isEditMode}>
              <Icon name="pencil" /> {editor.isEditMode ? "Done editing" : "Edit layout"}
            </button>
            <div style={{ position: "relative" }}>
              <button className="btn sm" onClick={openTemplates} aria-expanded={templatesOpen}>
                <Icon name="layout" /> Templates
              </button>
              {templatesOpen && (
                <div className="popover" style={{ bottom: "calc(100% + 6px)", left: 0 }} role="menu">
                  <div className="popover-head">Replace layout with</div>
                  {templates.map((t) => (
                    <button key={t.id} className="popover-item" role="menuitem" onClick={() => applyTemplate(t)}>
                      <b>{t.name}</b><span>{t.description}</span>
                    </button>
                  ))}
                  {!templates.length && <div className="popover-item"><span>Loading…</span></div>}
                </div>
              )}
            </div>
            <button className="btn sm quiet" onClick={fit} title="Fit the office to the view">Fit</button>
            <button className="btn sm quiet" onClick={() => setShowLabels((v) => !v)} aria-pressed={showLabels}>
              {showLabels ? "Hide names" : "Show names"}
            </button>
          </div>
          {error && <div className="stage-error" role="alert">{error}</div>}
        </>
      )}
    </div>
  );
}
