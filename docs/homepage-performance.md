# Homepage performance

The homepage starts public settings loading while synchronously applying due
activity transitions. The activity query embeds its related group through the
existing foreign key, retaining both tables' RLS and removing the second network
round trip. Due transitions are still applied before activity rows are read.

## Public settings cache

Only `site_navigation`, `homepage_hero`, and `homepage_bracket` use the shared
60-second data cache. Its loader uses an anonymous client without cookies.
Session, permission, activity state and voting queries explicitly use `no-store`.
All four settings write actions invalidate the public-settings tag after the
database update succeeds.

Cloudflare uses the private `buttervote-next-cache` R2 bucket, a Durable Object
tag cache, and the adapter's revalidation queue. Regional tag caching is disabled
to keep admin edits visible across regions without a secondary tag-cache delay.
The bucket is provisioned; the bindings and first Durable Object migration are
declared in `wrangler.jsonc` and applied by the existing Git-triggered deployment.
The public pages remain dynamic; private HTML must not be cached.

## Images

`VoteImage` requests responsive widths from the Next/OpenNext image endpoint.
The optimizer accepts only the configured Supabase origin's public `vote-images`
bucket. Existing paths, image versions, layout, loading behavior and full Hero
aspect ratios are retained. Unsupported URLs and browser upload previews are
served directly. A failed transformation falls back to the original image.

The `IMAGES` binding enables production resizing; `worker.mjs` delegates all
requests to OpenNext and adds a short cache lifetime only to successful public
vote-image responses. HTML, private/cookie responses, failures, and immutable
build assets retain their existing policy. This also works with existing images
without a database migration or an image backfill. No Images plan upgrade is
required; the original-image fallback also covers transformation quota errors.

New Hero uploads retain their width, height and version in the public setting.
Editing the Hero text preserves this metadata, so space can be reserved before
the image arrives and a replacement upload uses a fresh image URL.

## Sidebar

Private queries begin as soon as identity and navigation are available, while
public match cards load independently. Separate Suspense boundaries stream the
personal overview and the match list. Both share one permission/identity snapshot
and reference time; existing eligibility, quotas, result visibility, filters and
mobile expansion rules are kept. The personal overview is server-rendered.

## Local verification

Use Node.js 22 or newer (the verification used the existing Node.js 24 install).
Relevant checks cover sidebar rules and independent loading, allowed image
sources, versioned URLs, shared image cache boundaries, and request deadlines.
Local browser checks cover admin settings invalidation, guest data isolation,
match filtering/expansion, and complete Hero images at mobile/desktop widths.
