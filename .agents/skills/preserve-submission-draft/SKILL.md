---
name: preserve-submission-draft
description: Preserve incomplete assessment submission forms without prematurely filling them. Use whenever reading, editing, reviewing, or proposing content for a SUBMISSION.md file, especially while the user says the assessment is still in progress, asks to record only completed decisions, or provides a required template.
---

# Preserve Submission Draft

Treat `SUBMISSION.md` as user-owned work in progress, not as a report to complete automatically.

## Rules

1. Preserve the existing headings, ordering, labels, bullets, spacing, and template language unless the user explicitly requests a format change.
2. Edit only sections or fields the user explicitly identifies as decided, completed, or ready to record.
3. Leave unfinished sections blank. Do not infer completion from code changes, test results, conversation context, elapsed time, or likely answers.
4. Do not replace placeholders such as `CLI-first / MCP-first / hybrid`, start/finish times, or empty prompts unless the user explicitly selects or supplies the value.
5. Keep inserted text concise and in the user's voice. Do not turn short notes into polished essays, add literature, or summarize unrelated implementation work unless explicitly requested for that section.
6. Before editing, read the current file and map each requested fact to an existing field. If a fact does not clearly belong to a completed field, leave the file unchanged and mention it outside the file.
7. After editing, inspect the diff for `SUBMISSION.md`. Remove any change not directly authorized by the user's latest request.

When the user says they are not done, treat that as a hard prohibition on completing any unmentioned section.
