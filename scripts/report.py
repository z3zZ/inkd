"""Prints a self-test report written by the app."""
import json
import sys

d = json.load(open(sys.argv[1], encoding="utf8"))
print({k: v for k, v in d.items() if k != "proxy"})
p = d.get("proxy")
if p:
    print(p["summary"])
    for r in p["rows"]:
        mark = "OK " if r["correct"] else "BAD"
        print(f'{r["id"]:<12} {mark} {r["ms"]:>6}ms {r["confidence"]:.2f} | {r["expected"]} | {r["latex"]}')
