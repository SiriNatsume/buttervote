"use client";

import { Suspense, type ReactNode } from "react";
import { AppProgressBar } from "next-nprogress-bar";
import { Toaster } from "sonner";
import { ToastQueryListener } from "@/components/toast-query-listener";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <AppProgressBar
        color="#F97316"
        height="3px"
        options={{ showSpinner: false }}
        shallowRouting
      />
      <Toaster richColors position="top-center" closeButton />
      <Suspense fallback={null}>
        <ToastQueryListener />
      </Suspense>
    </>
  );
}
