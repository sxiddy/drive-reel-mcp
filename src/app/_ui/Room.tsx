import { SiteHeader } from "./SiteHeader";
import { wrap } from "./kit";

const CREDITS = [
  ["Directed by", "You"],
  ["Cut by", "Claude"],
  ["Rendered with", "Remotion"],
  ["Footage", "Your Google Drive"],
];

function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-line">
      <div className={`${wrap} py-12 sm:py-16`}>
        <dl className="grid max-w-3xl gap-x-12 gap-y-3 sm:grid-cols-2">
          {CREDITS.map(([k, v]) => (
            <div key={k} className="flex items-baseline gap-2 font-mono text-label font-medium uppercase tracking-[.08em]">
              <dt className="shrink-0 text-fg-3">{k}</dt>
              <span aria-hidden className="mb-[3px] flex-1 border-b border-dotted border-edge" />
              <dd className="shrink-0 text-fg">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-10 font-mono text-caption text-fg-3">itsawrap.cv</p>
      </div>
    </footer>
  );
}

/** A room is a page's lighting: paper office before the film exists, screening room after. */
export function Room({ tone, children, footer = true }: { tone: "office" | "dark"; children: React.ReactNode; footer?: boolean }) {
  return (
    <div data-room={tone}>
      <SiteHeader />
      {children}
      {footer ? <SiteFooter /> : null}
    </div>
  );
}
