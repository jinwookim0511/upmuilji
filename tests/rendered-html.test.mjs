import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("keeps Supabase values out of tracked source", async () => {
  const [page, supabaseClient, exampleEnv, gitignore] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/supabase.ts", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../.gitignore", import.meta.url), "utf8"),
  ]);

  assert.match(page, /process\.env\.SUPABASE_URL/);
  assert.match(page, /process\.env\.SUPABASE_PUBLISHABLE_KEY/);
  assert.match(supabaseClient, /createSupabaseBrowserClient/);
  assert.doesNotMatch(
    `${page}\n${supabaseClient}\n${exampleEnv}`,
    /sb_publishable_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
  );
  assert.match(exampleEnv, /^SUPABASE_URL=$/m);
  assert.match(exampleEnv, /^SUPABASE_PUBLISHABLE_KEY=$/m);
  assert.match(gitignore, /^\.env\*$/m);
  assert.match(gitignore, /^!\.env\.example$/m);
});

test("uses the Vercel-compatible Next.js and Node mail runtimes", async () => {
  const [packageJson, mailRoute] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/api/approval-email/route.ts", import.meta.url), "utf8"),
  ]);
  const pkg = JSON.parse(packageJson);

  assert.equal(pkg.scripts.dev, "next dev");
  assert.equal(pkg.scripts.build, "next build --webpack");
  assert.equal(pkg.scripts.start, "next start");
  assert.equal(typeof pkg.dependencies.next, "string");
  assert.equal(typeof pkg.dependencies.nodemailer, "string");
  assert.match(mailRoute, /nodemailer\.createTransport/);
  assert.match(mailRoute, /new URL\(request\.url\)\.origin/);
  assert.doesNotMatch(mailRoute, /cloudflare:sockets|chatgpt\.site/);
});
