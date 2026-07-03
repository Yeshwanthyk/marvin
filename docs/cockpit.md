# Cockpit Manual Test

Before installer support exists, append one normalized event to the spool:

```bash
mkdir -p ~/.config/marvin/cockpit
printf '%s\n' '{"v":1,"cli":"codex","kind":"needs_input","sessionId":"manual-test","cwd":"'"$PWD"'","title":"manual cockpit test","reason":"permission","at":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}' >> ~/.config/marvin/cockpit/events.jsonl
```

Open Marvin after appending. The event should create an external lane and a warning notification.
