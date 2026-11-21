# GOHEALTH Verification Checklist

> Run these checks to confirm every layer of the GOHEALTH setup is working correctly.

---

## 1. 🖥️ UI Branding Checks
**Open:** http://localhost:3000

Login with:
- **Email:** `admin@acedemo.com`
- **Password:** `Admin@2030!`

After login, confirm the following in the sidebar:

| What to check | Expected result |
|---|---|
| Browser tab | `GOHEALTH — Enrollee Helpline & Management System` |
| Sidebar logo icon | Green health cross (not purple sparkle) |
| Sidebar app name | `GOHEALTH` |
| Sidebar tagline | `Enrollee Helpline Portal` |
| Org badge (sidebar) | `GOHEALTH` with green `LIVE` badge |
| Sidebar section 1 heading | `HELPLINE` |
| First nav item | `Enrollees & Contacts` (not "CRM & Contacts") |
| Telephony nav item | `Helpline & Telephony` |
| Scheduling nav item | `Appointments` |
| Sidebar section 2 heading | `CHANNELS` |
| Sidebar section 3 heading | `ADMINISTRATION` |
| Top breadcrumb | `GOHEALTH` in green (not "Care Agent" in indigo) |
| User avatar color | Green gradient (not indigo/purple) |

---

## 2. 📚 Knowledge Base Check
**Open:** http://localhost:3000/knowledge

Confirm you see **5 documents** loaded:

| Expected Document | Status |
|---|---|
| About Gohealth | ✅ Should appear |
| Health Plans | ✅ Should appear |
| Healthcare Facilities | ✅ Should appear |
| Faqs | ✅ Should appear |
| Grievance Complaints | ✅ Should appear |

Also confirm FAQs tab shows **20 GOHEALTH FAQ entries** covering topics like enrollment, benefits, complaints, drug coverage.

---

## 3. 🗄️ Database Verification (Terminal)

Run this in the project folder to verify the org was updated:

```bash
node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.organization.findFirst({ where: { slug: 'gohealth' } })
  .then(o => {
    console.log('Org name:', o.name);
    console.log('Slug:', o.slug);
    console.log('Welcome msg:', o.welcomeMessage?.slice(0, 80));
  })
  .finally(() => p.\$disconnect());
"
```

**Expected output:**
```
Org name: GOHEALTH
Slug: gohealth
Welcome msg: Hello! Welcome to the GOHEALTH Helpline — Gombe State Contributory...
```

---

## 4. 🤖 ElevenLabs Agent Verification (Terminal)

Run this to confirm the agent on ElevenLabs was updated:

```bash
curl -s \
  -H "xi-api-key: sk_859d9ab10df8f59678f2c97c3e9dfdb0f64973a6b8d6b048" \
  "https://api.elevenlabs.io/v1/convai/agents/agent_3801m0c9terzf58tskm00cp3d008" \
  | python3 -c "
import json, sys
d = json.load(sys.stdin)
print('Agent Name  :', d.get('name'))
print('First Message:', d.get('conversation_config',{}).get('agent',{}).get('first_message','')[:80])
print('Voice ID    :', d.get('conversation_config',{}).get('tts',{}).get('voice_id'))
print('Tool count  :', len(d.get('tools', [])))
"
```

**Expected output:**
```
Agent Name  : GOHEALTH — Sarah
First Message: Hello! Welcome to the GOHEALTH Helpline — Gombe State Contributory...
Voice ID    : EXAVITQu4vr4xnSDxMaL
Tool count  : 9
```

---

## 5. 🎙️ Voice Agent Test (ElevenLabs Dashboard)

1. Go to **https://elevenlabs.io** → Conversational AI → Agents
2. Find **"GOHEALTH — Sarah"**
3. Click **"Talk to Agent"**
4. Say: *"Hello, who are you?"*

**Expected response:** Sarah greets as a GOHEALTH Helpline Officer, NOT as an AI

5. Ask: *"What is the informal sector plan?"*

**Expected:** She explains ₦12,000/person or ₦50,000/family, GOHEALTH plans, and references proper contacts

6. Ask: *"The hospital is asking me to pay money even though I have my card — what do I do?"*

**Expected:** She explains enrollee rights, says to call 0700-700-1111, and guides how to report the facility

---

## 6. 📞 Telephony Page Check
**Open:** http://localhost:3000/telephony

Confirm:
- Page label is **"Helpline & Telephony"** in the nav
- Twilio config section shows the phone number `+17372212163`
- ElevenLabs agent section shows the agent ID `agent_3801m0c9terzf58tskm00cp3d008`

> **Note:** Twilio number cannot be auto-linked until the Twilio account is upgraded from Trial to a paid plan.

---

## 7. ⚙️ Settings Page Check
**Open:** http://localhost:3000/settings

Confirm:
- Organization name shows **GOHEALTH**
- Welcome message shows the GOHEALTH helpline greeting with `{name}` placeholder
- AI Persona/Prompt section contains the GOHEALTH system prompt

---

## 8. 🧪 API Health Check (Terminal)

```bash
curl -s http://localhost:4000/api/health | python3 -m json.tool
```

**Expected:**
```json
{
  "status": "ok",
  "database": "connected",
  ...
}
```

---

## 9. 🔑 Login API Test (Terminal)

```bash
curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@acedemo.com","password":"Admin@2030!"}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('Login OK:', 'access_token' in d); print('Org:', d.get('user',{}).get('organizationName','—'))"
```

**Expected:**
```
Login OK: True
Org: GOHEALTH
```

---

## Summary of All Changes Made

| Layer | Change |
|---|---|
| **UI** | GOHEALTH logo, green colors, relabeled nav, updated title & breadcrumb |
| **Database** | Org renamed to GOHEALTH, new persona prompt, new welcome message |
| **FAQs** | 20 GOHEALTH-specific Q&As seeded |
| **Knowledge Base** | 5 documents: About, Plans, Facilities, FAQs, Grievances |
| **ElevenLabs Agent** | Agent renamed "GOHEALTH — Sarah", greeting updated, 9 tools synced |
| **Agent Prompt** | Full GOHEALTH-specific context: plans, benefits, LGAs, complaint handling |
| **Voice** | Sarah voice (warm, professional — ElevenLabs ID: EXAVITQu4vr4xnSDxMaL) |
