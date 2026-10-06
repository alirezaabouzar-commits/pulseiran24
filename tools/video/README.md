# Pulse Iran 24 — video tools

- `pulse_template.py` — approved vertical template (lower third, logo circle, 4.5 s outro).
- `news_voice_video.py` — narrated news video: ElevenLabs voice + timed RTL Vazirmatn captions, then the template.

```
export ELEVENLABS_API_KEY=...            # optional: ELEVENLABS_VOICE_ID, ELEVENLABS_MODEL (default eleven_v3)
python3 tools/video/news_voice_video.py --script tools/video/test_script.fa.txt \
  --white "ویدیوی آزمایشی|قالب خبری تازه" --red "صدای ElevenLabs" --out news_test.mp4
```

Without an API key it uses `--audio file.mp3`, or a silent track if that's missing. Captions are then timed
by text length instead of the ElevenLabs character timestamps. Vazirmatn is downloaded into the work dir on first run.
Needs ffmpeg and Pillow with RAQM.
