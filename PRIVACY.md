# Privacy

AGYScope runs locally on your Mac and binds to loopback (`127.0.0.1`) only. It has no analytics, and AGYScope itself sends nothing over the internet.

**What it reads**

- Local Antigravity transcript logs under `~/.gemini/antigravity/brain/*/.system_generated/logs/transcript.jsonl` and `~/.gemini/antigravity-cli/brain/*/.system_generated/logs/transcript.jsonl`. Only numeric token counters, model names, timestamps, and machine tool names are kept; prompts, replies, thinking blocks, file contents, and tool arguments are never stored.
- If the official `agy` CLI statusLine hook is installed, the allowlisted `quota` fields (`remaining_fraction`, `reset_time`, `plan_tier`) piped by `agy`.
- If the official `agy` CLI is installed and CLI reads are enabled, structured zero-token usage output from `agy`.

**It never reads, stores, or renews Google/Antigravity credentials and never contacts Google endpoints directly.**

**What it stores**, under `~/Library/Application Support/AGYScope/data`:

- Usage percentages, reset times, and observation timestamps.
- Numeric token counters, model names, tool call counts, and HMAC-hashed conversation/account identifiers.
