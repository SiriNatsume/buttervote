"use client";

import { useState } from "react";
import { Download, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  copyPngBlobToClipboard,
  downloadBlob,
  fetchPngBlob,
  safeFilenamePart,
} from "@/lib/generated-image-share";

type ShareBracket = {
  groupId: string | null;
  visibilityVersion: string;
  tournament: {
    id: string;
    name: string;
  };
};

function bracketImageUrl(bracket: ShareBracket) {
  if (!bracket.groupId) {
    return null;
  }

  const groupId = encodeURIComponent(bracket.groupId);
  const tournamentId = encodeURIComponent(bracket.tournament.id);
  const visibilityVersion = encodeURIComponent(bracket.visibilityVersion);

  return `/api/contest-groups/${groupId}/bracket-image?tournamentId=${tournamentId}&v=${visibilityVersion}`;
}

async function fetchBracketPng(url: string) {
  return fetchPngBlob(url, "\u5bf9\u9635\u56fe\u751f\u6210\u5931\u8d25\u3002");
}

export function TournamentBracketShareButton({
  bracket,
}: {
  bracket: ShareBracket;
}) {
  const [isGenerating, setIsGenerating] = useState(false);
  const imageUrl = bracketImageUrl(bracket);

  async function handleShare() {
    if (!imageUrl) {
      toast.error(
        "\u5f53\u524d\u5bf9\u9635\u56fe\u7f3a\u5c11\u6d3b\u52a8\u7ec4\uff0c\u6682\u65f6\u65e0\u6cd5\u5bfc\u51fa\u56fe\u7247\u3002",
      );
      return;
    }

    setIsGenerating(true);
    try {
      const blob = await fetchBracketPng(imageUrl);
      const copied = await copyPngBlobToClipboard(blob).catch(() => false);

      if (copied) {
        toast.success(
          "\u5bf9\u9635\u56fe\u56fe\u7247\u5df2\u590d\u5236\uff0c\u53ef\u4ee5\u76f4\u63a5\u7c98\u8d34\u5206\u4eab\u3002",
        );
      } else {
        downloadBlob(
          blob,
          `buttervote-${safeFilenamePart(
            bracket.tournament.name,
            "tournament",
          )}-bracket.png`,
        );
        toast.success(
          "\u6d4f\u89c8\u5668\u4e0d\u652f\u6301\u76f4\u63a5\u590d\u5236\uff0c\u5df2\u4e0b\u8f7d\u5bf9\u9635\u56fe\u56fe\u7247\u3002",
        );
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "\u751f\u6210\u5206\u4eab\u56fe\u7247\u5931\u8d25",
      );
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleShare}
      disabled={isGenerating || !imageUrl}
      title={
        imageUrl
          ? undefined
          : "\u5f53\u524d\u5bf9\u9635\u56fe\u7f3a\u5c11\u6d3b\u52a8\u7ec4"
      }
      data-bracket-share-control
    >
      {isGenerating ? (
        <Download className="size-4 animate-pulse" aria-hidden="true" />
      ) : (
        <Share2 className="size-4" aria-hidden="true" />
      )}
      {isGenerating ? "\u751f\u6210\u4e2d" : "\u5206\u4eab\u5bf9\u9635\u56fe"}
    </Button>
  );
}
