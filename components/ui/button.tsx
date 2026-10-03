import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:ring-offset-1",
  {
    variants: {
      variant: {
        primary: "bg-purple-600 text-white hover:bg-purple-700",
        secondary: "bg-surface text-ink border border-line hover:bg-purple-wash",
        ghost: "text-ink-secondary hover:bg-purple-wash",
        destructive: "bg-red text-white hover:opacity-90",
      },
      size: {
        // D170 — the one size for every page-header button and every form's
        // submit/Cancel pair, primary or bordered; only the colour differs.
        // `sm` is for compact controls inside cards, tables and filter bars.
        default: "h-9 px-3",
        sm: "h-7 px-2 text-xs",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

export interface ButtonProps
  extends React.ComponentProps<"button">,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <button className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}
