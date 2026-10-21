import type { Metadata } from "next";
import { Room } from "../_ui/Room";
import { wrap } from "../_ui/kit";
import { AdminBoard } from "./AdminBoard";

export const metadata: Metadata = { title: "Admin · It's a Wrap", robots: { index: false, follow: false } };

export default function AdminPage() {
  return (
    <Room tone="office">
      <main className={`${wrap} flex-1 pb-24`}>
        <AdminBoard />
      </main>
    </Room>
  );
}
