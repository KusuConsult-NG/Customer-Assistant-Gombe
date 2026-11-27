#!/usr/bin/env python3
"""
Gombe APC 2027 Situation Room — Bilingual Spitch Voice Agent (Asterisk AudioSocket).

Handles real-time phone calls routed from Asterisk on the DigitalOcean SIP bridge:
  - Press 1 -> Hausa (Spitch STT `ha` + Spitch TTS `hasan`)
  - Press 2 -> Nigerian English (Spitch STT `en` + Spitch TTS `kingsley`)

Architecture (zero third-party pip dependencies, Python 3.12 stdlib only):
  1. Local HTTP control server (127.0.0.1:9091):
       - POST /session  : Asterisk CURL() registers {uuid, callerId, lang} right before AudioSocket()
       - GET  /health   : Readiness probe
  2. Local AudioSocket TCP server (127.0.0.1:9092):
       - Speaks Asterisk AudioSocket protocol (0x01 UUID, 0x10 8kHz slin16 PCM, 0x03 DTMF, 0x00 hangup)
       - RMS VAD utterance capture + barge-in support
       - Spitch ASR (`POST /v1/transcriptions`) with Gombe special_words boosting
       - Conversational brain:
           * Full LLM + tool calling when LLM_API_KEY is configured (OpenAI / Gemini / Groq / OpenRouter)
           * Automatic Spitch-Direct fallback (Spitch Translate + live /api/agent-tools/* search & ticket filing)
             when no external LLM key is active yet, so Hausa & Nigerian English calls work out of the box
       - Spitch TTS (`POST /v1/speech`) resampled 24kHz -> 8kHz mono PCM, streamed in 20ms frames
"""
import asyncio
import audioop
from concurrent.futures import ThreadPoolExecutor
import io
import json
import logging
import os
import re
import struct
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid as uuidlib
import wave
from typing import Any, Dict, List, Optional, Tuple

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("spitch-voice")

# Asterisk AudioSocket message types
MSG_HANGUP = 0x00
MSG_UUID = 0x01
MSG_DTMF = 0x03
MSG_AUDIO = 0x10
MSG_ERROR = 0xFF

FRAME_BYTES = 320  # 20ms of 8kHz 16-bit mono PCM
SAMPLE_RATE = 8000

GOMBE_SPECIAL_WORDS = (
    "Dr. Jamil Isyaku Gwamna, Jamilu, Sardaunan Gombe, IMPACTS, APC, INEC, "
    "BVAS, IReV, EC8A, Akko, Balanga, Billiri, Dukku, Funakaye, Gombe, "
    "Kaltungo, Kwami, Nafada, Shongom, Yamaltu Deba"
)

GOMBE_LGAS = [
    "Akko", "Balanga", "Billiri", "Dukku", "Funakaye", "Gombe",
    "Kaltungo", "Kwami", "Nafada", "Shongom", "Yamaltu/Deba",
]

EXECUTOR = ThreadPoolExecutor(max_workers=12)
SESSIONS: Dict[str, Dict[str, Any]] = {}


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


class Config:
    def __init__(self) -> None:
        self.spitch_api_key = os.environ.get("SPITCH_API_KEY", "").strip()
        self.ha_voice = os.environ.get("SPITCH_HAUSA_VOICE", "hasan").strip() or "hasan"
        self.en_voice = os.environ.get("SPITCH_ENGLISH_VOICE", "kingsley").strip() or "kingsley"
        self.api_base_url = os.environ.get("API_BASE_URL", "https://gombe-api-3ios.onrender.com").rstrip("/")
        self.agent_tool_key = os.environ.get("AGENT_TOOL_KEY", "").strip()
        self.llm_api_key = os.environ.get("LLM_API_KEY", "").strip()
        self.llm_base_url = os.environ.get("LLM_BASE_URL", "https://api.openai.com/v1").rstrip("/")
        self.llm_model = os.environ.get("LLM_MODEL", "gpt-4o-mini").strip()
        self.http_port = int(os.environ.get("SPITCH_HTTP_PORT", "9091"))
        self.audiosocket_port = int(os.environ.get("SPITCH_AUDIOSOCKET_PORT", "9092"))


CFG: Config


# ── Audio & Spitch Helpers ───────────────────────────────────────────────────


def strip_wav_header(data: bytes) -> Tuple[bytes, int, int, int]:
    if len(data) < 44 or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise ValueError("Invalid WAV stream from Spitch")
    pos = 12
    channels, rate, sampwidth = 1, 24000, 2
    while pos + 8 <= len(data):
        cid = data[pos : pos + 4]
        csize = struct.unpack("<I", data[pos + 4 : pos + 8])[0]
        pos += 8
        if cid == b"fmt ":
            _, channels, rate, _, _, bps = struct.unpack("<HHIIHH", data[pos : pos + 16])
            sampwidth = bps // 8
            pos += csize + (csize % 2)
        elif cid == b"data":
            pcm = data[pos:]
            rem = len(pcm) % (channels * sampwidth)
            if rem:
                pcm = pcm[:-rem]
            return pcm, channels, sampwidth, rate
        else:
            pos += csize + (csize % 2)
    raise ValueError("WAV data chunk missing")


def pcm8k_to_wav_bytes(pcm: bytes) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(pcm)
    return buf.getvalue()


def spitch_tts_sync(text: str, lang: str) -> bytes:
    voice = CFG.ha_voice if lang == "ha" else CFG.en_voice
    clean = re.sub(r"[*_`#]+", "", text).strip()
    if not clean:
        return b""
    payload = json.dumps(
        {
            "language": lang,
            "voice": voice,
            "text": clean[:900],
            "format": "wav",
            "speed": 1.0,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        "https://api.spitch.app/v1/speech",
        data=payload,
        headers={
            "Authorization": f"Bearer {CFG.spitch_api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=25) as resp:
        raw = resp.read()
    pcm, channels, sampwidth, rate = strip_wav_header(raw)
    if channels == 2:
        pcm = audioop.tomono(pcm, sampwidth, 0.5, 0.5)
    if sampwidth != 2:
        pcm = audioop.lin2lin(pcm, sampwidth, 2)
    if rate != SAMPLE_RATE:
        pcm, _ = audioop.ratecv(pcm, 2, 1, rate, SAMPLE_RATE, None)
    return pcm


def spitch_stt_sync(pcm8k: bytes, lang: str) -> str:
    wav_bytes = pcm8k_to_wav_bytes(pcm8k)
    boundary = f"----SpitchBoundary{uuidlib.uuid4().hex}"
    parts: List[bytes] = []

    def add_field(name: str, value: str) -> None:
        parts.append(
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="{name}"\r\n\r\n'
            f"{value}\r\n".encode("utf-8")
        )

    add_field("language", lang)
    add_field("special_words", GOMBE_SPECIAL_WORDS)
    parts.append(
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="content"; filename="utterance.wav"\r\n'
        f"Content-Type: audio/wav\r\n\r\n".encode("utf-8")
    )
    parts.append(wav_bytes)
    parts.append(f"\r\n--{boundary}--\r\n".encode("utf-8"))
    body = b"".join(parts)

    req = urllib.request.Request(
        "https://api.spitch.app/v1/transcriptions",
        data=body,
        headers={
            "Authorization": f"Bearer {CFG.spitch_api_key}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=25) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return str(data.get("text") or "").strip()


def spitch_translate_sync(text: str, source: str, target: str) -> str:
    if not text.strip() or source == target:
        return text
    payload = json.dumps({"source": source, "target": target, "text": text[:1200]}).encode("utf-8")
    req = urllib.request.Request(
        "https://api.spitch.app/v1/translate",
        data=payload,
        headers={
            "Authorization": f"Bearer {CFG.spitch_api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return str(data.get("text") or text).strip()


# ── Gombe Situation Room API Tools ───────────────────────────────────────────


def call_agent_tool_sync(tool_path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    if not CFG.agent_tool_key:
        return {"ok": False, "error": "AGENT_TOOL_KEY not configured"}
    url = f"{CFG.api_base_url}/api/agent-tools/{tool_path.lstrip('/')}"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {CFG.agent_tool_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore")
        log.warning("Tool %s HTTP %s: %s", tool_path, e.code, body[:200])
        return {"ok": False, "error": f"HTTP {e.code}", "detail": body[:200]}
    except Exception as exc:
        log.warning("Tool %s failed: %s", tool_path, exc)
        return {"ok": False, "error": str(exc)}


# ── LLM + Tool Orchestration ─────────────────────────────────────────────────


LLM_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_knowledge",
            "description": "Search the Dr. Jamil Isyaku Gwamna IMPACTS Manifesto (2027-2031), Party Agent Field Handbook, SMS/USSD codes, and Situation Room protocols.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query in English"}
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_incident_ticket",
            "description": "Log an election-day incident or polling unit report into the Situation Room dashboard and receive a 5-digit reference number.",
            "parameters": {
                "type": "object",
                "properties": {
                    "subject": {"type": "string", "description": "Short incident title"},
                    "description": {"type": "string", "description": "Detailed report of what happened"},
                    "lga": {"type": "string", "description": "Gombe LGA (Akko, Balanga, Billiri, Dukku, Funakaye, Gombe, Kaltungo, Kwami, Nafada, Shongom, Yamaltu/Deba)"},
                    "ward": {"type": "string", "description": "Ward / Registration Area if known"},
                    "community": {"type": "string", "description": "Polling unit code or community name"},
                    "isOngoing": {"type": "boolean", "description": "True if incident is happening right now"},
                    "victimsOrInjuries": {"type": "string", "description": "Any injuries or threats reported"},
                },
                "required": ["subject", "description"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "request_callback",
            "description": "Schedule a callback from a Situation Room desk officer when the caller asks for a human coordinator or legal officer.",
            "parameters": {
                "type": "object",
                "properties": {
                    "reason": {"type": "string", "description": "Why the caller needs a callback"},
                },
                "required": ["reason"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "end_call",
            "description": "Call this only when the caller confirms they are done or says goodbye.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]


def system_prompt_for(lang: str, caller_id: str, caller_profile: Optional[Dict[str, Any]]) -> str:
    known_info = ""
    if caller_profile and caller_profile.get("known"):
        known_info = f"\nReturning caller profile: {json.dumps(caller_profile)[:400]}"

    if lang == "ha":
        lang_rule = (
            "Speak ONLY in clear, natural, respectful Northern Nigerian Hausa. "
            "Your name is Hasan. Keep every spoken reply short (1 to 3 clear sentences, under 18 seconds when spoken) "
            "with NO markdown, NO bullet symbols, and NO emojis."
        )
    else:
        lang_rule = (
            "Speak ONLY in clear, warm, natural Nigerian English. "
            "Your name is Kingsley. Keep every spoken reply short (1 to 3 clear sentences, under 18 seconds when spoken) "
            "with NO markdown, NO bullet symbols, and NO emojis."
        )

    return (
        "You are the official AI voice assistant for the Dr. Jamil Isyaku Gwamna (Sardaunan Gombe) "
        "2027 APC Governorship Campaign and Election-Day Situation Room in Gombe State, Nigeria.\n"
        f"{lang_rule}\n"
        f"Caller phone number: {caller_id or 'unknown'}.{known_info}\n\n"
        "Core Rules:\n"
        "- Coverage: all 11 LGAs of Gombe State (Akko, Balanga, Billiri, Dukku, Funakaye, Gombe, Kaltungo, Kwami, Nafada, Shongom, Yamaltu/Deba), 114 Registration Areas, 2,988 INEC polling units.\n"
        "- You are NOT the Gombe State Government and NOT INEC. You represent Dr. Jamil Isyaku Gwamna's APC 2027 Campaign Situation Room.\n"
        "- SAFETY FIRST: If a caller reports active violence, weapons, ballot snatching, or injury, immediately instruct them to move to safety and dial 112, then call create_incident_ticket with isOngoing=true and read back the 5-digit reference slowly.\n"
        "- MANIFESTO / HANDBOOK: Always call search_knowledge (with an English query) for questions about Dr. Jamil Isyaku Gwamna's IMPACTS Manifesto (2027-2031), SMS/USSD reporting codes, or party agent duties. Never invent promises or official election results.\n"
        "- INCIDENTS: For polling unit incidents (BVAS failure, late materials, vote buying, EC8A tampering, intimidation), confirm LGA, ward/polling unit, and what happened, then call create_incident_ticket and read back the exact reference number.\n"
        "- HUMAN DESK OFFICER: Never claim to transfer live. Offer a Situation Room desk-officer callback using request_callback."
    )


def run_llm_turn_sync(
    messages: List[Dict[str, Any]],
    caller_id: str,
) -> Tuple[str, bool]:
    """Execute one OpenAI-compatible LLM turn with up to 3 tool-call hops."""
    should_hangup = False
    for _ in range(3):
        payload = {
            "model": CFG.llm_model,
            "messages": messages,
            "tools": LLM_TOOLS,
            "tool_choice": "auto",
            "temperature": 0.3,
            "max_tokens": 220,
        }
        req = urllib.request.Request(
            f"{CFG.llm_base_url}/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {CFG.llm_api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        choice = data["choices"][0]["message"]
        tool_calls = choice.get("tool_calls") or []
        if not tool_calls:
            reply = (choice.get("content") or "").strip()
            messages.append({"role": "assistant", "content": reply})
            return reply, should_hangup

        messages.append(choice)
        for tc in tool_calls:
            fn = tc["function"]["name"]
            try:
                args = json.loads(tc["function"].get("arguments") or "{}")
            except Exception:
                args = {}

            if fn == "search_knowledge":
                res = call_agent_tool_sync("search-knowledge", {"query": args.get("query", "")})
            elif fn == "create_incident_ticket":
                res = call_agent_tool_sync(
                    "create-ticket",
                    {
                        "phoneNumber": caller_id,
                        "subject": args.get("subject", "Polling unit incident report"),
                        "description": args.get("description", ""),
                        "lga": args.get("lga"),
                        "ward": args.get("ward"),
                        "community": args.get("community"),
                        "isOngoing": bool(args.get("isOngoing")),
                        "victimsOrInjuries": args.get("victimsOrInjuries"),
                        "summaryConfirmed": True,
                    },
                )
            elif fn == "request_callback":
                res = call_agent_tool_sync(
                    "request-callback",
                    {
                        "phoneNumber": caller_id,
                        "reason": args.get("reason", "Caller requested Situation Room desk officer"),
                        "numberConfirmed": True,
                    },
                )
            elif fn == "end_call":
                should_hangup = True
                res = {"ok": True, "action": "end_call"}
            else:
                res = {"ok": False, "error": f"Unknown tool {fn}"}

            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": json.dumps(res)[:2000],
                }
            )

    return "", should_hangup


def run_spitch_direct_turn_sync(user_text: str, lang: str, caller_id: str) -> Tuple[str, bool]:
    """
    Zero-external-LLM fallback using Spitch Translate + live Gombe API tools.
    Ensures Hausa and Nigerian English callers get real manifesto answers,
    incident filing, and callbacks even if LLM_API_KEY is unset or unavailable.
    """
    english_text = (
        spitch_translate_sync(user_text, "ha", "en") if lang == "ha" else user_text
    )
    low = english_text.lower()

    # Check goodbye
    if re.search(r"\b(goodbye|bye|thank you bye|that is all|nothing else|sai an jima|na gode sai gobe)\b", low):
        farewell = (
            "Na gode da kiran dakin kula da zabe na Dakta Jamil Isyaku Gwamna. Sai an jima."
            if lang == "ha"
            else "Thank you for calling the Doctor Jamil Isyaku Gwamna 2027 A P C Election Situation Room. Goodbye."
        )
        return farewell, True

    # Detect LGA if mentioned
    detected_lga = next((lga for lga in GOMBE_LGAS if lga.lower().split("/")[0] in low), None)

    # Detect emergency / incident keywords
    is_urgent = bool(re.search(r"\b(violen|attack|fight|thug|gun|shoot|snatch|weapon|kill|injur|blood)\b", low))
    is_incident = is_urgent or bool(
        re.search(
            r"\b(bvas|ballot|material|vote buy|buying vote|intimidat|ec8a|result|over.?vot|rigg|collation|irev|polling unit|report|incident|problem|delay)\b",
            low,
        )
    )

    if is_incident:
        res = call_agent_tool_sync(
            "create-ticket",
            {
                "phoneNumber": caller_id,
                "subject": f"Voice Incident Report ({detected_lga or 'Gombe'})",
                "description": f"[{lang.upper()} voice] {english_text}",
                "lga": detected_lga,
                "isOngoing": is_urgent,
                "summaryConfirmed": True,
            },
        )
        ref = res.get("ticketNumber") or res.get("reference") or ""
        if is_urgent:
            en_reply = (
                f"Please move to a safe place and dial 1 1 2 immediately for emergency help. "
                f"I have flagged your urgent report with the Situation Room desk"
                + (f" under reference {' '.join(list(str(ref)))}." if ref else ".")
            )
        else:
            en_reply = (
                f"Thank you. Your polling unit report has been logged with the Situation Room desk"
                + (f" under reference {' '.join(list(str(ref)))}." if ref else ".")
                + " A coordinator will follow up. Is there anything else you want to report?"
            )
        reply = spitch_translate_sync(en_reply, "en", "ha") if lang == "ha" else en_reply
        return reply, False

    # Detect callback request
    if re.search(r"\b(call me back|callback|speak to someone|human|officer|coordinator|lawyer)\b", low):
        res = call_agent_tool_sync(
            "request-callback",
            {
                "phoneNumber": caller_id,
                "reason": english_text[:300],
                "numberConfirmed": True,
            },
        )
        ref = res.get("reference") or ""
        en_reply = (
            "A Situation Room desk officer will call you back on this number shortly"
            + (f". Your callback reference is {' '.join(list(str(ref)))}." if ref else ".")
            + " Is there anything else I can assist you with?"
        )
        reply = spitch_translate_sync(en_reply, "en", "ha") if lang == "ha" else en_reply
        return reply, False

    # Knowledge search (IMPACTS Manifesto, Party Agent Handbook, Situation Room Protocol)
    kb = call_agent_tool_sync("search-knowledge", {"query": english_text})
    speak = str(kb.get("speak") or "").strip()
    if speak:
        # Trim to 2-3 clean spoken sentences
        clean_lines = [
            re.sub(r"^[#*\-\s]+", "", ln).strip()
            for ln in speak.splitlines()
            if ln.strip() and not ln.strip().startswith("Also known as:")
        ]
        summary = " ".join(clean_lines)[:360]
        if "." in summary[120:]:
            summary = summary[: summary.rfind(".") + 1]
        en_reply = f"{summary} Would you like more details or to log a polling unit report?"
    else:
        en_reply = (
            "I am here to help with Doctor Jamil Isyaku Gwamna's IMPACTS manifesto "
            "or to log an election-day polling unit report. Please tell me what you need."
        )
    reply = spitch_translate_sync(en_reply, "en", "ha") if lang == "ha" else en_reply
    return reply, False


# ── AudioSocket Call Handler ─────────────────────────────────────────────────


async def send_frame(writer: asyncio.StreamWriter, msg_type: int, payload: bytes) -> None:
    header = struct.pack("!BH", msg_type, len(payload))
    writer.write(header + payload)
    await writer.drain()


async def stream_pcm(
    writer: asyncio.StreamWriter,
    pcm8k: bytes,
    stop_event: asyncio.Event,
) -> None:
    """Stream 8kHz slin16 PCM to Asterisk in paced 20ms (320-byte) AudioSocket frames."""
    if not pcm8k:
        return
    # Pad tail to 320-byte boundary
    rem = len(pcm8k) % FRAME_BYTES
    if rem:
        pcm8k += b"\x00" * (FRAME_BYTES - rem)

    t0 = time.monotonic()
    for idx in range(0, len(pcm8k), FRAME_BYTES):
        if stop_event.is_set() or writer.is_closing():
            break
        chunk = pcm8k[idx : idx + FRAME_BYTES]
        await send_frame(writer, MSG_AUDIO, chunk)
        frame_num = (idx // FRAME_BYTES) + 1
        target = t0 + frame_num * 0.020
        delay = target - time.monotonic()
        if delay > 0:
            await asyncio.sleep(delay)


async def handle_audiosocket(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    loop = asyncio.get_running_loop()
    call_uuid = ""
    session: Dict[str, Any] = {"callerId": "", "lang": "ha"}
    playback_stop = asyncio.Event()
    is_speaking = False
    hangup_requested = False

    async def speak_text(text: str, lang: str) -> None:
        nonlocal is_speaking
        if not text.strip():
            return
        try:
            t0 = time.time()
            pcm = await loop.run_in_executor(EXECUTOR, spitch_tts_sync, text, lang)
            log.info("[%s] TTS %s (%dms, %.1fs): %s", call_uuid[:8], lang, int((time.time() - t0) * 1000), len(pcm) / 16000, text[:90])
            playback_stop.clear()
            is_speaking = True
            await stream_pcm(writer, pcm, playback_stop)
        except Exception as exc:
            log.error("[%s] TTS error: %s", call_uuid[:8], exc)
        finally:
            is_speaking = False

    try:
        # 1. Read initial UUID frame (0x01)
        hdr = await asyncio.wait_for(reader.readexactly(3), timeout=5.0)
        mtype, mlen = struct.unpack("!BH", hdr)
        payload = await asyncio.wait_for(reader.readexactly(mlen), timeout=5.0)
        if mtype == MSG_UUID and mlen == 16:
            call_uuid = str(uuidlib.UUID(bytes=payload))
        else:
            call_uuid = str(uuidlib.uuid4())

        session = SESSIONS.pop(call_uuid, None) or SESSIONS.pop(call_uuid.replace("-", ""), None) or {"callerId": "", "lang": "ha"}
        lang = "en" if session.get("lang") == "en" else "ha"
        caller_id = str(session.get("callerId") or "")
        log.info("[%s] Call connected: caller=%s lang=%s", call_uuid[:8], caller_id or "unknown", lang)

        # Look up caller in background while greeting plays
        profile_fut = loop.run_in_executor(
            EXECUTOR,
            call_agent_tool_sync,
            "lookup-customer",
            {"phoneNumber": caller_id},
        ) if caller_id else None

        opening = (
            "Sannu da zuwa. Sunana Hasan daga dakin kula da zabe na Dakta Jamil Isyaku Gwamna. "
            "Kana da rahoton rumfar zabe ko tambaya game da manufofin IMPACTS?"
            if lang == "ha"
            else "Hello, my name is Kingsley from the Doctor Jamil Isyaku Gwamna 2027 A P C Election Situation Room. "
            "Are you calling with a polling unit report, or a question about the IMPACTS manifesto?"
        )
        await speak_text(opening, lang)

        caller_profile = None
        if profile_fut:
            try:
                caller_profile = await asyncio.wait_for(profile_fut, timeout=2.0)
            except Exception:
                caller_profile = None

        messages: List[Dict[str, Any]] = [
            {"role": "system", "content": system_prompt_for(lang, caller_id, caller_profile)},
            {"role": "assistant", "content": opening},
        ]

        # 2. Main VAD + Turn Loop
        speech_buf = bytearray()
        in_speech = False
        speech_frames = 0
        silence_frames = 0
        idle_frames = 0
        prompted_silence = 0
        RMS_THRESHOLD = 420
        SILENCE_END_FRAMES = 42  # 840ms of silence ends utterance
        MIN_SPEECH_FRAMES = 14   # 280ms minimum real speech
        MAX_UTTERANCE_FRAMES = 1000  # 20s cap
        IDLE_PROMPT_FRAMES = 450  # 9s of silence prompts caller

        while not hangup_requested:
            try:
                hdr = await asyncio.wait_for(reader.readexactly(3), timeout=30.0)
            except (asyncio.IncompleteReadError, asyncio.TimeoutError):
                break
            mtype, mlen = struct.unpack("!BH", hdr)
            payload = await reader.readexactly(mlen) if mlen else b""

            if mtype == MSG_HANGUP or mtype == MSG_ERROR:
                log.info("[%s] Remote hangup (type=0x%02x)", call_uuid[:8], mtype)
                break
            if mtype == MSG_DTMF:
                digit = payload.decode("ascii", errors="ignore")
                log.info("[%s] Mid-call DTMF: %s", call_uuid[:8], digit)
                if digit == "1" and lang != "ha":
                    lang = "ha"
                    await speak_text("An koma harshen Hausa. Yaya zan taimaka maka?", "ha")
                elif digit == "2" and lang != "en":
                    lang = "en"
                    await speak_text("Switched to Nigerian English. How can I help you?", "en")
                continue
            if mtype != MSG_AUDIO or is_speaking:
                continue

            rms = audioop.rms(payload, 2) if len(payload) >= 2 else 0
            if rms >= RMS_THRESHOLD:
                in_speech = True
                speech_frames += 1
                silence_frames = 0
                idle_frames = 0
                speech_buf.extend(payload)
                if speech_frames < MAX_UTTERANCE_FRAMES:
                    continue
            elif in_speech:
                silence_frames += 1
                speech_buf.extend(payload)
                if silence_frames < SILENCE_END_FRAMES:
                    continue
            else:
                idle_frames += 1
                if idle_frames >= IDLE_PROMPT_FRAMES:
                    idle_frames = 0
                    prompted_silence += 1
                    if prompted_silence >= 2:
                        bye = (
                            "Ban ji muryarka ba. Na gode da kira, sai an jima."
                            if lang == "ha"
                            else "I cannot hear you on the line. Thank you for calling, goodbye."
                        )
                        await speak_text(bye, lang)
                        break
                    check = (
                        "Kana kan layi har yanzu? Ina sauraronka."
                        if lang == "ha"
                        else "Are you still on the line? I am listening."
                    )
                    await speak_text(check, lang)
                continue

            # Utterance completed
            captured = bytes(speech_buf)
            captured_frames = speech_frames
            speech_buf.clear()
            in_speech = False
            speech_frames = 0
            silence_frames = 0

            if captured_frames < MIN_SPEECH_FRAMES:
                continue

            t0 = time.time()
            try:
                transcript = await loop.run_in_executor(EXECUTOR, spitch_stt_sync, captured, lang)
            except Exception as exc:
                log.error("[%s] STT error: %s", call_uuid[:8], exc)
                continue

            log.info("[%s] STT %s (%dms): %s", call_uuid[:8], lang, int((time.time() - t0) * 1000), transcript)
            if len(transcript.strip()) < 2:
                continue

            prompted_silence = 0
            messages.append({"role": "user", "content": transcript})

            reply = ""
            should_end = False
            if CFG.llm_api_key:
                try:
                    reply, should_end = await loop.run_in_executor(
                        EXECUTOR, run_llm_turn_sync, messages, caller_id
                    )
                except Exception as exc:
                    log.warning("[%s] LLM call failed (%s), falling back to Spitch-Direct mode", call_uuid[:8], exc)
                    reply, should_end = await loop.run_in_executor(
                        EXECUTOR, run_spitch_direct_turn_sync, transcript, lang, caller_id
                    )
            else:
                reply, should_end = await loop.run_in_executor(
                    EXECUTOR, run_spitch_direct_turn_sync, transcript, lang, caller_id
                )

            if reply:
                await speak_text(reply, lang)
            if should_end:
                hangup_requested = True
                await send_frame(writer, MSG_HANGUP, b"")
                break

    except Exception as exc:
        log.error("[%s] Call handler exception: %s", call_uuid[:8] or "init", exc)
    finally:
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass
        log.info("[%s] Call closed", call_uuid[:8] or "init")


# ── Local HTTP Control Server (for Asterisk CURL() + /health) ────────────────


async def handle_http(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        raw = await asyncio.wait_for(reader.read(8192), timeout=5.0)
        text = raw.decode("utf-8", errors="ignore")
        first_line = text.splitlines()[0] if text else ""
        parts = first_line.split(" ")
        method = parts[0] if len(parts) > 0 else "GET"
        target = parts[1] if len(parts) > 1 else "/"
        parsed = urllib.parse.urlparse(target)

        if parsed.path == "/health":
            body = json.dumps(
                {
                    "ok": bool(CFG.spitch_api_key),
                    "mode": "llm+spitch" if CFG.llm_api_key else "spitch-direct",
                    "voices": {"ha": CFG.ha_voice, "en": CFG.en_voice},
                    "apiToolsConfigured": bool(CFG.agent_tool_key),
                    "activeRegisteredSessions": len(SESSIONS),
                }
            ).encode("utf-8")
            resp = (
                b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n"
                + f"Content-Length: {len(body)}\r\nConnection: close\r\n\r\n".encode("ascii")
                + body
            )
            writer.write(resp)
            await writer.drain()
            return

        if parsed.path == "/session":
            qs = urllib.parse.parse_qs(parsed.query)
            if method == "POST" and "\r\n\r\n" in text:
                post_body = text.split("\r\n\r\n", 1)[1].strip()
                if post_body.startswith("{"):
                    try:
                        jb = json.loads(post_body)
                        for k, v in jb.items():
                            qs[k] = [str(v)]
                    except Exception:
                        pass
                elif "=" in post_body:
                    qs.update(urllib.parse.parse_qs(post_body))

            sid = (qs.get("uuid") or [""])[0].strip() or str(uuidlib.uuid4())
            caller = (qs.get("caller") or [""])[0].strip()
            lang = (qs.get("lang") or ["ha"])[0].strip().lower()
            if lang not in ("ha", "en"):
                lang = "ha"

            # Evict stale entries older than 30 min
            now = time.time()
            for k in [k for k, v in SESSIONS.items() if now - v.get("ts", 0) > 1800]:
                SESSIONS.pop(k, None)

            SESSIONS[sid] = {"callerId": caller, "lang": lang, "ts": now}
            log.info("Registered session %s (caller=%s, lang=%s)", sid[:8], caller or "unknown", lang)
            body = sid.encode("utf-8")
            resp = (
                b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n"
                + f"Content-Length: {len(body)}\r\nConnection: close\r\n\r\n".encode("ascii")
                + body
            )
            writer.write(resp)
            await writer.drain()
            return

        writer.write(b"HTTP/1.1 404 Not Found\r\nContent-Length: 9\r\nConnection: close\r\n\r\nNot Found")
        await writer.drain()
    except Exception as exc:
        log.warning("HTTP control error: %s", exc)
    finally:
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass


async def main() -> None:
    global CFG
    load_env(os.environ.get("BRIDGE_ENV_FILE", "/opt/sip-bridge/bridge.env"))
    CFG = Config()
    if not CFG.spitch_api_key:
        log.error("SPITCH_API_KEY is missing — set it in /opt/sip-bridge/bridge.env")

    http_srv = await asyncio.start_server(handle_http, "127.0.0.1", CFG.http_port)
    as_srv = await asyncio.start_server(handle_audiosocket, "127.0.0.1", CFG.audiosocket_port)
    log.info(
        "Spitch Bilingual Voice Agent listening: HTTP=127.0.0.1:%d AudioSocket=127.0.0.1:%d mode=%s ha=%s en=%s",
        CFG.http_port,
        CFG.audiosocket_port,
        "llm+spitch" if CFG.llm_api_key else "spitch-direct",
        CFG.ha_voice,
        CFG.en_voice,
    )
    async with http_srv, as_srv:
        await asyncio.gather(http_srv.serve_forever(), as_srv.serve_forever())


if __name__ == "__main__":
    asyncio.run(main())
