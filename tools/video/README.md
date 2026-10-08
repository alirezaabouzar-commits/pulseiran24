# Pulse Iran 24 — video tools

- `pulse_template.py` — approved vertical template (lower third, logo circle, 4.5 s outro).
- `news_voice_video.py` — narrated news video: ElevenLabs voice + timed RTL Vazirmatn captions, then the template.

```
export ELEVENLABS_API_KEY=...            # optional: ELEVENLABS_VOICE_ID, ELEVENLABS_MODEL (default eleven_v3)
python3 tools/video/news_voice_video.py --script tools/video/test_script.fa.txt \
  --white "ویدیوی آزمایشی|قالب خبری تازه" --red "صدای ElevenLabs" --out news_test.mp4
```

Without an API key it uses `--audio file.mp3`, or a silent track if that's missing. Captions are then timed
by text length instead of the ElevenLabs character timestamps.

## Dependencies

- **Python 3** and **ffmpeg** on `PATH` (both scripts shell out to `ffmpeg`).
- **Pillow built with RAQM** for correct Persian shaping and RTL layout. Check with
  `python3 -c "from PIL import features; print(features.check('raqm'))"`; it must print `True`.
  On Debian/Ubuntu: `apt install ffmpeg libraqm0` then `pip install Pillow`.
- **Vazirmatn font**: `news_voice_video.py` downloads it into `vz/` on first run.
  `pulse_template.py` reads it from `$VAZIR_DIR` (default `vz`).
- **ElevenLabs (optional)**: `ELEVENLABS_API_KEY`, plus `ELEVENLABS_VOICE_ID` and `ELEVENLABS_MODEL`
  (default `eleven_v3`) to override the voice and model. Never commit the key.
- Default background is the animated logo at `assets/video/pulse-map.mp4`; pass `--logo` to
  `pulse_template.py` when running it directly.
