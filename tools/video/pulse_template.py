#!/usr/bin/env python3
"""Pulse Iran 24 — vertical news template (TikTok / Instagram Reels).

Usage:
  python3 pulse_template.py --clip IN.mp4 --platform tiktok|instagram \
      --white "خط اول|خط دوم" --red "خط قرمز اول|خط قرمز دوم" \
      [--inset face.jpg  (default: animated logo in circle)] [--start 0] [--dur 20] [--logo logo.mp4] --out OUT.mp4
"""
import argparse, subprocess, os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 1080, 1920
RED = (200, 16, 46)
VZ = os.environ.get("VAZIR_DIR", "vz")
FD = VZ + "/misc/UI-Farsi-Digits/fonts/ttf/Vazirmatn-UI-FD-{}.ttf"
LT = VZ + "/fonts/ttf/Vazirmatn-{}.ttf"
KW = dict(direction="rtl", language="fa")

# Safe zones per platform: right edge of text block, bottom of block, left edge
PLATFORM = {
    # TikTok: right-side buttons ~x>930, caption/UI bottom ~420px
    "tiktok":    dict(right=900, bottom=1470, left=70),
    # Instagram Reels: buttons x>960, caption ~320px, and grid/feed shows 4:5 crop (y 285..1635)
    "instagram": dict(right=930, bottom=1560, left=70),
}
CTA = {
    "tiktok":    ("بخوانید، ببینید", "پالس ایران ۲۴ را دنبال کنید!"),
    "instagram": ("بخوانید، ببینید", "پالس ایران ۲۴ را فالو کنید!"),
}


def fa(w, s): return ImageFont.truetype(FD.format(w), s, layout_engine=ImageFont.Layout.RAQM)
def la(w, s): return ImageFont.truetype(LT.format(w), s)


def wordmark(d, x_right, y, size=40, fill=(255, 255, 255)):
    """PULSE | IRAN24 wordmark, right-aligned at x_right."""
    fb, fl = la("Black", size), la("Light", size)
    a, b = "PULSE", "IRAN24"
    wa, wb = d.textlength(a, font=fb), d.textlength(b, font=fl)
    gap = size * 0.35
    x = x_right - (wa + gap * 2 + 3 + wb)
    d.text((x, y), a, font=fb, fill=fill)
    lx = x + wa + gap
    d.rectangle((lx, y + size * 0.15, lx + 3, y + size * 1.25), fill=fill)
    d.text((lx + 3 + gap, y), b, font=fl, fill=fill)
    return x


def overlay_png(path, platform, white, red, inset):
    P = PLATFORM[platform]
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    # bottom gradient for legibility
    g = Image.new("L", (1, H), 0)
    for yy in range(H):
        t = max(0, (yy - 900) / (H - 900))
        g.putpixel((0, yy), int(215 * t ** 1.3))
    im.paste(Image.new("RGBA", (W, H), (0, 0, 0, 255)), (0, 0), g.resize((W, H)))
    d = ImageDraw.Draw(im)

    f = fa("Black", 80); lh = 100
    n = len(white) + len(red)
    top = P["bottom"] - n * lh
    # wordmark above headline
    wordmark(d, P["right"], top - 78, 46)
    y = top
    for ln in white:
        bw = d.textlength(ln, font=f, **KW)
        d.text((P["right"] - bw + 2, y + 2), ln, font=f, fill=(0, 0, 0, 160), **KW)
        d.text((P["right"] - bw, y), ln, font=f, fill=(255, 255, 255), **KW)
        y += lh
    for ln in red:
        bw = d.textlength(ln, font=f, **KW)
        d.rectangle((P["right"] - bw - 16, y + 4, P["right"] + 12, y + lh - 2), fill=RED)
        d.text((P["right"] - bw, y - 2), ln, font=f, fill=(255, 255, 255), **KW)
        y += lh

    s = 300
    x0, y0 = P["left"], top - 90 - s - 10
    if inset:
        src = Image.open(inset).convert("RGB")
        m = min(src.size); cx, cy = src.size[0] // 2, src.size[1] // 2
        src = src.crop((cx - m // 2, cy - m // 2, cx + m // 2, cy + m // 2)).resize((s, s), Image.LANCZOS)
        mask = Image.new("L", (s, s), 0); ImageDraw.Draw(mask).ellipse((0, 0, s, s), fill=255)
        ring = Image.new("RGBA", (s + 16, s + 16), (0, 0, 0, 0))
        ImageDraw.Draw(ring).ellipse((0, 0, s + 15, s + 15), fill=RED + (255,))
        im.alpha_composite(ring, (x0 - 8, y0 - 8))
        im.paste(src, (x0, y0), mask)
    im.save(path)
    return x0, y0, s


def circle_assets(s):
    ring = Image.new("RGBA", (s + 16, s + 16), (0, 0, 0, 0))
    ImageDraw.Draw(ring).ellipse((0, 0, s + 15, s + 15), fill=RED + (255,))
    ring.save("_ring.png")
    m = Image.new("L", (s, s), 0); ImageDraw.Draw(m).ellipse((0, 0, s - 1, s - 1), fill=255)
    m.save("_cmask.png")


def phone_png(path, platform):
    """Black background + phone frame; screen is transparent (logo video shows through)."""
    im = Image.new("RGBA", (W, H), (0, 0, 0, 255))
    d = ImageDraw.Draw(im)
    px0, py0, px1, py1 = 175, 250, 905, 1690          # phone body
    sx0, sy0, sx1, sy1 = 199, 274, 881, 1666          # screen
    # soft glow
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(glow).rounded_rectangle((px0 - 20, py0 - 20, px1 + 20, py1 + 20), 100, fill=(90, 10, 20, 150))
    im.alpha_composite(glow.filter(ImageFilter.GaussianBlur(40)))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((px0, py0, px1, py1), 86, fill=(40, 40, 44), outline=(190, 190, 196), width=6)
    d.rounded_rectangle((px0 + 8, py0 + 8, px1 - 8, py1 - 8), 80, fill=(8, 8, 10))
    # side buttons
    d.rounded_rectangle((px0 - 9, 520, px0, 620), 3, fill=(170, 170, 176))
    d.rounded_rectangle((px1, 600, px1 + 9, 760), 3, fill=(170, 170, 176))
    # cut the screen (transparent)
    hole = Image.new("L", (W, H), 255)
    ImageDraw.Draw(hole).rounded_rectangle((sx0, sy0, sx1, sy1), 64, fill=0)
    im.putalpha(hole)
    # notch drawn after cut
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((440, 274, 640, 318), 22, fill=(8, 8, 10, 255))
    im.save(path)


def cta_png(path, platform):
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    l1, l2 = CTA[platform]
    for i, s in enumerate((l1, l2)):
        f = fa("Black", 56); bw = d.textlength(s, font=f, **KW)
        d.text(((W - bw) / 2, 1130 + i * 78), s, font=f, fill=(255, 255, 255), **KW)
    f = la("Bold", 46); s = "pulseiran24.com"; bw = d.textlength(s, font=f)
    d.rounded_rectangle(((W - bw) / 2 - 26, 1320, (W + bw) / 2 + 26, 1396), 16, fill=RED)
    d.text(((W - bw) / 2, 1324), s, font=f, fill=(255, 255, 255))
    im.save(path)


def feather_mask(path, s=640):
    m = Image.new("L", (s, s), 0)
    ImageDraw.Draw(m).ellipse((s*0.12, s*0.12, s*0.88, s*0.88), fill=255)
    m.filter(ImageFilter.GaussianBlur(s*0.08)).save(path)


def run(cmd):
    subprocess.run(cmd, shell=True, check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--clip", required=True); ap.add_argument("--platform", default="tiktok")
    ap.add_argument("--white", default=""); ap.add_argument("--red", default="")
    ap.add_argument("--inset"); ap.add_argument("--start", type=float, default=0)
    ap.add_argument("--dur", type=float, default=0); ap.add_argument("--logo", default="logo.mp4")
    ap.add_argument("--out", required=True); a = ap.parse_args()
    white = [s for s in a.white.split("|") if s]; red = [s for s in a.red.split("|") if s]
    tag = a.platform
    x0, y0, cs = overlay_png(f"_ov_{tag}.png", a.platform, white, red, a.inset)
    circle_assets(cs)
    feather_mask("_fmask.png"); phone_png(f"_ph_{tag}.png", a.platform); cta_png(f"_cta_{tag}.png", a.platform)
    enc = "-c:v libx264 -preset veryfast -crf 19 -pix_fmt yuv420p -r 30 -c:a aac -b:a 192k -ar 48000"
    dur = a.dur or float(subprocess.check_output(
        f"ffprobe -v error -show_entries format=duration -of csv=p=0 '{a.clip}'", shell=True)) - a.start
    has_audio = subprocess.check_output(
        f"ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 '{a.clip}'", shell=True).strip()
    aud = ("[0:a]loudnorm=I=-15:TP=-1.5:LRA=11,aresample=48000,afade=t=in:d=0.15,"
           f"afade=t=out:st={dur-0.4}:d=0.4,aformat=channel_layouts=stereo[a]") if has_audio else \
          f"anullsrc=r=48000:cl=stereo,atrim=0:{dur}[a]"
    # 1) main: full-bleed crop-to-fill + lower third fading/sliding in at 0.3s
    slide = "if(lt(t,0.3),40,max(0,40-(t-0.3)*80))"
    if a.inset:   # photo inside the circle is already baked into the overlay PNG
        extra_in, circ = "", ""
        last = "[bg][ov]overlay=x='%s':y=0:format=auto,format=yuv420p[v]" % slide
    else:         # animated site logo inside the circle (default)
        extra_in = f"-stream_loop -1 -i '{a.logo}' -loop 1 -t {dur} -i _ring.png "
        z = int(cs * 1.18)
        circ = (f"[2:v]fps=30,scale={z}:{z},crop={cs}:{cs},format=rgba[l0];"
                f"movie=_cmask.png,format=gray,loop=-1:1,setpts=N/30/TB[mk];[l0][mk]alphamerge[lc];"
                f"[3:v]format=rgba[rg];[rg][lc]overlay=8:8:shortest=1[cr];"
                f"[cr]fade=t=in:st=0.3:d=0.5:alpha=1[c2];")
        last = (f"[bg][ov]overlay=x='{slide}':y=0:format=auto[b1];"
                f"[b1][c2]overlay=x='{x0 - 8}+{slide}':y={y0 - 8}:format=auto,format=yuv420p[v]")
    run(f"ffmpeg -v error -y -ss {a.start} -t {dur} -i '{a.clip}' -loop 1 -t {dur} -i _ov_{tag}.png {extra_in}"
        f"-filter_complex \"[0:v]fps=30,scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1[bg];"
        f"[1:v]format=rgba,fade=t=in:st=0.3:d=0.5:alpha=1[ov];{circ}{last};{aud}\" "
        f"-map \"[v]\" -map \"[a]\" -t {dur} {enc} _m_{tag}.mp4")
    # 2) outro: phone mockup, logo inside screen, CTA from 1.6s (4.5s)
    run(f"ffmpeg -v error -y -stream_loop 1 -i '{a.logo}' -loop 1 -t 4.5 -i _ph_{tag}.png -loop 1 -t 4.5 -i _cta_{tag}.png "
        f"-f lavfi -t 4.5 -i anullsrc=r=48000:cl=stereo -filter_complex "
        f"\"color=black:s={W}x{H}:r=30:d=4.5[base];[0:v]fps=30,scale=640:640,format=rgba[lg0];movie=_fmask.png,format=gray,loop=-1:1,setpts=N/30/TB[mk];[lg0][mk]alphamerge[lg];"
        f"[base][lg]overlay=(W-w)/2:'if(lt(t,1.4),650,650-min(1,(t-1.4)/0.5)*260)'[b1];"
        f"[b1][1:v]overlay=0:0[b2];[2:v]format=rgba,fade=t=in:st=1.6:d=0.5:alpha=1[c];"
        f"[b2][c]overlay=0:0,fade=t=in:st=0:d=0.3,fade=t=out:st=4.1:d=0.4,format=yuv420p,setsar=1[v]\" "
        f"-map \"[v]\" -map 3:a -t 4.5 {enc} _o_{tag}.mp4")
    run(f"ffmpeg -v error -y -i _m_{tag}.mp4 -i _o_{tag}.mp4 -filter_complex "
        f"\"[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]\" -map \"[v]\" -map \"[a]\" "
        f"-c:v libx264 -preset medium -crf 19 -profile:v high -pix_fmt yuv420p -r 30 -c:a aac -b:a 192k "
        f"-movflags +faststart '{a.out}'")


if __name__ == "__main__":
    main()
