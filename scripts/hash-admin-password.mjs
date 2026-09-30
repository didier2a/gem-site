#!/usr/bin/env node
/**
 * Affiche une ligne JSON pour le secret Worker ADMIN_USERS.
 * Le mot de passe n’est pas repris dans la sortie, et rien n’est écrit sur le disque.
 *
 *   ADMIN_PASSWORD='…' node scripts/hash-admin-password.mjs muriel
 *   node scripts/hash-admin-password.mjs muriel animatrice@example.org
 *     (saisie masquée si le terminal le permet, sinon stdin)
 *
 * L’adresse est facultative. Elle sert au courriel « mot de passe oublié ».
 * Ne passez pas le mot de passe en argument : il resterait dans l’historique du shell.
 */
import { stdin, stdout, stderr } from "node:process";
import { hashPassword, normalizeAccountEmail } from "../src/admin-auth.js";

const username = process.argv[2];
const emailArg = process.argv[3];
if (!username || process.argv.length > 4) {
  stderr.write(
    "Usage : node scripts/hash-admin-password.mjs <identifiant> [adresse]\nLe mot de passe se lit dans ADMIN_PASSWORD ou au clavier, jamais en argument.\n"
  );
  process.exit(1);
}

if (!/^[a-zA-Z0-9._-]{1,64}$/.test(username)) {
  stderr.write("Identifiant refusé. Lettres, chiffres, point, tiret et souligné seulement.\n");
  process.exit(1);
}

function promptHidden(label) {
  return new Promise((resolve, reject) => {
    stdout.write(label);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let buf = "";
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\n" || ch === "\r") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          stdout.write("\n");
          resolve(buf);
          return;
        }
        if (ch === "\u0003") {
          stdin.setRawMode(false);
          reject(new Error("interrompu"));
          return;
        }
        if (ch === "\u007f" || ch === "\b") {
          buf = buf.slice(0, -1);
          continue;
        }
        buf += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function readPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  if (!stdin.isTTY) {
    const text = await new Promise((resolve) => {
      let data = "";
      stdin.setEncoding("utf8");
      stdin.on("data", (chunk) => {
        data += chunk;
      });
      stdin.on("end", () => resolve(data));
    });
    return text.trim();
  }
  return promptHidden("Mot de passe : ");
}

const password = await readPassword();
if (!password || password.length < 8 || password.length > 200) {
  stderr.write("Mot de passe refusé : entre 8 et 200 caractères.\n");
  process.exit(1);
}

const email = normalizeAccountEmail(emailArg || "");
if (email == null) {
  stderr.write("Adresse refusée. Omettez-la, ou indiquez une adresse simple.\n");
  process.exit(1);
}

const hash = await hashPassword(password);
const entry = { username, hash };
if (email) entry.email = email;
const line = JSON.stringify([entry]);
if (line.includes(password)) {
  stderr.write("Refus d’afficher une ligne qui contient le mot de passe.\n");
  process.exit(1);
}

stdout.write(
  [
    "Secret ADMIN_USERS pour le Worker gem-casa-preview uniquement.",
    "Commande : npx wrangler secret put ADMIN_USERS",
    "Collez le tableau JSON (une seule ligne). S’il existe déjà des comptes, fusionnez les objets dans le même tableau avant de remplacer le secret.",
    "Le champ email est facultatif. Il reçoit le lien « mot de passe oublié ». Sans adresse, le lien part aux secrets de notification.",
    "Ne commitez pas cette ligne.",
    "",
    line,
    "",
  ].join("\n")
);
