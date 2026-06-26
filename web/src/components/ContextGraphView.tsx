"use client";

import { useEffect, useRef, useState } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { select } from "d3-selection";
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
import { Maximize2, Network, RotateCcw } from "lucide-react";
import { motion } from "framer-motion";

import { useCallStore } from "@/state/useCallStore";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusChip } from "@/components/ui/StatusChip";
import { cn } from "@/lib/cn";

const TYPE_COLOR: Record<string, string> = {
  member: "#6366f1",
  coverage: "#10b981",
  plan: "#14b8a6",
  claim: "#f59e0b",
  carc: "#ef4444",
  auth: "#8b5cf6",
  provider: "#64748b",
  payer: "#3b82f6",
  note: "#ec4899", // recorded on the call (conversational memory)
};

const W = 460;
const H = 360;
const PAD = 30;

function colorFor(type: string): string {
  return TYPE_COLOR[type] ?? "#64748b";
}
function relationLabel(label: string): string {
  return label.replace(/_/g, " ").toLowerCase();
}

interface GNode extends SimulationNodeDatum {
  id: string;
  type: string;
  label: string;
  score: number;
  lit: boolean;
  seed: boolean;
  hops: number | null;
}
interface GLink extends SimulationLinkDatum<GNode> {
  lit: boolean;
  label: string;
}

/**
 * D3 force-directed context-graph viz. Lays out once (stable, clamped), grows as
 * the call surfaces records, lit slice highlights + reheats per turn. Nodes are
 * draggable; the canvas is pan/zoomable (d3-zoom); an expand button opens a large
 * view. `height` sizes the canvas; `expandable` shows the fullscreen control.
 */
export function ContextGraphView({ height = 200, expandable = true }: { height?: number; expandable?: boolean } = {}) {
  const subgraph = useCallStore((s) => s.subgraph);
  const hasSubgraph = subgraph != null;
  const [hover, setHover] = useState<GNode | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [, setTick] = useState(0);

  const simRef = useRef<Simulation<GNode, GLink> | null>(null);
  const nodesRef = useRef<GNode[]>([]);
  const linksRef = useRef<GLink[]>([]);
  const sigRef = useRef<string>("");
  const svgRef = useRef<SVGSVGElement | null>(null);
  const viewportRef = useRef<SVGGElement | null>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const dragRef = useRef<string | null>(null);

  // --- simulation build / grow ---
  useEffect(() => {
    if (!subgraph || subgraph.nodes.length === 0) {
      simRef.current?.stop();
      simRef.current = null;
      nodesRef.current = [];
      linksRef.current = [];
      sigRef.current = "";
      setTick((t) => t + 1);
      return;
    }
    const sig = subgraph.nodes.map((n) => n.id).sort().join(",");
    if (sig !== sigRef.current) {
      const grew = sigRef.current !== "" && subgraph.nodes.length > nodesRef.current.length;
      sigRef.current = sig;
      const prevById = new Map(nodesRef.current.map((n) => [n.id, n]));
      const center = prevById.get(subgraph.nodes.find((n) => n.type === "member")?.id ?? "") ?? null;
      const cx = center?.x ?? W / 2;
      const cy = center?.y ?? H / 2;
      const nodes: GNode[] = subgraph.nodes.map((n) => {
        const prev = prevById.get(n.id);
        return {
          id: n.id,
          type: n.type,
          label: n.label,
          score: n.score,
          lit: n.lit,
          seed: n.seed,
          hops: n.hops ?? null,
          x: prev?.x ?? cx + (Math.random() - 0.5) * 60,
          y: prev?.y ?? cy + (Math.random() - 0.5) * 60,
          vx: prev?.vx,
          vy: prev?.vy,
        };
      });
      const byId = new Map(nodes.map((n) => [n.id, n]));
      const links: GLink[] = subgraph.edges
        .filter((e) => byId.has(e.source) && byId.has(e.target))
        .map((e) => ({ source: e.source, target: e.target, lit: e.lit, label: e.label }));
      nodesRef.current = nodes;
      linksRef.current = links;

      simRef.current?.stop();
      const sim = forceSimulation<GNode, GLink>(nodes)
        .force("link", forceLink<GNode, GLink>(links).id((d) => d.id).distance(70).strength(0.5))
        .force("charge", forceManyBody().strength(-180))
        .force("center", forceCenter(W / 2, H / 2))
        .force("x", forceX(W / 2).strength(0.06))
        .force("y", forceY(H / 2).strength(0.06))
        .force("collide", forceCollide(26));
      sim.on("tick", () => {
        for (const n of nodes) {
          n.x = Math.max(PAD, Math.min(W - PAD, n.x ?? W / 2));
          n.y = Math.max(PAD, Math.min(H - PAD, n.y ?? H / 2));
        }
        setTick((t) => t + 1);
      });
      sim.alpha(grew ? 0.5 : 1).restart();
      simRef.current = sim;
    } else {
      const incoming = new Map(subgraph.nodes.map((n) => [n.id, n]));
      for (const n of nodesRef.current) {
        const u = incoming.get(n.id);
        if (u) {
          n.lit = u.lit;
          n.seed = u.seed;
          n.score = u.score;
          n.hops = u.hops ?? null;
        }
      }
      const litIds = new Set(subgraph.nodes.filter((n) => n.lit).map((n) => n.id));
      for (const l of linksRef.current) {
        const s = typeof l.source === "object" ? (l.source as GNode).id : (l.source as string);
        const t = typeof l.target === "object" ? (l.target as GNode).id : (l.target as string);
        l.lit = litIds.has(s) && litIds.has(t);
      }
      simRef.current?.alpha(0.3).restart();
    }
  }, [subgraph]);

  useEffect(() => () => void simRef.current?.stop(), []);

  // --- pan / zoom ---
  useEffect(() => {
    const svg = svgRef.current;
    const vp = viewportRef.current;
    if (!svg || !vp) return;
    const zb = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.4, 5])
      .filter((event: any) => {
        // wheel zoom + background drag pan; ignore drags that start on a node
        if (event.type === "wheel") return true;
        const t = event.target as Element;
        return !t.closest?.("[data-node]");
      })
      .on("zoom", (event) => {
        vp.setAttribute("transform", event.transform.toString());
      });
    select(svg).call(zb).on("dblclick.zoom", null);
    zoomRef.current = zb;
    return () => {
      select(svg).on(".zoom", null);
    };
  }, [hasSubgraph, expanded]);

  function resetView() {
    const svg = svgRef.current;
    if (svg && zoomRef.current) select(svg).call(zoomRef.current.transform, zoomIdentity);
  }

  // --- node drag (maps through the viewport's zoom transform) ---
  function toLocal(clientX: number, clientY: number): { x: number; y: number } | null {
    const vp = viewportRef.current;
    if (!vp) return null;
    const ctm = vp.getScreenCTM();
    if (!ctm) return null;
    const pt = (svgRef.current as SVGSVGElement).createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }
  function onPointerDown(e: React.PointerEvent, n: GNode) {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = n.id;
    simRef.current?.alphaTarget(0.3).restart();
    n.fx = n.x;
    n.fy = n.y;
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const n = nodesRef.current.find((x) => x.id === dragRef.current);
    const p = toLocal(e.clientX, e.clientY);
    if (n && p) {
      n.fx = Math.max(PAD, Math.min(W - PAD, p.x));
      n.fy = Math.max(PAD, Math.min(H - PAD, p.y));
    }
  }
  function onPointerUp() {
    const id = dragRef.current;
    dragRef.current = null;
    simRef.current?.alphaTarget(0);
    const n = nodesRef.current.find((x) => x.id === id);
    if (n) {
      n.fx = null;
      n.fy = null;
    }
  }

  const nodes = nodesRef.current;
  const links = linksRef.current;
  const litCount = subgraph?.nodes.filter((n) => n.lit).length ?? 0;
  const types = Array.from(new Set((subgraph?.nodes ?? []).map((n) => n.type)));

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-muted-foreground"><Network className="h-4 w-4" /></span>
          <div className="min-w-0">
            <CardTitle className="truncate">Context graph</CardTitle>
            <p className="truncate text-xs text-muted-foreground">Grows as the call surfaces records · drag · scroll to zoom</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {subgraph && <StatusChip tone="blue">{litCount} / {subgraph.nodes.length} lit</StatusChip>}
          {subgraph && (
            <button type="button" onClick={resetView} title="Reset view" className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
          {expandable && subgraph && (
            <button type="button" onClick={() => setExpanded(true)} title="Expand" className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </CardHeader>

      <div className="relative flex-1 overflow-hidden p-2" style={{ minHeight: height }}>
        {!subgraph ? (
          <div className="flex h-full min-h-[220px] items-center justify-center px-6 text-center text-xs text-muted-foreground">
            Start a session — the agent builds a context graph from the payer's records and lights up the slice it retrieves to ground each turn.
          </div>
        ) : (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="h-full w-full cursor-grab touch-none select-none overflow-hidden active:cursor-grabbing"
            role="img"
            aria-label="Context graph"
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          >
            <g ref={viewportRef}>
              {links.map((l, i) => {
                const s = l.source as GNode;
                const t = l.target as GNode;
                if (typeof s !== "object" || typeof t !== "object" || s.x == null || t.x == null || s.y == null || t.y == null) return null;
                const mx = (s.x + t.x) / 2;
                const my = (s.y + t.y) / 2;
                return (
                  <g key={i}>
                    <line
                      x1={s.x}
                      y1={s.y}
                      x2={t.x}
                      y2={t.y}
                      stroke={l.lit ? "#6366f1" : "currentColor"}
                      strokeOpacity={l.lit ? 0.6 : 0.1}
                      strokeWidth={l.lit ? 1.6 : 1}
                      className="text-muted-foreground"
                    />
                    {l.lit && (
                      <text x={mx} y={my - 2} textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 6.5, fontWeight: 500 }}>
                        {relationLabel(l.label)}
                      </text>
                    )}
                  </g>
                );
              })}
              {nodes.map((n) => {
                if (n.x == null || n.y == null) return null;
                const c = colorFor(n.type);
                const r = 6 + Math.min(1, n.score) * 8;
                return (
                  <g
                    key={n.id}
                    data-node
                    transform={`translate(${n.x} ${n.y})`}
                    onPointerDown={(e) => onPointerDown(e, n)}
                    onMouseEnter={() => setHover(n)}
                    onMouseLeave={() => setHover((h) => (h?.id === n.id ? null : h))}
                    className="cursor-grab active:cursor-grabbing"
                  >
                    {n.seed && n.lit && (
                      <motion.circle
                        r={r + 6}
                        fill="none"
                        stroke={c}
                        strokeWidth={1.5}
                        initial={{ opacity: 0.5, scale: 0.9 }}
                        animate={{ opacity: [0.5, 0.1, 0.5], scale: [0.95, 1.18, 0.95] }}
                        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                      />
                    )}
                    <circle
                      r={r}
                      fill={c}
                      fillOpacity={n.lit ? 0.9 : 0.16}
                      stroke={c}
                      strokeOpacity={n.lit ? 1 : 0.25}
                      strokeWidth={n.lit ? 1.5 : 1}
                    />
                    {n.lit && (
                      <text y={r + 11} textAnchor="middle" className="fill-foreground" style={{ fontSize: 8, fontWeight: 500 }}>
                        {n.label.length > 18 ? n.label.slice(0, 17) + "…" : n.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
        )}

        {hover && (
          <div className="liquid-glass pointer-events-none absolute right-3 top-3 max-w-[220px] rounded-lg p-2.5 text-left shadow-pop">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colorFor(hover.type) }} />
              <span className="text-[11px] font-semibold capitalize text-foreground">{hover.type}</span>
              {hover.seed && <span className="text-[10px] text-brand-600 dark:text-brand-300">· seed</span>}
            </div>
            <div className="mt-0.5 text-xs font-medium text-foreground">{hover.label}</div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">
              score {hover.score.toFixed(2)}{hover.hops != null ? ` · ${hover.hops} hop${hover.hops === 1 ? "" : "s"} from seed` : ""}
            </div>
          </div>
        )}
      </div>

      {subgraph && types.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border px-4 py-2.5">
          {types.map((t) => (
            <span key={t} className="flex items-center gap-1.5 text-[10px] capitalize text-muted-foreground">
              <span className={cn("h-2 w-2 rounded-full")} style={{ backgroundColor: colorFor(t) }} />
              {t}
            </span>
          ))}
        </div>
      )}

      {expandable && (
        <Dialog open={expanded} onOpenChange={setExpanded}>
          <DialogContent className="max-w-5xl">
            <DialogHeader>
              <DialogTitle>Context graph</DialogTitle>
            </DialogHeader>
            <div className="h-[70vh]">
              <ContextGraphView height={620} expandable={false} />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}
