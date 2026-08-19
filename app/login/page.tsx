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
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">
          BIR 8% Practice Manager
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Local, single-operator tool. Enter the shared password to continue.
        </p>

        <form action={login} className="mt-6 flex flex-col gap-3">
          <label className="text-sm font-medium text-slate-700" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoFocus
            required
            className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
          {error && (
            <p className="text-sm text-red-600">Incorrect password. Try again.</p>
          )}
          <button
            type="submit"
            className="mt-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
