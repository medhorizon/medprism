"""Compile each official template main file under Tectonic and report status."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TECTONIC = ROOT / "resources" / "tectonic" / "win32-x64" / "tectonic.exe"
TEMPLATES = ROOT / "templates" / "official"

# Catalog mainCandidates (+ springer already fixed starter)
MAINS = {
    "springer-nature-sn-jnl": ["sn-article.tex"],
    "elsevier-elsarticle": [
        "elsarticle-template-num.tex",
        "elsarticle-template-harv.tex",
        "elsarticle-template-num-names.tex",
    ],
    "ieee-journal": [
        "bare_jrnl.tex",
        "bare_jrnl_compsoc.tex",
        "bare_conf.tex",
        "bare_jrnl_comsoc.tex",
        "bare_jrnl_transmag.tex",
        "bare_conf_compsoc.tex",
        "bare_adv.tex",
    ],
    "acm-acmart": ["sample-sigconf.tex"],
}


def compile_one(template_id: str, main: str, work_root: Path) -> dict:
    src = TEMPLATES / template_id
    work = work_root / f"{template_id}__{main.replace('/', '_')}"
    if work.exists():
        shutil.rmtree(work)
    shutil.copytree(src, work)
    main_path = work / main
    if not main_path.exists():
        return {
            "template": template_id,
            "main": main,
            "ok": False,
            "error": "main file missing",
            "tail": "",
        }
    log_path = work / "_tectonic.log"
    cmd = [
        str(TECTONIC),
        "-X",
        "compile",
        "--outdir",
        str(work),
        str(main_path),
    ]
    env = os.environ.copy()
    # Keep first-compile package downloads from hanging forever.
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(work),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=240,
            env=env,
        )
    except subprocess.TimeoutExpired as e:
        return {
            "template": template_id,
            "main": main,
            "ok": False,
            "error": "timeout",
            "tail": (e.stderr or e.stdout or "")[-2000:],
        }
    out = (proc.stdout or "") + "\n" + (proc.stderr or "")
    log_path.write_text(out, encoding="utf-8")
    pdf_name = main_path.with_suffix(".pdf").name
    pdf = work / pdf_name
    # Also accept any pdf if name differs
    pdfs = list(work.glob("*.pdf"))
    ok = proc.returncode == 0 and (pdf.exists() or bool(pdfs))
    # Extract useful error lines
    err_lines = [
        ln
        for ln in out.splitlines()
        if ln.startswith("!")
        or "error:" in ln.lower()
        or "Undefined control sequence" in ln
        or "Emergency stop" in ln
        or "Fatal" in ln
        or ln.startswith("l.")
    ]
    return {
        "template": template_id,
        "main": main,
        "ok": ok,
        "exit": proc.returncode,
        "pdf": str(pdf if pdf.exists() else (pdfs[0] if pdfs else "")),
        "pdf_bytes": (pdf.stat().st_size if pdf.exists() else (pdfs[0].stat().st_size if pdfs else 0)),
        "error": "" if ok else (err_lines[-8:] and " | ".join(err_lines[-8:]) or out[-800:]),
        "tail": "\n".join(out.splitlines()[-15:]),
    }


def main() -> None:
    if not TECTONIC.exists():
        raise SystemExit(f"missing tectonic: {TECTONIC}")
    work_root = Path(tempfile.mkdtemp(prefix="medprism-tpl-check-"))
    results = []
    print(f"work_root={work_root}")
    for tid, mains in MAINS.items():
        for main in mains:
            print(f"compiling {tid} / {main} ...", flush=True)
            r = compile_one(tid, main, work_root)
            results.append(r)
            status = "OK" if r["ok"] else "FAIL"
            print(f"  {status} exit={r.get('exit')} pdf_bytes={r.get('pdf_bytes', 0)}")
            if not r["ok"]:
                print("  error:", r.get("error", "")[:500])
    out_json = ROOT / "scripts" / "_template-compile-report.json"
    out_json.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
    print("\n=== SUMMARY ===")
    for r in results:
        mark = "PASS" if r["ok"] else "FAIL"
        print(f"{mark}\t{r['template']}\t{r['main']}")
    print(f"\nreport: {out_json}")
    print(f"artifacts: {work_root}")


if __name__ == "__main__":
    main()
