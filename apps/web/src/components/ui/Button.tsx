import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'pv'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  loading?: boolean
  icon?: ReactNode
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent-btn text-on-accent border-transparent hover:brightness-110',
  secondary: 'bg-surface text-text border-border-strong hover:bg-surface-2',
  ghost: 'bg-transparent text-text-2 border-transparent hover:bg-neutral-soft hover:text-text',
  pv: 'bg-pv-btn text-white border-transparent hover:brightness-110',
}

export function Button({ variant = 'secondary', loading = false, icon, disabled, className, children, type, ...rest }: ButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border px-3.5 text-[13.5px] font-semibold transition-[background-color,filter,transform] duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <span aria-hidden="true" className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : icon}
      {children}
    </button>
  )
}
