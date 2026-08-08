export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6 py-20">
      <div className="rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">
          Velantis Legal Explorer
        </h1>
        <p className="mt-3 text-sm text-neutral-600">Search and understand the law</p>
        <label className="mt-8 block text-sm font-medium text-neutral-700" htmlFor="search">
          Search
        </label>
        <input
          id="search"
          type="search"
          disabled
          placeholder="Search will be available soon"
          className="mt-2 w-full rounded-lg border border-neutral-300 bg-neutral-100 px-3 py-2 text-sm text-neutral-500 outline-none"
        />
      </div>
    </main>
  );
}
