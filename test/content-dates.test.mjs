import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import yaml from "js-yaml";
import { z } from "zod/v4";
import { calendarDateSchema } from "../src/lib/calendar-date.mjs";

const calendarDate = calendarDateSchema(z);

function yamlDate(source) {
  const parsed = yaml.load(source);
  return parsed.date;
}

if (process.env.CONTENT_DATE_TZ_CHILD === "1") {
  const bare = yamlDate("date: 2026-04-24");
  const quoted = yamlDate('date: "2026-04-24"');
  const local = `${bare.getFullYear()}-${String(bare.getMonth() + 1).padStart(2, "0")}-${String(bare.getDate()).padStart(2, "0")}`;
  if (local === "2026-04-24") {
    console.error(`fuseau non appliqué: ${bare.toString()}`);
    process.exit(1);
  }
  if (calendarDate.parse(bare) !== "2026-04-24") {
    console.error(`date sans guillemets décalée: ${calendarDate.parse(bare)}`);
    process.exit(1);
  }
  if (calendarDate.parse(quoted) !== "2026-04-24") {
    console.error(`date avec guillemets décalée: ${calendarDate.parse(quoted)}`);
    process.exit(1);
  }
  process.exit(0);
}

test("une date avec guillemets reste la chaîne AAAA-MM-JJ", () => {
  const value = yamlDate('date: "2026-04-24"');
  assert.equal(typeof value, "string");
  assert.equal(calendarDate.parse(value), "2026-04-24");
});

test("une date sans guillemets (Date YAML) devient AAAA-MM-JJ en UTC", () => {
  const value = yamlDate("date: 2026-04-24");
  assert.ok(value instanceof Date);
  assert.equal(value.toISOString(), "2026-04-24T00:00:00.000Z");
  assert.equal(calendarDate.parse(value), "2026-04-24");

  const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    env: { ...process.env, TZ: "America/Los_Angeles", CONTENT_DATE_TZ_CHILD: "1" },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
