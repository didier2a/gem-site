import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("les portraits, activités et icônes sont des champs Decap, avec la photo actuelle", () => {
  const qui = read("content/pages/qui-sommes-nous.md");
  const activites = read("content/pages/nos-activites.md");
  const soutenir = read("content/pages/nous-soutenir.md");
  const config = read("public/admin/config.yml");

  for (const [slug, alt] of [
    ["michele-mereu", "Portrait de Michèle Mereu"],
    ["didier-aouizerate", "Portrait de Didier Aouizerate"],
    ["nathalie-maxant", "Portrait de Nathalie Maxant"],
    ["muriel-trupheme", "Portrait de Muriel Truphème"],
  ]) {
    assert.match(qui, new RegExp(`photo: "/uploads/pages/${slug}\\.webp"`));
    assert.match(qui, new RegExp(`photo_alt: "${alt}"`));
    const size = statSync(`public/uploads/pages/${slug}.webp`).size;
    assert.ok(size > 40_000 && size < 400_000, `${slug} ${size}`);
  }
  assert.match(qui, /name: "Michèle Mereu"/);
  assert.match(qui, /role: "Présidente"/);
  assert.match(qui, /group: "Le Bureau"/);
  assert.match(qui, /group: "Animatrices"/);

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
