import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import yaml from "js-yaml";
import { z } from "zod/v4";
import { blogDataSchema, pageDataSchema } from "../src/lib/content-schema.mjs";

const blog = blogDataSchema(z);
const page = pageDataSchema(z);

function frontmatter(path) {
  const raw = readFileSync(path, "utf8");
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(match, path);
  return yaml.load(match[1]);
}

test("le contenu déjà en ligne passe le schéma souple", () => {
  for (const name of readdirSync("content/blog")) {
    if (!name.endsWith(".md")) continue;
    blog.parse(frontmatter(`content/blog/${name}`));
  }
  for (const name of readdirSync("content/pages")) {
    if (!name.endsWith(".md")) continue;
    page.parse(frontmatter(`content/pages/${name}`));
  }
});

test("une page ou un article sans photo ni liste reste valide", () => {
  page.parse({ title: "Page nue" });
  page.parse({
    title: "Qui",
    team: [],
    intro: null,
  });
  page.parse({
    title: "Qui",
    team: [{ photo: "", photo_alt: null }, { name: "Sans portrait" }],
  });
  page.parse({ title: "Activités", activities: [] });
  page.parse({
    title: "Activités",
    activities: [{ title: "Peindre", image: "", image_alt: null }, { text: "Sans titre" }],
  });
  page.parse({ title: "Soutenir", support_cards: [] });
  page.parse({
    title: "Soutenir",
    support_cards: [{ icon: null, icon_alt: "", title: "" }],
    helloasso_url: null,
  });
  page.parse({
    title: "Accueil",
    hero_image: "",
    hero_image_alt: null,
    welcome_image: null,
    abri_image: "",
    hero: {},
    welcome: null,
    activities: { cards: [] },
    team: {},
    blog_teaser: { cards: [{ image: "", date: "", alt: null }, { date: "2026-04-24", image: "/uploads/blog/x.jpg" }] },
    support: { cards: [{ button_style: "", helloasso: null }] },
    visit: { lines: [] },
    map: null,
  });
  page.parse({ title: "Contact", form: {}, practical: { lines: null }, faq: { items: [] }, cta: {} });

  const article = blog.parse({ title: "Sans photo", cover: "", excerpt: null, category: null, draft: null });
  assert.equal(article.draft, false);
  assert.equal(article.date, undefined);
  blog.parse({ title: "Avec date", date: "2026-04-24" });
});

test("le titre reste obligatoire et une date illisible est refusée", () => {
  assert.throws(() => page.parse({}));
  assert.throws(() => page.parse({ title: "" }));
  assert.throws(() => page.parse({ title: "X", blog_teaser: { cards: [{ date: "demain" }] } }));
  assert.throws(() => page.parse({ title: "X", blog_teaser: { cards: [{ date: "2026-13-40" }] } }));
  assert.throws(() => blog.parse({}));
  assert.throws(() => blog.parse({ title: "" }));
  assert.throws(() => blog.parse({ title: "X", date: "pas-une-date" }));
  assert.equal(page.parse({ title: "X", blog_teaser: { cards: [{ date: "2026-04-24" }] } }).blog_teaser.cards[0].date, "2026-04-24");
});

test("dans l’éditeur, les images sont facultatives et les titres de page restent obligatoires", () => {
  const config = readFileSync("public/admin/config.yml", "utf8");
  const lines = config.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!/widget:\s*image\b/.test(lines[i])) continue;
    const around = lines.slice(i, i + 4).join("\n");
    assert.match(around, /required:\s*false/, lines[i]);
  }

  const requiredTitles = lines.filter((line) => {
    const spaces = line.length - line.trimStart().length;
    return (
      (spaces === 6 || spaces === 10) &&
      /name: title, widget: string \}$/.test(line) &&
      !line.includes("required:")
    );
  });
  assert.equal(requiredTitles.length, 6);
});
