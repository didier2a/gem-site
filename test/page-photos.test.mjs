import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

/** Blocs « - » de la liste team du frontmatter. */
function teamMemberBlocks(markdown) {
  const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
  const start = frontmatter.search(/^team:[ \t]*$/m);
  assert.notEqual(start, -1, "liste équipe");
  return frontmatter.slice(start).split(/\n(?=  - )/).slice(1);
}

/** undefined si le champ est absent, "" si Decap l’a laissé vide. */
function photoValue(block) {
  const line = block.match(/^    photo:[ \t]*(.*)$/m);
  if (!line) return undefined;
  let value = line[1].trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1);
  }
  return value;
}

test("les portraits, activités et icônes sont des champs Decap, avec la photo actuelle", () => {
  const qui = read("content/pages/qui-sommes-nous.md");
  const activites = read("content/pages/nos-activites.md");
  const soutenir = read("content/pages/nous-soutenir.md");
  const config = read("public/admin/config.yml");

  const members = teamMemberBlocks(qui);
  assert.ok(members.length > 0);
  for (const member of members) {
    assert.match(member, /name:/);
    assert.match(member, /role:/);
    assert.match(member, /group:/);
    const photo = photoValue(member);
    if (photo === undefined || photo === "") continue;
    assert.match(photo, /^\/uploads\/pages\//);
  }

  for (const slug of [
    "michele-mereu",
    "didier-aouizerate",
    "nathalie-maxant",
    "muriel-trupheme",
  ]) {
    const size = statSync(`public/uploads/pages/${slug}.webp`).size;
    assert.ok(size > 40_000 && size < 400_000, `${slug} ${size}`);
  }

  for (const [title, file, alt] of [
    ["Peindre", "activity-peindre-v2.jpg", "Atelier peinture"],
    ["Cuisiner", "activity-cuisiner-v2.jpg", "Atelier cuisine"],
    ["Marcher", "activity-marcher-v2.jpg", "Marche en extérieur"],
    ["Sorties", "activity-sorties-v2.jpg", "Repas partagé en terrasse"],
    ["Temps conviviaux", "activity-temps-v2.jpg", "Discussion autour d’une table"],
    ["Ateliers créatifs", "activity-ateliers-v2.jpg", "Atelier de peinture en groupe"],
  ]) {
    assert.match(activites, new RegExp(`title: "${title}"`));
    assert.match(activites, new RegExp(`image: "/uploads/pages/${file}"`));
    assert.match(activites, new RegExp(`image_alt: "${alt}"`));
    assert.equal(
      statSync(`public/uploads/pages/${file}`).size,
      statSync(`public/assets/home/${file}`).size,
      file,
    );
  }

  for (const [title, file] of [
    ["Faire un don", "icon-don.png"],
    ["Devenir bénévole", "icon-benevole.png"],
    ["Devenir partenaire", "icon-partenaire.png"],
  ]) {
    assert.match(soutenir, new RegExp(`title: "${title}"`));
    assert.match(soutenir, new RegExp(`icon: "/uploads/pages/${file}"`));
    assert.equal(
      statSync(`public/uploads/pages/${file}`).size,
      statSync(`public/assets/home/${file}`).size,
      file,
    );
  }
  assert.match(soutenir, /icon_alt: ""/);

  assert.match(config, /label: Équipe/);
  assert.match(config, /name: photo_alt/);
  assert.match(config, /name: activities/);
  assert.match(config, /name: image_alt/);
  assert.match(config, /name: support_cards/);
  assert.match(config, /name: icon_alt/);
  assert.match(config, /label: Activités/);
  assert.match(config, /Cartes de soutien/);
});
