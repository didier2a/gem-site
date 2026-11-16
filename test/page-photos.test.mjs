import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import yaml from "js-yaml";

function frontmatter(path) {
  const raw = readFileSync(path, "utf8");
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(match, path);
  return yaml.load(match[1]);
}

/** Une image vide est permise. Une image remplie vient de la médiathèque. */
function uploadOrEmpty(value, label) {
  if (value == null) return;
  const text = String(value).trim();
  if (!text) return;
  assert.ok(text.startsWith("/uploads/"), `${label} doit commencer par /uploads/ : ${text}`);
}

test("les photos, activités et cartes de soutien acceptent une liste de n’importe quelle longueur", () => {
  const qui = frontmatter("content/pages/qui-sommes-nous.md");
  const activites = frontmatter("content/pages/nos-activites.md");
  const soutenir = frontmatter("content/pages/nous-soutenir.md");
  const team = qui.team ?? [];
  const activities = activites.activities ?? [];
  const cards = soutenir.support_cards ?? [];

  assert.ok(Array.isArray(team));
  assert.ok(Array.isArray(activities));
  assert.ok(Array.isArray(cards));

  for (const [index, member] of team.entries()) {
    assert.equal(typeof member, "object");
    uploadOrEmpty(member?.photo, `équipe ${index}`);
    if (member?.photo_alt != null) assert.equal(typeof member.photo_alt, "string");
  }
  for (const [index, item] of activities.entries()) {
    uploadOrEmpty(item?.image, `activité ${index}`);
    if (item?.image_alt != null) assert.equal(typeof item.image_alt, "string");
  }
  for (const [index, card] of cards.entries()) {
    uploadOrEmpty(card?.icon, `soutien ${index}`);
    if (card?.icon_alt != null) assert.equal(typeof card.icon_alt, "string");
  }

  const config = readFileSync("public/admin/config.yml", "utf8");
  assert.match(config, /label: Équipe/);
  assert.match(config, /name: photo_alt/);
  assert.match(config, /name: activities/);
  assert.match(config, /name: image_alt/);
  assert.match(config, /name: support_cards/);
  assert.match(config, /name: icon_alt/);
  assert.match(config, /label: Activités/);
  assert.match(config, /Cartes de soutien/);
});
