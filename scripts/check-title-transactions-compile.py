"""Smoke-test canonical title replacement in one template per profile."""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TEMPLATES = {
    "springer": ("springer-nature-sn-jnl", "sn-article.tex"),
    "elsevier": ("elsevier-elsarticle", "elsarticle-template-num.tex"),
    "acm": ("acm-acmart", "sample-sigconf.tex"),
    "ieee": ("ieee-journal", "bare_conf.tex"),
}
TITLE = "Runtime-Owned Semantic Transaction Title"


def tectonic_executable() -> Path:
    configured = os.environ.get("MEDPRISM_TECTONIC_PATH")
    candidates = [
        Path(configured) if configured else None,
        ROOT / "resources" / "tectonic" / "win32-x64" / "tectonic.exe",
        Path(found) if (found := shutil.which("tectonic")) else None,
    ]
    for candidate in candidates:
        if candidate and candidate.is_file():
            return candidate
    raise SystemExit("Tectonic was not found; set MEDPRISM_TECTONIC_PATH.")


def mask_comments(source: str) -> str:
    output: list[str] = []
    commented = False
    slash_count = 0
    for character in source:
        if character in "\r\n":
            output.append(character)
            commented = False
            slash_count = 0
        elif commented:
            output.append(" ")
        elif character == "%" and slash_count % 2 == 0:
            output.append(" ")
            commented = True
            slash_count = 0
        else:
            output.append(character)
            slash_count = slash_count + 1 if character == "\\" else 0
    return "".join(output)


def matching_delimiter(masked: str, opening: int, left: str, right: str) -> int:
    depth = 0
    for index in range(opening, len(masked)):
        if masked[index] == left:
            depth += 1
        elif masked[index] == right:
            depth -= 1
            if depth == 0:
                return index
    raise ValueError(f"unbalanced {left}{right} argument")


def replace_canonical_title(source: str) -> str:
    masked = mask_comments(source)
    match = re.search(r"\\title(?![A-Za-z@])", masked)
    if not match:
        raise ValueError("active title command not found")
    cursor = match.end()
    while cursor < len(masked) and masked[cursor].isspace():
        cursor += 1
    optional: tuple[int, int] | None = None
    if cursor < len(masked) and masked[cursor] == "[":
        optional = (cursor, matching_delimiter(masked, cursor, "[", "]"))
        cursor = optional[1] + 1
        while cursor < len(masked) and masked[cursor].isspace():
            cursor += 1
    if cursor >= len(masked) or masked[cursor] != "{":
        raise ValueError("title body was not a balanced group")
    closing = matching_delimiter(masked, cursor, "{", "}")
    if optional:
        short = TITLE if len(TITLE) <= 60 else f"{TITLE[:57].rsplit(' ', 1)[0]}..."
        return (
            f"{source[:optional[0] + 1]}{short}"
            f"{source[optional[1]:cursor + 1]}{TITLE}{source[closing:]}"
        )
    return f"{source[:cursor + 1]}{TITLE}{source[closing:]}"


def compile_profile(engine: Path, profile: str, template_id: str, main: str, root: Path) -> None:
    source_dir = ROOT / "templates" / "official" / template_id
    work = root / profile
    shutil.copytree(source_dir, work)
    main_path = work / main
    original = main_path.read_text(encoding="utf-8")
    updated = replace_canonical_title(original)
    if updated == original or TITLE not in updated:
        raise RuntimeError(f"{profile}: canonical title was not replaced")
    main_path.write_text(updated, encoding="utf-8")
    process = subprocess.run(
        [str(engine), "-X", "compile", "--outdir", str(work), str(main_path)],
        cwd=work,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=240,
    )
    pdf = main_path.with_suffix(".pdf")
    if process.returncode != 0 or not pdf.is_file():
        tail = "\n".join((process.stdout + process.stderr).splitlines()[-30:])
        raise RuntimeError(f"{profile}: Tectonic failed\n{tail}")
    print(f"PASS\t{profile}\t{main}\t{pdf.stat().st_size} bytes")


def main() -> None:
    engine = tectonic_executable()
    with tempfile.TemporaryDirectory(prefix="medprism-title-smoke-") as directory:
        root = Path(directory)
        for profile, (template_id, main_file) in TEMPLATES.items():
            compile_profile(engine, profile, template_id, main_file, root)


if __name__ == "__main__":
    main()
