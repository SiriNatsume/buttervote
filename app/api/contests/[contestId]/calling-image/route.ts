import { NextRequest } from "next/server";
import {
  normalizeContestCallingEvent,
  withContestCallingPhaseProgress,
} from "@/lib/contest-calling";
import { renderContestCallingSvg } from "@/lib/contest-calling-image";
import { getCallingShareBackgroundDataUrl } from "@/lib/calling-share-background";
import { getCurrentProfile } from "@/lib/auth";
import { svgToPng } from "@/lib/bracket-image/png";
import { createClient } from "@/lib/supabase/server";
import { createRequiredServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

function parseStep(value: string | null) {
  if (!value) {
    return null;
  }
  const step = Number(value);
  return Number.isInteger(step) && step >= 0 ? step : null;
}

function pngResponse(bytes: Uint8Array, contestId: string, step: number) {
  const body = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;

  return new Response(body, {
    headers: {
      "content-type": "image/png",
      "cache-control": "no-store",
      "content-disposition": `inline; filename="buttervote-calling-${contestId}-${step}.png"`,
    },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ contestId: string }> },
) {
  const { contestId } = await params;
  const profile = await getCurrentProfile();
  const isAdmin = profile?.role === "admin";
  const supabase = isAdmin ? createRequiredServiceClient() : await createClient();
  const requestedSessionId = request.nextUrl.searchParams.get("sessionId");

  const { data: contest } = await supabase
    .from("contests")
    .select("id,title,archived_at")
    .eq("id", contestId)
    .maybeSingle();

  if (!contest || contest.archived_at) {
    return new Response("Not found", { status: 404 });
  }

  let sessionQuery = supabase
    .from("contest_calling_sessions")
    .select(
      "id,contest_id,status,current_step,total_steps,metadata,archived_at,created_at",
    )
    .eq("contest_id", contestId)
    .is("archived_at", null);

  if (requestedSessionId) {
    sessionQuery = sessionQuery.eq("id", requestedSessionId);
  }

  if (!isAdmin) {
    sessionQuery = sessionQuery.in("status", ["active", "paused", "completed"]);
  }

  const { data: sessions, error: sessionError } = await sessionQuery
    .order("created_at", { ascending: false })
    .limit(1);
  const session = sessions?.[0] ?? null;

  if (sessionError || !session) {
    return new Response("Not found", { status: 404 });
  }

  const currentStep = Math.max(0, Number(session.current_step) || 0);
  const totalSteps = Math.max(0, Number(session.total_steps) || 0);
  const requestedStep = parseStep(request.nextUrl.searchParams.get("step"));
  const step = requestedStep ?? currentStep;
  const maxVisibleStep = isAdmin ? totalSteps : currentStep;

  if (step > maxVisibleStep || step < 0) {
    return new Response("Not found", { status: 404 });
  }

  const event =
    step > 0
      ? await supabase
          .from("contest_calling_events")
          .select(
            "sequence,phase,candidate_id,delta_score,candidate_snapshot,scores,metadata",
          )
          .eq("session_id", session.id)
          .eq("sequence", step)
          .maybeSingle()
      : { data: null, error: null };

  if (event.error) {
    return new Response("Not found", { status: 404 });
  }

  const normalizedEvent = withContestCallingPhaseProgress(
    event.data ? normalizeContestCallingEvent(event.data) : null,
    session.metadata,
  );
  const backgroundDataUrl = await getCallingShareBackgroundDataUrl(request.nextUrl.origin);
  const svg = await renderContestCallingSvg({
    contestTitle: contest.title,
    sessionStatus: session.status,
    currentStep: step,
    totalSteps,
    event: normalizedEvent,
    backgroundDataUrl,
  });
  const png = await svgToPng(svg);

  return pngResponse(png, contestId, step);
}