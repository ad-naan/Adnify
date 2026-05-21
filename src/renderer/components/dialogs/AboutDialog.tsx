/**
 * About Dialog
 * Shows app metadata, project links and contributors.
 */

import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Code2, ExternalLink, Github, Sparkles, X, Zap } from 'lucide-react'
import { CONTRIBUTORS, getCoreContributor, getOrbitContributors } from '@shared/config/contributors'
import { useStore } from '@store'
import { logger } from '@utils/Logger'
import { Modal } from '../ui'
import { Logo } from '../common/Logo'

interface AboutDialogProps {
  onClose: () => void
}

interface RingSpec {
  radius: number
  capacity: number
  angleOffset: number
}

interface RingLayout {
  rings: RingSpec[]
  avatarSize: number
}

interface RingAssignment<T> {
  items: T[]
  radius: number
  angleOffset: number
}

export default function AboutDialog({ onClose }: AboutDialogProps) {
  const language = useStore(s => s.language)
  const isZh = language === 'zh'
  const [version, setVersion] = useState('1.0.0')
  const core = getCoreContributor()
  const contributorLabel = `${CONTRIBUTORS.length}+`

  useEffect(() => {
    const loadVersions = async () => {
      try {
        const appVersion = await window.electronAPI?.getAppVersion?.()
        if (appVersion) setVersion(appVersion)
      } catch (e) {
        logger.ui.error('Failed to get app version:', e)
      }
    }
    loadVersions()
  }, [])

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      noPadding
      size="4xl"
      showCloseButton={false}
      className="adnify-about-modal bg-transparent border-0 shadow-none rounded-[24px]"
    >
      <AboutStyles />
      <motion.section
        className="adnify-about"
        initial={{ opacity: 0, y: 14, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.46, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="adnify-about-backdrop" />
        <div className="adnify-about-glow adnify-about-glow-1" />
        <div className="adnify-about-glow adnify-about-glow-2" />
        <div className="adnify-about-stars" aria-hidden="true" />

        <button
          type="button"
          onClick={onClose}
          className="adnify-about-close"
          aria-label={isZh ? '关闭' : 'Close'}
        >
          <X className="w-4 h-4" />
        </button>

        <div className="adnify-about-shell">
          <div className="adnify-about-hero">
            <div className="adnify-about-brand-row">
              <span className="adnify-about-logo-wrap">
                <Logo className="adnify-about-logo" glow />
              </span>
              <div className="adnify-about-brand-meta">
                <span className="adnify-about-version">v{version}</span>
                <p className="adnify-about-eyebrow">{isZh ? 'AI 原生编辑器' : 'AI-native editor'}</p>
              </div>
            </div>

            <div>
              <h1 className="adnify-about-title">Adnify</h1>
              <p className="adnify-about-subtitle">
                {isZh
                  ? '为下一代开发者打造的工程化 AI 编程工作台。'
                  : 'An engineering-grade AI coding workspace for the next generation of developers.'}
              </p>
            </div>

            <div className="adnify-about-chips" aria-label={isZh ? '产品能力' : 'Product capabilities'}>
              <FeatureChip icon={Sparkles} label={isZh ? '智能补全' : 'Intelligent'} />
              <FeatureChip icon={Code2} label={isZh ? '深度理解' : 'Deep Context'} />
              <FeatureChip icon={Zap} label={isZh ? '极速响应' : 'Fast Loop'} />
            </div>

            <div className="adnify-about-actions">
              <SocialButton href="https://github.com/ad-naan/adnify" icon={Github} label="GitHub" />
              <SocialButton href="https://gitee.com/adnaan/adnify" icon={ExternalLink} label="Gitee" />
            </div>
          </div>

          <div className="adnify-about-community">
            <ContributorGalaxy isZh={isZh} />
            <div className="adnify-about-community-copy">
              <p className="adnify-about-eyebrow adnify-about-eyebrow-success">
                {isZh ? '社区共建' : 'Community built'}
              </p>
              <h2>{isZh ? '感谢每一位贡献者' : 'Shaped by contributors'}</h2>
              <p>
                {isZh
                  ? `感谢 ${contributorLabel} 位贡献者，让 Adnify 持续进化。`
                  : `Made possible by ${contributorLabel} contributors who keep Adnify moving.`}
              </p>
            </div>
          </div>
        </div>

        <footer className="adnify-about-footer">
          <a href={core.url} target="_blank" rel="noreferrer" className="adnify-about-author">
            <img src={core.avatar} alt={core.name} draggable={false} />
            <span>
              <strong>{core.name}</strong>
              <small>{isZh ? '创建者与维护者' : 'Creator & Maintainer'}</small>
            </span>
          </a>
          <p>Copyright © 2025-present adnaan. All rights reserved.</p>
        </footer>
      </motion.section>
    </Modal>
  )
}

function FeatureChip({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <span className="adnify-about-chip">
      <Icon className="w-3.5 h-3.5" />
      {label}
    </span>
  )
}

function SocialButton({ href, icon: Icon, label }: { href: string; icon: React.ElementType; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="adnify-about-link">
      <Icon className="w-4 h-4" />
      <span>{label}</span>
    </a>
  )
}

function ContributorGalaxy({ isZh }: { isZh: boolean }) {
  const orbit = getOrbitContributors()
  const core = getCoreContributor()
  const layout = useMemo(() => computeGalaxyLayout(orbit.length), [orbit.length])
  const rings = useMemo(() => assignRings(orbit, layout.rings), [orbit, layout.rings])
  const visible = rings.flatMap(r => r.items)
  const overflow = orbit.length - visible.length

  return (
    <div className="adnify-about-galaxy" role="img" aria-label={isZh ? '贡献者星系' : 'Contributor galaxy'}>
      <div className="adnify-about-galaxy-stars" aria-hidden="true" />
      <svg className="adnify-about-galaxy-svg" viewBox="-150 -150 300 300" aria-hidden="true">
        <defs>
          <radialGradient id="aboutGalaxyHalo" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgb(var(--accent))" stopOpacity="0.32" />
            <stop offset="100%" stopColor="rgb(var(--accent))" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="aboutGalaxyLine" cx="0" cy="0" r="140" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="rgb(var(--accent))" stopOpacity="0.64" />
            <stop offset="62%" stopColor="rgb(var(--accent))" stopOpacity="0.22" />
            <stop offset="100%" stopColor="rgb(var(--accent))" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="0" cy="0" r="58" fill="url(#aboutGalaxyHalo)" />
        {rings.flatMap((ring, ringIdx) =>
          ring.items.map((_, idx) => {
            const angle = ((idx + ring.angleOffset) / ring.items.length) * Math.PI * 2 - Math.PI / 2
            const x = Math.cos(angle) * ring.radius
            const y = Math.sin(angle) * ring.radius
            const flatIdx = ringIdx * ring.items.length + idx
            return (
              <line
                key={`line-${ringIdx}-${idx}`}
                x1="0"
                y1="0"
                x2={x}
                y2={y}
                stroke="url(#aboutGalaxyLine)"
                strokeWidth="0.75"
                strokeLinecap="round"
                className="adnify-about-galaxy-line"
                style={{ animationDelay: `${0.18 + flatIdx * 0.05}s, ${(flatIdx * 0.3) % 4}s` }}
              />
            )
          })
        )}
      </svg>

      <a href={core.url} target="_blank" rel="noreferrer" className="adnify-about-galaxy-core" title={core.name}>
        <span className="adnify-about-galaxy-core-pulse" aria-hidden="true" />
        <img src={core.avatar} alt={core.name} draggable={false} />
      </a>

      {rings.map((ring, ringIdx) =>
        ring.items.map((c, idx) => {
          const angle = ((idx + ring.angleOffset) / ring.items.length) * Math.PI * 2 - Math.PI / 2
          const x = Math.cos(angle) * ring.radius
          const y = Math.sin(angle) * ring.radius
          const flatIdx = ringIdx * ring.items.length + idx
          return (
            <a
              key={c.name}
              href={c.url}
              target="_blank"
              rel="noreferrer"
              className="adnify-about-galaxy-node"
              style={{
                '--node-x': `${x}px`,
                '--node-y': `${y}px`,
                '--node-size': `${layout.avatarSize}px`,
                '--node-enter-delay': `${0.25 + flatIdx * 0.05}s`,
                '--node-float-delay': `${(flatIdx * 0.4) % 5}s`,
              } as React.CSSProperties}
              title={c.name}
            >
              <span className="adnify-about-galaxy-node-inner">
                <img src={c.avatar} alt={c.name} draggable={false} />
              </span>
              <span className="adnify-about-galaxy-node-name">{c.name}</span>
            </a>
          )
        })
      )}

      {overflow > 0 && (
        <span className="adnify-about-galaxy-overflow" aria-label={`+${overflow}`}>
          +{overflow}
        </span>
      )}
    </div>
  )
}

function computeGalaxyLayout(count: number): RingLayout {
  if (count <= 6) {
    return {
      rings: [{ radius: 96, capacity: 6, angleOffset: 0 }],
      avatarSize: 34,
    }
  }
  if (count <= 14) {
    return {
      rings: [
        { radius: 64, capacity: 5, angleOffset: 0 },
        { radius: 114, capacity: 9, angleOffset: 0.5 },
      ],
      avatarSize: 30,
    }
  }
  return {
    rings: [
      { radius: 64, capacity: 5, angleOffset: 0 },
      { radius: 116, capacity: 13, angleOffset: 0.5 },
    ],
    avatarSize: 26,
  }
}

function assignRings<T>(items: T[], rings: RingSpec[]): RingAssignment<T>[] {
  const result: RingAssignment<T>[] = []
  let cursor = 0
  for (const ring of rings) {
    if (cursor >= items.length) break
    const slice = items.slice(cursor, cursor + ring.capacity)
    result.push({ items: slice, radius: ring.radius, angleOffset: ring.angleOffset })
    cursor += slice.length
  }
  return result
}

function AboutStyles() {
  return (
    <style>{`
      .adnify-about-modal {
        max-width: min(920px, calc(100vw - 32px));
      }

      .adnify-about {
        position: relative;
        min-height: 560px;
        overflow: hidden;
        border-radius: 24px;
        color: rgb(var(--text-primary));
        background: rgb(var(--surface) / 0.88);
        border: 1px solid rgb(var(--border) / 0.55);
        backdrop-filter: blur(26px);
        -webkit-backdrop-filter: blur(26px);
        box-shadow:
          0 30px 90px -32px rgb(0 0 0 / 0.42),
          0 1px 0 rgb(var(--text-primary) / 0.05) inset;
      }

      .adnify-about-backdrop {
        position: absolute;
        inset: 0;
        background:
          radial-gradient(circle at 16% 12%, rgb(var(--accent) / 0.11), transparent 28%),
          radial-gradient(circle at 84% 24%, rgb(96 165 250 / 0.09), transparent 30%),
          linear-gradient(135deg, rgb(var(--surface) / 0.94), rgb(var(--surface-hover) / 0.70));
        pointer-events: none;
      }

      .adnify-about-stars,
      .adnify-about-galaxy-stars {
        position: absolute;
        inset: 0;
        background-image:
          radial-gradient(rgb(var(--text-primary) / 0.08) 1px, transparent 1px),
          radial-gradient(rgb(var(--accent) / 0.12) 1px, transparent 1px);
        background-size: 38px 38px, 72px 72px;
        background-position: 0 0, 20px 30px;
        opacity: 0.36;
        animation: adnify-about-stars 18s linear infinite;
        pointer-events: none;
        -webkit-mask-image: radial-gradient(ellipse at center, black 20%, transparent 82%);
        mask-image: radial-gradient(ellipse at center, black 20%, transparent 82%);
      }
      @keyframes adnify-about-stars {
        0% { background-position: 0 0, 20px 30px; }
        100% { background-position: 76px 76px, 96px 106px; }
      }

      .adnify-about-glow {
        position: absolute;
        border-radius: 999px;
        filter: blur(72px);
        pointer-events: none;
      }
      .adnify-about-glow-1 {
        top: -160px;
        left: -140px;
        width: 420px;
        height: 420px;
        background: radial-gradient(circle, rgb(var(--accent) / 0.18), transparent 70%);
        animation: adnify-about-float-glow 18s ease-in-out infinite;
      }
      .adnify-about-glow-2 {
        right: -130px;
        bottom: -160px;
        width: 430px;
        height: 430px;
        background: radial-gradient(circle, rgb(var(--accent) / 0.10), transparent 70%);
        animation: adnify-about-float-glow 22s ease-in-out -8s infinite;
      }
      @keyframes adnify-about-float-glow {
        0%, 100% { transform: translate(0, 0) scale(1); }
        50% { transform: translate(34px, -26px) scale(1.08); }
      }

      .adnify-about-close {
        position: absolute;
        top: 18px;
        right: 18px;
        z-index: 5;
        width: 34px;
        height: 34px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 10px;
        color: rgb(var(--text-muted));
        background: rgb(var(--surface-hover) / 0.38);
        border: 1px solid rgb(var(--border) / 0.45);
        transition: all 0.2s ease;
      }
      .adnify-about-close:hover {
        color: rgb(var(--text-primary));
        background: rgb(var(--surface-hover) / 0.78);
        transform: translateY(-1px);
      }

      .adnify-about-shell {
        position: relative;
        z-index: 1;
        display: grid;
        grid-template-columns: minmax(0, 0.95fr) minmax(330px, 1fr);
        gap: clamp(18px, 3vw, 34px);
        padding: clamp(34px, 5vw, 54px);
        padding-bottom: 28px;
        min-height: 480px;
      }

      .adnify-about-hero {
        min-width: 0;
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 20px;
        padding-left: 2px;
      }

      .adnify-about-brand-row {
        display: inline-flex;
        align-items: center;
        gap: 16px;
        width: fit-content;
        padding: 8px 14px 8px 8px;
        border-radius: 24px;
        background: linear-gradient(135deg, rgb(var(--surface) / 0.66), rgb(var(--surface-hover) / 0.34));
        border: 1px solid rgb(var(--border) / 0.42);
        box-shadow: 0 1px 0 rgb(var(--text-primary) / 0.04) inset;
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
      }

      .adnify-about-logo-wrap {
        position: relative;
        width: 72px;
        height: 72px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
        border-radius: 20px;
        background: rgb(var(--surface-active) / 0.72);
        border: 1px solid rgb(var(--border) / 0.52);
        box-shadow:
          0 18px 42px -24px rgb(var(--accent) / 0.55),
          0 1px 0 rgb(var(--text-primary) / 0.05) inset;
      }
      .adnify-about-logo-wrap::before {
        content: '';
        position: absolute;
        inset: -14px;
        border-radius: inherit;
        background: radial-gradient(circle, rgb(var(--accent) / 0.25), transparent 68%);
        filter: blur(16px);
        z-index: -1;
      }
      .adnify-about-logo {
        width: 52px;
        height: 52px;
        object-fit: contain;
      }

      .adnify-about-brand-meta {
        display: grid;
        gap: 7px;
        justify-items: start;
        min-width: 0;
      }

      .adnify-about-version {
        display: inline-flex;
        align-items: center;
        width: fit-content;
        padding: 3px 10px;
        border-radius: 999px;
        font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
        font-size: 10px;
        font-weight: 700;
        color: rgb(var(--text-secondary));
        background: rgb(var(--surface) / 0.95);
        border: 1px solid rgb(var(--border));
        box-shadow: 0 8px 20px -12px rgb(0 0 0 / 0.45);
      }

      .adnify-about-eyebrow {
        margin: 0;
        font-size: 11px;
        font-weight: 800;
        color: rgb(var(--accent));
        letter-spacing: 0.6px;
        text-transform: uppercase;
      }
      .adnify-about-eyebrow-success {
        color: rgb(var(--status-success));
      }
      .adnify-about-title {
        margin: 0;
        font-size: clamp(50px, 6vw, 68px);
        line-height: 0.9;
        font-weight: 900;
        letter-spacing: 0;
        color: rgb(var(--text-primary));
      }
      .adnify-about-subtitle {
        max-width: 410px;
        margin: 18px 0 0;
        font-size: 14px;
        line-height: 1.65;
        font-weight: 500;
        color: rgb(var(--text-secondary));
      }

      .adnify-about-chips,
      .adnify-about-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
      }

      .adnify-about-chips {
        margin-top: 2px;
      }

      .adnify-about-actions {
        margin-top: 2px;
      }

      .adnify-about-chip,
      .adnify-about-link {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        height: 32px;
        padding: 0 12px;
        border-radius: 999px;
        color: rgb(var(--text-secondary));
        background: rgb(var(--surface-hover) / 0.52);
        border: 1px solid rgb(var(--border) / 0.5);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
      }
      .adnify-about-chip {
        font-size: 11px;
        font-weight: 700;
      }
      .adnify-about-chip svg,
      .adnify-about-link svg {
        color: rgb(var(--accent));
      }
      .adnify-about-link {
        font-size: 12px;
        font-weight: 800;
        transition: all 0.2s ease;
      }
      .adnify-about-link:hover {
        color: rgb(var(--text-primary));
        background: rgb(var(--accent) / 0.12);
        border-color: rgb(var(--accent) / 0.35);
        transform: translateY(-1px);
      }

      .adnify-about-community {
        position: relative;
        min-width: 0;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        text-align: center;
        gap: 6px;
        min-height: 376px;
        border-radius: 20px;
        background: rgb(var(--surface) / 0.24);
        border: 1px solid rgb(var(--border) / 0.28);
        box-shadow: 0 1px 0 rgb(var(--text-primary) / 0.04) inset;
        overflow: hidden;
      }
      .adnify-about-community::before {
        content: '';
        position: absolute;
        inset: 0;
        background: radial-gradient(circle at 50% 42%, rgb(var(--accent) / 0.10), transparent 55%);
        pointer-events: none;
      }
      .adnify-about-community > * {
        position: relative;
        z-index: 1;
      }
      .adnify-about-community-copy {
        max-width: 420px;
        padding: 0 24px 18px;
      }
      .adnify-about-community-copy h2 {
        margin: 0 0 6px;
        font-size: 22px;
        line-height: 1.18;
        font-weight: 850;
        color: rgb(var(--text-primary));
      }
      .adnify-about-community-copy p:last-child {
        margin: 0;
        font-size: 12px;
        line-height: 1.5;
        color: rgb(var(--text-secondary));
      }

      .adnify-about-galaxy {
        position: relative;
        width: 300px;
        height: 244px;
        margin: 0 auto;
        flex-shrink: 0;
      }
      .adnify-about-galaxy-stars {
        opacity: 0.46;
      }
      .adnify-about-galaxy-svg {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 252px;
        height: 252px;
        transform: translate(-50%, -50%);
        pointer-events: none;
      }
      .adnify-about-galaxy-line {
        opacity: 0;
        animation:
          adnify-about-galaxy-line-in 0.6s ease forwards,
          adnify-about-galaxy-line-pulse 4s ease-in-out infinite;
      }
      @keyframes adnify-about-galaxy-line-in {
        from { opacity: 0; stroke-dasharray: 0 200; }
        to { opacity: 1; stroke-dasharray: 200 0; }
      }
      @keyframes adnify-about-galaxy-line-pulse {
        0%, 100% { opacity: 0.35; }
        50% { opacity: 0.72; }
      }
      .adnify-about-galaxy-core {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 58px;
        height: 58px;
        transform: translate(-50%, -50%);
        border-radius: 50%;
        z-index: 2;
        animation: adnify-about-galaxy-pop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both;
      }
      .adnify-about-galaxy-core img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: 50%;
        border: 2px solid rgb(var(--accent));
        background: rgb(var(--surface));
        box-shadow:
          0 0 0 4px rgb(var(--accent) / 0.16),
          0 8px 24px rgb(var(--accent) / 0.30);
      }
      .adnify-about-galaxy-core-pulse {
        position: absolute;
        inset: -8px;
        border-radius: 50%;
        background: radial-gradient(circle, rgb(var(--accent) / 0.42), transparent 70%);
        animation: adnify-about-galaxy-pulse 2.4s ease-in-out infinite;
        pointer-events: none;
      }
      @keyframes adnify-about-galaxy-pulse {
        0%, 100% { opacity: 0.34; transform: scale(0.95); }
        50% { opacity: 0.76; transform: scale(1.15); }
      }
      @keyframes adnify-about-galaxy-pop {
        from { opacity: 0; transform: translate(-50%, -50%) scale(0); }
        to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
      }
      .adnify-about-galaxy-node {
        position: absolute;
        top: 50%;
        left: 50%;
        width: var(--node-size, 34px);
        height: var(--node-size, 34px);
        opacity: 0;
        z-index: 1;
        transform: translate(-50%, -50%) scale(0.4);
        animation: adnify-about-galaxy-node-in 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) var(--node-enter-delay, 0s) forwards;
      }
      .adnify-about-galaxy-node-inner {
        display: block;
        width: 100%;
        height: 100%;
        animation: adnify-about-galaxy-node-float 6s ease-in-out var(--node-float-delay, 0s) infinite;
      }
      @keyframes adnify-about-galaxy-node-float {
        0%, 100% { transform: translateY(0) scale(1); }
        50% { transform: translateY(-3px) scale(1.02); }
      }
      .adnify-about-galaxy-node img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: 50%;
        border: 2px solid rgb(var(--surface));
        background: rgb(var(--surface));
        box-shadow:
          0 0 0 1px rgb(var(--border)),
          0 4px 12px rgb(0 0 0 / 0.16);
        transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), border-color 0.25s ease;
      }
      .adnify-about-galaxy-node:hover img {
        transform: scale(1.18);
        border-color: rgb(var(--accent));
      }
      .adnify-about-galaxy-node-name {
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
      .adnify-about-galaxy-node:hover .adnify-about-galaxy-node-name {
        opacity: 1;
        transform: translate(-50%, 0);
      }
      .adnify-about-galaxy-overflow {
        position: absolute;
        right: 18px;
        bottom: 8px;
        padding: 3px 10px;
        font-size: 11px;
        font-weight: 800;
        color: rgb(var(--accent));
        background: rgb(var(--accent) / 0.12);
        border: 1px solid rgb(var(--accent) / 0.3);
        border-radius: 999px;
        backdrop-filter: blur(8px);
        animation: adnify-about-galaxy-pop 0.6s ease 0.8s both;
      }
      @keyframes adnify-about-galaxy-node-in {
        0% {
          opacity: 0;
          transform: translate(-50%, -50%) scale(0.4);
        }
        60% { opacity: 1; }
        100% {
          opacity: 1;
          transform: translate(calc(var(--node-x, 0px) - 50%), calc(var(--node-y, 0px) - 50%)) scale(1);
        }
      }

      .adnify-about-footer {
        position: relative;
        z-index: 2;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        min-height: 74px;
        padding: 16px clamp(26px, 5vw, 54px);
        border-top: 1px solid rgb(var(--border) / 0.34);
        background: rgb(var(--surface) / 0.34);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
      }
      .adnify-about-author {
        display: inline-flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
      }
      .adnify-about-author img {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        border: 2px solid rgb(var(--surface));
        box-shadow: 0 0 0 1px rgb(var(--border));
      }
      .adnify-about-author span {
        display: grid;
        gap: 2px;
      }
      .adnify-about-author strong {
        font-size: 13px;
        font-weight: 800;
        color: rgb(var(--text-primary));
      }
      .adnify-about-author small {
        font-size: 10px;
        font-weight: 600;
        color: rgb(var(--text-muted));
      }
      .adnify-about-footer p {
        margin: 0;
        font-size: 10px;
        font-weight: 600;
        color: rgb(var(--text-muted) / 0.68);
        text-align: right;
      }

      @media (max-width: 760px) {
        .adnify-about {
          min-height: 0;
        }
        .adnify-about-shell {
          grid-template-columns: 1fr;
          padding: 34px 22px 20px;
        }
        .adnify-about-hero {
          align-items: center;
          text-align: center;
        }
        .adnify-about-brand-row {
          width: auto;
        }
        .adnify-about-brand-meta {
          justify-items: start;
          text-align: left;
        }
        .adnify-about-subtitle {
          max-width: 430px;
        }
        .adnify-about-chips,
        .adnify-about-actions {
          justify-content: center;
        }
        .adnify-about-community {
          min-height: 350px;
        }
        .adnify-about-footer {
          flex-direction: column;
          align-items: center;
          text-align: center;
        }
        .adnify-about-footer p {
          text-align: center;
        }
      }
    `}</style>
  )
}
