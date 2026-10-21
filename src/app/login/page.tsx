import type { Metadata } from "next";
import { Room } from "../_ui/Room";
import { wrap } from "../_ui/kit";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in · It's a Wrap", robots: { index: false, follow: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  // Only same-site paths, so the sign-in page can't bounce visitors elsewhere.
  const back = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return (
    <Room tone="office">
      <main className={`${wrap} flex-1 pb-24`}>
        <LoginForm next={back} />
      </main>
    </Room>
  );
}
