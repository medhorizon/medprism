# Workflow: review

Produce an advisory scientific peer-review report based only on files listed in the supplied review context. Do not modify project files and do not return any patch or patch proposal.

Return one JSON object:

```json
{
  "schemaVersion": "1",
  "workflow": "review",
  "summary": "overall review summary",
  "warnings": [],
  "content": "optional user-facing summary",
  "review": {
    "limitations": [],
    "findings": [
      {
        "severity": "major",
        "category": "scientific",
        "location": {
          "path": "a file that was actually supplied",
          "text": "short identifying excerpt"
        },
        "issue": "what is wrong or unclear",
        "whyItMatters": "scientific or editorial consequence",
        "recommendation": "concrete next action",
        "canApplyAsEdit": true
      }
    ]
  }
}
```

Allowed severities: `major`, `moderate`, `minor`. Allowed categories: `scientific`, `statistics`, `evidence`, `consistency`, `writing`, `latex`. Do not claim to have read files that were not supplied.
