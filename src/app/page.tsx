import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 px-6 py-24">
      <h1 className="text-3xl font-semibold tracking-tight">Repo Cartographer</h1>
      <p className="text-muted-foreground max-w-xl text-lg">
        Paste a public GitHub repository. An agent explores it with read-only
        tools and returns an architecture graph where every component and
        relation cites its evidence.
      </p>
      <div>
        <Button disabled>Coming soon</Button>
      </div>
    </main>
  );
}
