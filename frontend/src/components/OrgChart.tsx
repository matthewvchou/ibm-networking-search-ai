import { useEffect, useRef, useState } from 'react'
import Tree from 'react-d3-tree'
import type { CustomNodeElementProps, RawNodeDatum } from 'react-d3-tree'
import type { Employee, OrgNode } from '../api/client'

function orgNodeToRaw(node: OrgNode): RawNodeDatum {
  return {
    name: node.employee.display_name,
    attributes: {
      id: node.employee.id,
      title: node.employee.title ?? '',
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
      name: ancestor.display_name,
      attributes: { id: ancestor.id, title: ancestor.title ?? '', hasMore: false },
      children: [child],
    }),
    rootDescendant,
  )
}

interface OrgChartProps {
  managerChain: Employee[]
  orgNode: OrgNode
  selectedId: string
  onSelect: (id: string) => void
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
    const title = String(nodeDatum.attributes?.title ?? '')
    const hasMore = Boolean(nodeDatum.attributes?.hasMore)
    const isSelected = id === selectedId

    return (
      <g onClick={onNodeClick} style={{ cursor: 'pointer' }}>
        <circle
          r={14}
          fill={isSelected ? 'var(--accent)' : 'var(--bg)'}
          stroke={hasMore ? 'var(--accent)' : 'var(--border)'}
          strokeDasharray={hasMore ? '4,2' : undefined}
          strokeWidth={2}
        />
        <foreignObject width={170} height={56} x={-85} y={18}>
          <div style={{ textAlign: 'center', fontSize: 12, lineHeight: 1.3 }}>
            <div style={{ fontWeight: 600, color: 'var(--text-h)' }}>{nodeDatum.name}</div>
            <div style={{ color: 'var(--text)' }}>{title}</div>
            {hasMore && <div style={{ color: 'var(--accent)' }}>+ more reports</div>}
          </div>
        </foreignObject>
      </g>
    )
  }

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: 640, border: '1px solid var(--border)', borderRadius: 8 }}
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
        nodeSize={{ x: 180, y: 100 }}
        zoom={0.85}
        pathFunc="step"
        zoomable
      />
    </div>
  )
}
