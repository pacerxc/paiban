type Theme = 'warm' | 'ocean' | 'dark'

const THEMES: { id: Theme; label: string; swatch: string }[] = [
  { id: 'warm', label: '暖纸', swatch: '#0e7c66' },
  { id: 'ocean', label: '碧海', swatch: '#2563eb' },
  { id: 'dark', label: '暗夜', swatch: '#3ec9a0' },
]

export default function ThemeSwitcher({
  theme,
  onChange,
}: {
  theme: Theme
  onChange: (t: Theme) => void
}) {
  return (
    <div className="theme-switcher" role="group" aria-label="主题切换">
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          className={theme === t.id ? 'ts-btn active' : 'ts-btn'}
          onClick={() => onChange(t.id)}
          title={`${t.label}主题`}
        >
          <span className="ts-swatch" style={{ background: t.swatch }} />
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  )
}
