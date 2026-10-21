import { CreateForm } from "./CreateForm";
import { YourVideos } from "./YourVideos";
import { Room } from "./_ui/Room";
import { Label, wrap } from "./_ui/kit";

const RUNNING_ORDER = [
  { n: "01", tag: "Paste", title: "Paste the folder", body: "Any Drive folder shared as “Anyone with the link”: clips, photos, songs." },
  { n: "02", tag: "Dailies", title: "Every clip gets watched", body: "Light, blur, motion and sound are measured, and the music’s beat is found." },
  { n: "03", tag: "Pitches", title: "Claude pitches the cut", body: "Three or four treatments written from what’s actually in your footage." },
  { n: "04", tag: "Final cut", title: "You get the film", body: "Rendered at 1080p, cut on the beat. Change any text, shot or song after." },
];

export default function Home() {
  const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }).replaceAll("/", ".");
  return (
    <Room tone="office">
      <main className="flex-1">
        <section className={`${wrap} grid gap-12 pb-16 pt-10 sm:pt-16 lg:grid-cols-12 lg:gap-6 lg:pb-24 lg:pt-20`}>
          <div className="lg:col-span-6 xl:col-span-7">
            <Label className="text-fg-3">
              Call sheet · <span className="tnum">{today}</span>
            </Label>
            <h1 className="display mt-5 text-[4rem] leading-[.88] tracking-[-.005em] sm:text-hero">
              <span className="gate">
                <span>You shot it.</span>
              </span>
              <span className="gate">
                <span style={{ animationDelay: "var(--f2)" }}>We&rsquo;ll cut it.</span>
              </span>
            </h1>
            <p className="mt-7 max-w-[36ch] font-serif text-lede text-fg-2">
              Paste a Google Drive folder. Every clip gets watched, Claude pitches three or four ways to cut it, and you get a finished 1080p film, cut on the beat.
            </p>
            <p className="mt-6 font-mono text-label font-medium uppercase tracking-[.08em] text-fg-3">
              1080p · Cut on the beat · 16:9 / 9:16 / 1:1 · Edit after
            </p>
          </div>
          <div className="lg:col-span-6 xl:col-span-5">
            <CreateForm />
          </div>
        </section>

        <section aria-labelledby="order" className={`${wrap} py-16 lg:py-24`}>
          <div className="flex items-baseline justify-between gap-4 border-t border-line pt-6">
            <h2 id="order" className="display text-d2" style={{ fontStretch: "75%", fontWeight: 700 }}>
              Running order
            </h2>
            <Label className="hidden text-fg-3 sm:block">4 steps · one folder</Label>
          </div>
          {/* Desktop: one horizontal ruler with four markers. Mobile: a vertical ruler. */}
          <div className="relative mt-10 hidden lg:block">
            <div className="ruler" aria-hidden />
            <ol className="mt-6 grid grid-cols-4 gap-6">
              {RUNNING_ORDER.map((s) => (
                <li key={s.n} className="relative">
                  <span aria-hidden className="absolute -top-[30px] left-0 h-[24px] w-px bg-fg" />
                  <Label className="text-fg-3">
                    {s.n} · {s.tag}
                  </Label>
                  <p className="mt-2 text-title font-semibold tracking-[-.01em]">{s.title}</p>
                  <p className="mt-2 max-w-[30ch] text-small text-fg-2">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
          <div className="mt-8 flex gap-4 lg:hidden">
            <span className="ruler-v shrink-0" aria-hidden />
            <ol className="grid gap-8">
              {RUNNING_ORDER.map((s) => (
                <li key={s.n}>
                  <Label className="text-fg-3">
                    {s.n} · {s.tag}
                  </Label>
                  <p className="mt-1.5 text-title font-semibold">{s.title}</p>
                  <p className="mt-1.5 text-small text-fg-2">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
          <p className="mt-10 font-serif text-prose text-fg-2">A few minutes, start to finish.</p>
        </section>

        <section id="videos" className={`${wrap} scroll-mt-16 pb-24 pt-8`}>
          <YourVideos />
        </section>
      </main>
    </Room>
  );
}
