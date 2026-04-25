import { useStore } from '@renderer/store'

export function Logo({ className = "w-6 h-6", glow = false }: { className?: string; glow?: boolean }) {
  const currentTheme = useStore(s => s.currentTheme)
  const isDawn = currentTheme === 'dawn'

  return (
    <img
      src={isDawn ? '/brand/logos/app-light.png' : '/brand/logos/app.png'}
      alt="Adnify"
      className={`${className} ${glow ? 'drop-shadow-[0_0_8px_rgba(var(--accent),0.6)]' : ''}`}
    />
  )
}
