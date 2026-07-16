import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function GroupHomepageSection({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn(className)}>
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="pt-3">{children}</div>
    </section>
  );
}
