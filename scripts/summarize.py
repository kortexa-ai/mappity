import json, sys
names, allscores = {}, []
for line in sys.stdin:
    e = json.loads(line); s = e.pop("step")
    if s == "places":
        names = {p["id"]: p for p in e["places"]}; e["places"] = "<%d>" % len(e["places"])
    if s == "street":
        e["points"] = "<%d>" % len(e.get("points", [])); ctx = e.pop("contexts", {}); e["ctx_sample"] = list(ctx.values())[:1]
    if s == "kinds":
        fmt = lambda ks: " ".join("%s:%.2f" % (k["kind"], k["p"]) for k in ks)
        e["kinds"] = fmt(e["kinds"][:9]) + " ... " + fmt(e["kinds"][-4:])
    if s == "judge":
        allscores += e["scores"]; e["scores"] = "<%d>" % len(e["scores"])
    if s == "explain":
        e["reasons"] = [(names[r["id"]]["name"], r["fact"], round(r["confidence"], 2)) for r in e["reasons"]]
    for k, v in list(e.items()):
        if isinstance(v, float): e[k] = round(v, 5 if k == "usd" else 2)
    print("%-9s %s" % (s, json.dumps(e)[:420]))
print("TOP:")
for pid, p in sorted(allscores, key=lambda x: -x[1])[:8]:
    n = names[pid]; print("   %.2f  %s (%s, %.0f m)" % (p, n["name"], n["kind"], n["metres"]))
