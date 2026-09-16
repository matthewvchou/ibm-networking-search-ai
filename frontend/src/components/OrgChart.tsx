import { useEffect, useRef, useState } from 'react'
import Tree from 'react-d3-tree'
import type { CustomNodeElementProps, RawNodeDatum } from 'react-d3-tree'
import { Tile } from '@carbon/react'
import type { Employee, OrgNode } from '../api/client'
import { formatDisplayName } from '../utils/formatName'

function orgNodeToRaw(node: OrgNode): RawNodeDatum {
  return {
    name: formatDisplayName(node.employee.display_name),
    attributes: {
      id: node.employee.id,
      hasMore: node.has_more_reports,
    },
    children: node.direct_reports.map(orgNodeToRaw),
  }
}

function buildTreeData(managerChain: Employee[], orgNode: OrgNode): RawNodeDatum {
  const ancestors = managerChain.slice(1).reverse()
  const rootDescendant = orgNodeToRaw(orgNode)
  return ancestors.reduceRight<RawNodeDatum>(
    (child, ancestor) => ({
      name: formatDisplayName(ancestor.display_name),
      attributes: { id: ancestor.id, hasMore: false },
      children: [child],
    }),
    rootDescendant,
  )
}

function initialsOf(name: string): string {
  const parts = name.split(' ').filter(Boolean)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : ''
  return (first + last).toUpperCase()
}

interface OrgChartProps {
  managerChain: Employee[]
  orgNode: OrgNode
  selectedId: string
  onSelect: (id: string) => void
}

const CARD_WIDTH = 160
const CARD_HEIGHT = 40
// Links are drawn behind nodes, but a straight step path still runs through the
// node's own bounding box near its start/end point. Route the path to clear each
// card's edge (with a small gap) instead, so it never crosses through the name.
const LINK_CLEARANCE = CARD_HEIGHT / 2 + 8

function stepAroundCards(linkData: { source: { x: number; y: number }; target: { x: number; y: number } }) {
  const { source, target } = linkData
  const y1 = source.y + LINK_CLEARANCE
  const y2 = target.y - LINK_CLEARANCE
  const midY = y1 + (y2 - y1) / 2
  return `M${source.x},${y1} V${midY} H${target.x} V${y2}`
}

export function OrgChart({ managerChain, orgNode, selectedId, onSelect }: OrgChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(600)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width) setContainerWidth(width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const treeData = buildTreeData(managerChain, orgNode)

  function renderNode({ nodeDatum, onNodeClick }: CustomNodeElementProps) {
    const id = String(nodeDatum.attributes?.id ?? '')
    const hasMore = Boolean(nodeDatum.attributes?.hasMore)
    const isSelected = id === selectedId

    return (
      <g onClick={onNodeClick} style={{ cursor: 'pointer' }}>
        <foreignObject width={CARD_WIDTH} height={CARD_HEIGHT} x={-CARD_WIDTH / 2} y={-CARD_HEIGHT / 2}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: CARD_WIDTH - 2,
              height: CARD_HEIGHT - 2,
              padding: '0 10px',
              boxSizing: 'border-box',
              borderRadius: 8,
              background: 'var(--bg)',
              border: isSelected ? '2px solid var(--accent)' : hasMore ? '1.5px dashed var(--accent)' : '1px solid var(--border)',
              boxShadow: isSelected ? '0 2px 6px rgba(15, 98, 254, 0.25)' : '0 1px 2px rgba(0, 0, 0, 0.06)',
            }}
          >
            <div
              style={{
                flexShrink: 0,
                width: 26,
                height: 26,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11,
                fontWeight: 600,
                color: isSelected ? '#fff' : 'var(--text-h)',
                background: isSelected ? 'var(--accent)' : 'var(--border)',
              }}
            >
              {initialsOf(nodeDatum.name)}
            </div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--text-h)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {nodeDatum.name}
            </div>
          </div>
        </foreignObject>
      </g>
    )
  }

  return (
    <Tile style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16 }}>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: 'var(--text-h)' }}>Org chart</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 12, color: 'var(--text)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', border: '1.5px dashed var(--accent)', display: 'inline-block' }} />
            More reports to load
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', border: '2px solid var(--accent)', display: 'inline-block' }} />
            Currently viewing
          </span>
        </div>
      </div>

      <div
        ref={containerRef}
        className="org-chart-canvas"
        style={{
          width: '100%',
          flex: 1,
          minHeight: 480,
          marginTop: 16,
          borderRadius: 8,
          background: 'var(--cds-layer-01, #f4f4f4)',
        }}
      >
        <Tree
          data={treeData}
          orientation="vertical"
          translate={{ x: containerWidth / 2, y: 60 }}
          renderCustomNodeElement={renderNode}
          onNodeClick={(node) => {
            const id = node.data.attributes?.id
            if (typeof id === 'string') onSelect(id)
          }}
          separation={{ siblings: 1.2, nonSiblings: 1.5 }}
          nodeSize={{ x: 190, y: 100 }}
          zoom={0.85}
          pathFunc={stepAroundCards}
          zoomable
        />
      </div>
    </Tile>
  )
}
