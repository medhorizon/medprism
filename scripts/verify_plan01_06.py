#!/usr/bin/env python3
"""Repository-level verification for the Plan01-06 implementation."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


def run(command: list[str], cwd: Path, timeout: int = 600) -> None:
    print("+", " ".join(command), flush=True)
    subprocess.run(command, cwd=cwd, check=True, timeout=timeout)


def npm_command() -> str:
    return "npm.cmd" if os.name == "nt" else "npm"


def check_packaging(repo: Path) -> None:
    package = json.loads((repo / "package.json").read_text(encoding="utf-8"))
    build = package.get("build", {})
    files = build.get("files", [])
    if "shared/**/*" not in files:
        raise SystemExit("package.json build.files must include shared/**/*")
    resources = build.get("extraResources", [])
    if not any(isinstance(item, dict) and item.get("to") == "tectonic" for item in resources):
        raise SystemExit("package.json build.extraResources must include resources/tectonic")


def check_node_syntax(repo: Path) -> None:
    candidates: list[Path] = []
    for folder in ("electron", "server", "shared"):
        base = repo / folder
        if not base.exists():
            continue
        candidates.extend(path for path in base.rglob("*") if path.suffix in {".mjs", ".cjs"})
    for path in sorted(candidates):
        run(["node", "--check", str(path.relative_to(repo))], repo, timeout=60)


def tectonic_smoke(repo: Path, required: bool) -> None:
    executable = os.environ.get("MEDPRISM_TECTONIC_PATH") or shutil.which("tectonic")
    if not executable:
        message = (
            "Tectonic was not found. Fake-engine compile tests still run in Vitest, "
            "but a real packaged compile smoke test remains required before release."
        )
        if required:
            raise SystemExit(message)
        print("WARNING:", message)
        return

    with tempfile.TemporaryDirectory(prefix="medprism-tectonic-smoke-") as directory:
        root = Path(directory)
        (root / "main.tex").write_text(
            "\\documentclass{article}\n\\begin{document}\nMedPrism smoke test.\n\\end{document}\n",
            encoding="utf-8",
        )
        run(
            [
                executable,
                "-X",
                "compile",
                "--untrusted",
                "--outfmt",
                "pdf",
                "main.tex",
            ],
            root,
            timeout=180,
        )
        if not (root / "main.pdf").is_file():
            raise SystemExit("Tectonic returned successfully but main.pdf was not produced")
    print("Real Tectonic smoke test passed.")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--install", action="store_true", help="Run npm ci before verification")
    parser.add_argument("--require-tectonic", action="store_true")
    parser.add_argument("--skip-lint", action="store_true")
    parser.add_argument("--skip-npm", action="store_true", help="Skip npm test/typecheck/build")
    args = parser.parse_args()

    repo = args.repo.resolve()
    if not (repo / "package.json").is_file():
        raise SystemExit(f"Not a MedPrism repository: {repo}")
    npm = npm_command()
    if args.install and args.skip_npm:
        raise SystemExit("--install cannot be combined with --skip-npm")
    if not args.skip_npm:
        if args.install:
            run([npm, "ci"], repo, timeout=900)
        run([npm, "test"], repo)
        run([npm, "run", "typecheck"], repo)
        run([npm, "run", "build"], repo)
        if not args.skip_lint:
            run([npm, "run", "lint"], repo)
    check_packaging(repo)
    check_node_syntax(repo)
    run(["git", "diff", "--check"], repo, timeout=60)
    tectonic_smoke(repo, args.require_tectonic)
    print("Plan01-06 repository verification passed.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as error:
        print(f"Verification failed with exit code {error.returncode}", file=sys.stderr)
        raise
