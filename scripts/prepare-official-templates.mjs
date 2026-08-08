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

// Elsevier: generate elsarticle.cls from .dtx
{
  const dtx = fs.readFileSync(path.join(official, "elsevier-elsarticle/elsarticle.dtx"), "utf8");
  for (const opts of [["class"], ["package"], ["elsarticle"]]) {
    const cls = docstrip(dtx, opts);
    if (cls.includes("ProvidesClass{elsarticle}") || cls.includes("ProvidesPackage{elsarticle}")) {
      write("elsevier-elsarticle/elsarticle.cls", cls);
      break;
    }
  }
  if (!fs.existsSync(path.join(official, "elsevier-elsarticle/elsarticle.cls"))) {
    write("elsevier-elsarticle/elsarticle.cls", docstrip(dtx, ["class"]));
  }
}

// ACM: class + flat authoring samples at package root (no duplicate under samples/)
{
  const pkg = path.join(official, "acm-acmart");
  const samplesDir = path.join(pkg, "samples");
  write(
    "acm-acmart/acmart.cls",
    docstrip(fs.readFileSync(path.join(pkg, "acmart.dtx"), "utf8"), ["class"]),
  );
  const sampleDtx = fs.readFileSync(path.join(samplesDir, "samples.dtx"), "utf8");
  write(
    "acm-acmart/sample-sigconf.tex",
    docstrip(sampleDtx, ["all", "proceedings", "sigconf"]),
  );
  copy("acm-acmart/samples/sample-base.bib", "acm-acmart/sample-base.bib");
  copy("acm-acmart/samples/software.bib", "acm-acmart/software.bib");
  copy("acm-acmart/samples/abbrev.bib", "acm-acmart/abbrev.bib");
}

console.log("prepare-official-templates done");
