"use client";

import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { getActiveSection, type PageSection, type SiteNavigationData, type SiteSection } from "@/lib/page-navigation";

const PageSectionContext = createContext<{
  page: PageSection | null;
  register: (page: PageSection) => () => void;
} | null>(null);

export function PageSectionProvider({ children }: { children: ReactNode }) {
  const [page, setPage] = useState<PageSection | null>(null);
  const register = useCallback((next: PageSection) => {
    setPage(next);
    return () => setPage((current) => current === next ? null : current);
  }, []);
  const value = useMemo(() => ({ page, register }), [page, register]);
  return <PageSectionContext.Provider value={value}>{children}</PageSectionContext.Provider>;
}

export function useRegisterPageSection(section?: SiteSection) {
  const pathname = usePathname();
  const register = useContext(PageSectionContext)?.register;
  // Shared layouts persist across navigation. Use the current page's server
  // metadata when activities are added or reassigned after the layout loaded.
  useLayoutEffect(() => {
    if (section && register) return register({ pathname, section });
  }, [pathname, section, register]);
}

export function useActiveSection(navigation: SiteNavigationData) {
  const pathname = usePathname();
  const context = useContext(PageSectionContext);
  return getActiveSection(pathname, navigation, context?.page ?? null);
}
