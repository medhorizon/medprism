import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { docstrip } from "./docstrip.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const official = path.join(root, "templates/official");

function write(rel, content) {
  const dest = path.join(official, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content);
  console.log("wrote", rel, content.length);
}

function copy(fromRel, toRel) {
  const from = path.join(official, fromRel);
  const to = path.join(official, toRel);
  fs.copyFileSync(from, to);
  console.log("copied", fromRel, "->", toRel);
}

function assertClass(label, content) {
  if (!/\\(?:NeedsTeXFormat|ProvidesClass)\b/.test(content)) {
    throw new Error(`${label}: missing NeedsTeXFormat/ProvidesClass after docstrip`);
  }
  if (/^\s*\\documentclass\{ltxdoc\}/m.test(content)) {
    throw new Error(`${label}: active \\documentclass{ltxdoc} leaked into class file`);
  }
}

/** ACM samples.dtx uses %<< verbatim with single-% TC lines; restore TeX comments. */
function fixAcmSample(tex) {
  let out = tex
    .split(/\n/)
    .map((line) => {
      if (/^TC:/.test(line)) return "%" + line;
      return line;
    })
    .join("\n");
  // Drop tagging metadata (needs lualatex-dev / very new LaTeX).
  out = out.replace(
    /\\ifx\\HCode\\Undef\s*\\DocumentMetadata\{[\s\S]*?\\else\s*\\DocumentMetadata\{\}\s*\\fi\s*/m,
    "",
  );
  // Missing sample images were stripped from the vendored package.
  out = out.replace(
    /^([ \t]*)\\includegraphics(\[[^\]]*\])?\{sample[^}]*\}/gm,
    "% [MedPrism] sample image omitted",
  );
  return out;
}

// Elsevier: generate elsarticle.cls from .dtx
{
  const dtx = fs.readFileSync(path.join(official, "elsevier-elsarticle/elsarticle.dtx"), "utf8");
  const cls = docstrip(dtx, ["class"]);
  assertClass("elsarticle.cls", cls);
  write("elsevier-elsarticle/elsarticle.cls", cls);
}

// ACM: class + flat authoring samples at package root
{
  const pkg = path.join(official, "acm-acmart");
  const samplesDir = path.join(pkg, "samples");
  const cls = docstrip(fs.readFileSync(path.join(pkg, "acmart.dtx"), "utf8"), ["class"]);
  assertClass("acmart.cls", cls);
  write("acm-acmart/acmart.cls", cls);

  const sampleDtx = fs.readFileSync(path.join(samplesDir, "samples.dtx"), "utf8");
  let sample = docstrip(sampleDtx, ["all", "proceedings", "sigconf"]);
  sample = fixAcmSample(sample);
  if (/^TC:/m.test(sample)) {
    throw new Error("sample-sigconf.tex: bare TC: lines remain");
  }
  if (sample.includes("DocumentMetadata")) {
    throw new Error("sample-sigconf.tex: DocumentMetadata still present");
  }
  write("acm-acmart/sample-sigconf.tex", sample);

  copy("acm-acmart/samples/sample-base.bib", "acm-acmart/sample-base.bib");
  copy("acm-acmart/samples/software.bib", "acm-acmart/software.bib");
  copy("acm-acmart/samples/abbrev.bib", "acm-acmart/abbrev.bib");
}

console.log("prepare-official-templates done");
