export function SiteFooter() {
  const currentYear = new Date().getFullYear();
  const yearText = currentYear > 2026 ? `2026-${currentYear}` : "2026";

  return (
    <footer className="mx-auto mt-12 w-full max-w-6xl border-t border-[#EED8AA]/70 px-4 py-8 text-center text-sm leading-7 text-muted-foreground sm:px-6">
      <p>
        © {yearText}{" "}
        <a
          href="https://sirinatsume.com/"
          target="_blank"
          rel="noreferrer"
          className="font-medium text-[#5C321E] underline-offset-4 transition-colors hover:text-orange-700 hover:underline"
        >
          SiriNatsume
        </a>
      </p>
      <p>Built with Supabase, Tailwind CSS and shadcn/ui</p>
    </footer>
  );
}
