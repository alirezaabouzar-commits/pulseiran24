#!/usr/bin/env python3
"""Pulse Iran 24 — narrated Persian news video (ElevenLabs voice + RTL Vazirmatn captions).

Builds a narrated background segment (clip or animated logo + timed RTL captions),
then hands it to pulse_template.py for the lower third and the 4.5 s outro.

Voice:
  ELEVENLABS_API_KEY set  -> ElevenLabs /with-timestamps (captions synced to the voice)
  --audio narration.mp3   -> use an existing voice file (captions timed by text length)
  neither                 -> silent placeholder track (captions timed by text length)

Usage:
  python3 news_voice_video.py --script script.txt --white "خط اول|خط دوم" --red "خط قرمز" \
      [--clip bg.mp4] [--platform tiktok|instagram] [--total 30] --out out.mp4
"""
import argparse, base64, json, os, re, subprocess, sys, urllib.request, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
OUTRO = 4.5
VZ_URL = "https://github.com/rastikerdar/vazirmatn/releases/download/v33.003/vazirmatn-v33.003.zip"
# Premade multilingual voice; override with --voice-id or ELEVENLABS_VOICE_ID.
DEFAULT_VOICE = "pNInz6obpgDQGcFmaJgB"


def run(cmd):
    subprocess.run(cmd, shell=True, check=True)


def probe_dur(path):
    return float(subprocess.check_output(
        f"ffprobe -v error -show_entries format=duration -of csv=p=0 '{path}'", shell=True))


def ensure_fonts(work):
    vz = os.path.join(work, "vz")
    if not os.path.exists(os.path.join(vz, "fonts/ttf/Vazirmatn-Black.ttf")):
        z = os.path.join(work, "vz.zip")
        urllib.request.urlretrieve(VZ_URL, z)
        zipfile.ZipFile(z).extractall(vz)
    os.environ["VAZIR_DIR"] = vz
    return vz


def elevenlabs_tts(text, voice, model, out_mp3):
    """Returns (start, end) seconds per character of `text`, writes audio to out_mp3."""
    req = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice}/with-timestamps?output_format=mp3_44100_128",
        data=json.dumps({"text": text, "model_id": model, "language_code": "fa",
                         "voice_settings": {"stability": 0.5, "similarity_boost": 0.75}}).encode(),
        headers={"xi-api-key": os.environ["ELEVENLABS_API_KEY"], "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        res = json.load(r)
    open(out_mp3, "wb").write(base64.b64decode(res["audio_base64"]))
    al = res.get("normalized_alignment") or res["alignment"]
    return list(zip(al["character_start_times_seconds"], al["character_end_times_seconds"]))


def chunk_script(text, max_words=6):
    """Split into caption chunks: sentence boundaries first, then at most max_words words."""
    chunks = []
    for sent in re.split(r"(?<=[.!؟?،])\s+", text.strip()):
        words = sent.split()
        n = max(1, -(-len(words) // max_words))           # balanced split
        per = -(-len(words) // n)
        chunks += [" ".join(words[i:i + per]) for i in range(0, len(words), per)]
    return [c for c in chunks if c]


def time_chunks(text, chunks, char_times, t0, t1):
    """(start, end) per chunk — from ElevenLabs alignment if present, else by character count."""
    spans, pos = [], 0
    for c in chunks:
        i = text.find(c.split()[0], pos)
        j = i + len(c)
        spans.append((i, j)); pos = j
    if char_times and len(char_times) >= len(text):
        out = [(char_times[i][0], char_times[min(j, len(text)) - 1][1]) for i, j in spans]
    else:
        total = sum(len(c) for c in chunks); t = t0; out = []
        for c in chunks:
            d = (t1 - t0) * len(c) / total
            out.append((t, t + d)); t += d
    # no gaps: each caption stays until the next one starts
    return [(s, out[k + 1][0] if k + 1 < len(out) else e) for k, (s, e) in enumerate(out)]


def caption_png(path, text, y_top=300):
    import pulse_template as T
    from PIL import Image, ImageDraw
    im = Image.new("RGBA", (T.W, T.H), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    f = T.fa("Bold", 64); lh = 92; maxw = 860
    lines, cur = [], []
    for w in text.split():                                 # RTL word wrap
        if cur and d.textlength(" ".join(cur + [w]), font=f, **T.KW) > maxw:
            lines.append(" ".join(cur)); cur = [w]
        else:
            cur.append(w)
    lines.append(" ".join(cur))
    bw = max(d.textlength(l, font=f, **T.KW) for l in lines)
    x0, x1 = (T.W - bw) / 2 - 34, (T.W + bw) / 2 + 34
    d.rounded_rectangle((x0, y_top, x1, y_top + lh * len(lines) + 30), 26, fill=(0, 0, 0, 170))
    d.rectangle((x1 - 10, y_top + 20, x1 - 4, y_top + lh * len(lines) + 10), fill=T.RED + (255,))
    for k, l in enumerate(lines):
        lw = d.textlength(l, font=f, **T.KW)
        d.text(((T.W - lw) / 2, y_top + 8 + k * lh), l, font=f, fill=(255, 255, 255), **T.KW)
    im.save(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--script", required=True, help="UTF-8 text file with the narration")
    ap.add_argument("--white", default=""); ap.add_argument("--red", default="")
    ap.add_argument("--clip", help="background clip (default: animated site logo)")
    ap.add_argument("--logo", default=os.path.join(REPO, "assets/video/pulse-map.mp4"))
    ap.add_argument("--platform", default="tiktok"); ap.add_argument("--audio")
    ap.add_argument("--voice-id", default=os.environ.get("ELEVENLABS_VOICE_ID", DEFAULT_VOICE))
    ap.add_argument("--model", default=os.environ.get("ELEVENLABS_MODEL", "eleven_v3"))
    ap.add_argument("--total", type=float, default=30.0, help="target length incl. outro")
    ap.add_argument("--work", default="_work"); ap.add_argument("--out", required=True)
    a = ap.parse_args()

    out = os.path.abspath(a.out); logo = os.path.abspath(a.logo)
    clip = os.path.abspath(a.clip) if a.clip else None
    text = " ".join(open(a.script, encoding="utf-8").read().split())
    os.makedirs(a.work, exist_ok=True); os.chdir(a.work)
    ensure_fonts(os.getcwd()); sys.path.insert(0, HERE)

    main_dur = a.total - OUTRO
    char_times, voice = None, "none"
    if os.environ.get("ELEVENLABS_API_KEY"):
        char_times = elevenlabs_tts(text, a.voice_id, a.model, "voice.mp3"); voice = "voice.mp3"
    elif a.audio:
        voice = os.path.abspath(a.audio)
    lead = 0.6                                             # voice starts after the lower third appears
    if voice != "none":
        vd = probe_dur(voice)
        if vd + lead + 0.5 > main_dur:
            print(f"warning: narration {vd:.1f}s is longer than {main_dur:.1f}s; video will run long")
            main_dur = vd + lead + 0.5
        t1 = lead + vd
    else:
        t1 = main_dur - 0.6
    if char_times:
        char_times = [(s + lead, e + lead) for s, e in char_times]

    chunks = chunk_script(text)
    timing = time_chunks(text, chunks, char_times, lead, t1)
    for k, c in enumerate(chunks):
        caption_png(f"_cap{k}.png", c)

    # background: clip crop-to-fill, or the logo animation filling the frame with a slow zoom
    if clip:
        bg_in = f"-i '{clip}'"
        bg = "[0:v]fps=30,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[bg]"
    else:
        bg_in = f"-stream_loop -1 -i '{logo}'"
        bg = ("[0:v]fps=30,scale=1920:1920:flags=lanczos,crop=1080:1920,"
              f"zoompan=z='1+0.06*on/({main_dur}*30)':d=1:s=1080x1920:fps=30,"
              "eq=brightness=-0.12:saturation=1.1,setsar=1[bg]")
    caps_in = "".join(f" -loop 1 -t {main_dur} -i _cap{k}.png" for k in range(len(chunks)))
    fc, last = [bg], "bg"
    for k, (s, e) in enumerate(timing):
        n = k + 1
        fc.append(f"[{n}:v]format=rgba,fade=t=in:st={s:.2f}:d=0.2:alpha=1,"
                  f"fade=t=out:st={max(s, e - 0.15):.2f}:d=0.15:alpha=1[c{k}]")
        fc.append(f"[{last}][c{k}]overlay=0:0:enable='between(t,{s:.2f},{e:.2f})'[v{k}]")
        last = f"v{k}"
    ai = len(chunks) + 1
    if voice != "none":
        aud_in = f" -i '{voice}'"
        fc.append(f"[{ai}:a]aresample=48000,adelay={int(lead * 1000)}:all=1,apad,atrim=0:{main_dur}[a]")
    else:
        aud_in = f" -f lavfi -t {main_dur} -i anullsrc=r=48000:cl=stereo"
        fc.append(f"[{ai}:a]anull[a]")
    run(f"ffmpeg -v error -y {bg_in}{caps_in}{aud_in} -filter_complex \"{';'.join(fc)}\" "
        f"-map \"[{last}]\" -map \"[a]\" -t {main_dur} -c:v libx264 -preset veryfast -crf 17 "
        f"-pix_fmt yuv420p -c:a aac -b:a 192k narrated.mp4")

    # lower third + logo circle + outro via the approved template
    run(f"python3 '{os.path.join(HERE, 'pulse_template.py')}' --clip narrated.mp4 --platform {a.platform} "
        f"--white \"{a.white}\" --red \"{a.red}\" --logo '{logo}' --out '{out}'")
    print(f"done: {out}  ({probe_dur(out):.1f}s, voice: {'ElevenLabs' if char_times else voice})")


if __name__ == "__main__":
    main()
