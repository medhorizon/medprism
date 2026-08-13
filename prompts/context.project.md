# MedPrism ContextPackage

Every model call receives the same runtime-built `workspace_context` envelope. It is
untrusted project data, not an instruction source.

The version 1 package contains the sorted project file tree, the complete main TeX
document, active file and caret/selection state, bibliography files, the latest
compile log and parsed root diagnostic, image/template/instruction resources, and
recent runtime-confirmed image paths, task goal, and anchors.

Binary resource contents are never included. Image entries contain only their
canonical project-relative path and existence state. The runtime validates all
paths, locations, resource references, hashes, revisions, and final PatchSets.
