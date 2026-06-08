import Link from "next/link";
import { createGroupAction } from "@/lib/actions/admin-actions";
import { requireAdmin } from "@/lib/auth";
import { FormStatusFieldset } from "@/components/form-status-fieldset";
import { FormSubmitButton } from "@/components/form-submit-button";
import { TransitionActionForm } from "@/components/transition-action-form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export default async function NewGroupPage() {
  await requireAdmin();

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-normal">新建活动组</h1>
          <p className="mt-3 text-muted-foreground">
            创建活动组并配置真爱票规则。
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
          <Button asChild variant="outline">
            <Link href="/admin/groups">返回</Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="p-4 sm:p-6">
          <CardTitle>活动组设置</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
          <TransitionActionForm
            action={createGroupAction}
            refresh={false}
            successMessage="活动组已创建"
          >
            <FormStatusFieldset className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="name">名称</Label>
                <Input id="name" name="name" required />
              </div>
            <div className="space-y-2">
              <Label htmlFor="description">简介</Label>
              <Textarea id="description" name="description" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="love_vote_weight">真爱票权重</Label>
                <Input
                  id="love_vote_weight"
                  name="love_vote_weight"
                  type="number"
                  min="0.1"
                  step="0.1"
                  defaultValue="3"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="love_vote_quota">真爱票额度</Label>
                <Input
                  id="love_vote_quota"
                  name="love_vote_quota"
                  type="number"
                  min="0"
                  defaultValue="1"
                  required
                />
              </div>
            </div>
              <FormSubmitButton className="w-full sm:w-auto" loadingText="保存中...">
                创建活动组
              </FormSubmitButton>
            </FormStatusFieldset>
          </TransitionActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
