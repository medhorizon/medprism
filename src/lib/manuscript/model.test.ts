import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildContextSnapshot } from "../context/snapshot";
import { loadBundledOfficialTemplate } from "../../templates";
import { buildManuscriptModel, occurrencesForSlot } from "./model";
import type { TemplateProfileId } from "./types";

const cases: Array<[string, TemplateProfileId]> = [
  ["templates/official/springer-nature-sn-jnl/sn-article.tex", "springer-sn"],
  ["templates/official/elsevier-elsarticle/elsarticle-template-num.tex", "elsevier"],
  ["templates/official/elsevier-elsarticle/elsarticle-template-num-names.tex", "elsevier"],
  ["templates/official/elsevier-elsarticle/elsarticle-template-harv.tex", "elsevier"],
  ["templates/official/acm-acmart/sample-sigconf.tex", "acm"],
  ["templates/official/ieee-journal/bare_adv.tex", "ieee"],
  ["templates/official/ieee-journal/bare_conf.tex", "ieee"],
  ["templates/official/ieee-journal/bare_conf_compsoc.tex", "ieee"],
  ["templates/official/ieee-journal/bare_jrnl.tex", "ieee"],
  ["templates/official/ieee-journal/bare_jrnl_compsoc.tex", "ieee"],
  ["templates/official/ieee-journal/bare_jrnl_comsoc.tex", "ieee"],
  ["templates/official/ieee-journal/bare_jrnl_transmag.tex", "ieee"],
];

describe("ManuscriptModel official template corpus", () => {
  it.each(cases)("indexes %s with profile %s", async (path, profile) => {
    const source = readFileSync(resolve(path), "utf8");
    const snapshot = await buildContextSnapshot({
      projectId: path,
      files: { [path]: source },
      mainFile: path,
      activeFile: path,
    });
    const model = buildManuscriptModel(snapshot);
    expect(model.profile).toBe(profile);
    expect(occurrencesForSlot(model, { slot: "title" }).length).toBeGreaterThan(0);
    expect(occurrencesForSlot(model, { slot: "abstract" }).length).toBeGreaterThan(0);
    expect(model.structuralNodes.some((node) => node.kind === "end-document")).toBe(true);
  });

  it("treats Springer declaration items as canonical semantic slots", async () => {
    const path = "templates/official/springer-nature-sn-jnl/sn-article.tex";
    const source = readFileSync(resolve(path), "utf8");
    const snapshot = await buildContextSnapshot({
      projectId: "springer",
      files: { [path]: source },
      mainFile: path,
      activeFile: path,
    });
    const model = buildManuscriptModel(snapshot);
    const data = occurrencesForSlot(model, { slot: "data-availability" });
    expect(data).toHaveLength(1);
    expect(data[0]?.syntax).toBe("declaration-item");
    expect(data[0]?.canonical).toBe(true);
  });

  it("does not confuse ACM template documentation sections with front matter", async () => {
    const path = "templates/official/acm-acmart/sample-sigconf.tex";
    const source = readFileSync(resolve(path), "utf8");
    const snapshot = await buildContextSnapshot({
      projectId: "acm",
      files: { [path]: source },
      mainFile: path,
      activeFile: path,
    });
    const model = buildManuscriptModel(snapshot);
    expect(occurrencesForSlot(model, { slot: "title" })).toHaveLength(1);
    expect(occurrencesForSlot(model, { slot: "custom-section", title: "Title Information" })).toHaveLength(1);
  });

  it("indexes only the active manuscript graph from a bundled template package", async () => {
    const extracted = await loadBundledOfficialTemplate("springer-nature-sn-jnl");
    const snapshot = await buildContextSnapshot({
      projectId: "springer-bundled",
      files: extracted.files,
      mainFile: extracted.mainFile,
      activeFile: extracted.mainFile,
    });
    const model = buildManuscriptModel(snapshot);
    expect(model.activePaths).toEqual([extracted.mainFile]);
    expect(occurrencesForSlot(model, { slot: "title" })).toHaveLength(1);
    expect(model.diagnostics.filter((diagnostic) => diagnostic.code === "DUPLICATE_SLOT")).toEqual([]);
  });

  it("follows tex inputs that are part of the active manuscript graph", async () => {
    const snapshot = await buildContextSnapshot({
      projectId: "multi-file",
      files: {
        "main.tex": "\\documentclass{article}\n\\begin{document}\n\\input{front/title}\n\\section{Discussion}\nMain.\n\\end{document}",
        "front/title.tex": "\\title{Included Title}",
        "unused.tex": "\\title{Unused Package Example}",
      },
      mainFile: "main.tex",
      activeFile: "main.tex",
    });
    const model = buildManuscriptModel(snapshot);
    expect(model.activePaths).toEqual(["main.tex", "front/title.tex"]);
    expect(occurrencesForSlot(model, { slot: "title" })).toHaveLength(1);
    expect(occurrencesForSlot(model, { slot: "title" })[0]?.path).toBe("front/title.tex");
  });
});
