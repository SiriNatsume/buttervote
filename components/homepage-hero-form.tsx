"use client";

import { useMemo, useState } from "react";
import { updateHomepageHeroAction } from "@/lib/actions/admin-actions";
import type { HomepageHeroValue } from "@/lib/types";
import { FormStatusFieldset } from "@/components/form-status-fieldset";
import { FormSubmitButton } from "@/components/form-submit-button";
import { TransitionActionForm } from "@/components/transition-action-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type Option = {
  id: string;
  label: string;
};

export function HomepageHeroForm({
  groups,
  contests,
  tournaments,
  value,
}: {
  groups: Option[];
  contests: Option[];
  tournaments: Option[];
  value?: HomepageHeroValue | null;
}) {
  const initialType =
    value?.featuredType ??
    (groups.length > 0
      ? "group"
      : contests.length > 0
        ? "contest"
        : "tournament");
  const [featuredType, setFeaturedType] = useState<
    "group" | "contest" | "tournament"
  >(initialType);
  const options = useMemo(
    () =>
      featuredType === "group"
        ? groups
        : featuredType === "contest"
          ? contests
          : tournaments,
    [contests, featuredType, groups, tournaments],
  );
  const preferredId =
    value?.featuredType === initialType ? value?.featuredId : undefined;
  const initialId =
    preferredId && options.some((option) => option.id === preferredId)
      ? preferredId
      : options[0]?.id ?? "";
  const [featuredId, setFeaturedId] = useState(initialId);

  function handleTypeChange(nextType: "group" | "contest" | "tournament") {
    setFeaturedType(nextType);
    const nextOptions =
      nextType === "group"
        ? groups
        : nextType === "contest"
          ? contests
          : tournaments;
    setFeaturedId(nextOptions[0]?.id ?? "");
  }

  return (
    <TransitionActionForm
      action={updateHomepageHeroAction}
      successMessage="首页 Hero 已保存"
    >
      <FormStatusFieldset className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>推荐类型</Label>
            <Select
              name="featuredType"
              value={featuredType}
              onValueChange={(nextValue) =>
                handleTypeChange(nextValue as "group" | "contest" | "tournament")
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="group">活动组</SelectItem>
                <SelectItem value="contest">活动</SelectItem>
                <SelectItem value="tournament">赛事对阵图</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>推荐对象</Label>
            <Select
              name="featuredId"
              value={featuredId}
              onValueChange={setFeaturedId}
            >
              <SelectTrigger>
                <SelectValue placeholder="选择对象" />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="title">Hero 标题</Label>
          <Input
            id="title"
            name="title"
            defaultValue={value?.title ?? ""}
            placeholder="可选覆盖标题"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="description">Hero 简介</Label>
          <Textarea
            id="description"
            name="description"
            defaultValue={value?.description ?? ""}
            placeholder="可选覆盖简介"
          />
        </div>
        <FormSubmitButton
          disabled={!featuredId}
          className="w-full sm:w-auto"
          loadingText="保存中..."
        >
          保存首页 Hero
        </FormSubmitButton>
      </FormStatusFieldset>
    </TransitionActionForm>
  );
}
