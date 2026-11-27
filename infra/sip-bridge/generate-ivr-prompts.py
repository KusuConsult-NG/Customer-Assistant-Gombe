#!/usr/bin/env python3
"""
Generate bilingual Hausa + Nigerian English Asterisk IVR prompts using Spitch TTS.

Outputs 8 kHz, 16-bit signed mono PCM WAV files directly into Asterisk's custom
sounds directory (/var/lib/asterisk/sounds/en/custom by default), so Asterisk
can play them with Background(custom/gombe-ivr-menu) at zero per-call latency.
"""
import audioop
import json
import os
import struct
import sys
import urllib.request
import wave


def load_env(path: str) -> None:
    if not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8") as fh:
        for raw in fh:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            v = v.strip().strip('"').strip("'")
            os.environ.setdefault(k.strip(), v)


def strip_wav_header(data: bytes) -> tuple[bytes, int, int, int]:
    """Parse streaming WAV from Spitch (where data chunk size may be 0x7FFFFFFF)."""
    if len(data) < 44 or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise ValueError("Spitch response is not a valid WAV file")
    pos = 12
    channels = 1
    sample_rate = 24000
    sampwidth = 2
    while pos + 8 <= len(data):
        chunk_id = data[pos : pos + 4]
        chunk_size = struct.unpack("<I", data[pos + 4 : pos + 8])[0]
        pos += 8
        if chunk_id == b"fmt ":
            fmt_bytes = data[pos : pos + chunk_size]
            _, channels, sample_rate, _, _, bits_per_sample = struct.unpack("<HHIIHH", fmt_bytes[:16])
            sampwidth = bits_per_sample // 8
            pos += chunk_size + (chunk_size % 2)
        elif chunk_id == b"data":
            pcm = data[pos:]
            # Ensure even frame alignment
            rem = len(pcm) % (channels * sampwidth)
            if rem:
                pcm = pcm[:-rem]
            return pcm, channels, sampwidth, sample_rate
        else:
            pos += chunk_size + (chunk_size % 2)
    raise ValueError("WAV data chunk not found")


def spitch_tts_pcm8k(api_key: str, text: str, language: str, voice: str, speed: float = 1.0) -> bytes:
    payload = json.dumps(
        {
            "language": language,
            "voice": voice,
            "text": text,
            "format": "wav",
            "speed": speed,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        "https://api.spitch.app/v1/speech",
        data=payload,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read()
    pcm, channels, sampwidth, rate = strip_wav_header(raw)
    if channels == 2:
        pcm = audioop.tomono(pcm, sampwidth, 0.5, 0.5)
    if sampwidth != 2:
        pcm = audioop.lin2lin(pcm, sampwidth, 2)
    if rate != 8000:
        pcm, _ = audioop.ratecv(pcm, 2, 1, rate, 8000, None)
    return pcm


def silence_8k(seconds: float) -> bytes:
    samples = int(8000 * seconds)
    return b"\x00\x00" * samples


def write_wav_8k(path: str, pcm8k: bytes) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(8000)
        wf.writeframes(pcm8k)


def main() -> None:
    load_env(os.environ.get("BRIDGE_ENV_FILE", "/opt/sip-bridge/bridge.env"))
    api_key = os.environ.get("SPITCH_API_KEY", "").strip()
    if not api_key:
        print("ERROR: SPITCH_API_KEY is required", file=sys.stderr)
        sys.exit(1)

    ha_voice = os.environ.get("SPITCH_HAUSA_VOICE", "hasan").strip() or "hasan"
    en_voice = os.environ.get("SPITCH_ENGLISH_VOICE", "kingsley").strip() or "kingsley"
    out_dir = os.environ.get("ASTERISK_CUSTOM_SOUNDS", "/var/lib/asterisk/sounds/en/custom")

    prompts = {
        "gombe-ivr-menu.wav": [
            (
                "ha",
                ha_voice,
                "Barka da zuwa dakin kula da zabe na Dakta Jamil Isyaku Gwamna. Domin yin magana da Hausa, danna daya.",
            ),
            ("silence", "", "0.45"),
            (
                "en",
                en_voice,
                "Welcome to the Doctor Jamil Isyaku Gwamna 2027 A P C Election Situation Room. For Nigerian English, press two.",
            ),
        ],
        "gombe-ivr-invalid.wav": [
            ("ha", ha_voice, "Lambar da ka danna ba daidai ba ce. Danna daya domin Hausa."),
            ("silence", "", "0.35"),
            ("en", en_voice, "Invalid selection. Press one for Hausa, or press two for Nigerian English."),
        ],
        "gombe-ivr-connecting-ha.wav": [
            ("ha", ha_voice, "Na gode. Ana hada ka da wakilinmu na Hausa yanzu."),
        ],
        "gombe-ivr-connecting-en.wav": [
            ("en", en_voice, "Thank you. Connecting you to our Situation Room assistant now."),
        ],
    }

    for filename, parts in prompts.items():
        combined = bytearray()
        for lang, voice, text in parts:
            if lang == "silence":
                combined.extend(silence_8k(float(text)))
            else:
                print(f"Synthesizing {filename} [{lang}/{voice}]...")
                combined.extend(spitch_tts_pcm8k(api_key, text, lang, voice))
        out_path = os.path.join(out_dir, filename)
        write_wav_8k(out_path, bytes(combined))
        dur = len(combined) / (8000 * 2)
        print(f"  -> Wrote {out_path} ({len(combined)} bytes, {dur:.2f}s)")


if __name__ == "__main__":
    main()
