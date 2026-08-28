import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const alertVariants = cva(
  'relative w-full rounded-md border px-3 py-2 text-sm [&>svg]:absolute [&>svg]:left-3 [&>svg]:top-2.5 [&>svg+div]:pl-6',
  {
    variants: {
      variant: {
        default: 'border-border bg-background text-foreground',
        warning: 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300',
        destructive:
          'border-destructive/35 bg-destructive/10 text-destructive dark:border-destructive/50',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn('text-xs leading-relaxed', className)}
      {...props}
    />
  )
}

export { Alert, AlertDescription }
