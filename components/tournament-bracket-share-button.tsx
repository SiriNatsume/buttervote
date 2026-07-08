"use client";

import { useState } from "react";
import { Download, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type ShareBracket = {
  groupId: string | null;
  tournament: {
    id: string;
    name: string;
  };
};

function safeFilenamePart(value: string) {
  return (
    value
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "tournament"
  );
}

function bracketImageUrl(bracket: ShareBracket) {
  if (!bracket.groupId) {
    return null;
  }

  const groupId = encodeURIComponent(bracket.groupId);
  const tournamentId = encodeURIComponent(bracket.tournament.id);

  return `/api/contest-groups/${groupId}/bracket-image?tournamentId=${tournamentId}`;
}

async function fetchBracketPng(url: string) {
  const response = await fetch(url);

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(message || "\u5bf9\u9635\u56fe\u751f\u6210\u5931\u8d25\u3002");
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("image/png")) {
    throw new Error("\u670d\u52a1\u7aef\u672a\u8fd4\u56de PNG \u56fe\u7247\u3002");
  }

  return response.blob();
}

function downloadBlob(blob: Blob, tournamentName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `buttervote-${safeFilenamePart(tournamentName)}-bracket.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function copyBlob(blob: Blob) {
  if (!navigator.clipboard || !("ClipboardItem" in window)) {
    return false;
  }

  await navigator.clipboard.write([
    new ClipboardItem({
      "image/png": blob,
    }),
  ]);
  return true;
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
      const copied = await copyBlob(blob).catch(() => false);

      if (copied) {
        toast.success(
          "\u5bf9\u9635\u56fe\u56fe\u7247\u5df2\u590d\u5236\uff0c\u53ef\u4ee5\u76f4\u63a5\u7c98\u8d34\u5206\u4eab\u3002",
        );
      } else {
        downloadBlob(blob, bracket.tournament.name);
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
