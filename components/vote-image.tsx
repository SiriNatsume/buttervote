"use client";

import { useState, type ComponentPropsWithoutRef } from "react";
import { getVoteImageSources, type VoteImageWidth } from "@/lib/image/responsive-image";

type VoteImageProps = Omit<ComponentPropsWithoutRef<"img">, "src" | "srcSet"> & {
  src: string;
  alt: string;
  maxWidth?: VoteImageWidth;
};

export function VoteImage({ src, alt, maxWidth, sizes = "100vw", onError, ...props }: VoteImageProps) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const sources = failedSource === src ? { src } : getVoteImageSources(src, maxWidth);

  return (
    <img
      alt={alt}
      decoding="async"
      {...props}
      {...sources}
      sizes={sources.srcSet ? sizes : undefined}
      onError={(event) => {
        // A transform quota, upstream error, or unavailable optimizer must not
        // hide an otherwise valid image. A changed source retries optimization.
        if (sources.srcSet) setFailedSource(src);
        onError?.(event);
      }}
    />
  );
}
