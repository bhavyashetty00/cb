# Executive Intelligence Suite (EIS)

> Board-level meeting intelligence platform. Secure. Private. AI-powered.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    FRONTEND (React)                      │
│  Login → Dashboard → Live Meeting → Archive → Detail    │
│  JWT Auth | Socket.io | MediaRecorder API | SW          │
└────────────────────┬────────────────────────────────────┘
                     │ HTTPS + WSS
┌────────────────────▼────────────────────────────────────┐
│               BACKEND (Node.js + Express)                │
│  /api/auth  /api/meetings  Socket.io server             │
│  JWT validation | Rate limiting | Helmet | Audit logs   │
└──────────┬────────────────────────┬────────────────────┘
           │ Mongoose               │ HTTP
┌──────────▼──────────┐  ┌─────────▼──────────────────────┐
│   MongoDB Atlas     │  │   AI SERVICE (Python/Flask)     │
│   meetings          │  │   Whisper STT | spaCy NLP       │
│   users             │  │   Claude API commands           │
│   Full-text index   │  │   /transcribe /insights /command│
└─────────────────────┘  └────────────────────────────────┘
           │
┌──────────▼──────────┐
│  Local Storage      │
│  /recordings/*.webm │
│  Admin-controlled   │
└─────────────────────┘
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, React Router, Socket.io-client |
| Backend | Node.js 20, Express 4, Socket.io, JWT |
| Database | MongoDB 7 with full-text search indexes |
| AI/ML | Python 3.11, OpenAI Whisper, spaCy, Claude API |
| Auth | JWT (access 15min + refresh 7d) + optional PIN |
| Storage | Local filesystem for audio, MongoDB for metadata |
| Deploy | Netlify (frontend) + Railway/Fly.io (backend) + Render (AI) |

---

## Folder Structure

```
eis/
├── frontend/               # React SPA
│   ├── src/
│   │   ├── pages/          # LoginPage, DashboardPage, MeetingPage, ArchivePage, MeetingDetailPage
│   │   ├── components/     # Sidebar
│   │   ├── context/        # AuthContext, SocketContext
│   │   └── utils/          # api.js (Axios + token refresh interceptor)
│   ├── public/sw.js        # Service Worker (background recording)
│   └── netlify.toml        # Netlify deploy config
├── backend/                # Express API
│   ├── routes/             # auth.js, meetings.js
│   ├── models/             # User.js, Meeting.js
│   ├── middleware/         # auth.js, socketAuth.js
│   ├── services/           # aiService.js, adminSetup.js
│   ├── config/             # logger.js (Winston)
│   └── server.js
├── ai-service/             # Python Flask microservice
│   ├── app.py              # Whisper + spaCy + Claude
│   ├── requirements.txt
│   └── Dockerfile
├── docker-compose.yml      # Full local stack
└── netlify.toml            # Frontend + proxy config
```

---

## Quick Start (Development)

### Prerequisites
- Node.js 20+, Python 3.11+, Docker (optional)

### 1. Clone & configure

```bash
cp backend/.env.example backend/.env
# Edit backend/.env — set MONGODB_URI, JWT_SECRET, ADMIN_PASSWORD
```

### 2. Start with Docker Compose

```bash
docker-compose up --build
```

Or manually:

```bash
# MongoDB (or use Atlas)
mongod --dbpath ./data

# AI Service
cd ai-service
pip install -r requirements.txt
python -m spacy download en_core_web_sm
ANTHROPIC_API_KEY=your_key python app.py

# Backend
cd backend
npm install
npm run dev

# Frontend
cd frontend
npm install
npm run dev
```

### 3. Access
- Frontend: http://localhost:5173
- Backend API: http://localhost:4000
- AI Service: http://localhost:5001

---

## API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Login (username + password + optional PIN) |
| POST | `/api/auth/logout` | Logout + invalidate refresh token |
| POST | `/api/auth/refresh` | Get new access token |
| GET | `/api/auth/me` | Get current user |

### Meetings
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/meetings/start` | Start new meeting session |
| POST | `/api/meetings/transcribe-chunk` | Send 5s audio chunk for live transcription |
| POST | `/api/meetings/stop` | Stop meeting, save full audio |
| POST | `/api/meetings/command` | Run AI command against transcript |
| GET | `/api/meetings` | List meetings (paginated) |
| GET | `/api/meetings/stats` | Dashboard statistics |
| GET | `/api/meetings/search?q=...` | Full-text search |
| GET | `/api/meetings/:id` | Meeting detail |
| POST | `/api/meetings/:id/mark` | Mark key moment |
| GET | `/api/meetings/:id/export?type=pdf\|docx\|txt` | Export |

### AI Service (internal)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/transcribe` | Whisper audio transcription |
| POST | `/insights` | Extract keywords/actions/summary |
| POST | `/command` | NL command via Claude API |
| GET | `/health` | Health check |

---

## Deployment

### Frontend → Netlify

1. Push `frontend/` to GitHub
2. Connect repo to Netlify
3. Set build settings:
   - Base: `frontend`
   - Build: `npm run build`
   - Publish: `frontend/dist`
4. Environment: `VITE_BACKEND_URL=https://your-backend.railway.app`
5. Update `netlify.toml` proxy URL

### Backend → Railway

```bash
cd backend
railway init
railway up
railway variables set MONGODB_URI=... JWT_SECRET=... ADMIN_PASSWORD=...
```

### AI Service → Render

```bash
# In Render dashboard:
# - Runtime: Python 3.11
# - Build: pip install -r requirements.txt && python -m spacy download en_core_web_sm
# - Start: gunicorn --bind 0.0.0.0:5001 app:app
# - Env: ANTHROPIC_API_KEY=...
```

### Audio Storage
For production, replace local `/recordings` with S3-compatible storage:
- AWS S3 + presigned URLs
- Cloudflare R2 (cheaper, S3-compatible)
- MinIO (self-hosted)

---

## Security

| Concern | Implementation |
|---------|---------------|
| Authentication | JWT access (15min) + refresh tokens (7d), bcrypt passwords |
| Admin access | Single admin model, all routes protected |
| Rate limiting | 200 req/15min general, 10/15min on login |
| Headers | Helmet.js (CSP, HSTS, XFO) |
| Audit logs | Winston logs all login/logout events |
| Recording access | Auth-protected static file serving |
| Token revocation | Refresh tokens stored in DB, cleared on logout |
| Input validation | Schema validation on all inputs |

---

## Voice Commands (examples)

| Command | Result |
|---------|--------|
| `"Summarize last 5 minutes"` | AI summary of recent transcript |
| `"Highlight decisions"` | Extract decision points |
| `"Add note: budget risk"` | Marks key moment with label |
| `"List action items"` | All extracted actions |
| `"Who said what about timeline"` | Semantic search in transcript |

---

## Environment Variables

```bash
# backend/.env
NODE_ENV=production
PORT=4000
MONGODB_URI=mongodb+srv://...
JWT_SECRET=64_char_random_string
JWT_REFRESH_SECRET=64_char_random_string
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_strong_password
ADMIN_PIN=123456                    # optional
AI_SERVICE_URL=https://ai.example.com
AUDIO_STORAGE_PATH=./recordings
FRONTEND_URL=https://app.netlify.app

# ai-service env
ANTHROPIC_API_KEY=sk-ant-...
WHISPER_MODEL=base                  # tiny|base|small|medium|large
AI_PORT=5001
```

---

## Scaling Strategy

- **Horizontal**: Backend stateless (JWT) → scale with PM2 cluster or multiple Railway instances
- **Database**: MongoDB Atlas auto-scaling, add read replicas for search
- **AI**: Whisper GPU instance on Modal/Replicate for fast transcription
- **Storage**: S3 with CloudFront for audio files
- **Caching**: Redis for session management + frequently searched meetings
- **Monitoring**: Logtail or Datadog for audit trail review

---

## License

Proprietary — Executive use only. Not for redistribution.
