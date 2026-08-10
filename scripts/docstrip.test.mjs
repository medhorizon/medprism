import assert from "node:assert/strict";
import { docstrip, evalGuard } from "./docstrip.mjs";

assert.equal(evalGuard("class", new Set(["class"])), true);
assert.equal(evalGuard("driver", new Set(["class"])), false);
assert.equal(evalGuard("!tagged", new Set(["all"])), true);
assert.equal(evalGuard("sigconf&!(biblatex|authordraft)", new Set(["all", "sigconf"])), true);

const dtx = `%<*driver>
\\documentclass{ltxdoc}
%</driver>
%<*class>
\\NeedsTeXFormat{LaTeX2e}
\\ProvidesClass{demo}
%</class>
%<class>\\extra{ok}
`;
const cls = docstrip(dtx, ["class"]);
assert.match(cls, /NeedsTeXFormat/);
assert.doesNotMatch(cls, /ltxdoc/);
assert.match(cls, /\\extra\{ok\}/);

const verb = docstrip(`%<*all>
%<<NAME
%TC:macro
%NAME
%</all>
`, ["all"]);
assert.match(verb, /^TC:macro$/m);

console.log("docstrip.test.mjs OK");
