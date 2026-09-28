import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { login } from "@/lib/actions/auth";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  const store = await cookies();
  const alreadyValid = await verifySessionToken(store.get(SESSION_COOKIE_NAME)?.value);
  if (alreadyValid) {
    redirect("/");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-8 shadow-sm">
        <h1 className="text-lg font-semibold text-ink">
          BIR 8% Practice Manager
        </h1>
        <p className="mt-1 text-sm text-faint">
          Local, single-operator tool. Enter the shared password to continue.
        </p>

        <form action={login} className="mt-6 flex flex-col gap-3">
          <label className="text-sm font-medium text-ink-secondary" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoFocus
            required
            className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-400"
          />
          {error && (
            <p className="text-sm text-red">Incorrect password. Try again.</p>
          )}
          <button
            type="submit"
            className="mt-2 rounded-md bg-purple-600 px-3 py-2 text-sm font-medium text-white hover:bg-purple-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:ring-offset-1"
          >
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
