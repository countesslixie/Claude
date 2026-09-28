import { Nav } from "@/components/nav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <Nav />
      <main className="min-h-screen pl-60">
        <div className="px-6 py-6">{children}</div>
      </main>
    </div>
  );
}
