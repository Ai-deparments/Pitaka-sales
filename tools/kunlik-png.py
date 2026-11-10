#!/usr/bin/env python3
# Kunlik hisobot rasmi (TZ «Sales OS» 1.4): eni 1000 px, 2x sifat (haqiqiy 2000 px), Telegram uchun.
# Kirish — stdin JSON (lib/kunlik.mjs pngData), chiqish — stdout PNG. Serverda brauzer yo'q,
# shuning uchun Pillow bilan chiziladi; shrift — DejaVu (kirill va lotin harflari to'liq).
import json
import sys
from PIL import Image, ImageDraw, ImageFont

S = 2                      # sifat (2x)
W = 1000                   # mantiqiy eni
PAD = 32
FD = "/usr/share/fonts/truetype/dejavu/"

C = {
    "brand": "#042E5C", "gold": "#F6C66A", "bg": "#FFFFFF", "soft": "#F4F6FA", "ink": "#0A1B32",
    "ink2": "#4A5568", "ink3": "#8A94A6", "rule": "#E3E8EF", "green": "#1F9D55", "red": "#D64545",
    "ybg": "#FFF1C2", "yink": "#8A6100", "rbg": "#FDE2E2", "rink": "#B42318", "alt": "#F8FAFC",
    "bar1": "#A9C1DD", "bar2": "#042E5C", "sub": "#C9D6E8",
}
MEDAL = {1: "#E2B13C", 2: "#A7B1BC", 3: "#C28A5A"}


def font(name, size):
    return ImageFont.truetype(FD + name, int(size * S))


F = {
    "t": font("DejaVuSans-Bold.ttf", 23), "st": font("DejaVuSans.ttf", 13),
    "brand": font("DejaVuSans-Bold.ttf", 17), "brand2": font("DejaVuSans.ttf", 11),
    "kl": font("DejaVuSans.ttf", 12), "kv": font("DejaVuSans-Bold.ttf", 29), "kd": font("DejaVuSans.ttf", 11.5),
    "h2": font("DejaVuSans-Bold.ttf", 14), "note": font("DejaVuSans.ttf", 11.5), "noteb": font("DejaVuSans-Bold.ttf", 11.5),
    "th": font("DejaVuSansCondensed-Bold.ttf", 10.5), "td": font("DejaVuSansCondensed.ttf", 12), "tdb": font("DejaVuSansCondensed-Bold.ttf", 12.5),
    "tds": font("DejaVuSansCondensed.ttf", 9.5), "med": font("DejaVuSans-Bold.ttf", 11),
    "ax": font("DejaVuSansCondensed.ttf", 10), "axb": font("DejaVuSansCondensed-Bold.ttf", 10),
    "foot": font("DejaVuSans.ttf", 10.5),
}


def fmt(n):
    if n is None:
        return "—"
    return f"{int(n):,}".replace(",", " ")


def pct(x):
    return "—" if x is None else (f"{x:.1f}".rstrip("0").rstrip(".").replace(".", ",") + "%")


def hm(sec):
    sec = int(sec or 0)
    h, m = sec // 3600, (sec % 3600) // 60
    return f"{h}:{m:02d}"


def ms(sec):
    sec = int(sec or 0)
    return f"{sec // 60}:{sec % 60:02d}"


class Canvas:
    def __init__(self, h):
        self.img = Image.new("RGB", (W * S, int(h * S)), C["bg"])
        self.d = ImageDraw.Draw(self.img)

    def rect(self, x, y, w, h, fill, r=0, outline=None):
        box = [x * S, y * S, (x + w) * S - 1, (y + h) * S - 1]
        if r:
            self.d.rounded_rectangle(box, radius=r * S, fill=fill, outline=outline, width=S if outline else 0)
        else:
            self.d.rectangle(box, fill=fill, outline=outline)

    def line(self, x1, y1, x2, y2, fill, w=1):
        self.d.line([x1 * S, y1 * S, x2 * S, y2 * S], fill=fill, width=max(1, int(w * S)))

    def tw(self, text, f):
        return self.d.textlength(str(text), font=F[f]) / S

    def text(self, x, y, text, f, fill, anchor="la"):
        self.d.text((x * S, y * S), str(text), font=F[f], fill=fill, anchor=anchor)

    def fit(self, text, f, maxw):
        t = str(text)
        if self.tw(t, f) <= maxw:
            return t
        while t and self.tw(t + "…", f) > maxw:
            t = t[:-1]
        return t + "…"


def delta(k, yomon=False, pp=False):
    b, o = k.get("bugun"), k.get("oldin")
    if o is None or b is None:
        return None, C["ink3"]
    df = round(b - o, 1)
    if df == 0:
        return "= o'zgarmadi", C["ink3"]
    up = df > 0
    good = (not up) if yomon else up
    v = (f"{abs(df):.1f}".rstrip("0").rstrip(".").replace(".", ",") + " p.p.") if pp else fmt(abs(df))
    return ("▲ " if up else "▼ ") + v, (C["green"] if good else C["red"])


def main():
    R = json.load(sys.stdin)
    rows = R.get("rows") or []
    seriya = R.get("seriya") or []
    kpi = R["kpi"]

    TH, RH = 30, 36
    H = 96 + 22 + 104 + 44 + 30 + TH + RH * max(1, len(rows)) + RH + 30 + 26 + 150 + 26 + 40
    cv = Canvas(H)

    # ---- sarlavha ----
    cv.rect(0, 0, W, 96, C["brand"])
    cv.rect(0, 96 - 4, W, 4, C["gold"])
    cv.text(PAD, 24, "Call-markaz kunlik hisoboti", "t", "#FFFFFF")
    holat = f"{R['sanaNomi']} · Odoo holati {R['holat']}" if R.get("bugunmi") else f"{R['sanaNomi']} · yakuniy"
    cv.text(PAD, 58, holat, "st", C["sub"])
    cv.text(W - PAD, 28, "SUN-HIGHTECH", "brand", C["gold"], anchor="ra")
    cv.text(W - PAD, 54, "Sotuv Desk · Odoo CRM + VoIP", "brand2", C["sub"], anchor="ra")

    # ---- KPI kartalar ----
    y = 96 + 22
    oldin = "kecha" if R.get("kechami") else (R.get("oldinQisqa") or "")
    uz = kpi.get("uzatish") or kpi.get("konversiya") or {}
    bl = kpi.get("ball") or {}
    cards = [
        ("Yangi lidlar", fmt(kpi["tushgan"]["bugun"]), delta(kpi["tushgan"]), kpi["tushgan"].get("oldin"), "n"),
        ("Ishlangan", fmt(kpi["ishlangan"]["bugun"]), delta(kpi["ishlangan"]), kpi["ishlangan"].get("oldin"), "n"),
        ("Uzatildi", fmt(kpi["uzatildi"]["bugun"]), delta(kpi["uzatildi"]), kpi["uzatildi"].get("oldin"), "n"),
        ("Uzatish · 7 kun", pct(uz.get("bugun")), delta(uz, pp=True), uz.get("oldin"), "p"),
        ("AI ball", fmt(bl.get("bugun")), delta(bl), bl.get("oldin"), "n"),
        ("Yo'qotilgan", fmt(kpi["otkaz"]["bugun"]), delta(kpi["otkaz"], yomon=True), kpi["otkaz"].get("oldin"), "n"),
    ]
    gap = 10
    cw = (W - 2 * PAD - gap * (len(cards) - 1)) / len(cards)
    for i, (lab, val, (dt, dc), ov, tur) in enumerate(cards):
        x = PAD + i * (cw + gap)
        cv.rect(x, y, cw, 104, C["soft"], r=12)
        cv.rect(x, y + 14, 3, 22, C["gold"] if i == 3 else C["brand"])
        cv.text(x + 14, y + 16, lab, "kl", C["ink2"])
        cv.text(x + 14, y + 38, val, "kv", C["ink"])
        if dt:
            cv.text(x + 14, y + 80, dt, "kd", dc)
        if ov is not None:
            ovs = pct(ov) if tur == "p" else fmt(ov)
            lab2 = f"{oldin}: {ovs}"
            if cv.tw(lab2, "kd") + (cv.tw(dt, "kd") if dt else 0) + 12 > cw - 26:
                lab2 = ovs                       # tor kartada — faqat qiymat (matn ustma-ust tushmasin)
            cv.text(x + cw - 12, y + 80, lab2, "kd", C["ink3"], anchor="ra")
    y += 104 + 14

    # ---- manba va AI qatori ----
    mn = " · ".join(f"{m['n']} {fmt(m['c'])}" for m in (R.get("manba") or []))
    x = PAD
    cv.text(x, y, "Manba:", "noteb", C["ink2"])
    x += cv.tw("Manba: ", "noteb")
    cv.text(x, y, cv.fit(mn or "—", "note", 430), "note", C["ink2"])
    j = R.get("jami") or {}
    ai = [("sifatli", j.get("sifatli", 0), C["green"]), ("sifatsiz", j.get("sifatsiz", 0), C["red"]),
          ("noaniq", j.get("noaniq", 0), C["ink3"]), ("baholanmagan", j.get("baholanmagan", 0), C["rule"])]
    xr = W - PAD
    parts = []
    for nom, n, col in ai:
        parts.append((f"{nom} {fmt(n)}", col))
    tot = cv.tw("AI sifat bahosi: ", "noteb") + sum(cv.tw(p, "note") + 22 for p, _ in parts)
    x = xr - tot
    cv.text(x, y, "AI sifat bahosi: ", "noteb", C["ink2"])
    x += cv.tw("AI sifat bahosi: ", "noteb")
    for p, col in parts:
        cv.rect(x, y + 3, 9, 9, col, r=2)
        cv.text(x + 13, y, p, "note", C["ink2"])
        x += cv.tw(p, "note") + 22
    y += 30

    # ---- jadval (v2: panel bilan bir xil ustunlar) ----
    cv.text(PAD, y, "Operatorlar — uzatgani bo'yicha reyting", "h2", C["ink"])
    y += 30
    cols = [("#", 34, "c"), ("Operator", 168, "l"), ("Faollik", 96, "c"), ("Yangi", 72, "c"), ("Ishlangan", 72, "c"),
            ("Uzatdi", 64, "c"), ("AI sifat", 100, "c"), ("Qo'ng'iroq", 112, "c"), ("Suhbat", 90, "c"), ("Ball", 64, "c")]
    tot_w = sum(c[1] for c in cols)
    x0 = PAD + (W - 2 * PAD - tot_w) / 2
    cv.rect(x0, y, tot_w, TH, C["brand"], r=6)
    x = x0
    for nom, w, al in cols:
        ty = y + TH / 2 - 6
        if al == "l":
            cv.text(x + 8, ty, nom, "th", "#FFFFFF")
        else:
            cv.text(x + w / 2, ty, nom, "th", "#FFFFFF", anchor="ma")
        x += w
    y += TH

    def cell(x, w, txt, f="td", col=C["ink"], al="c", yy=None, sub=None, subcol=None):
        yy = y + RH / 2 - 8 if yy is None else yy
        if sub:
            yy -= 5
        if al == "l":
            cv.text(x + 8, yy, txt, f, col)
        else:
            cv.text(x + w / 2, yy, txt, f, col, anchor="ma")
        if sub:
            sy = yy + 16
            if al == "l":
                cv.text(x + 8, sy, sub, "tds", subcol or C["ink3"])
            else:
                cv.text(x + w / 2, sy, sub, "tds", subcol or C["ink3"], anchor="ma")

    def ballcol(b):
        return C["ink3"] if b is None else (C["green"] if b >= 70 else (C["red"] if b < 50 else C["yink"]))

    def sifat(x, w, a, b, sub):
        xx = x + w / 2
        a, b = fmt(a), fmt(b)
        full = f"{a} / {b}"
        yy = y + RH / 2 - 8 - (5 if sub else 0)
        sx = xx - cv.tw(full, "tdb") / 2
        cv.text(sx, yy, a, "tdb", C["green"])
        sx += cv.tw(a, "tdb")
        cv.text(sx, yy, " / ", "td", C["ink3"])
        sx += cv.tw(" / ", "td")
        cv.text(sx, yy, b, "tdb", C["red"])
        if sub:
            cv.text(xx, yy + 16, sub, "tds", C["ink3"], anchor="ma")

    if not rows:
        cv.rect(x0, y, tot_w, RH, C["alt"])
        cv.text(x0 + tot_w / 2, y + 10, "Bu kunda operator faolligi qayd etilmagan", "td", C["ink3"], anchor="ma")
        y += RH
    for i, r in enumerate(rows):
        cv.rect(x0, y, tot_w, RH, C["alt"] if i % 2 else C["bg"])
        cv.line(x0, y + RH, x0 + tot_w, y + RH, C["rule"])
        fb = next((b for b in r.get("bayroq", []) if b["k"] == "faollik"), None)
        qb = next((b for b in r.get("bayroq", []) if b["k"] == "qongiroq"), None)
        q = r.get("q") or {}
        x = x0
        for nom, w, al in cols:
            if nom == "#":
                o = r.get("orin")
                if o and o <= 3:
                    cx, cy, rr = x + w / 2, y + RH / 2, 10
                    cv.d.ellipse([(cx - rr) * S, (cy - rr) * S, (cx + rr) * S, (cy + rr) * S], fill=MEDAL[o])
                    cv.text(cx, cy - 7, str(o), "med", "#FFFFFF", anchor="ma")
                elif o:
                    cell(x, w, str(o), "td", C["ink3"], "c")
            elif nom == "Operator":
                cell(x, w, cv.fit(r["ism"], "tdb", w - 14), "tdb", C["ink"] if r.get("callMarkaz") else C["ink2"], "l",
                     sub=None if r.get("callMarkaz") else "call-markazdan tashqari")
            elif nom == "Faollik":
                if fb:
                    cv.rect(x + 4, y + 5, w - 8, RH - 10, C["ybg"] if fb["rang"] == "sariq" else C["rbg"], r=6)
                col = C["ink"] if not fb else (C["yink"] if fb["rang"] == "sariq" else C["rink"])
                t = f"{r['birinchi']}–{r['oxirgi']}" if r.get("birinchi") else "yo'q"
                cell(x, w, t, "td", col, "c")
            elif nom == "Yangi":
                bm = r.get("belgilanmagan") or 0
                cell(x, w, fmt(r["yangi"]), "tdb", sub=f"{bm} belgilanmagan" if bm else None, subcol=C["rink"])
            elif nom == "Ishlangan":
                cell(x, w, fmt(r["ishlangan"]))
            elif nom == "Uzatdi":
                cell(x, w, fmt(r["uzatildi"]), "tdb", C["brand"] if r["uzatildi"] else C["ink3"])
            elif nom == "AI sifat":
                sifat(x, w, r["sifatli"], r["sifatsiz"], f"+{r['baholanmagan']} baholanmagan" if r.get("baholanmagan") else None)
            elif nom == "Qo'ng'iroq":
                if qb:
                    cv.rect(x + 4, y + 5, w - 8, RH - 10, C["ybg"], r=6)
                kj = q.get("kirJavobsiz") or 0
                cell(x, w, f"{fmt(q.get('qildi', q.get('jami')))} · {q.get('javobli', 0)} javob", "td", C["yink"] if qb else C["ink"], "c",
                     sub=f"+{kj} kiruvchi javobsiz" if kj else None)
            elif nom == "Suhbat":
                cell(x, w, hm(q.get("sek")), "td", sub=f"o'rt. {ms(q.get('ortacha'))}" if q.get("javobli") else None)
            elif nom == "Ball":
                b = r.get("ball")
                cell(x, w, "—" if b is None else str(b), "tdb", ballcol(b), sub=f"{r.get('tahlil', 0)} tahlil" if r.get("tahlil") else None)
            x += w
        y += RH

    # jami qatori — jadvaldagi qatorlar yig'indisi (ball — tahlillar soniga ko'ra o'rtacha)
    cv.rect(x0, y, tot_w, RH, C["soft"])
    x = x0
    sm = lambda f: sum((r.get(f) or 0) for r in rows)
    qj = sum((r.get("q") or {}).get("qildi", (r.get("q") or {}).get("jami", 0)) for r in rows)
    qv = sum((r.get("q") or {}).get("javobli", 0) for r in rows)
    qs = sum((r.get("q") or {}).get("sek", 0) for r in rows)
    jb = (R.get("jami") or {}).get("ball")
    for nom, w, al in cols:
        if nom == "Operator":
            cell(x, w, "Jami", "tdb", C["ink"], "l")
        elif nom == "Yangi":
            cell(x, w, fmt(sm("yangi")), "tdb")
        elif nom == "Ishlangan":
            cell(x, w, fmt(sm("ishlangan")), "tdb")
        elif nom == "Uzatdi":
            cell(x, w, fmt(sm("uzatildi")), "tdb", C["brand"])
        elif nom == "AI sifat":
            sifat(x, w, sm("sifatli"), sm("sifatsiz"), None)
        elif nom == "Qo'ng'iroq":
            cell(x, w, f"{fmt(qj)} · {fmt(qv)} javob", "tdb", C["ink"], "c")
        elif nom == "Suhbat":
            cell(x, w, hm(qs), "tdb")
        elif nom == "Ball":
            cell(x, w, "—" if jb is None else str(jb), "tdb", ballcol(jb))
        x += w
    y += RH
    # kartalar (Odoo plitkalari) bilan farq — sababi bilan
    fark = []
    if R.get("operatorsiz"):
        fark.append(f"operator tanlanmagan yangi lid {fmt(R['operatorsiz'])}")
    du = (kpi["uzatildi"].get("bugun") or 0) - sm("uzatildi")
    if du > 0:
        fark.append(f"operator tanlanmagan uzatilgan lid {fmt(du)}")
    di = sm("ishlangan") - (kpi["ishlangan"].get("bugun") or 0)
    if di > 0:
        fark.append(f"{fmt(di)} lidni ikki operator ishlagan (kartada bir marta)")
    if fark:
        cv.text(x0, y + 6, "Kartalar bilan farq: " + " · ".join(fark), "foot", C["ink3"])
    y += 30

    # ---- 7 kunlik dinamika ----
    cv.text(PAD, y, "Oxirgi 7 kun: yangi lid va menejerga uzatilgan", "h2", C["ink"])
    lx = W - PAD
    for nom, col in (("uzatildi", C["bar2"]), ("yangi lid", C["bar1"])):
        wv = cv.tw(nom, "note")
        cv.text(lx - wv, y + 1, nom, "note", C["ink2"])
        cv.rect(lx - wv - 16, y + 3, 10, 10, col, r=2)
        lx -= wv + 34
    y += 26
    ch = 150
    cv.line(PAD, y + ch - 22, W - PAD, y + ch - 22, C["rule"])
    mx = max([1] + [max(s.get("tushgan", 0), s.get("uzatildi", 0)) for s in seriya])
    n = max(1, len(seriya))
    slot = (W - 2 * PAD) / n
    bw = min(28, slot / 4)
    for i, s in enumerate(seriya):
        cx = PAD + slot * i + slot / 2
        base = y + ch - 22
        for k, (f, col) in enumerate((("tushgan", C["bar1"]), ("uzatildi", C["bar2"]))):
            v = s.get(f, 0) or 0
            hh = (ch - 52) * v / mx
            bx = cx - bw - 2 if k == 0 else cx + 2
            if hh > 0:
                cv.rect(bx, base - hh, bw, hh, col, r=3)
            cv.text(bx + bw / 2, base - hh - 14, fmt(v), "ax", C["ink2"], anchor="ma")
        lab = s.get("qisqa", "")
        wk = s.get("hafta")
        cv.text(cx, base + 6, lab, "axb" if i == n - 1 else "ax", C["ink"] if i == n - 1 else C["ink3"], anchor="ma")
    y += ch + 4

    # ---- izoh ----
    cv.line(PAD, y, W - PAD, y, C["rule"])
    y += 10
    x = PAD
    so = R.get("sozlama") or {}
    leg = [(C["ybg"], f"Birinchi faollik {so.get('sariq', '09:00')} dan kech"), (C["rbg"], f"{so.get('qizil', '10:00')} dan kech yoki faollik yo'q")]
    if so.get("norma"):
        leg.append((C["ybg"], f"Qo'ng'iroq kunlik normadan ({so['norma']}) kam"))
    for col, t in leg:
        cv.rect(x, y + 1, 12, 12, col, r=3)
        cv.text(x + 17, y, t, "foot", C["ink2"])
        x += cv.tw(t, "foot") + 34
    y += 20
    cv.text(PAD, y, "Uzatish % — oxirgi 7 kun: uzatildi ÷ yangi lid. Reyting — uzatgani, keyin AI ball. AI ball va sifat — qo'ng'iroq suhbati bo'yicha.", "foot", C["ink3"])
    cv.text(W - PAD, y, R.get("panel", ""), "foot", C["ink3"], anchor="ra")

    cv.img.save(sys.stdout.buffer, "PNG", optimize=True)


if __name__ == "__main__":
    main()
