/**
 * 贡献者星系。
 *
 * 关于对话框和引导向导展示的是同一张图，之前各自维护一份实现：布局函数、环形接口、
 * 角度计算和 ~155 行 CSS 都是复制粘贴出来的两份，靠十几处常量分叉（半径 96 vs 110、
 * 描边 0.75 vs 0.8、星点透明度 0.46 vs 0.5）假装成两种设计，同一个入场延迟 bug 也在
 * 两边各活了一次。
 *
 * 这里只有一份：宿主之间真正的差异是画布尺寸，所以用 `scale` 表达（关于对话框是 0.9），
 * 其余全部收敛到同一套常量、同一段 CSS、同一个 i18n key。
 */

import React, { useMemo } from 'react'
import { getCoreContributor, getOrbitContributors, type Contributor } from '@shared/config/contributors'
import { t, type Language } from '@shared/i18n'

/** 画布基准尺寸（scale = 1 时的像素值） */
const CANVAS = { width: 320, height: 280, svg: 280 } as const

interface RingSpec {
  radius: number
  capacity: number
  /** 环相对上一环的角度错位（0.5 = 半个槽位），避免两环节点连成一条辐条 */
  angleOffset: number
}

interface GalaxyLayout {
  rings: RingSpec[]
  avatarSize: number
}

/** 已经算好坐标和入场顺序的轨道节点 */
interface GalaxyNode {
  contributor: Contributor
  x: number
  y: number
  /** 全图内的序号，只用来错开入场/浮动动画 */
  index: number
}

/**
 * 节点数决定环数：人少时一圈铺开更好看，15 人以上封顶 18 个（5 + 13），
 * 多出来的用 +N 角标表示。
 */
function galaxyLayout(count: number): GalaxyLayout {
  if (count <= 6) {
    return { rings: [{ radius: 110, capacity: 6, angleOffset: 0 }], avatarSize: 38 }
  }
  if (count <= 14) {
    return {
      rings: [
        { radius: 72, capacity: 5, angleOffset: 0 },
        { radius: 128, capacity: 9, angleOffset: 0.5 },
      ],
      avatarSize: 32,
    }
  }
  return {
    rings: [
      { radius: 68, capacity: 5, angleOffset: 0 },
      { radius: 130, capacity: 13, angleOffset: 0.5 },
    ],
    avatarSize: 26,
  }
}

/**
 * 把贡献者摊到各环上并直接算出坐标。
 *
 * 序号是跨环连续累加的：按环内下标算（`ringIdx * ring.items.length + idx`）会让第二环
 * 的前几个节点和第一环撞上同一个延迟，入场动画看着像丢了几个。
 */
function layoutNodes(contributors: Contributor[], layout: GalaxyLayout, scale: number): GalaxyNode[] {
  const nodes: GalaxyNode[] = []
  let cursor = 0

  for (const ring of layout.rings) {
    if (cursor >= contributors.length) break
    const slice = contributors.slice(cursor, cursor + ring.capacity)
    const radius = ring.radius * scale

    slice.forEach((contributor, idx) => {
      const angle = ((idx + ring.angleOffset) / slice.length) * Math.PI * 2 - Math.PI / 2
      nodes.push({
        contributor,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        index: cursor + idx,
      })
    })
    cursor += slice.length
  }

  return nodes
}

interface ContributorGalaxyProps {
  language: Language
  /** 画布缩放（关于对话框比引导向导窄一圈，传 0.9） */
  scale?: number
}

export function ContributorGalaxy({ language, scale = 1 }: ContributorGalaxyProps) {
  const core = getCoreContributor()
  const orbit = getOrbitContributors()
  const { nodes, avatarSize } = useMemo(() => {
    const layout = galaxyLayout(orbit.length)
    return { nodes: layoutNodes(orbit, layout, scale), avatarSize: layout.avatarSize * scale }
  }, [orbit, scale])
  const overflow = orbit.length - nodes.length

  return (
    <div
      className="adnify-galaxy"
      role="img"
      aria-label={t('contributorGalaxy.label', language)}
      style={{ width: CANVAS.width * scale, height: CANVAS.height * scale }}
    >
      <GalaxyStyles />
      <div className="adnify-galaxy-stars" aria-hidden="true" />

      <svg
        className="adnify-galaxy-svg"
        viewBox="-150 -150 300 300"
        aria-hidden="true"
        style={{ width: CANVAS.svg * scale, height: CANVAS.svg * scale }}
      >
        <defs>
          <radialGradient id="adnifyGalaxyHalo" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgb(var(--accent))" stopOpacity="0.35" />
            <stop offset="100%" stopColor="rgb(var(--accent))" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="adnifyGalaxyLine" cx="0" cy="0" r="140" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="rgb(var(--accent))" stopOpacity="0.7" />
            <stop offset="60%" stopColor="rgb(var(--accent))" stopOpacity="0.25" />
            <stop offset="100%" stopColor="rgb(var(--accent))" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="0" cy="0" r="60" fill="url(#adnifyGalaxyHalo)" />

        {nodes.map(node => (
          <line
            key={`line-${node.contributor.name}`}
            x1="0"
            y1="0"
            x2={node.x}
            y2={node.y}
            stroke="url(#adnifyGalaxyLine)"
            strokeWidth="0.8"
            strokeLinecap="round"
            className="adnify-galaxy-line"
            style={{ animationDelay: `${0.2 + node.index * 0.05}s, ${(node.index * 0.3) % 4}s` }}
          />
        ))}
      </svg>

      <a href={core.url} target="_blank" rel="noreferrer" className="adnify-galaxy-core" title={core.name}>
        <span className="adnify-galaxy-core-pulse" aria-hidden="true" />
        <img src={core.avatar} alt={core.name} draggable={false} />
      </a>

      {nodes.map(node => (
        <a
          key={node.contributor.name}
          href={node.contributor.url}
          target="_blank"
          rel="noreferrer"
          className="adnify-galaxy-node"
          title={node.contributor.name}
          style={{
            '--node-x': `${node.x}px`,
            '--node-y': `${node.y}px`,
            '--node-size': `${avatarSize}px`,
            '--node-enter-delay': `${0.25 + node.index * 0.05}s`,
            '--node-float-delay': `${(node.index * 0.4) % 5}s`,
          } as React.CSSProperties}
        >
          <span className="adnify-galaxy-node-inner">
            <img src={node.contributor.avatar} alt={node.contributor.name} draggable={false} />
          </span>
          <span className="adnify-galaxy-node-name">{node.contributor.name}</span>
        </a>
      ))}

      {overflow > 0 && (
        <span className="adnify-galaxy-overflow" aria-label={`+${overflow}`}>+{overflow}</span>
      )}
    </div>
  )
}

/**
 * 星系自带的样式。
 *
 * 类名带 `adnify-galaxy-` 前缀，全局注入不会撞到宿主对话框的作用域样式；组件内联注入
 * 是为了让"用了这个组件就一定有样式"，不必在两个宿主的 CSS 里各留一份。
 */
function GalaxyStyles() {
  return (
    <style>{`
      .adnify-galaxy {
        position: relative;
        margin: 0 auto 4px;
        flex-shrink: 0;
      }
      .adnify-galaxy-stars {
        position: absolute;
        inset: 0;
        background-image:
          radial-gradient(rgb(var(--text-primary) / 0.12) 1px, transparent 1px),
          radial-gradient(rgb(var(--accent) / 0.18) 1px, transparent 1px);
        background-size: 40px 40px, 70px 70px;
        background-position: 0 0, 20px 30px;
        opacity: 0.5;
        animation: adnify-galaxy-stars 18s linear infinite;
        pointer-events: none;
        -webkit-mask-image: radial-gradient(ellipse at center, black 30%, transparent 80%);
        mask-image: radial-gradient(ellipse at center, black 30%, transparent 80%);
      }
      @keyframes adnify-galaxy-stars {
        0% { background-position: 0 0, 20px 30px; }
        100% { background-position: 80px 80px, 100px 110px; }
      }
      .adnify-galaxy-svg {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        pointer-events: none;
      }
      .adnify-galaxy-line {
        opacity: 0;
        animation:
          adnify-galaxy-line-in 0.6s ease forwards,
          adnify-galaxy-line-pulse 4s ease-in-out infinite;
      }
      @keyframes adnify-galaxy-line-in {
        from { opacity: 0; stroke-dasharray: 0 200; }
        to { opacity: 1; stroke-dasharray: 200 0; }
      }
      @keyframes adnify-galaxy-line-pulse {
        0%, 100% { opacity: 0.45; }
        50% { opacity: 0.85; }
      }
      .adnify-galaxy-core {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 64px;
        height: 64px;
        transform: translate(-50%, -50%);
        border-radius: 50%;
        z-index: 2;
        animation: adnify-galaxy-pop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both;
      }
      .adnify-galaxy-core img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: 50%;
        border: 2px solid rgb(var(--accent));
        background: rgb(var(--surface));
        box-shadow:
          0 0 0 4px rgb(var(--accent) / 0.18),
          0 8px 24px rgb(var(--accent) / 0.4);
      }
      .adnify-galaxy-core-pulse {
        position: absolute;
        inset: -8px;
        border-radius: 50%;
        background: radial-gradient(circle, rgb(var(--accent) / 0.5), transparent 70%);
        animation: adnify-galaxy-pulse 2.4s ease-in-out infinite;
        pointer-events: none;
      }
      @keyframes adnify-galaxy-pulse {
        0%, 100% { opacity: 0.4; transform: scale(0.95); }
        50% { opacity: 0.9; transform: scale(1.15); }
      }
      @keyframes adnify-galaxy-pop {
        from { opacity: 0; transform: translate(-50%, -50%) scale(0); }
        to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
      }
      .adnify-galaxy-node {
        position: absolute;
        top: 50%;
        left: 50%;
        width: var(--node-size, 38px);
        height: var(--node-size, 38px);
        opacity: 0;
        z-index: 1;
        transform: translate(-50%, -50%) scale(0.4);
        animation: adnify-galaxy-node-in 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) var(--node-enter-delay, 0s) forwards;
      }
      @keyframes adnify-galaxy-node-in {
        0% { opacity: 0; transform: translate(-50%, -50%) scale(0.4); }
        60% { opacity: 1; }
        100% {
          opacity: 1;
          transform: translate(calc(var(--node-x, 0px) - 50%), calc(var(--node-y, 0px) - 50%)) scale(1);
        }
      }
      .adnify-galaxy-node-inner {
        display: block;
        width: 100%;
        height: 100%;
        animation: adnify-galaxy-node-float 6s ease-in-out var(--node-float-delay, 0s) infinite;
      }
      @keyframes adnify-galaxy-node-float {
        0%, 100% { transform: translateY(0) scale(1); }
        50% { transform: translateY(-3px) scale(1.02); }
      }
      .adnify-galaxy-node img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: 50%;
        border: 2px solid rgb(var(--surface));
        background: rgb(var(--surface));
        box-shadow:
          0 0 0 1px rgb(var(--border)),
          0 4px 12px rgb(0 0 0 / 0.18);
        transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), border-color 0.25s ease;
      }
      .adnify-galaxy-node:hover img {
        transform: scale(1.18);
        border-color: rgb(var(--accent));
      }
      .adnify-galaxy-node-name {
        position: absolute;
        top: calc(100% + 6px);
        left: 50%;
        padding: 2px 8px;
        font-size: 10px;
        font-weight: 700;
        color: rgb(var(--text-secondary));
        background: rgb(var(--surface) / 0.95);
        border: 1px solid rgb(var(--border));
        border-radius: 999px;
        opacity: 0;
        transform: translate(-50%, -4px);
        transition: all 0.2s ease;
        white-space: nowrap;
        pointer-events: none;
        backdrop-filter: blur(8px);
      }
      .adnify-galaxy-node:hover .adnify-galaxy-node-name {
        opacity: 1;
        transform: translate(-50%, 0);
      }
      .adnify-galaxy-overflow {
        position: absolute;
        right: 12px;
        bottom: 4px;
        padding: 3px 10px;
        font-size: 11px;
        font-weight: 700;
        color: rgb(var(--accent));
        background: rgb(var(--accent) / 0.12);
        border: 1px solid rgb(var(--accent) / 0.3);
        border-radius: 999px;
        backdrop-filter: blur(8px);
        animation: adnify-galaxy-pop 0.6s ease 0.8s both;
      }
    `}</style>
  )
}

