import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-normal rounded-full text-center text-sm font-medium leading-snug shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[#FFF8E8] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-orange-600",
        destructive:
          "border border-red-200 bg-red-50 text-red-700 hover:bg-red-100",
        love:
          "border border-[#FFB3C1] bg-[#FF6B81] text-white hover:bg-[#E85B72]",
        outline:
          "border border-[#EED8AA] bg-white/60 text-[#5C321E] hover:bg-[#FFF3D0] hover:text-[#5C321E]",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[#FFE59B]",
        ghost:
          "shadow-none text-[#5C321E] hover:bg-[#FFF3D0] hover:text-orange-700",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "min-h-10 px-4 py-2",
        sm: "min-h-9 px-3 py-2",
        lg: "min-h-11 px-8 py-2",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
