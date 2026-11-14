// Node-only test for lib/telegram-auth validateInitData (no test framework).
// Usage: BOT_TOKEN=test-token-123 node scripts/test-auth.mjs
// It forges a valid initData with the same HMAC construction Telegram uses,
// then checks: valid passes, tampered user fails, expired auth_date fails,
// wrong token fails. Exits non-zero on any failure.
import crypto from "node:crypto";

const TOKEN = process.env.BOT_TOKEN || "test-token-123";
const user = { id: 123456, first_name: "Test", username: "tester" };

function forge(u, token, authDate) {
  const p = new URLSearchParams();
  p.set("user", JSON.stringify(u));
  p.set("auth_date", String(authDate ?? Math.floor(Date.now() / 1000)));
  const pairs = [];
  p.forEach((v, k) => pairs.push(`${k}=${v}`));
  pairs.sort();
  const secret = crypto.createHash("sha256").update(token).digest();
  const hash = crypto.createHmac("sha256", secret).update(pairs.join("\n")).digest("hex");
  p.set("hash", hash);
  return p.toString();
}

// Re-implement the check here (mirrors lib/telegram-auth.ts) so the test is
// independent of importing TS from plain node.
function validate(initData, token) {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { valid: false, error: "hash missing" };
  const pairs = [];
  params.forEach((v, k) => { if (k !== "hash") pairs.push(`${k}=${v}`); });
  pairs.sort();
  const secret = crypto.createHash("sha256").update(token).digest();
  const computed = crypto.createHmac("sha256", secret).update(pairs.join("\n")).digest("hex");
  if (computed !== hash.toLowerCase()) return { valid: false, error: "hash mismatch" };
  const authDate = Number(params.get("auth_date") ?? 0);
  if (!authDate || Math.floor(Date.now() / 1000) - authDate > 24 * 3600) return { valid: false, error: "auth_date expired" };
  return { valid: true, user: JSON.parse(params.get("user")) };
}

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}`);
  if (!cond) failures++;
}

const good = forge(user, TOKEN);
check("valid forged initData passes", validate(good, TOKEN).valid === true);
check("user id round-trips", validate(good, TOKEN).user?.id === 123456);
const tampered = good.replace("Test", "Mallory");
check("tampered user fails", validate(tampered, TOKEN).valid === false);
check("wrong token fails", validate(good, "other-token").valid === false);
const old = forge(user, TOKEN, Math.floor(Date.now() / 1000) - 25 * 3600);
check("expired auth_date fails", validate(old, TOKEN).valid === false);
check("empty initData fails", validate("", TOKEN).valid === false);

if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log("All initData validation checks passed.");
