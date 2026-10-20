import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import Tree from 'react-d3-tree'
import type { CustomNodeElementProps, RawNodeDatum } from 'react-d3-tree'
import { Button, Tile } from '@carbon/react'
import {
  CenterToFit,
  ChevronDown,
  ChevronRight,
  UserMultiple,
  WarningAltFilled,
  ZoomIn,
  ZoomOut,
} from '@carbon/icons-react'
import { getDirectReports } from '../api/client'
import { AvatarCircle } from './AvatarCircle'
import type { Employee, OrgNode } from '../api/client'

const CARD_WIDTH = 184
const CARD_HEIGHT = 56
// Links are drawn behind nodes, but a straight step path still runs through the
// node's own bounding box near its start/end point. Route the path to clear each
// card's edge (with a small gap) instead, so it never crosses through the name.
const LINK_CLEARANCE = CARD_HEIGHT / 2 + 8
// x is the sibling pitch, y the depth pitch: react-d3-tree hands d3-hierarchy
// [nodeSize.x, nodeSize.y] for a vertical tree, and d3 scales the sibling axis by the
// first and sets depth to `depth * second`.
const NODE_SIZE = { x: 200, y: 124 }
// `siblings` multiplies the sibling pitch only, so adjacent cards sit 230px apart.
const SEPARATION = { siblings: 1.15, nonSiblings: 1.4 }
const ZOOM_MIN = 0.2
const ZOOM_MAX = 1.6
const DEFAULT_ZOOM = 0.8
// How far down the canvas the selected card sits. Above centre, so the person's own
// reports - which grow downward - stay in frame with them.
const SELECTED_Y_FRACTION = 0.34

// A node's visual role. Every card is built the same way; this picks the emphasis.
type NodeRole = 'self' | 'ancestor' | 'peer' | 'report'
// 'none' means there is nothing to expand, so no chevron is drawn at all.
type ExpandState = 'none' | 'closed' | 'loading' | 'error' | 'empty' | 'open'

// 'empty' is its own remembered outcome rather than done-with-no-children: MGR is an
// HR manager indicator, so someone flagged as a manager can legitimately have no
// current reports, and without remembering that, the chevron would refetch nothing
// every time it was clicked.
type ChildFetch =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'empty' }
  | { status: 'done'; children: Employee[] }

type ExpandedMap = Record<string, ChildFetch>

// `title` is recorded for only a minority of employees, and the endpoints behind the
// chart return `department` as a raw code, so fall through until something is there.
// (LOCCITY, the one field that would give a city for free, is unpopulated.)
function secondLine(employee: Employee): string {
  return employee.title || employee.department || employee.location || ''
}

function nodeFor(
  employee: Employee,
  role: NodeRole,
  expandState: ExpandState,
  children: RawNodeDatum[],
): RawNodeDatum {
  return {
    name: employee.display_name,
    attributes: {
      id: employee.id,
      kind: 'employee',
      role,
      subtitle: secondLine(employee),
      expandState,
    },
    children,
  }
}

// Resolves what hangs below a node the payload gave no children for: nothing, or
// whatever its chevron has fetched. `canExpand` says whether a chevron is offered at
// all - from `has_more_reports` where the org-chart payload knows, and from
// `is_manager` for peers, where it doesn't.
function leafNode(
  employee: Employee,
  role: NodeRole,
  canExpand: boolean,
  expanded: ExpandedMap,
  seen: Set<string>,
): RawNodeDatum {
  const fetched = expanded[employee.id]
  if (!fetched) return nodeFor(employee, role, canExpand ? 'closed' : 'none', [])
  if (fetched.status === 'loading') return nodeFor(employee, role, 'loading', [])
  if (fetched.status === 'error') return nodeFor(employee, role, 'error', [])
  if (fetched.status === 'empty') return nodeFor(employee, role, 'empty', [])
  // Directory data is user-maintained and has carried bad manager pointers before; a
  // cycle here would recurse until the stack gave out.
  const next = new Set(seen).add(employee.id)
  const children = fetched.children
    .filter((child) => !next.has(child.id))
    .map((child) => leafNode(child, 'report', child.is_manager, expanded, next))
  return nodeFor(employee, role, 'open', children)
}

function orgNodeToRaw(
  node: OrgNode,
  role: NodeRole,
  expanded: ExpandedMap,
  seen: Set<string>,
): RawNodeDatum {
  if (node.direct_reports.length === 0) {
    // `has_more_reports` is authoritative here and `is_manager` is not: the backend
    // probes one level past the depth boundary, whereas MGR is an HR flag that is set
    // on people with no current reports (11 of 20 flagged against 8 with reports, on
    // the org measured). Trusting MGR here would draw chevrons known to lead nowhere.
    return leafNode(node.employee, role, node.has_more_reports, expanded, seen)
  }
  const next = new Set(seen).add(node.employee.id)
  const children = node.direct_reports
    .filter((child) => !next.has(child.employee.id))
    .map((child) => orgNodeToRaw(child, 'report', expanded, next))
  // 'none', not 'open': these children came with the page rather than from a chevron,
  // so there is nothing for a chevron to reveal and nothing it should collapse. Only a
  // node whose children were fetched on demand gets one.
  return nodeFor(node.employee, role, 'none', children)
}

// Lays out a sibling row around the one member that carries the rest of the tree: the
// others are sorted by surname for stability across visits (matching how the search
// table sorts) and split evenly either side, so the spine stays in the middle and its
// link to the manager above stays short and near-vertical.
function rowAround(
  reports: Employee[],
  spine: RawNodeDatum,
  spineId: string,
  expanded: ExpandedMap,
): RawNodeDatum[] {
  const others = reports
    .filter((person) => person.id !== spineId)
    .sort((a, b) => a.last_name.localeCompare(b.last_name))
  const half = Math.floor(others.length / 2)
  const toLeaf = (person: Employee) => leafNode(person, 'peer', person.is_manager, expanded, new Set())
  return [...others.slice(0, half).map(toLeaf), spine, ...others.slice(half).map(toLeaf)]
}

interface BuildArgs {
  managerChain: Employee[]
  orgNode: OrgNode
  peers: Employee[]
  expanded: ExpandedMap
  showFullChain: boolean
}

function buildTreeData({ managerChain, orgNode, peers, expanded, showFullChain }: BuildArgs): RawNodeDatum {
  const selfId = orgNode.employee.id
  const selfRaw = orgNodeToRaw(orgNode, 'self', expanded, new Set())

  // Peers are drawn as leaves on purpose: the row is already as wide as the manager's
  // whole span, and expanding every peer's reports would multiply that. A peer's
  // reports load only when their chevron is clicked. Don't rebuild this row from
  // getOrgChart - getDirectReports returns flat Employee records, which is the point.
  //
  // `rowAround` filters the selected employee out before splitting, so this is correct
  // whether or not they appear in `peers` - they won't when the lookup failed, and then
  // the row is just them.
  let level: RawNodeDatum[] = rowAround(peers, selfRaw, selfId, expanded)

  // managerChain is self -> manager -> skip-level -> ... -> top.
  const chainUp = managerChain.slice(1)
  // The direct manager and the skip-level manager stay as real nodes; the rest of the
  // chain folds into one node, so a deep chain doesn't push the person you came to
  // look at off the bottom of the canvas.
  const kept = showFullChain ? chainUp : chainUp.slice(0, 2)
  const hidden = showFullChain ? [] : chainUp.slice(2)

  // Ancestors are drawn with the chain below them, so they carry no chevron - with one
  // exception. The skip-level manager (index 1, since `kept` runs upward from the direct
  // manager) can be expanded to bring in the rest of its reports, i.e. your manager's
  // peers. Its chain child is kept throughout: unlike a leaf, this node always has
  // something below it, so a pending or failed fetch must not drop the tree underneath.
  for (const [index, ancestor] of kept.entries()) {
    if (index !== 1) {
      level = [nodeFor(ancestor, 'ancestor', 'none', level)]
      continue
    }
    const fetched = expanded[ancestor.id]
    if (!fetched) {
      level = [nodeFor(ancestor, 'ancestor', 'closed', level)]
    } else if (fetched.status === 'done') {
      // The direct manager is the spine, so it stays in the middle and the chain below
      // it hangs where it already was.
      level = [nodeFor(ancestor, 'ancestor', 'open', rowAround(fetched.children, level[0], kept[0].id, expanded))]
    } else {
      level = [nodeFor(ancestor, 'ancestor', fetched.status, level)]
    }
  }
  if (hidden.length > 0) {
    level = [
      {
        name: `${hidden.length} more manager${hidden.length === 1 ? '' : 's'}`,
        attributes: { kind: 'more-ancestors', id: '', role: 'ancestor', subtitle: '', expandState: 'closed' },
        children: level,
      },
    ]
  }
  return level[0]
}

// Assumes a vertical tree: it clears the cards on the y axis, and ignores the
// `orientation` that react-d3-tree passes as a second argument.
function stepAroundCards(linkData: { source: { x: number; y: number }; target: { x: number; y: number } }) {
  const { source, target } = linkData
  const y1 = source.y + LINK_CLEARANCE
  const y2 = target.y - LINK_CLEARANCE
  const midY = y1 + (y2 - y1) / 2
  return `M${source.x},${y1} V${midY} H${target.x} V${y2}`
}

const cardBase: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: CARD_WIDTH - 2,
  height: CARD_HEIGHT - 2,
  padding: '0 8px 0 10px',
  boxSizing: 'border-box',
  borderRadius: 8,
  background: 'var(--bg)',
}

function ellipsis(fontSize: number, fontWeight: number, color: string): CSSProperties {
  return { fontSize, fontWeight, color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
}

// `style` is typed as the CSS keyword union, not string, so the per-side border
// longhands below satisfy CSSProperties.
type BorderStyleKeyword = 'solid' | 'dashed'
type Edge = readonly [width: string, style: BorderStyleKeyword, color: string]

// Expandable and loading cards look like any other card: the chevron is the only
// affordance, so a dashed outline on top of it was noise rather than information. Only
// the selected card and a failed fetch change the border.
function edgeFor(role: NodeRole, state: ExpandState): Edge {
  if (role === 'self') return ['2px', 'solid', 'var(--accent)']
  if (state === 'error') return ['1px', 'solid', 'var(--cds-support-warning, #f1c21b)']
  return ['1px', 'solid', 'var(--border)']
}

// Every side is written out individually, and none is ever conditionally omitted. React
// warns (and can mis-apply styles) whenever one render sets a shorthand like `border` or
// `borderWidth` and another sets `borderLeftWidth` on the same element - which is what
// happens when a card changes role, since only `report` tints its left edge.
function cardBorder(role: NodeRole, state: ExpandState): CSSProperties {
  const [width, style, color] = edgeFor(role, state)
  // A tinted left edge marks "inside my org" without spending a second border weight.
  const [lw, ls, lc]: Edge = role === 'report' ? ['3px', 'solid', 'var(--accent)'] : [width, style, color]
  return {
    borderTopWidth: width,
    borderRightWidth: width,
    borderBottomWidth: width,
    borderLeftWidth: lw,
    borderTopStyle: style,
    borderRightStyle: style,
    borderBottomStyle: style,
    borderLeftStyle: ls,
    borderTopColor: color,
    borderRightColor: color,
    borderBottomColor: color,
    borderLeftColor: lc,
  }
}

function ExpandControl({ state, name, onToggle }: { state: ExpandState; name: string; onToggle: () => void }) {
  if (state === 'none') return null

  const shared: CSSProperties = {
    flexShrink: 0,
    width: 20,
    height: 20,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    border: 'none',
    background: 'transparent',
    color: 'var(--text)',
  }

  if (state === 'loading') {
    return <span style={shared} className="org-chart-spinner" aria-label={`Loading reports for ${name}`} />
  }
  if (state === 'empty') {
    return (
      <span style={{ ...shared, color: 'var(--border)' }} title="No direct reports" aria-label="No direct reports">
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
      </span>
    )
  }

  const isOpen = state === 'open'
  const isError = state === 'error'
  return (
    <button
      type="button"
      aria-expanded={isOpen}
      aria-label={
        isError
          ? `Retry loading reports for ${name}`
          : isOpen
            ? `Hide reports for ${name}`
            : `Show reports for ${name}`
      }
      // The enclosing <g> carries the navigation handler, so the chevron has to stop
      // the click from reaching it.
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      style={{
        ...shared,
        cursor: 'pointer',
        color: isError ? 'var(--cds-support-warning, #f1c21b)' : 'var(--text)',
      }}
    >
      {isError ? <WarningAltFilled size={16} /> : isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
    </button>
  )
}

interface OrgChartProps {
  managerChain: Employee[]
  orgNode: OrgNode
  // Direct reports of the employee's manager, i.e. the employee and their peers.
  peers: Employee[]
  selectedId: string
  // The enriched record for the selected employee. Only this one node can show a
  // resolved department name; every other card comes from an endpoint that returns
  // the raw code.
  selfEmployee?: Employee | null
  onSelect: (id: string) => void
}

type View = { x: number; y: number; k: number }

export function OrgChart({ managerChain, orgNode, peers, selectedId, selfEmployee, onSelect }: OrgChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 600, height: 520 })

  const [expanded, setExpanded] = useState<ExpandedMap>({})
  const [showFullChain, setShowFullChain] = useState(false)

  const [view, setView] = useState<View>({ x: 300, y: 80, k: DEFAULT_ZOOM })
  // Free-hand pan and zoom land here instead of in state, so dragging the canvas costs
  // no React renders. The buttons read it to zoom relative to what you can see.
  const liveView = useRef<View>(view)
  // Layout coordinates per employee, written while the tree renders: react-d3-tree
  // hands each custom node its `hierarchyPointNode`, so centring needs no DOM reads.
  const nodePos = useRef(new Map<string, { x: number; y: number }>())
  const centeredFor = useRef<string | null>(null)
  // Set just before an expand/collapse changes the tree, holding the screen position
  // the clicked card occupied. The layout effect below puts it back there afterwards.
  const pendingAnchor = useRef<{ id: string; sx: number; sy: number } | null>(null)
  // One generation per employee, not one counter for the whole chart: a single counter
  // meant expanding a second person discarded the first person's in-flight result and
  // left them spinning forever.
  const fetchGen = useRef(new Map<string, number>())

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width && rect.height) setSize({ width: rect.width, height: rect.height })
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (box?.width && box?.height) setSize({ width: box.width, height: box.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const treeData = useMemo(
    () => buildTreeData({ managerChain, orgNode, peers, expanded, showFullChain }),
    [managerChain, orgNode, peers, expanded, showFullChain],
  )

  const viewCenteredOn = useCallback(
    (employeeId: string, k: number): View | null => {
      const point = nodePos.current.get(employeeId)
      if (!point) return null
      // Vertical layout: layout x is screen x, layout y is screen y, and the card is
      // centred on the node's origin.
      const x = size.width / 2 - point.x * k
      // The root always sits at layout y = 0, so the deepest node is the tree's height.
      const depth = Math.max(0, ...[...nodePos.current.values()].map((p) => p.y))
      const contentHeight = depth * k + CARD_HEIGHT * k
      const margin = CARD_HEIGHT / 2 * k + 16
      // When the whole tree fits, centre the tree itself - biasing to the selected
      // person would only strand dead space at one end. When it doesn't fit, bias to
      // the selected person but never above the top edge, or centring on someone three
      // levels deep would push their manager chain off-canvas, which is the context the
      // chain exists to give.
      if (contentHeight <= size.height - 2 * margin) {
        return { k, x, y: (size.height - contentHeight) / 2 + CARD_HEIGHT / 2 * k }
      }
      return { k, x, y: Math.max(margin, size.height * SELECTED_Y_FRACTION - point.y * k) }
    },
    [size.width, size.height],
  )

  // Children render before a parent's effects run, so `nodePos` already holds this
  // pass's coordinates. `centeredFor` is what stops the setView -> render -> effect
  // cycle from repeating.
  useLayoutEffect(() => {
    // Keyed on what arrives with the page, never on the card's layout position. Both
    // the canvas size and `peers` land a tick after the first paint - peers resolve
    // after the page's initial Promise.all - so the key has to cover them or the view
    // stays centred on the single-child chain it was first handed. It must NOT cover
    // the card's position: expanding a peer re-lays out the whole tree and moves this
    // card by hundreds of pixels, and re-centring on that yanked the camera far enough
    // to throw the manager chain off-screen. An expansion keeps the camera still and
    // preserves the clicked card's position instead (see `pendingAnchor`).
    const key = [
      selectedId,
      Math.round(size.width),
      Math.round(size.height),
      managerChain.length,
      peers.length,
    ].join(':')
    if (centeredFor.current === key) return
    const next = viewCenteredOn(selectedId, DEFAULT_ZOOM)
    if (!next) return
    centeredFor.current = key
    liveView.current = next
    setView(next)
  }, [selectedId, treeData, viewCenteredOn, size.width, size.height, managerChain.length, peers.length])

  // Expanding or collapsing changes every sibling's position, so without this the card
  // you clicked would jump out from under the cursor. Runs after the new layout, and
  // only when an expand/collapse actually armed an anchor - a mere loading-state change
  // moves nothing.
  useLayoutEffect(() => {
    const anchor = pendingAnchor.current
    if (!anchor) return
    pendingAnchor.current = null
    const point = nodePos.current.get(anchor.id)
    if (!point) return
    const k = liveView.current.k
    applyView({ k, x: anchor.sx - point.x * k, y: anchor.sy - point.y * k })
  }, [treeData])

  function applyView(next: View) {
    liveView.current = next
    setView(next)
  }

  function zoomBy(factor: number) {
    const { x, y, k } = liveView.current
    const k2 = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, k * factor))
    if (k2 === k) return
    // Anchor on the canvas centre so the view doesn't drift, and move translate and
    // zoom together: changing zoom alone makes react-d3-tree rebind its zoom listener
    // using the translate prop, which throws away any free-hand panning.
    const cx = size.width / 2
    const cy = size.height / 2
    applyView({ k: k2, x: cx - (cx - x) * (k2 / k), y: cy - (cy - y) * (k2 / k) })
  }

  function centerOnSelected() {
    const next = viewCenteredOn(selectedId, liveView.current.k)
    if (next) applyView(next)
  }

  // Records where this card sits on screen right now, so the view can be shifted to
  // hold it there once the tree relaid out around its new children.
  function armAnchor(id: string) {
    const point = nodePos.current.get(id)
    if (!point) return
    const { x, y, k } = liveView.current
    pendingAnchor.current = { id, sx: x + point.x * k, sy: y + point.y * k }
  }

  function toggleExpand(id: string) {
    const current = expanded[id]
    if (current?.status === 'loading') return
    // An 'empty' result is kept rather than cleared, so it isn't fetched again.
    if (current?.status === 'done') {
      armAnchor(id)
      setExpanded(({ [id]: _removed, ...rest }) => rest)
      return
    }
    const generation = (fetchGen.current.get(id) ?? 0) + 1
    fetchGen.current.set(id, generation)
    setExpanded((prev) => ({ ...prev, [id]: { status: 'loading' } }))
    getDirectReports(id)
      .then((res) => {
        if (fetchGen.current.get(id) !== generation) return
        // Armed here rather than on the click: the loading state adds no children, so
        // the layout only moves once the children themselves land.
        if (res.reports.length) armAnchor(id)
        setExpanded((prev) => ({
          ...prev,
          [id]: res.reports.length ? { status: 'done', children: res.reports } : { status: 'empty' },
        }))
      })
      // A failed expansion costs one branch, not the page - the chevron becomes a
      // warning you can click to retry.
      .catch(() => {
        if (fetchGen.current.get(id) !== generation) return
        setExpanded((prev) => ({ ...prev, [id]: { status: 'error' } }))
      })
  }

  function renderNode({ nodeDatum, hierarchyPointNode, onNodeClick }: CustomNodeElementProps) {
    const attrs = nodeDatum.attributes ?? {}
    const id = String(attrs.id ?? '')
    const role = String(attrs.role ?? 'peer') as NodeRole
    const expandState = String(attrs.expandState ?? 'none') as ExpandState
    if (id) nodePos.current.set(id, { x: hierarchyPointNode.x, y: hierarchyPointNode.y })

    if (attrs.kind === 'more-ancestors') {
      return (
        <g onClick={onNodeClick} style={{ cursor: 'pointer' }}>
          <foreignObject
            width={CARD_WIDTH}
            height={CARD_HEIGHT}
            x={-CARD_WIDTH / 2}
            y={-CARD_HEIGHT / 2}
            overflow="visible"
          >
            <div
              style={{
                ...cardBase,
                ...cardBorder('ancestor', 'none'),
                borderTopStyle: 'dashed',
                borderRightStyle: 'dashed',
                borderBottomStyle: 'dashed',
                borderLeftStyle: 'dashed',
                justifyContent: 'center',
                color: 'var(--text)',
              }}
            >
              <UserMultiple size={16} />
              <span style={{ fontSize: 12 }}>{nodeDatum.name}</span>
            </div>
          </foreignObject>
        </g>
      )
    }

    const isSelf = role === 'self'
    // The selected card is the only one where a resolved department name exists.
    const subtitle =
      isSelf && selfEmployee
        ? secondLine({ ...selfEmployee, department: selfEmployee.department_name ?? selfEmployee.department })
        : String(attrs.subtitle ?? '')

    return (
      <g onClick={onNodeClick} style={{ cursor: 'pointer' }}>
        <foreignObject
          width={CARD_WIDTH}
          height={CARD_HEIGHT}
          x={-CARD_WIDTH / 2}
          y={-CARD_HEIGHT / 2}
          overflow="visible"
        >
          <div
            style={{
              ...cardBase,
              ...cardBorder(role, expandState),
              boxShadow: isSelf ? '0 2px 6px rgba(15, 98, 254, 0.25)' : '0 1px 2px rgba(0, 0, 0, 0.06)',
            }}
            title={[nodeDatum.name, subtitle].filter(Boolean).join(' · ')}
          >
            <AvatarCircle id={id} name={nodeDatum.name} size={28} isSelf={isSelf} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={ellipsis(12, 600, 'var(--text-h)')}>{nodeDatum.name}</div>
              {/* Always rendered, even when empty: the depth pitch is one constant, so
                  a card that changed height would make the rows ragged. */}
              <div style={{ ...ellipsis(11, 400, 'var(--text)'), opacity: role === 'peer' ? 0.75 : 1 }}>
                {subtitle || ' '}
              </div>
            </div>
            <ExpandControl state={expandState} name={nodeDatum.name} onToggle={() => toggleExpand(id)} />
          </div>
        </foreignObject>
      </g>
    )
  }

  return (
    <Tile style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: 'var(--text-h)' }}>Org chart</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Button
            kind="ghost"
            size="sm"
            hasIconOnly
            renderIcon={ZoomOut}
            iconDescription="Zoom out"
            onClick={() => zoomBy(1 / 1.25)}
          />
          <Button
            kind="ghost"
            size="sm"
            hasIconOnly
            renderIcon={ZoomIn}
            iconDescription="Zoom in"
            onClick={() => zoomBy(1.25)}
          />
          <Button
            kind="ghost"
            size="sm"
            hasIconOnly
            renderIcon={CenterToFit}
            iconDescription="Centre on this person"
            onClick={centerOnSelected}
          />
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          flexWrap: 'wrap',
          marginTop: 4,
          fontSize: 12,
          color: 'var(--text)',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ChevronRight size={14} />
          Click to load reports
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              border: '2px solid var(--accent)',
              display: 'inline-block',
            }}
          />
          Currently viewing
        </span>
      </div>

      <div
        ref={containerRef}
        className="org-chart-canvas"
        style={{
          width: '100%',
          // Bounded and panned rather than grown: a wide peer row is thousands of pixels
          // of layout. The chart sits below the profile/chat row, so it is scrolled to
          // rather than fitted above the fold - hence a near-viewport height.
          height: 'clamp(520px, calc(100vh - 120px), 900px)',
          marginTop: 16,
          borderRadius: 8,
          overflow: 'hidden',
          background: 'var(--cds-layer-01, #f4f4f4)',
        }}
      >
        <Tree
          data={treeData}
          orientation="vertical"
          translate={{ x: view.x, y: view.y }}
          zoom={view.k}
          // Without this the default max of 1 silently caps zooming in.
          scaleExtent={{ min: ZOOM_MIN, max: ZOOM_MAX }}
          nodeSize={NODE_SIZE}
          separation={SEPARATION}
          pathFunc={stepAroundCards}
          renderCustomNodeElement={renderNode}
          onNodeClick={(node) => {
            const attrs = node.data.attributes ?? {}
            if (attrs.kind === 'more-ancestors') {
              setShowFullChain(true)
              return
            }
            const id = attrs.id
            if (typeof id !== 'string' || !id) return
            // Clicking the person you're already on re-centres, rather than navigating
            // to the route you're already on.
            if (id === selectedId) centerOnSelected()
            else onSelect(id)
          }}
          onUpdate={({ zoom, translate }) => {
            liveView.current = { x: translate.x, y: translate.y, k: zoom }
          }}
          // Expansion is ours, not the library's: its own addChildren pushes without
          // dedupe and has nowhere to record a pending or failed fetch.
          collapsible={false}
          zoomable
          draggable
        />
      </div>
    </Tile>
  )
}
