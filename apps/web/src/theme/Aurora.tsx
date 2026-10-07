/** Fundalul cu aurora statică. Gradienți din tokens (--au1..3); fără animație și fără sticlă. */
export function Aurora() {
  return (
    <div
      aria-hidden="true"
      data-testid="aurora"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        pointerEvents: 'none',
        background:
          'radial-gradient(820px 560px at 8% 4%, var(--au1), transparent 70%), radial-gradient(760px 560px at 92% 14%, var(--au2), transparent 70%), radial-gradient(1000px 640px at 55% 108%, var(--au3), transparent 70%), var(--bg)',
      }}
    />
  )
}
