import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default:
          "border-orange-200 bg-orange-100 text-orange-800 hover:bg-orange-200",
        secondary:
          "border-[#F0D08A] bg-[#FFF3D0] text-[#6A3E21] hover:bg-[#FFE9A8]",
        destructive:
          "border-red-200 bg-red-50 text-red-700 hover:bg-red-100",
        outline: "border-[#E4C892] bg-white/50 text-[#5C321E]",
        love: "border-[#FFB3C1] bg-[#FFE4EA] text-[#C73555]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
